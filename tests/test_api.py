from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from mobile_data_tracker import api
from mobile_data_tracker.api import app
from mobile_data_tracker.models import CarrierConfig
from mobile_data_tracker.providers.carrier import CarrierError, CarrierTimeoutError


@pytest.fixture(autouse=True)
def reset_usage_limiter(monkeypatch):
    monkeypatch.setattr(api, "usage_limiter", api.UsageRateLimiter())


def test_health_does_not_contact_carrier():
    with patch("mobile_data_tracker.providers.carrier.httpx.Client") as carrier_http:
        with TestClient(app) as client:
            response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    carrier_http.assert_not_called()


@pytest.fixture
def usage_client(home_response):
    with patch.object(api.CarrierConfig, "from_env", return_value=CarrierConfig()), \
         patch.object(api, "CarrierProvider") as provider_factory:
        provider = provider_factory.return_value
        provider.login.return_value = "login-token"
        provider.get_access_token.return_value = "access-token"
        provider.get_home.return_value = home_response
        with TestClient(app) as client:
            yield client, provider_factory, provider


def test_usage_runs_flow_and_closes_session(usage_client):
    client, factory, provider = usage_client
    response = client.post('/v1/usage', json={'username': 'alice', 'password': 'secret'})
    assert response.status_code == 200
    assert response.json()['remaining_gb'] == 15.0
    assert response.json()['expiration_date'] == '2027-01-02'
    assert response.headers['cache-control'] == 'no-store'
    config = factory.call_args.args[0]
    assert config.username == 'alice'
    assert config.password == 'secret'
    provider.login.assert_called_once_with()
    provider.get_access_token.assert_called_once_with(login_token='login-token')
    provider.get_home.assert_called_once_with(access_token='access-token')
    provider.close.assert_called_once_with()


@pytest.mark.parametrize('body', [
    {}, {'username': 'alice'}, {'username': '', 'password': 'secret'},
    {'username': 'alice', 'password': '   '},
    {'username': 123, 'password': 'secret'},
    {'username': 'alice', 'password': {'private': 'secret'}},
])
def test_invalid_credentials_are_not_echoed(usage_client, body):
    client, factory, _ = usage_client
    response = client.post('/v1/usage', json=body)
    assert response.status_code == 422
    assert response.json() == {'detail': 'Invalid request body.'}
    assert response.headers['cache-control'] == 'no-store'
    factory.assert_not_called()


@pytest.mark.parametrize('error,status', [
    (CarrierError('private-token'), 502),
    (CarrierTimeoutError('private-token'), 504),
    (ValueError('private-token'), 502),
    (RuntimeError('private-token'), 500),
])
def test_usage_errors_are_sanitized_and_close_session(usage_client, error, status):
    client, _, provider = usage_client
    provider.login.side_effect = error
    response = client.post('/v1/usage', json={'username': 'alice', 'password': 'secret'})
    assert response.status_code == status
    assert 'private-token' not in response.text
    assert response.headers['cache-control'] == 'no-store'
    provider.close.assert_called_once_with()


def test_each_request_gets_its_own_configuration(usage_client):
    client, factory, _ = usage_client
    for username in ['alice', 'bob']:
        assert client.post('/v1/usage', json={'username': username, 'password': 'secret'}).status_code == 200
    configs = [call.args[0] for call in factory.call_args_list]
    assert [config.username for config in configs] == ['alice', 'bob']
    assert configs[0] is not configs[1]


def test_third_attempt_is_blocked_before_contacting_carrier(usage_client, monkeypatch):
    client, factory, _ = usage_client
    monkeypatch.setattr(api, "monotonic", lambda: 1000.0)
    body = {"username": "alice", "password": "secret"}
    assert client.post("/v1/usage", json=body).status_code == 200
    assert client.post("/v1/usage", json=body).status_code == 200
    response = client.post("/v1/usage", json=body)
    assert response.status_code == 429
    assert response.headers["retry-after"] == "900"
    assert response.headers["cache-control"] == "no-store"
    assert factory.call_count == 2
    assert client.get("/health").status_code == 200


def test_rolling_window_expires_attempts_individually(usage_client, monkeypatch):
    client, _, _ = usage_client
    clock = [1000.0]
    monkeypatch.setattr(api, "monotonic", lambda: clock[0])
    body = {"username": "alice", "password": "secret"}
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
    client, factory, provider = usage_client
    provider.login.side_effect = CarrierError("Rejected")
    body = {"username": "alice", "password": "secret"}
    assert [client.post("/v1/usage", json=body).status_code for _ in range(3)] == [502, 502, 429]
    assert factory.call_count == 2


def test_invalid_input_does_not_consume_attempts(usage_client):
    client, _, _ = usage_client
    for _ in range(3):
        assert client.post("/v1/usage", json={}).status_code == 422
    assert client.post("/v1/usage", json={"username": "alice", "password": "secret"}).status_code == 200


def test_callers_have_independent_limits(usage_client):
    client, _, _ = usage_client
    body = {"username": "alice", "password": "secret"}
    for _ in range(2):
        assert client.post("/v1/usage", json=body).status_code == 200
    with TestClient(app, client=("other-client", 12345)) as other_client:
        assert other_client.post("/v1/usage", json=body).status_code == 200


def test_concurrent_attempts_cannot_exceed_limit():
    from concurrent.futures import ThreadPoolExecutor

    from fastapi import HTTPException

    def attempt(_):
        try:
            api.usage_limiter.check("same-caller")
            return 200
        except HTTPException as exc:
            return exc.status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(attempt, range(8)))
    assert statuses.count(200) == 2
    assert statuses.count(429) == 6
