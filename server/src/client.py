import logging

from src.providers.carrier import CarrierProvider
from src.providers.carrier_parser import parse_usage

logger = logging.getLogger(__name__)


class MobileDataTracker:
    def __init__(self, provider: CarrierProvider) -> None:
        self._provider = provider
        logger.debug("Mobile data tracker initialized.")

    def login(self) -> str:
        logger.debug("Delegating login to the carrier provider.")
        return self._provider.login()

    def get_access_token(self, *, auth_token: str) -> str:
        logger.debug("Delegating access token retrieval to the carrier provider.")
        return self._provider.get_access_token(login_token=auth_token)

    def get_home(self, *, access_token: str) -> dict[str, object]:
        logger.debug("Delegating home data retrieval to the carrier provider.")
        return self._provider.get_home(access_token=access_token)

    def get_usage_data(self) -> dict[str, object]:
        logger.info("Retrieving usage data.")
        auth_token = self.login()
        access_token = self.get_access_token(auth_token=auth_token)
        home_response = self.get_home(access_token=access_token)
        usage = parse_usage(home_response)
        logger.info("Usage data retrieved successfully.")
        return usage

    def close(self) -> None:
        logger.debug("Closing the mobile data tracker.")
        self._provider.close()
