import logging
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

from src.exceptions import CarrierError, CarrierTimeoutError
from src.models import UsageData
from src.providers.bait.config import BaitConfig
from src.providers.bait.parser import parse_usage

logger = logging.getLogger(__name__)


class BaitProvider:
    def __init__(self, config: BaitConfig) -> None:
        self.config = config
        self._http = httpx.Client(timeout=30.0, verify=True)

    def _get_consumption(self) -> object:
        url = f"{self.config.base_url.rstrip('/')}/{quote(self.config.phone, safe='')}/get/consumption"
        error = "Bait request failed."
        error_type = CarrierError
        try:
            response = self._http.get(url, headers={
                "Accept": "application/json",
                "x-ord-service": self.config.service_key,
            })
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            error = f"Bait request failed (HTTP {exc.response.status_code})."
        except httpx.TimeoutException:
            error = "Bait request timed out."
            error_type = CarrierTimeoutError
        except httpx.RequestError:
            error = "Bait request failed due to a connection error."
        except (ValueError, httpx.InvalidURL):
            error = "Invalid Bait request URL or JSON response."
        # Do not retain sensitive HTTP exceptions or log request/response details.
        logger.error("%s", error)
        raise error_type(error)

    def get_usage_data(self) -> UsageData:
        for name, value in (("BAIT_PHONE", self.config.phone), ("BAIT_SERVICE_KEY", self.config.service_key)):
            if not value.strip():
                raise ValueError(f"Missing required configuration: {name}")
        logger.info("Retrieving Bait consumption.")
        response = self._get_consumption()
        fetched_at = datetime.now(timezone.utc)
        usage = parse_usage(response, fetched_at=fetched_at)
        logger.info("Bait usage retrieved successfully.")
        return usage

    def close(self) -> None:
        self._http.close()
