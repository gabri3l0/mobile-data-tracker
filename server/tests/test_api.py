from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.api import rate_limit, routes
from src.api.app import app
from src.providers.telcel.parser import parse_usage
from src.exceptions import CarrierError, CarrierTimeoutError


@pytest.fixture(autouse=True)
def reset_usage_limiter(monkeypatch):
    monkeypatch.setattr(app.state, "usage_limiter", rate_limit.UsageRateLimiter())
    monkeypatch.setenv("API_KEYS", '{"alice":"alice-api-key","bob":"bob-api-key"}')


def test_health_does_not_contact_carrier():
    with patch("src.providers.telcel.provider.httpx.Client") as carrier_http:
        with TestClient(app) as client:
            response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    carrier_http.assert_not_called()


@pytest.fixture
def usage_client(home_response):
    with patch.object(routes, "MobileDataTracker") as tracker_constructor:
        provider = tracker_constructor.return_value
        provider.get_usage_data.return_value = parse_usage(home_response)
        with TestClient(app, headers={"Authorization": "Bearer alice-api-key"}) as client:
            yield client, tracker_constructor, provider


def test_usage_runs_flow_and_closes_session(usage_client):
    client, constructor, provider = usage_client
    response = client.post('/v1/usage', json={'carrier': 'telcel', 'username': 'alice', 'password': 'secret'})
    assert response.status_code == 200
    assert response.json()['remaining_gb'] == 15.0
    assert response.json()['expiration_date'] == '2027-01-02'
    assert response.headers['cache-control'] == 'no-store'
    constructor.assert_called_once_with(carrier="telcel", username="alice", password="secret")
    provider.get_usage_data.assert_called_once_with()
    provider.close.assert_called_once_with()


@pytest.mark.parametrize('body', [
    {}, {'carrier': 'telcel', 'username': 'alice'}, {'carrier': 'telcel', 'username': '', 'password': 'secret'},
    {'carrier': 'telcel', 'username': 'alice', 'password': '   '},
    {'carrier': 'telcel', 'username': 123, 'password': 'secret'},
    {'carrier': 'telcel', 'username': 'alice', 'password': {'private': 'secret'}},
])
def test_invalid_credentials_are_not_echoed(usage_client, body):
    client, constructor, _ = usage_client
    response = client.post('/v1/usage', json=body)
    assert response.status_code == 422
    assert response.json() == {'detail': 'Invalid request body.'}
    assert response.headers['cache-control'] == 'no-store'
    constructor.assert_not_called()


@pytest.mark.parametrize('error,status', [
    (CarrierError('private-token'), 502),
    (CarrierTimeoutError('private-token'), 504),
    (ValueError('private-token'), 502),
    (RuntimeError('private-token'), 500),
])
def test_usage_errors_are_sanitized_and_close_session(usage_client, error, status):
    client, _, provider = usage_client
    provider.get_usage_data.side_effect = error
    response = client.post('/v1/usage', json={'carrier': 'telcel', 'username': 'alice', 'password': 'secret'})
    assert response.status_code == status
    assert 'private-token' not in response.text
    assert response.headers['cache-control'] == 'no-store'
    provider.close.assert_called_once_with()


def test_each_request_selects_carrier_and_account(usage_client):
    client, constructor, _ = usage_client
    for username in ['alice', 'bob']:
        assert client.post('/v1/usage', json={'carrier': 'telcel', 'username': username, 'password': 'secret'}).status_code == 200
    assert [call.kwargs["carrier"] for call in constructor.call_args_list] == ["telcel", "telcel"]
    assert [call.kwargs["username"] for call in constructor.call_args_list] == ["alice", "bob"]


def test_third_attempt_is_blocked_before_contacting_carrier(usage_client, monkeypatch):
    client, constructor, _ = usage_client
    monkeypatch.setattr(rate_limit, "monotonic", lambda: 1000.0)
    body = {"carrier": "telcel", "username": "alice", "password": "secret"}
    assert client.post("/v1/usage", json=body).status_code == 200
    assert client.post("/v1/usage", json=body).status_code == 200
    response = client.post("/v1/usage", json=body)
    assert response.status_code == 429
    assert response.headers["retry-after"] == "900"
    assert response.headers["cache-control"] == "no-store"
    assert constructor.call_count == 2
    assert client.get("/health").status_code == 200


