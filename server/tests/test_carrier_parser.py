from unittest.mock import Mock

import pytest

from src.client import MobileDataTracker
from src.providers.carrier_parser import parse_usage


def test_nested_home_response(home_response):
    assert parse_usage(home_response) == {
        "plan_name": "Plan 20 GB",
        "expiration_date": "2027-01-02",
        "days_until": 3,
        "last_updated": "2026-12-30T14:35:00",
        "total_gb": 20.0,
        "used_gb": 5.0,
        "remaining_gb": 15.0,
        "used_percentage": 25.0,
        "remaining_percentage": 75.0,
    }


def test_zero_total(home_response):
    home_response["data"]["components"][1]["config"]["value"] = "0"
    result = parse_usage(home_response)
    assert result["used_percentage"] is None
    assert result["remaining_percentage"] is None


def test_missing_component():
    with pytest.raises(ValueError, match="missing tabs-plans-v2-plan-name"):
        parse_usage({})


@pytest.mark.parametrize("index,config,error", [
    (1, {"value": "invalid"}, "invalid number"),
    (4, {"value": "invalid"}, "invalid last-update-text"),
    (5, {"value": "2 de invalid"}, "invalid text-due-value"),
    (6, {"segments": None}, "invalid cutoff message segments"),
    (6, {"segments": [{"text": "Sin fecha"}]}, "missing the number of days"),
])
def test_malformed_fields(home_response, index, config, error):
    home_response["data"]["components"][index]["config"] = config
    with pytest.raises(ValueError, match=error):
        parse_usage(home_response)


def test_client_parses_provider_home_response(home_response):
    provider = Mock()
    provider.login.return_value = "login-token"
    provider.get_access_token.return_value = "access-token"
    provider.get_home.return_value = home_response
    tracker = MobileDataTracker(provider)
    try:
        result = tracker.get_usage_data()
    finally:
        tracker.close()
    assert result["remaining_gb"] == 15.0
    provider.get_access_token.assert_called_once_with(login_token="login-token")
    provider.get_home.assert_called_once_with(access_token="access-token")
    provider.close.assert_called_once_with()
