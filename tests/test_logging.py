import httpx
import pytest

from mobile_data_tracker.providers.carrier import CarrierError


@pytest.mark.parametrize("level", ["INFO", "DEBUG"])
def test_username_only_appears_at_debug(carrier, caplog, level):
    carrier.payload = {"estatus": "ok", "token": "private-token"}
    with caplog.at_level(level, logger="mobile_data_tracker"):
        assert carrier.provider.login() == "private-token"
    assert "Carrier login successful" in caplog.text
    assert ("test-user" in caplog.text) == (level == "DEBUG")
    for secret in ("test-password", "private-token", "carrier.example"):
        assert secret not in caplog.text


def test_http_error_logs_status_without_request_details(carrier, caplog):
    carrier.status = 401
    with caplog.at_level("DEBUG", logger="mobile_data_tracker"):
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
