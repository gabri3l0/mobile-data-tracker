from typing import Literal, TypedDict


CarrierName = Literal["telcel"]


class UsageData(TypedDict):
    """Carrier-independent usage; dates use ISO strings without timezone conversion."""

    plan_name: str
    expiration_date: str
    days_until: int
    last_updated: str
    total_gb: float
    used_gb: float
    remaining_gb: float
    used_percentage: float | None
    remaining_percentage: float | None
