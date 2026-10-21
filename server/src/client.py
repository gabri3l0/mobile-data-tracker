import logging
from dataclasses import replace

from src.models import CarrierName, UsageData
from src.providers.bait.config import BaitConfig
from src.providers.bait.provider import BaitProvider
from src.providers.telcel.config import TelcelConfig
from src.providers.telcel.provider import TelcelProvider

logger = logging.getLogger(__name__)


class MobileDataTracker:
    def __init__(
        self, carrier: CarrierName = "telcel", *,
        username: str | None = None, password: str | None = None,
    ) -> None:
        self._provider: TelcelProvider | BaitProvider
        if carrier == "telcel":
            config = TelcelConfig.from_env()
            config = replace(
                config,
                username=config.username if username is None else username,
                password=config.password if password is None else password,
            )
            self._provider = TelcelProvider(config)
        elif carrier == "bait":
            bait_config = BaitConfig.from_env()
            bait_config = replace(
                bait_config, phone=bait_config.phone if username is None else username,
            )
            self._provider = BaitProvider(bait_config)
        else:
            raise ValueError("Unsupported carrier.")

    def get_usage_data(self) -> UsageData:
        logger.info("Retrieving usage data.")
        usage = self._provider.get_usage_data()
        logger.info("Usage data retrieved successfully.")
        return usage

    def close(self) -> None:
        self._provider.close()
