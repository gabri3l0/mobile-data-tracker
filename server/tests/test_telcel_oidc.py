import logging
import runpy
from dataclasses import replace
from pathlib import Path
from urllib.parse import parse_qs
from unittest.mock import Mock

import httpx
import pytest

from src.exceptions import CarrierError, CarrierTimeoutError
from src.providers.telcel.oidc import code_from_response, sso_token


@pytest.fixture
def oidc_carrier(carrier):
    carrier.provider.config = replace(carrier.provider.config, username="5555555555")
    return carrier


def authorize(request):
    return httpx.Response(200, headers={
        "x-oidc-redirect-location": f"https://callback.example/?code=private-code&state={request.url.params['state']}",
        "content-type": "application/octet-stream",
    })


def exchange_payload():
    return {"message": "Éxito.", "tokenResponse": {"tokens": [
        {"id": "token:b2f", "access_token": "private-b2f"},
    ]}}


def oidc_success(carrier):
    carrier.oidc_responses = [authorize, httpx.Response(200, json={
        "error": "Seccessful", "error_description": "", "access_token": "private-sso",
    })]


@pytest.mark.parametrize("failure", ["empty", "html", "json", "credentials", "missing_token", "http", "timeout", "connection"])
def test_auto_fallback_once_for_each_legacy_post_failure(oidc_carrier, home_response, monkeypatch, caplog, failure):
    c = oidc_carrier
    oidc_success(c)
    c.payloads = [exchange_payload(), home_response]
    original = c.http.request
    posts = []

    def request(method, url, **kwargs):
        if method == "POST" and str(url) == c.provider.config.login_url:
            posts.append(1)
            if failure == "timeout":
                raise httpx.ReadTimeout("private-request-details")
            if failure == "connection":
                raise httpx.ConnectError("private-request-details")
            responses = {
                "empty": httpx.Response(200, text=""),
                "html": httpx.Response(200, text="<title>Request Rejected</title>"),
                "json": httpx.Response(200, text="not-json-private"),
                "credentials": httpx.Response(200, json={"estatus": "failed"}),
                "missing_token": httpx.Response(200, json={"estatus": "ok"}),
                "http": httpx.Response(403),
            }
            response = responses[failure]
            response.request = httpx.Request(method, url)
            return response
        return original(method, url, **kwargs)

    monkeypatch.setattr(c.http, "request", request)
    with caplog.at_level(logging.DEBUG, logger="src"):
        result = c.provider.get_usage_data(preserve_units=True)
    assert result["remaining_data"] == 15
    assert len(posts) == 1
    assert [r.url.path for r in c.oidc_requests] == ["/oid-authorize-prod/authorize", "/oid-authorize-prod/token"]
    assert [r.url.path for r in c.requests] == ["/token", "/home", "/revoke"]
    assert "Trying OIDC once" in caplog.text
    assert all(s not in caplog.text for s in ["5555555555", "test-password", "private-code", "private-sso", "private-b2f", "private-request-details", "not-json-private", "test-basic"])


@pytest.mark.parametrize("page", [
    httpx.Response(200, text="<title>Request Rejected</title>"),
    httpx.Response(503), httpx.ReadTimeout("private-page-details"),
])
def test_fallback_when_initial_page_fails(oidc_carrier, page):
    c = oidc_carrier
    c.login_page_responses = [page]
    oidc_success(c)
    assert c.provider.login() == "private-sso"
    assert len(c.login_page_requests) == 1
    assert c.requests == []
    assert len(c.oidc_requests) == 2


def test_legacy_success_skips_oidc(carrier):
    carrier.payload = {"estatus": "ok", "token": "legacy-sso"}
    assert carrier.provider.login() == "legacy-sso"
    assert carrier.oidc_requests == []


def test_legacy_get_keeps_cookie_for_post(carrier):
    carrier.login_page_responses = [httpx.Response(200, text="login", headers={"set-cookie": "session=private-cookie; Path=/"})]
    carrier.payload = {"estatus": "ok", "token": "legacy-sso"}
    assert carrier.provider.login(auth_mode="legacy") == "legacy-sso"
    assert carrier.requests[0].headers["cookie"] == "session=private-cookie"


