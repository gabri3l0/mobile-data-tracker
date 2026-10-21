import httpx
import pytest

from src.providers.carrier import CarrierError


@pytest.mark.parametrize("level", ["INFO", "DEBUG"])
def test_raw_response_and_endpoint_are_only_logged_at_debug(carrier, caplog, level):
    carrier.payload = {"estatus": "ok", "token": "private-token"}
    with caplog.at_level(level, logger="src"):
        assert carrier.provider.login() == "private-token"
    assert "Carrier login successful" in caplog.text
    for secret in ("test-user", "test-password"):
        assert secret not in caplog.text
    for detail in ("private-token", "https://carrier.example/login"):
        assert (detail in caplog.text) == (level == "DEBUG")


def test_http_error_logs_status_without_request_details(carrier, caplog):
    carrier.status = 401
    with caplog.at_level("INFO", logger="src"):
        with pytest.raises(CarrierError):
            carrier.provider.login()
    assert "HTTP 401" in caplog.text
    assert "carrier.example" not in caplog.text
    assert "test-password" not in caplog.text


def test_connection_error_omits_exception_details(carrier, caplog, monkeypatch):
    def fail_request(*args, **kwargs):
        raise httpx.ConnectError("Failed at https://private.example/?token=private-token")

    monkeypatch.setattr(carrier.http, "request", fail_request)
    with pytest.raises(CarrierError):
        carrier.provider.login()
    assert "connection or timeout" in caplog.text
    assert "private.example" not in caplog.text
    assert "private-token" not in caplog.text
