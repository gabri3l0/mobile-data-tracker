import base64
from dataclasses import replace
from urllib.parse import parse_qs

import pytest

from src.exceptions import CarrierError


def test_login_sends_decoded_password_field_and_encoded_password(carrier):
    carrier.payload = {"estatus": "ok", "token": "login-token"}
    assert carrier.provider.login() == "login-token"
    request, = carrier.requests
    assert request.method == "POST"
    assert request.url.path == "/login"
    form = parse_qs(request.content.decode())
    assert form.pop("username") == ["test-user"]
    assert form.pop("pB64") == ["dGVzdC1wYXNzd29yZA=="]
    assert form.pop("CCode") == ["52"]
    assert form.pop("sitedomain") == ["https://carrier.example"]
    password_field, = form
    assert base64.b64encode(password_field.encode()).decode() == "dGVsY2VsLXBhc3M="
    assert form[password_field] == ["test-password"]


@pytest.mark.parametrize("payload", [
    {"estatus": "failed"}, {"estatus": "ok"},
    {"estatus": "ok", "token": " "}, {"estatus": "ok", "token": 123},
])
def test_login_rejects_failed_status_and_invalid_tokens(carrier, payload):
    carrier.payload = payload
    with pytest.raises(CarrierError):
        carrier.provider.login()


def test_access_token_request_and_nested_response(carrier):
    carrier.payload = {
        "message": "Éxito.",
        "tokenResponse": {"tokens": [
            {"id": "token:other", "access_token": "other-token"},
            {"id": "token:b2f", "access_token": "access-token"},
        ]},
    }
    assert carrier.provider.get_access_token(login_token="login-token") == "access-token"
    request, = carrier.requests
    assert request.method == "GET"
    assert request.url.path == "/token"
    assert dict(request.url.params) == {"user": "test-user", "token": "login-token"}
    assert request.headers["Authorization"] == "Basic test-basic"
    assert request.headers["scope"] == "test-scope"


@pytest.mark.parametrize("payload", [
    {}, {"message": "Éxito."}, {"message": "Éxito.", "tokenResponse": []},
    {"message": "Éxito.", "tokenResponse": {"tokens": {"token:b2f": {"access_token": " "}}}},
    {"message": "Éxito.", "tokenResponse": {"tokens": []}},
    {"message": "Éxito.", "tokenResponse": {"tokens": [
        {"id": "token:other", "access_token": "other-token"},
    ]}},
    {"message": "Éxito.", "tokenResponse": {"tokens": [
        {"id": "token:b2f", "access_token": " "},
    ]}},
    {"message": "Éxito.", "tokenResponse": {"tokens": [
        {"id": "token:b2f"},
    ]}},
])
def test_access_token_rejects_malformed_responses(carrier, payload):
    carrier.payload = payload
    with pytest.raises(CarrierError):
        carrier.provider.get_access_token(login_token="login-token")


def test_home_request_uses_bearer_token(carrier):
    carrier.payload = {"data": {"components": []}}
    assert carrier.provider.get_home(access_token="access-token") == carrier.payload
    request, = carrier.requests
    assert request.method == "GET"
    assert request.url.path == "/home"
    assert dict(request.url.params) == {"externalCode": "test-user"}
    assert request.headers["Authorization"] == "Bearer access-token"


def test_missing_configuration_fails_before_sending_request(carrier):
    carrier.provider.config = replace(carrier.provider.config, password=" ")
    with pytest.raises(ValueError, match="TELCEL_PASSWORD"):
        carrier.provider.login()
    assert carrier.requests == []


def test_invalid_json_is_reported_without_body_contents(carrier, caplog):
    carrier.content = b"invalid-json-with-private-details"
    with pytest.raises(CarrierError, match="Telcel JSON response") as error:
        carrier.provider.get_home(access_token="access-token")
    assert "private-details" not in str(error.value) + caplog.text


def test_non_object_json_is_rejected(carrier):
    carrier.payload = []
    with pytest.raises(CarrierError, match="not an object"):
        carrier.provider.get_home(access_token="access-token")


def test_close_releases_http_client(carrier):
    carrier.provider.close()
    assert carrier.http.is_closed