def test_oidc_parameters_tokens_and_cleanup(oidc_carrier, home_response):
    c = oidc_carrier
    oidc_success(c)
    c.payloads = [exchange_payload(), home_response]
    assert c.provider.get_usage_data(auth_mode="oidc")["remaining_gb"] == 15
    assert c.login_page_requests == []
    first, second = c.oidc_requests
    assert first.method == "GET"
    assert first.headers["USERNAME"] == "525555555555"
    assert first.headers["PASSWORD"] == "test-password"
    assert first.url.params["state"] != first.url.params["nonce"]
    assert first.url.params["response_type"] == "code"
    assert first.url.params["scope"] == "openid"
    assert first.url.params["acr_values"] == "1"
    assert "USERNAME" not in second.headers and "PASSWORD" not in second.headers
    form = parse_qs(second.content.decode())
    assert form == {"grant_type": ["authorization_code"], "client_id": [c.provider.config.oidc_client_id],
                    "redirect_uri": [c.provider.config.oidc_redirect_uri], "code": ["private-code"]}
    assert first.extensions["timeout"]["read"] == 30
    assert parse_qs(c.requests[-1].content.decode())["token"] == ["private-sso"]
    assert c.provider.config.username == "5555555555"


@pytest.mark.parametrize("source", ["json", "body", "location", "header"])
def test_extract_code_without_visiting_callback(source):
    callback = "https://callback.example/?code=private-code&state=expected"
    response = {
        "json": httpx.Response(200, json={"code": "private-code", "state": "expected"}),
        "body": httpx.Response(200, text=callback),
        "location": httpx.Response(302, headers={"location": callback}),
        "header": httpx.Response(200, headers={"x-oidc-redirect-location": callback}),
    }[source]
    assert code_from_response(response, "expected") == "private-code"


@pytest.mark.parametrize("payload", [{"code": "code", "state": "wrong"}, {}, {"error": "access_denied", "error_description": "Password_not_valid"}])
def test_authorize_invalid_payload_stops(payload):
    with pytest.raises(CarrierError):
        code_from_response(httpx.Response(200, json=payload), "expected")


def test_redirect_with_code_does_not_forward_credentials(oidc_carrier):
    c = oidc_carrier
    c.oidc_responses = [httpx.Response(302, headers={"location": "https://other.example/callback?code=code"}),
                        httpx.Response(200, json={"access_token": "sso"})]
    assert c.provider.login(auth_mode="oidc") == "sso"
    assert len(c.oidc_requests) == 2
    assert all(r.url.host == "www.mitelcel.com" for r in c.oidc_requests)


@pytest.mark.parametrize("response", [httpx.Response(200), httpx.Response(500), httpx.ReadTimeout("private-details"), httpx.Response(200, json={"error": "access_denied"})])
def test_oidc_failure_stops_without_token_exchange_or_logout(oidc_carrier, response):
    c = oidc_carrier
    c.oidc_responses = [response]
    with pytest.raises(CarrierError):
        c.provider.get_usage_data(auth_mode="oidc")
    assert len(c.oidc_requests) == 1
    assert c.requests == []


@pytest.mark.parametrize("payload", [
    {"error": "Seccessful", "access_token": "sso"},
    {"error": "Seccessful", "tokenResponse": {"tokens": [{"id": "token:mit", "access_token": "sso"}]}},
])
def test_success_marker_is_not_an_error_with_token(payload):
    assert sso_token(httpx.Response(200, json=payload)) == "sso"


@pytest.mark.parametrize("payload", [{"error": "Seccessful"}, {"id_token": "private-id"}, {"access_token": " "}, {"error": "private-error", "error_description": "private-description"}])
def test_missing_token_or_unknown_error_never_leaks_payload(payload):
    with pytest.raises(CarrierError) as exc:
        sso_token(httpx.Response(200, json=payload))
    assert "private-" not in str(exc.value)


