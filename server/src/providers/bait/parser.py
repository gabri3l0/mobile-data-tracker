import math
from datetime import datetime, timezone

from src.models import DataTier, UsageData


def _balance(bucket: dict) -> tuple[float, float]:
    summary = bucket.get("resume")
    if not isinstance(summary, dict):
        raise ValueError("Bait data summary is missing.")
    values = [summary.get("total"), summary.get("unused")]
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in values):
        raise ValueError("Bait data balances must be numbers.")
    try:
        total, unused = (float(v) for v in values)
    except OverflowError:
        raise ValueError("Bait data balances are out of range.") from None
    if not all(math.isfinite(v) for v in (total, unused)) or not 0 <= unused <= total:
        raise ValueError("Bait data balances are invalid.")
    return total, unused


def parse_usage(response: object, *, fetched_at: datetime) -> UsageData:
    """Normalize one data tier; Bait's last_updated is the fetch time, not a reading time."""
    if fetched_at.utcoffset() is None:
        raise ValueError("Bait fetch time must include a timezone.")
    fetched_at = fetched_at.astimezone(timezone.utc)
    if not isinstance(response, dict) or response.get("success") is not True:
        raise ValueError("Bait consumption request was unsuccessful.")
    entries = response.get("data")
    if not isinstance(entries, list):
        raise ValueError("Bait consumption data must be a list.")

    tiers = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Bait consumption entry must be an object.")
        kind = entry.get("type")
        if entry.get("category") != "Data" or kind not in ("BestEffort", "Throttling"):
            continue
        if kind in tiers:
            raise ValueError("Bait consumption has ambiguous data tier summaries.")
        total, unused = _balance(entry)
        tiers[kind] = (entry, total, unused)

    tier: DataTier
    high_speed = tiers.get("BestEffort")
    throttled = tiers.get("Throttling")
    if high_speed and high_speed[2] > 0:
        selected, tier = high_speed, "high_speed"
    elif throttled and (throttled[2] > 0 or high_speed is None):
        selected, tier = throttled, "throttled"
    elif high_speed:
        selected, tier = high_speed, "high_speed"
    else:
        raise ValueError("Bait consumption has no supported data tier.")

    bucket, total, unused = selected
    expiration = bucket["resume"].get("expire_date")
    try:
        if not isinstance(expiration, str):
            raise ValueError
        expires_at = datetime.fromisoformat(expiration.replace("Z", "+00:00"))
        if expires_at.utcoffset() is None:
            raise ValueError
        expiration_date = expires_at.astimezone(timezone.utc).date()
    except ValueError:
        raise ValueError("Bait expiration date is invalid.") from None

    offers = bucket.get("offers_detail")
    if not isinstance(offers, list) or not offers:
        raise ValueError("Bait offer details are missing.")
    names = []
    for offer in offers:
        name = offer.get("offer_name") if isinstance(offer, dict) else None
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Bait offer name is invalid.")
        if name.strip() not in names:
            names.append(name.strip())

    used = total - unused
    return {
        "plan_name": ", ".join(names),
        "expiration_date": expiration_date.isoformat(),
        "days_until": max(0, (expiration_date - fetched_at.date()).days),
        "last_updated": fetched_at.isoformat(),
        "total_gb": total / 1024,
        "used_gb": used / 1024,
        "remaining_gb": unused / 1024,
        "used_percentage": round(used / total * 100, 2) if total else None,
        "remaining_percentage": round(unused / total * 100, 2) if total else None,
        "data_tier": tier,
    }
