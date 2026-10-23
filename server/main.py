import argparse
import logging
import os
from typing import get_args

from dotenv import load_dotenv

from src.client import MobileDataTracker
from src.models import CarrierName

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Read current mobile data usage.")
    parser.add_argument("--carrier", choices=get_args(CarrierName), default="telcel")
    args = parser.parse_args(argv)
    load_dotenv()
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.CRITICAL + 1)

    logger.info("Starting mobile data tracker.")
    try:
        tracker = MobileDataTracker(carrier=args.carrier)
        try:
            if args.carrier == "telcel":
                print(tracker.get_usage_data(preserve_units=True))
            else:
                print(tracker.get_usage_data())
        finally:
            tracker.close()
    except Exception:
        logger.error("Unable to retrieve usage data.")
        raise SystemExit(1) from None
    logger.info("Mobile data tracker stopped.")


if __name__ == "__main__":
    main()