def test_rolling_window_expires_attempts_individually(usage_client, monkeypatch):
    client, _, _ = usage_client
    clock = [1000.0]
    monkeypatch.setattr(rate_limit, "monotonic", lambda: clock[0])
    body = {"carrier": "telcel", "username": "alice", "password": "secret"}
    assert client.post("/v1/usage", json=body).status_code == 200
    clock[0] = 1100.0
    assert client.post("/v1/usage", json=body).status_code == 200
    clock[0] = 1899.5
    blocked = client.post("/v1/usage", json=body)
    assert blocked.status_code == 429
    assert blocked.headers["retry-after"] == "1"
    clock[0] = 1900.0
    assert client.post("/v1/usage", json=body).status_code == 200
    assert client.post("/v1/usage", json=body).headers["retry-after"] == "100"


def test_failed_carrier_attempts_count_toward_limit(usage_client):
    client, constructor, provider = usage_client
    provider.get_usage_data.side_effect = CarrierError("Rejected")
    body = {"carrier": "telcel", "username": "alice", "password": "secret"}
    assert [client.post("/v1/usage", json=body).status_code for _ in range(3)] == [502, 502, 429]
    assert constructor.call_count == 2


def test_invalid_input_does_not_consume_attempts(usage_client):
    client, _, _ = usage_client
    for _ in range(3):
        assert client.post("/v1/usage", json={}).status_code == 422
    assert client.post("/v1/usage", json={"carrier": "telcel", "username": "alice", "password": "secret"}).status_code == 200


def test_callers_have_independent_limits(usage_client):
    client, _, _ = usage_client
    body = {"carrier": "telcel", "username": "alice", "password": "secret"}
    for _ in range(2):
        assert client.post("/v1/usage", json=body).status_code == 200
    # Same IP, different person: separate allowance.
    with TestClient(app, headers={"Authorization": "Bearer bob-api-key"}) as other_client:
        assert other_client.post("/v1/usage", json=body).status_code == 200


def test_concurrent_attempts_cannot_exceed_limit():
    from concurrent.futures import ThreadPoolExecutor

    from fastapi import HTTPException

    def attempt(_):
        try:
            app.state.usage_limiter.check("same-caller")
            return 200
        except HTTPException as exc:
            return exc.status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(attempt, range(8)))
    assert statuses.count(200) == 2
    assert statuses.count(429) == 6


@pytest.mark.parametrize('authorization', ['', 'Bearer wrong-key', 'Basic alice-api-key', 'Bearer'])
def test_missing_or_invalid_key_is_rejected_without_using_allowance(usage_client, authorization):
    client, constructor, _ = usage_client
    body = {'carrier': 'telcel', 'username': 'alice', 'password': 'secret'}
    response = client.post('/v1/usage', json=body, headers={'Authorization': authorization})
    assert response.status_code == 401
    assert response.headers['www-authenticate'] == 'Bearer'
    assert response.headers['cache-control'] == 'no-store'
    assert response.json() == {'detail': 'Missing or invalid API key.'}
    constructor.assert_not_called()
    assert app.state.usage_limiter._attempts == {}


def test_same_person_shares_limit_across_ips(usage_client):
    client, _, _ = usage_client
    body = {'carrier': 'telcel', 'username': 'alice', 'password': 'secret'}
    for _ in range(2):
        assert client.post('/v1/usage', json=body).status_code == 200
    with TestClient(app, client=('other-ip', 12345), headers={'Authorization': 'Bearer alice-api-key'}) as other_client:
        assert other_client.post('/v1/usage', json=body).status_code == 429


