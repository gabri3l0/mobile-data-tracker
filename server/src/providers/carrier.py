import base64
import logging

import httpx

from src.models import CarrierConfig

logger = logging.getLogger(__name__)


class CarrierError(Exception):
    """An API failure with credentials and request URLs omitted."""


class CarrierTimeoutError(CarrierError):
    """The carrier did not respond within the configured timeout."""


class CarrierProvider:
    def __init__(self, config: CarrierConfig) -> None:
        self.config = config
        self._http = httpx.Client(timeout=30.0, verify=True)
        logger.debug("Carrier HTTP client initialized.")

    @staticmethod
    def _require(**values: str) -> None:
        missing = [name for name, value in values.items() if not value.strip()]
        if missing:
            logger.error("Missing required configuration: %s", ", ".join(missing))
            raise ValueError(f"Missing required configuration: {', '.join(missing)}")

    def _request(self, method: str, url: str, **kwargs) -> dict[str, object]:
        logger.debug("Sending carrier %s request.", method)
        error = "Carrier request failed."
        error_type = CarrierError
        try:
            response = self._http.request(method, url, **kwargs)
            logger.debug(
                "Carrier response from %s (HTTP %s): %s",
                url, response.status_code, response.text,
            )
            response.raise_for_status()
            result = response.json()
            if isinstance(result, dict):
                logger.debug("Carrier request completed (HTTP %s).", response.status_code)
                return result
            error = "Carrier returned a JSON value that is not an object."
        except httpx.HTTPStatusError as exc:
            error = f"Carrier request failed (HTTP {exc.response.status_code})."
        except httpx.TimeoutException:
            error = "Carrier request timed out."
            error_type = CarrierTimeoutError
        except httpx.RequestError:
            error = "Carrier request failed due to a connection or timeout error."
        except (ValueError, httpx.InvalidURL):
            error = "Invalid request URL or carrier JSON response."
        # Raise outside the handler to avoid retaining a sensitive HTTP exception.
        logger.error("%s", error)
        raise error_type(error)

    def login(self) -> str:
        logger.info("Trying to log in to the carrier.")
        config = self.config
        self._require(
            CARRIER_USERNAME=config.username,
            CARRIER_PASSWORD=config.password,
            CARRIER_SITE_DOMAIN=config.site_domain,
            CARRIER_LOGIN_URL=config.login_url,
        )
        response = self._request("POST", config.login_url, follow_redirects=True, data={
            "username": config.username,
            base64.b64decode("dGVsY2VsLXBhc3M=").decode("ascii"): config.password,
            "pB64": base64.b64encode(config.password.encode("utf-8")).decode("ascii"),
            "CCode": "52",
            "sitedomain": config.site_domain,
        })
        if response.get("estatus") != "ok":
            logger.error("Carrier login rejected.")
            raise CarrierError("Login failed.")

        token = response.get("token")
        if not isinstance(token, str) or not token.strip():
            logger.error("Login response is missing a valid token.")
            raise CarrierError("Login response is missing a valid token.")
        logger.info("Carrier login successful.")
        return token

    def get_access_token(self, *, login_token: str) -> str:
        logger.info("Retrieving carrier access token.")
        config = self.config
        self._require(
            CARRIER_USERNAME=config.username,
            CARRIER_BASIC_AUTH=config.basic_auth,
            CARRIER_SCOPE=config.scope,
            CARRIER_TOKEN_URL=config.token_url,
            login_token=login_token,
        )
        response = self._request(
            "GET", config.token_url,
            params={"user": config.username, "token": login_token},
            headers={
                "Authorization": f"Basic {config.basic_auth}",
                "app-version": "0.14",
                "code-version": "38",
                "device-id": "DSK",
                "os": "WEB",
                "os-version": "13",
                "scope": config.scope,
                "x-channel": "web-browser",
            },
        )
        if response.get("message") != "Éxito.":
            logger.error("Carrier access token retrieval failed.")
            raise CarrierError("Failed to get access token.")

        token_response = response.get("tokenResponse")
        tokens = token_response.get("tokens") if isinstance(token_response, dict) else None
        token = None
        if isinstance(tokens, list):
            for entry in tokens:
                if isinstance(entry, dict) and entry.get("id") == "token:b2f":
                    token = entry.get("access_token")
                    break

        if not isinstance(token, str) or not token.strip():
            logger.error("Access token response is missing a valid token.")
            raise CarrierError("Access token response is missing a valid token.")
        logger.info("Carrier access token retrieved successfully.")
        return token

    def get_home(self, *, access_token: str) -> dict[str, object]:
        logger.info("Retrieving carrier home data.")
        config = self.config
        self._require(
            CARRIER_USERNAME=config.username,
            CARRIER_HOME_URL=config.home_url,
            bearer_token=access_token,
        )
        response = self._request(
            "GET", config.home_url,
            params={"externalCode": config.username},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        logger.info("Carrier home data retrieved successfully.")
        return response

    def close(self) -> None:
        logger.debug("Closing carrier HTTP connections.")
        self._http.close()
        logger.debug("Carrier HTTP connections closed.")
