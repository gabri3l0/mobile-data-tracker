import logging
import os

from dotenv import load_dotenv

from mobile_data_tracker.client import MobileDataTracker
from mobile_data_tracker.models import CarrierConfig
from mobile_data_tracker.providers.carrier import CarrierProvider

logger = logging.getLogger(__name__)


def main() -> None:
    load_dotenv()
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # Silence HTTP library logs, even in DEBUG mode, to avoid exposing endpoints
    # or tokens in URLs and headers. CRITICAL + 1 blocks all standard log levels;
    # our application's own logs remain enabled.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.CRITICAL + 1)

    logger.info("Starting mobile data tracker.")
    tracker = MobileDataTracker(CarrierProvider(CarrierConfig.from_env()))
    try:
        print(tracker.get_usage_data())
    except Exception:
        # Exception text and tracebacks may include sensitive request details.
        logger.error("Unable to retrieve usage data.")
        raise SystemExit(1) from None
    finally:
        tracker.close()
        logger.info("Mobile data tracker stopped.")


if __name__ == "__main__":
    main()
