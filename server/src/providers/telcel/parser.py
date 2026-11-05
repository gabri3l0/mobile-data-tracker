import logging
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from src.models import UsageData

logger = logging.getLogger(__name__)


def parse_usage(
    response: dict[str, object], *, preserve_units: bool = False,
) -> UsageData | dict[str, object]:
    """Extract plan usage from the nested JSON returned by get_home."""
    logger.debug("Parsing Telcel home response.")
    if not isinstance(response, dict):
        logger.error("Carrier home response must be a JSON object.")
        raise ValueError("Carrier home response must be a JSON object.")

    def find(obj, component_id: str):
        if isinstance(obj, dict):
            if obj.get("id") == component_id:
                return obj.get("config", {}) if obj.get("config") is not None else {}
            for value in obj.values():
                result = find(value, component_id)
                if result is not None:
                    return result
        elif isinstance(obj, list):
            for value in obj:
                result = find(value, component_id)
                if result is not None:
                    return result
        return None

    def config(component_id: str) -> dict:
        result = find(response, component_id)
        if not isinstance(result, dict):
            logger.error("Carrier home response is missing component %s.", component_id)
            raise ValueError(f"Carrier home response is missing {component_id}.")
        return result

    def get(component_id: str) -> str:
        value = config(component_id).get("value")
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            logger.error("Carrier home response has an invalid value for %s.", component_id)
            raise ValueError(f"Carrier home response has an invalid value for {component_id}.")
        return str(value)

    def number(component_id: str) -> float:
        try:
            text = get(component_id).strip()
            if "," in text:
                if not re.fullmatch(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", text):
                    raise ValueError
                text = text.replace(",", "")
            return float(text)
        except ValueError:
            logger.error("Carrier home response has an invalid number for %s.", component_id)
            raise ValueError(
                f"Carrier home response has an invalid number for {component_id}."
            ) from None

    plan = get(
        "text-plan-name" if response.get("id") == "home-corpo"
        else "tabs-plans-v2-plan-name-0-0-0"
    )
    readings: dict[str, tuple[float, str]] = {}

    def data_gb(kind: str) -> float:
        amount = number(f"tabs-plans-v2-{kind}-data-value-0-0-0")
        unit_id = f"tabs-plans-v2-{kind}-data-unit-0-0-0"
        # Preserve compatibility with older responses that omit unit components.
        unit = "GB" if find(response, unit_id) is None else get(unit_id).strip().upper()
        readings[kind] = (amount, unit)
        if unit == "MB":
            return amount / 1000
        if unit == "GB":
            return amount
        logger.error("Carrier home response has an invalid unit for %s.", unit_id)
        raise ValueError(f"Carrier home response has an invalid unit for {unit_id}.")

    total = data_gb("total")
    used = data_gb("used")
    remaining = data_gb("available")

    updated_id = "last-update-text"
    if find(response, updated_id) is None and find(response, "last-update-text-web") is not None:
        updated_id = "last-update-text-web"

    if find(response, updated_id) is not None:
        updated = get(updated_id)
        try:
            last_updated = datetime.strptime(
                updated.replace("Información al ", "").replace(" h", "").strip(),
                "%d/%m/%Y %H:%M"
            )
        except ValueError:
            logger.error("Carrier home response has an invalid %s date.", updated_id)
            raise ValueError(f"Carrier home response has an invalid {updated_id} date.") from None
    else:
        # New responses use a relative sync label; the chart retains the reading time.
        chart_id = "tabs-plans-v2-usage-chart-0-0-0"
        if find(response, chart_id) is None:
            chart_id = "tabs-plans-v2-usage-chart-web-0-0-0"
        chart = find(response, chart_id)
        if chart is None:
            raise ValueError("Carrier home response is missing last-update-text and usage chart timestamp.")
        try:
            entries = chart.get("data") if isinstance(chart, dict) else None
            if not isinstance(entries, list):
                raise ValueError
            reading = next(
                entry for entry in entries
                if isinstance(entry, dict) and entry.get("key") == "available"
            )
            timestamp = reading.get("updatedAt")
            if not isinstance(timestamp, str):
                raise ValueError
            parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError
            # Match the local, timezone-naive format returned by older Telcel labels.
            last_updated = parsed.astimezone(ZoneInfo("America/Monterrey")).replace(
                tzinfo=None, microsecond=0,
            )
        except (ValueError, StopIteration):
            raise ValueError("Carrier home response has an invalid usage chart timestamp.") from None
        logger.debug("Using Telcel usage chart timestamp.")

    segments = config("tabs-plans-v2-limited-cutoff-message-0-0-0").get("segments")
    if not isinstance(segments, list) or not all(
        isinstance(segment, dict) and isinstance(segment.get("text"), str)
        for segment in segments
    ):
        logger.error("Carrier home response has invalid cutoff message segments.")
        raise ValueError("Carrier home response has invalid cutoff message segments.")
    message = "".join(s["text"] for s in segments)
    days_match = re.search(r"\bFaltan?\s+(\d+)\b", message, re.IGNORECASE)
    if re.fullmatch(r"\s*Hoy\s+vence\s+tu\s+paquete\.?\s*", message, re.IGNORECASE):
        days_until = 0
    elif days_match is not None:
        days_until = int(days_match.group(1))
    else:
        logger.error("Carrier cutoff message is missing the number of days remaining.")
        raise ValueError("Carrier cutoff message is missing the number of days remaining.")
    logger.debug("Telcel days remaining: %d", days_until)

    if response.get("id") == "home-corpo" and find(response, "text-due-value") is None:
        expiration_date = last_updated.date() + timedelta(days=days_until)
    else:
        expiration = get("text-due-value")
        months = {
            name: i for i, name in enumerate(
                ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
                1
            )
        }
        try:
            day, month = expiration.strip().lower().split(" de ")
            expiration_date = datetime(last_updated.year, months[month], int(day)).date()
            if expiration_date < last_updated.date():
                expiration_date = expiration_date.replace(year=expiration_date.year + 1)
        except (KeyError, ValueError):
            logger.error("Carrier home response has an invalid text-due-value date.")
            raise ValueError("Carrier home response has an invalid text-due-value date.") from None
    usage: UsageData = {
        "plan_name": plan,
        "expiration_date": expiration_date.isoformat(),
        "days_until": days_until,
        "last_updated": last_updated.isoformat(),
        "total_gb": total,
        "used_gb": used,
        "remaining_gb": remaining,
        "used_percentage": round(used / total * 100, 2) if total else None,
        "remaining_percentage": round(remaining / total * 100, 2) if total else None,
    }
    logger.debug("Carrier usage parsed successfully.")
    if preserve_units:
        result: dict[str, object] = dict(usage)
        for field, kind in (("total", "total"), ("used", "used"), ("remaining", "available")):
            amount, unit = readings[kind]
            result.pop(f"{field}_gb")
            result[f"{field}_data"] = amount
            result[f"{field}_unit"] = unit
        return result
    return usage
