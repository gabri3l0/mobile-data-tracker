from dotenv import load_dotenv

from mobile_data_tracker.client import MobileDataTracker
from mobile_data_tracker.models import CarrierConfig
from mobile_data_tracker.providers.carrier import CarrierProvider


def main() -> None:
    load_dotenv()
    tracker = MobileDataTracker(CarrierProvider(CarrierConfig.from_env()))
    try:
        print(tracker.get_usage_data())
    finally:
        tracker.close()


if __name__ == "__main__":
    main()
