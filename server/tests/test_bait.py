from dataclasses import replace
from datetime import datetime, timezone
from unittest.mock import Mock

import httpx
import pytest

from src.exceptions import CarrierError, CarrierTimeoutError
from src.providers.bait import provider as provider_module
from src.providers.bait.config import BaitConfig


def test_get_consumption_request_and_normalized_result(bait, monkeypatch, caplog):
    fetched_at = datetime(2026, 10, 20, 21, 38, tzinfo=timezone.utc)
    clock = Mock()
    clock.now.return_value = fetched_at
    monkeypatch.setattr(provider_module, "datetime", clock)
    with caplog.at_level("DEBUG", logger="src"):
        usage = bait.provider.get_usage_data()
    request, = bait.requests
    assert request.method == "GET"
    assert str(request.url) == "https://bait.example/api/core/q/dn/5512345678/get/consumption"
    assert request.headers["Accept"] == "application/json"
    assert request.headers["x-ord-service"] == "private-service-key"
    assert not request.url.query and not request.content
    assert request.extensions["timeout"]["read"] == 30.0
    assert usage["remaining_gb"] == 13805 / 1024
    assert usage["last_updated"] == fetched_at.isoformat()
    assert usage["data_tier"] == "high_speed"
    clock.now.assert_called_once_with(timezone.utc)
    for secret in ("5512345678", "private-service-key", "bait.example", "Paquete 3 meses"):
        assert secret not in caplog.text


def test_phone_is_encoded_as_one_path_segment(bait):
    bait.provider.config = replace(bait.provider.config, phone="55/12?private=value")
    bait.provider.get_usage_data()
    request, = bait.requests
    assert request.url.raw_path == b"/api/core/q/dn/55%2F12%3Fprivate%3Dvalue/get/consumption"
    assert not request.url.query


@pytest.mark.parametrize("field", ["phone", "service_key"])
def test_missing_configuration_fails_before_request(bait, field):
    bait.provider.config = replace(bait.provider.config, **{field: " "})
    with pytest.raises(ValueError, match="Missing required configuration"):
        bait.provider.get_usage_data()
    assert bait.requests == []


@pytest.mark.parametrize("status", [302, 400, 401, 403, 429, 500])
def test_http_error_omits_request_and_response_details(bait, caplog, status):
    bait.status = status
    bait.content = b"private-response-body"
    with pytest.raises(CarrierError, match=f"HTTP {status}") as error:
        bait.provider.get_usage_data()
    for secret in ("private-response-body", "5512345678", "private-service-key", "bait.example"):
        assert secret not in str(error.value) + caplog.text
    assert error.value.__context__ is None


@pytest.mark.parametrize("error_type,expected", [
    (httpx.ReadTimeout, CarrierTimeoutError),
    (httpx.ConnectTimeout, CarrierTimeoutError),
    (httpx.ConnectError, CarrierError),
    (httpx.InvalidURL, CarrierError),
])
def test_network_errors_are_sanitized_and_keep_timeout_type(bait, monkeypatch, caplog, error_type, expected):
    request = Mock(side_effect=error_type("private-service-key https://bait.example/5512345678"))
    monkeypatch.setattr(bait.http, "get", request)
    with pytest.raises(expected) as error:
        bait.provider.get_usage_data()
    for secret in ("private-service-key", "bait.example", "5512345678"):
        assert secret not in str(error.value) + caplog.text
    assert error.value.__context__ is None


def test_invalid_json_does_not_expose_response(bait, caplog):
    bait.content = b"not-json-private-body"
    with pytest.raises(CarrierError, match="JSON response") as error:
        bait.provider.get_usage_data()
    assert "private-body" not in str(error.value) + caplog.text


def test_unsuccessful_consumption_is_rejected(bait):
    bait.payload = {"success": False, "message": "private-details"}
    with pytest.raises(ValueError, match="unsuccessful") as error:
        bait.provider.get_usage_data()
    assert "private-details" not in str(error.value)


def test_http_client_closes_after_parser_failure(bait):
    bait.payload = {"success": True, "data": []}
    try:
        with pytest.raises(ValueError):
            bait.provider.get_usage_data()
    finally:
        bait.provider.close()
    assert bait.http.is_closed


def test_http_client_closes_after_network_failure(bait):
    bait.status = 500
    try:
        with pytest.raises(CarrierError):
            bait.provider.get_usage_data()
    finally:
        bait.provider.close()
    assert bait.http.is_closed


def test_close_releases_http_client(bait):
    bait.provider.get_usage_data()
    bait.provider.close()
    assert bait.http.is_closed


def test_config_loads_only_credentials_from_environment(monkeypatch):
    monkeypatch.setenv("BAIT_PHONE", "5512345678")
    monkeypatch.setenv("BAIT_SERVICE_KEY", "private-service-key")
    monkeypatch.setenv("BAIT_BASE_URL", "https://untrusted.example")
    config = BaitConfig.from_env()
    assert config.phone == "5512345678"
    assert config.service_key == "private-service-key"
    assert config.base_url == "https://mibait.com/api/core/q/dn"
    assert "private-service-key" not in repr(config)
    assert "5512345678" not in repr(config)
