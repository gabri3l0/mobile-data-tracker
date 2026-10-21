import logging
from dataclasses import replace

from src.models import CarrierName, UsageData
from src.providers.base import UsageProvider
from src.providers.telcel.config import TelcelConfig
from src.providers.telcel.provider import TelcelProvider

logger = logging.getLogger(__name__)


class MobileDataTracker:
    def __init__(
        self, carrier: CarrierName = "telcel", *,
        username: str | None = None, password: str | None = None,
    ) -> None:
        if carrier != "telcel":
            raise ValueError("Unsupported carrier.")
        config = TelcelConfig.from_env()
        config = replace(
            config,
            username=config.username if username is None else username,
            password=config.password if password is None else password,
        )
        self._provider: UsageProvider = TelcelProvider(config)

    def get_usage_data(self) -> UsageData:
        logger.info("Retrieving usage data.")
        usage = self._provider.get_usage_data()
        logger.info("Usage data retrieved successfully.")
        return usage

    def close(self) -> None:
        self._provider.close()