@pytest.mark.parametrize('configured_keys', [
    '', 'invalid-private-value', '{}', '[]', '{"alice":""}',
    '{"alice":123}', '{"alice":[]}', '{"":"key"}',
    '{"alice":"same","bob":"same"}', '{"alice":"two words"}',
])
def test_invalid_api_keys_prevent_startup(monkeypatch, configured_keys):
    monkeypatch.setenv('API_KEYS', configured_keys)
    with pytest.raises(RuntimeError, match='API_KEYS must be') as error:
        with TestClient(app):
            pass
    assert 'invalid-private-value' not in str(error.value)


def test_missing_api_keys_prevent_startup(monkeypatch):
    monkeypatch.delenv('API_KEYS')
    with pytest.raises(RuntimeError, match='API_KEYS must be'):
        with TestClient(app):
            pass


def test_openapi_describes_bearer_authentication():
    with TestClient(app) as client:
        schema = client.get('/openapi.json').json()
    assert schema['components']['securitySchemes']['HTTPBearer']['scheme'] == 'bearer'
    assert schema['paths']['/v1/usage']['post']['security'] == [{'HTTPBearer': []}]
    assert 'security' not in schema['paths']['/health']['get']


def test_revoked_key_is_rejected_after_restart(usage_client, monkeypatch):
    _, constructor, _ = usage_client
    monkeypatch.setenv('API_KEYS', '{"bob":"bob-api-key"}')
    with TestClient(app) as client:
        response = client.post('/v1/usage', json={'carrier': 'telcel', 'username': 'alice', 'password': 'secret'},
                               headers={'Authorization': 'Bearer alice-api-key'})
    assert response.status_code == 401
    constructor.assert_not_called()


@pytest.mark.parametrize("carrier", [None, "bait", "unknown", "", 123])
def test_carrier_is_required_and_must_be_supported(usage_client, carrier):
    client, constructor, _ = usage_client
    body = {"username": "alice", "password": "private-password"}
    if carrier is not None:
        body["carrier"] = carrier
    response = client.post("/v1/usage", json=body)
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid request body."}
    assert response.headers["cache-control"] == "no-store"
    constructor.assert_not_called()
    assert app.state.usage_limiter._attempts == {}


def test_client_initialization_failure_is_sanitized(usage_client):
    client, constructor, _ = usage_client
    constructor.side_effect = ValueError("private-configuration")
    response = client.post("/v1/usage", json={
        "carrier": "telcel", "username": "alice", "password": "secret",
    })
    assert response.status_code == 502
    assert "private-configuration" not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_cleanup_failure_is_sanitized(usage_client):
    client, _, provider = usage_client
    provider.close.side_effect = RuntimeError("private-token")
    response = client.post("/v1/usage", json={
        "carrier": "telcel", "username": "alice", "password": "secret",
    })
    assert response.status_code == 500
    assert "private-token" not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_openapi_requires_carrier_and_exposes_only_telcel():
    with TestClient(app) as client:
        schema = client.get("/openapi.json").json()["components"]["schemas"]["UsageRequest"]
    assert "carrier" in schema["required"]
    assert schema["properties"]["carrier"]["const"] == "telcel"


def test_usage_endpoint_runs_real_telcel_provider_with_mocked_http(carrier, home_response, monkeypatch):
    from src.providers.telcel.config import TelcelConfig

    monkeypatch.setattr(TelcelConfig, "from_env", lambda: carrier.provider.config)
    carrier.payloads = [
        {"estatus": "ok", "token": "login-token"},
        {"message": "Éxito.", "tokenResponse": {"tokens": [
            {"id": "token:b2f", "access_token": "access-token"},
        ]}},
        home_response,
    ]
    with TestClient(app, headers={"Authorization": "Bearer alice-api-key"}) as client:
        response = client.post("/v1/usage", json={
            "carrier": "telcel", "username": "alice", "password": "secret",
        })
    assert response.status_code == 200
    assert response.json() == parse_usage(home_response)
    assert [r.url.path for r in carrier.requests] == ["/login", "/token", "/home"]
    assert carrier.requests[1].url.params["user"] == "alice"
    assert carrier.http.is_closed