def test_provider_runs_full_telcel_flow_and_normalizes_usage(carrier, home_response):
    carrier.payloads = [
        {"estatus": "ok", "token": "login-token"},
        {"message": "Éxito.", "tokenResponse": {"tokens": [
            {"id": "token:b2f", "access_token": "access-token"},
        ]}},
        home_response,
    ]
    try:
        usage = carrier.provider.get_usage_data()
    finally:
        carrier.provider.close()
    assert [request.url.path for request in carrier.requests] == ["/login", "/token", "/home", "/revoke"]
    assert carrier.requests[1].url.params["token"] == "login-token"
    assert carrier.requests[2].headers["Authorization"] == "Bearer access-token"
    assert usage["remaining_gb"] == 15.0
    assert usage["expiration_date"] == "2027-01-02"
    assert carrier.http.is_closed


def test_network_timeout_uses_shared_timeout_exception(carrier, monkeypatch):
    import httpx
    from src.exceptions import CarrierTimeoutError

    def timeout(*args, **kwargs):
        raise httpx.ReadTimeout("private-request-details")

    monkeypatch.setattr(carrier.http, "request", timeout)
    with pytest.raises(CarrierTimeoutError) as error:
        carrier.provider.login()
    assert "private-request-details" not in str(error.value)


def test_revoke_posts_only_sso_token_and_accepts_empty_response(carrier, caplog):
    carrier.status = 204
    carrier.content = b""
    with caplog.at_level("DEBUG", logger="src"):
        carrier.provider.revoke_session(login_token="private-sso-token")
    request, = carrier.requests
    assert request.method == "POST"
    assert str(request.url) == "https://carrier.example/revoke"
    assert request.headers["Content-Type"] == "application/x-www-form-urlencoded"
    assert request.headers["Accept"] == "application/json"
    assert "Authorization" not in request.headers
    assert parse_qs(request.content.decode()) == {
        "token": ["private-sso-token"], "token_type": ["revoke"],
    }
    assert request.extensions["timeout"]["read"] == 5.0
    assert "Unable to revoke" not in caplog.text
    assert "private-sso-token" not in caplog.text
    assert "carrier.example" not in caplog.text


@pytest.mark.parametrize("failure", ["http", "timeout"])
def test_revoke_failure_does_not_discard_usage(carrier, home_response, monkeypatch, caplog, failure):
    import httpx

    carrier.payloads = [
        {"estatus": "ok", "token": "private-sso-token"},
        {"message": "Éxito.", "tokenResponse": {"tokens": [
            {"id": "token:b2f", "access_token": "access-token"},
        ]}},
        home_response,
    ]

    def fail_revoke(*args, **kwargs):
        if failure == "timeout":
            raise httpx.ReadTimeout("private-sso-token")
        return httpx.Response(500, request=httpx.Request("POST", "https://private.example/revoke"))

    monkeypatch.setattr(carrier.http, "post", fail_revoke)
    assert carrier.provider.get_usage_data()["remaining_gb"] == 15.0
    assert "Unable to revoke Telcel SSO session" in caplog.text
    assert "private-sso-token" not in caplog.text
    assert "private.example" not in caplog.text


@pytest.mark.parametrize("stage", ["exchange", "home", "parsing"])
def test_revoke_runs_after_failures_and_preserves_original_error(carrier, monkeypatch, stage):
    from unittest.mock import Mock

    monkeypatch.setattr(carrier.provider, "login", Mock(return_value="sso-token"))
    exchange = Mock(return_value="b2f-token")
    home = Mock(return_value={})
    if stage == "exchange":
        exchange.side_effect = CarrierError("Original exchange failure")
    elif stage == "home":
        home.side_effect = CarrierError("Original home failure")
    monkeypatch.setattr(carrier.provider, "get_access_token", exchange)
    monkeypatch.setattr(carrier.provider, "get_home", home)
    # Even an unexpected cleanup error must not replace the original failure.
    revoke = Mock(side_effect=RuntimeError("Cleanup failure"))
    monkeypatch.setattr(carrier.http, "post", revoke)
    expected = "missing tabs-plans" if stage == "parsing" else f"Original {stage} failure"
    with pytest.raises((CarrierError, ValueError), match=expected):
        carrier.provider.get_usage_data()
    revoke.assert_called_once()
    assert revoke.call_args.kwargs["data"]["token"] == "sso-token"


def test_no_revocation_when_login_does_not_produce_token(carrier):
    carrier.payload = {"estatus": "failed"}
    with pytest.raises(CarrierError):
        carrier.provider.get_usage_data()
    assert [request.url.path for request in carrier.requests] == ["/login"]
