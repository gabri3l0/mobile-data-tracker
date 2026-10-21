from copy import deepcopy
from datetime import datetime, timezone

import pytest

from src.providers.bait.parser import parse_usage

FETCHED_AT = datetime(2026, 10, 20, 21, 38, tzinfo=timezone.utc)


def parse(response):
    return parse_usage(response, fetched_at=FETCHED_AT)


def test_sample_selects_high_speed_without_double_counting_offers(bait_response):
    assert parse(bait_response) == {
        "plan_name": "Paquete 3 meses Ilimitado",
        "expiration_date": "2026-11-10",
        "days_until": 21,
        "last_updated": "2026-10-20T21:38:00+00:00",
        "total_gb": 20495 / 1024,
        "used_gb": 6690 / 1024,
        "remaining_gb": 13805 / 1024,
        "used_percentage": 32.64,
        "remaining_percentage": 67.36,
        "data_tier": "high_speed",
    }


def test_falls_back_to_throttled_after_high_speed_is_exhausted(bait_response):
    bait_response["data"][0]["resume"]["unused"] = 0
    usage = parse(bait_response)
    assert usage["data_tier"] == "throttled"
    assert usage["total_gb"] == 105
    assert usage["remaining_gb"] == 105
    assert usage["used_gb"] == 0
    assert usage["used_percentage"] == 0


def test_no_high_speed_bucket_uses_throttled_even_when_exhausted(bait_response):
    bait_response["data"].pop(0)
    bait_response["data"][0]["resume"]["unused"] = 0
    assert parse(bait_response)["data_tier"] == "throttled"


def test_both_exhausted_retains_high_speed(bait_response):
    for bucket in bait_response["data"][:2]:
        bucket["resume"]["unused"] = 0
    usage = parse(bait_response)
    assert usage["data_tier"] == "high_speed"
    assert usage["remaining_gb"] == 0
    assert usage["used_percentage"] == 100


def test_exhausted_high_speed_without_throttled_bucket(bait_response):
    bait_response["data"].pop(1)
    bait_response["data"][0]["resume"]["unused"] = 0
    assert parse(bait_response)["remaining_gb"] == 0


def test_zero_total_has_no_percentages(bait_response):
    bait_response["data"] = bait_response["data"][:1]
    bait_response["data"][0]["resume"].update(total=0, unused=0)
    usage = parse(bait_response)
    assert usage["total_gb"] == 0
    assert usage["used_percentage"] is None
    assert usage["remaining_percentage"] is None


def test_duplicate_offer_names_are_deduplicated_but_distinct_names_remain(bait_response):
    offers = bait_response["data"][0]["offers_detail"]
    offers.append({"offer_name": "Bono adicional"})
    assert parse(bait_response)["plan_name"] == "Paquete 3 meses Ilimitado, Bono adicional"


def test_expiration_uses_summary_instead_of_offer_and_clamps_days(bait_response):
    bait_response["data"][0]["resume"]["expire_date"] = "2026-10-19T00:00:00Z"
    usage = parse(bait_response)
    assert usage["expiration_date"] == "2026-10-19"
    assert usage["days_until"] == 0


def test_dates_use_utc_across_midnight(bait_response):
    fetched_at = datetime.fromisoformat("2026-10-20T23:30:00-06:00")
    usage = parse_usage(bait_response, fetched_at=fetched_at)
    assert usage["last_updated"] == "2026-10-21T05:30:00+00:00"
    assert usage["days_until"] == 20


def test_fetch_time_requires_timezone(bait_response):
    with pytest.raises(ValueError, match="timezone"):
        parse_usage(bait_response, fetched_at=datetime(2026, 10, 20))


@pytest.mark.parametrize("response", [
    None, [], {}, {"success": False, "error": "private-details"},
    {"success": "true", "data": []}, {"success": True},
    {"success": True, "data": {}}, {"success": True, "data": []},
    {"success": True, "data": [None]},
])
def test_unsuccessful_or_malformed_response_is_rejected_without_details(response):
    with pytest.raises(ValueError) as error:
        parse(response)
    assert "private-details" not in str(error.value)


@pytest.mark.parametrize("field,value", [
    ("total", -1), ("unused", -1), ("unused", 20496),
    ("unused", True), ("total", "20495"), ("total", None),
    ("unused", float("inf")), ("total", float("nan")), ("total", 10**400),
])
def test_invalid_high_speed_balances_fail_instead_of_falling_back(bait_response, field, value):
    bait_response["data"][0]["resume"][field] = value
    with pytest.raises(ValueError):
        parse(bait_response)


@pytest.mark.parametrize("value", [None, {}, "private-summary"])
def test_missing_summary_is_rejected(bait_response, value):
    bait_response["data"][0]["resume"] = value
    with pytest.raises(ValueError):
        parse(bait_response)


@pytest.mark.parametrize("value", [None, "invalid", "2026-11-10", "2026-11-10T00:00:00"])
def test_invalid_or_timezone_missing_expiration_is_rejected(bait_response, value):
    bait_response["data"][0]["resume"]["expire_date"] = value
    with pytest.raises(ValueError, match="expiration"):
        parse(bait_response)


@pytest.mark.parametrize("offers", [None, [], [{}], [{"offer_name": " "}], ["private-value"]])
def test_missing_or_invalid_plan_names_are_rejected(bait_response, offers):
    bait_response["data"][0]["offers_detail"] = offers
    with pytest.raises(ValueError):
        parse(bait_response)


@pytest.mark.parametrize("index", [0, 1])
def test_duplicate_tier_summaries_are_rejected(bait_response, index):
    bait_response["data"].append(deepcopy(bait_response["data"][index]))
    with pytest.raises(ValueError, match="ambiguous"):
        parse(bait_response)


def test_minutes_and_messages_do_not_substitute_for_data(bait_response):
    bait_response["data"] = bait_response["data"][2:]
    with pytest.raises(ValueError, match="no supported data tier"):
        parse(bait_response)
