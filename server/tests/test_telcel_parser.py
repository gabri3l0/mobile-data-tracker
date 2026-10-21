import pytest

from src.providers.telcel.parser import parse_usage


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
