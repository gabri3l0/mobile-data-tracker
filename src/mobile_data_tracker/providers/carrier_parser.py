import logging
import re
from datetime import datetime

logger = logging.getLogger(__name__)


def parse_usage(response: dict[str, object]) -> dict[str, object]:
    """Extract plan usage from the nested JSON returned by get_home."""
    logger.debug("Parsing carrier home response.")
    if not isinstance(response, dict):
        logger.error("Carrier home response must be a JSON object.")
        raise ValueError("Carrier home response must be a JSON object.")

    def find(obj, component_id: str):
        if isinstance(obj, dict):
            if obj.get("id") == component_id:
                return obj.get("config", {})
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
            return float(get(component_id))
        except ValueError:
            logger.error("Carrier home response has an invalid number for %s.", component_id)
            raise ValueError(
                f"Carrier home response has an invalid number for {component_id}."
            ) from None

    plan = get("tabs-plans-v2-plan-name-0-0-0")
    total = number("tabs-plans-v2-total-data-value-0-0-0")
    used = number("tabs-plans-v2-used-data-value-0-0-0")
    remaining = number("tabs-plans-v2-available-data-value-0-0-0")

    updated = get("last-update-text")
    try:
        last_updated = datetime.strptime(
            updated.replace("Información al ", "").replace(" h", "").strip(),
            "%d/%m/%Y %H:%M"
        )
    except ValueError:
        logger.error("Carrier home response has an invalid last-update-text date.")
        raise ValueError("Carrier home response has an invalid last-update-text date.") from None

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

    segments = config("tabs-plans-v2-limited-cutoff-message-0-0-0").get("segments")
    if not isinstance(segments, list) or not all(
        isinstance(segment, dict) and isinstance(segment.get("text"), str)
        for segment in segments
    ):
        logger.error("Carrier home response has invalid cutoff message segments.")
        raise ValueError("Carrier home response has invalid cutoff message segments.")
    message = "".join(s["text"] for s in segments)
    days_match = re.search(r"Faltan\s+(\d+)", message, re.IGNORECASE)
    if days_match is None:
        logger.error("Carrier cutoff message is missing the number of days remaining.")
        raise ValueError("Carrier cutoff message is missing the number of days remaining.")
    days_until = int(days_match.group(1))

    usage = {
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
    return usage
