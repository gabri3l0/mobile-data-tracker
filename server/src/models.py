from typing import Literal, NotRequired, TypedDict


CarrierName = Literal["telcel"]
DataTier = Literal["high_speed", "throttled"]


class UsageData(TypedDict):
    """Normalized usage; last_updated is carrier reading time, or fetch time if unavailable."""

    plan_name: str
    expiration_date: str
    days_until: int
    last_updated: str
    total_gb: float
    used_gb: float
    remaining_gb: float
    used_percentage: float | None
    remaining_percentage: float | None
    data_tier: NotRequired[DataTier | None]
