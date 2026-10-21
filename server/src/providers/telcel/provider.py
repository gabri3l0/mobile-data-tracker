import base64
import logging

import httpx

from src.exceptions import CarrierError, CarrierTimeoutError
from src.models import UsageData
from src.providers.telcel.config import TelcelConfig
from src.providers.telcel.parser import parse_usage

logger = logging.getLogger(__name__)


class TelcelProvider:
    """Own Telcel authentication, retrieval, and usage normalization."""

    def __init__(self, config: TelcelConfig) -> None:
        self.config = config
        self._http = httpx.Client(timeout=30.0, verify=True)
        logger.debug("Telcel HTTP client initialized.")

    @staticmethod
    def _require(**values: str) -> None:
        missing = [name for name, value in values.items() if not value.strip()]
        if missing:
            logger.error("Missing required configuration: %s", ", ".join(missing))
            raise ValueError(f"Missing required configuration: {', '.join(missing)}")

    def _request(self, method: str, url: str, **kwargs) -> dict[str, object]:
        logger.debug("Sending Telcel %s request.", method)
        error = "Telcel request failed."
        error_type = CarrierError
        try:
            response = self._http.request(method, url, **kwargs)
            logger.debug(
                "Telcel response from %s (HTTP %s): %s",
                url, response.status_code, response.text,
            )
            response.raise_for_status()
            result = response.json()
            if isinstance(result, dict):
                logger.debug("Telcel request completed (HTTP %s).", response.status_code)
                return result
            error = "Telcel returned a JSON value that is not an object."
        except httpx.HTTPStatusError as exc:
            error = f"Telcel request failed (HTTP {exc.response.status_code})."
        except httpx.TimeoutException:
            error = "Telcel request timed out."
            error_type = CarrierTimeoutError
        except httpx.RequestError:
            error = "Telcel request failed due to a connection or timeout error."
        except (ValueError, httpx.InvalidURL):
            error = "Invalid request URL or Telcel JSON response."
        # Raise outside the handler to avoid retaining a sensitive HTTP exception.
        logger.error("%s", error)
        raise error_type(error)

    def login(self) -> str:
        logger.info("Trying to log in to Telcel.")
        config = self.config
        self._require(
            TELCEL_USERNAME=config.username,
            TELCEL_PASSWORD=config.password,
            site_domain=config.site_domain,
            login_url=config.login_url,
        )
        response = self._request("POST", config.login_url, follow_redirects=True, data={
            "username": config.username,
            base64.b64decode("dGVsY2VsLXBhc3M=").decode("ascii"): config.password,
            "pB64": base64.b64encode(config.password.encode("utf-8")).decode("ascii"),
            "CCode": "52",
            "sitedomain": config.site_domain,
        })
        if response.get("estatus") != "ok":
            logger.error("Telcel login rejected.")
            raise CarrierError("Login failed.")

        token = response.get("token")
        if not isinstance(token, str) or not token.strip():
            logger.error("Login response is missing a valid token.")
            raise CarrierError("Login response is missing a valid token.")
        logger.info("Telcel login successful.")
        return token

    def get_access_token(self, *, login_token: str) -> str:
        logger.info("Retrieving Telcel access token.")
        config = self.config
        self._require(
            TELCEL_USERNAME=config.username,
            TELCEL_BASIC_AUTH=config.basic_auth,
            scope=config.scope,
            token_url=config.token_url,
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
            logger.error("Telcel access token retrieval failed.")
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
        logger.info("Telcel access token retrieved successfully.")
        return token

    def get_home(self, *, access_token: str) -> dict[str, object]:
        logger.info("Retrieving Telcel home data.")
        config = self.config
        self._require(
            TELCEL_USERNAME=config.username,
            home_url=config.home_url,
            bearer_token=access_token,
        )
        response = self._request(
            "GET", config.home_url,
            params={"externalCode": config.username},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        logger.info("Telcel home data retrieved successfully.")
        return response

    def get_usage_data(self) -> UsageData:
        login_token = self.login()
        try:
            access_token = self.get_access_token(login_token=login_token)
            return parse_usage(self.get_home(access_token=access_token))
        finally:
            self.revoke_session(login_token=login_token)

    def revoke_session(self, *, login_token: str) -> None:
        """Attempt SSO logout without replacing the usage result or its error."""
        logger.info("Revoking Telcel SSO session.")
        try:
            response = self._http.post(
                self.config.revoke_url,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
                data={"token": login_token, "token_type": "revoke"},
                timeout=5.0,
            )
            response.raise_for_status()
            # A successful response may have an empty body. Do not log its contents.
            logger.info("Telcel SSO revocation request completed.")
        except Exception:
            # Cleanup must not hide a reading or the original carrier/parser failure.
            logger.warning("Unable to revoke Telcel SSO session.")

    def close(self) -> None:
        logger.debug("Closing Telcel HTTP connections.")
        self._http.close()
        logger.debug("Telcel HTTP connections closed.")