@pytest.mark.parametrize("stage", ["exchange", "home", "parser"])
def test_post_login_failure_revokes_without_fallback(oidc_carrier, monkeypatch, stage):
    c = oidc_carrier
    oidc_success(c)
    # Starting directly in OIDC excludes legacy; no authentication restart may occur.
    monkeypatch.setattr(c.provider, "login_legacy", Mock(side_effect=AssertionError("Unexpected legacy login")))
    c.payloads = [exchange_payload(), {}]
    if stage == "exchange":
        monkeypatch.setattr(c.provider, "get_access_token", Mock(side_effect=CarrierError("Exchange failed")))
    elif stage == "home":
        monkeypatch.setattr(c.provider, "get_home", Mock(side_effect=CarrierError("Home failed")))
    with pytest.raises((CarrierError, ValueError)):
        c.provider.get_usage_data(auth_mode="oidc")
    assert len(c.oidc_requests) == 2
    assert c.requests[-1].url.path == "/revoke"


@pytest.mark.parametrize("stage", ["exchange", "home", "parser"])
def test_auto_legacy_session_never_restarts_authentication(carrier, monkeypatch, stage):
    carrier.payload = {"estatus": "ok", "token": "legacy-sso"}
    oidc = Mock(side_effect=AssertionError("Unexpected fallback after successful login"))
    monkeypatch.setattr(carrier.provider, "login_oidc", oidc)
    if stage == "exchange":
        monkeypatch.setattr(carrier.provider, "get_access_token", Mock(side_effect=CarrierError("Exchange failed")))
    else:
        monkeypatch.setattr(carrier.provider, "get_access_token", Mock(return_value="b2f"))
        monkeypatch.setattr(carrier.provider, "get_home", Mock(side_effect=CarrierError("Home failed")) if stage == "home" else Mock(return_value={}))
    with pytest.raises((CarrierError, ValueError)):
        carrier.provider.get_usage_data()
    oidc.assert_not_called()
    assert carrier.requests[-1].url.path == "/revoke"


def test_both_logins_fail_once_and_no_revocation(oidc_carrier):
    c = oidc_carrier
    c.payload = {"estatus": "failed"}
    c.oidc_responses = [httpx.Response(200, json={"error": "access_denied"})]
    with pytest.raises(CarrierError, match="legacy login and OIDC fallback failed"):
        c.provider.get_usage_data()
    assert len(c.requests) == 1
    assert len(c.oidc_requests) == 1


@pytest.mark.parametrize("mode", ["auto", "legacy", "oidc"])
def test_missing_credentials_fail_before_requests(oidc_carrier, mode):
    c = oidc_carrier
    c.provider.config = replace(c.provider.config, password="")
    with pytest.raises(ValueError):
        c.provider.get_usage_data(auth_mode=mode)
    assert not c.requests and not c.login_page_requests and not c.oidc_requests


def test_modes_are_exclusive_and_invalid_modes_send_nothing(carrier):
    carrier.payload = {"estatus": "failed"}
    with pytest.raises(CarrierError):
        carrier.provider.login(auth_mode="legacy")
    assert carrier.oidc_requests == []
    count = len(carrier.requests)
    with pytest.raises(ValueError):
        carrier.provider.login(auth_mode="unknown")
    assert len(carrier.requests) == count


def test_environment_oidc_overrides(monkeypatch):
    from src.providers.telcel.config import TelcelConfig
    monkeypatch.setenv("TELCEL_OIDC_CLIENT_ID", "custom-client")
    monkeypatch.setenv("TELCEL_OIDC_REDIRECT_URI", "https://custom.example/callback")
    config = TelcelConfig.from_env()
    assert config.oidc_client_id == "custom-client"
    assert config.oidc_redirect_uri == "https://custom.example/callback"


