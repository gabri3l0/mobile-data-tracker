import base64
from dataclasses import replace

import httpx
import pytest

from src.exceptions import CarrierError
from src.providers.telcel.web_auth import extract_basic_auth, find_bundle


PUBLIC_BASIC = base64.b64encode(b"web-client:public-configuration").decode()
PAGE = '<script type="module" src="/assets/index-test123.js"></script>'
BUNDLE = f'const config = {{MTL_AUTHORIZATION_BASIC:"{PUBLIC_BASIC}"}};'


def exchange_payload():
    return {"message": "Éxito.", "tokenResponse": {"tokens": [
        {"id": "token:b2f", "access_token": "personal-access"},
    ]}}


@pytest.mark.parametrize("quote", ['"', "'"])
@pytest.mark.parametrize("quoted_key", [False, True])
def test_extracts_static_client_configuration(quote, quoted_key):
    key = f"{quote}MTL_AUTHORIZATION_BASIC{quote}" if quoted_key else "MTL_AUTHORIZATION_BASIC"
    assert extract_basic_auth(f"{{ {key}: {quote}{PUBLIC_BASIC}{quote} }}") == PUBLIC_BASIC


@pytest.mark.parametrize("value", ["bad", "", "with spaces", "dXNlcm5hbWU=", "OnBhc3N3b3Jk", "dXNlcjpwYXNzCg=="])
def test_rejects_invalid_discovered_credentials(value):
    with pytest.raises(ValueError):
        extract_basic_auth(f'MTL_AUTHORIZATION_BASIC:"{value}"')


@pytest.mark.parametrize("source", [
    "/assets/index-test123.js", "https://carrier.example/assets/index-test123.js",
    "/assets/index-test123.js?v=1&amp;other=2",
])
def test_finds_same_origin_bundle(source):
    result = find_bundle(f"<script src='{source}'></script>", "https://carrier.example/mitelcel/login")
    assert result.startswith("https://carrier.example/assets/index-test123.js")
    assert "&amp;" not in result


@pytest.mark.parametrize("source", [
    "https://other.example/assets/index-test.js", "//other.example/assets/index-test.js",
    "http://carrier.example/assets/index-test.js", "/other/index-test.js", "javascript:alert(1)",
])
def test_rejects_unexpected_bundle_origins_and_paths(source):
    with pytest.raises(ValueError):
        find_bundle(f'<script src="{source}"></script>', "https://carrier.example/mitelcel/login")


def test_discovers_on_each_exchange_without_credentials_or_raw_logs(carrier, caplog, capsys):
    carrier.provider.config = replace(carrier.provider.config, basic_auth="")
    carrier.payload = exchange_payload()
    for _ in range(2):
        carrier.discovery_responses = [httpx.Response(200, text=PAGE), httpx.Response(200, text=BUNDLE)]
        with caplog.at_level("DEBUG", logger="src"):
            assert carrier.provider.get_access_token(login_token="sso-token") == "personal-access"
        assert carrier.requests[-1].headers["Authorization"] == f"Basic {PUBLIC_BASIC}"
    assert len(carrier.discovery_requests) == 4
    for request in carrier.discovery_requests:
        assert request.method == "GET"
        assert "authorization" not in request.headers
        assert request.headers.get("cookie", "") == ""
        assert request.content == b""
        assert request.extensions["timeout"]["read"] == 5.0
        assert not request.url.query
    output = caplog.text + capsys.readouterr().out
    for value in (PUBLIC_BASIC, "public-configuration", PAGE, BUNDLE):
        assert value not in output


@pytest.mark.parametrize("failure", [
    httpx.Response(503), httpx.ReadTimeout("private-details"),
    httpx.Response(200, text="<html>Request Rejected</html>"),
    httpx.Response(200, text='<script src="https://other.example/assets/index-test.js"></script>'),
])
def test_discovery_failure_uses_configured_fallback(carrier, failure):
    carrier.discovery_responses = [failure]
    assert carrier.provider.get_basic_auth() == "test-basic"
    assert len(carrier.discovery_requests) == 1


def test_malformed_bundle_uses_fallback(carrier):
    carrier.discovery_responses = [httpx.Response(200, text=PAGE), httpx.Response(200, text="missing key")]
    assert carrier.provider.get_basic_auth() == "test-basic"
    assert len(carrier.discovery_requests) == 2


def test_cross_origin_redirect_never_requested(carrier):
    carrier.discovery_responses = [httpx.Response(302, headers={"Location": "https://other.example/assets/index-test.js"})]
    assert carrier.provider.get_basic_auth() == "test-basic"
    assert len(carrier.discovery_requests) == 1


def test_same_origin_redirect_is_followed_and_loops_are_bounded(carrier):
    carrier.discovery_responses = [
        httpx.Response(302, headers={"Location": "/mitelcel/login?next=1"}),
        httpx.Response(200, text=PAGE), httpx.Response(200, text=BUNDLE),
    ]
    assert carrier.provider.get_basic_auth() == PUBLIC_BASIC
    assert len(carrier.discovery_requests) == 3
    carrier.discovery_requests.clear()
    carrier.discovery_responses = [httpx.Response(302, headers={"Location": "/mitelcel/login"}) for _ in range(4)]
    assert carrier.provider.get_basic_auth() == "test-basic"
    assert len(carrier.discovery_requests) == 4


def test_no_fallback_fails_clearly_and_still_revokes_session(carrier):
    carrier.provider.config = replace(carrier.provider.config, basic_auth="")
    carrier.payload = {"estatus": "ok", "token": "sso-token"}
    with pytest.raises(CarrierError, match="no Basic-auth fallback"):
        carrier.provider.get_usage_data()
    assert [request.url.path for request in carrier.requests] == ["/login", "/revoke"]


def test_rejected_exchange_is_not_retried_and_still_revokes(carrier):
    carrier.discovery_responses = [httpx.Response(200, text=PAGE), httpx.Response(200, text=BUNDLE)]
    carrier.payloads = [{"estatus": "ok", "token": "sso-token"}]
    carrier.status = 401
    # Keep login successful while rejecting only the exchange.
    original_request = carrier.http.request

    def request(method, url, **kwargs):
        if method == "POST" and str(url).endswith("/login"):
            carrier.status = 200
            result = original_request(method, url, **kwargs)
            carrier.status = 401
            return result
        return original_request(method, url, **kwargs)

    carrier.http.request = request
    with pytest.raises(CarrierError, match="HTTP 401"):
        carrier.provider.get_usage_data()
    assert [request.url.path for request in carrier.requests] == ["/login", "/token", "/revoke"]
    assert len(carrier.discovery_requests) == 2