@pytest.mark.parametrize("mode", ["legacy", "oidc"])
def test_probe_entrypoint_selects_only_its_mode(monkeypatch, mode):
    scripts = Path(__file__).resolve().parents[1] / "scripts"
    monkeypatch.syspath_prepend(str(scripts))
    import probe_telcel_common
    main = Mock(return_value=0)
    monkeypatch.setattr(probe_telcel_common, "main", main)
    with pytest.raises(SystemExit) as result:
        runpy.run_path(str(scripts / f"probe_telcel_{mode}.py"), run_name="__main__")
    assert result.value.code == 0
    main.assert_called_once_with(mode)


def test_probe_options_and_close_on_failure(monkeypatch, capsys):
    scripts = Path(__file__).resolve().parents[1] / "scripts"
    monkeypatch.syspath_prepend(str(scripts))
    import probe_telcel_common as probe
    monkeypatch.setattr(probe, "load_dotenv", Mock())
    provider = Mock()
    provider.get_usage_data.side_effect = CarrierError("OIDC failed")
    factory = Mock(return_value=provider)
    monkeypatch.setattr(probe, "ProbeProvider", factory)
    assert probe.main("oidc", ["--client-id", "custom", "--redirect-uri", "https://custom.example/callback"]) == 1
    config = factory.call_args.args[0]
    assert config.oidc_client_id == "custom" and config.oidc_redirect_uri == "https://custom.example/callback"
    provider.get_usage_data.assert_called_once_with(preserve_units=True, auth_mode="oidc")
    provider.close.assert_called_once()


def test_oidc_timeout_preserves_shared_timeout_error(oidc_carrier):
    oidc_carrier.payload = {"estatus": "failed"}
    oidc_carrier.oidc_responses = [httpx.ReadTimeout("private-network-url")]
    with pytest.raises(CarrierTimeoutError) as exc:
        oidc_carrier.provider.get_usage_data()
    assert "private-network-url" not in str(exc.value)
    assert len(oidc_carrier.oidc_requests) == 1


@pytest.mark.parametrize("failure", ["http", "timeout"])
def test_oidc_logout_failure_keeps_reading(oidc_carrier, home_response, monkeypatch, failure):
    c = oidc_carrier
    oidc_success(c)
    c.payloads = [exchange_payload(), home_response]
    def fail_revoke(*args, **kwargs):
        if failure == "timeout":
            raise httpx.ReadTimeout("private-logout")
        return httpx.Response(503, request=httpx.Request("POST", c.provider.config.revoke_url))
    monkeypatch.setattr(c.http, "post", fail_revoke)
    assert c.provider.get_usage_data(auth_mode="oidc")["remaining_gb"] == 15


def test_oidc_state_mismatch_in_header_stops_before_token(oidc_carrier):
    c = oidc_carrier
    c.oidc_responses = [httpx.Response(200, headers={
        "x-oidc-redirect-location": "https://callback.example/?code=private-code&state=wrong",
    })]
    with pytest.raises(CarrierError, match="state"):
        c.provider.login(auth_mode="oidc")
    assert len(c.oidc_requests) == 1


def test_oidc_failed_token_stops_before_usage_or_logout(oidc_carrier):
    c = oidc_carrier
    c.oidc_responses = [authorize, httpx.Response(200, json={"error": "Seccessful"})]
    with pytest.raises(CarrierError):
        c.provider.get_usage_data(auth_mode="oidc")
    assert len(c.oidc_requests) == 2
    assert c.requests == []


def test_client_and_main_use_automatic_fallback(oidc_carrier, home_response, monkeypatch, capsys):
    from src.providers.telcel.config import TelcelConfig
    import main
    c = oidc_carrier
    monkeypatch.setattr(TelcelConfig, "from_env", lambda: c.provider.config)
    oidc_success(c)
    c.payloads = [{"estatus": "failed"}, exchange_payload(), home_response]
    monkeypatch.setattr(main, "load_dotenv", Mock())
    main.main([])
    assert "remaining_data" in capsys.readouterr().out
    assert len(c.login_page_requests) == 1
    assert len(c.oidc_requests) == 2
    assert c.requests[-1].url.path == "/revoke"
    assert c.http.is_closed
