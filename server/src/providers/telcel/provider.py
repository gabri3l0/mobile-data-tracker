import base64
import logging
import re
from typing import Literal
from urllib.parse import urljoin, urlsplit

import httpx

from src.exceptions import CarrierError, CarrierTimeoutError
from src.models import UsageData
from src.providers.telcel.config import TelcelConfig
from src.providers.telcel.oidc import login_oidc
from src.providers.telcel.parser import parse_usage
from src.providers.telcel.web_auth import extract_basic_auth, find_bundle, same_origin

logger = logging.getLogger(__name__)

WEB_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)


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
            rejected = self._log_response(response)
            response.raise_for_status()
            if rejected:
                raise CarrierError("Telcel rejected the request before authentication.")
            if not response.content.strip():
                raise CarrierError("Telcel returned an empty response instead of JSON.")
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

    @staticmethod
    def _log_response(response: httpx.Response) -> bool:
        for entry in [*response.history, response]:
            content_type = entry.headers.get("content-type", "").split(";", 1)[0]
            logger.debug(
                "Telcel response: HTTP %s, content type %s, path %s, bytes %s.",
                entry.status_code, content_type, entry.url.path, len(entry.content),
            )
        rejected = "<title>Request Rejected</title>" in response.text
        if rejected:
            support = re.search(
                r"Your support ID is\s+([a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})\b",
                response.text,
            )
            logger.warning(
                "Telcel security rejection; support ID: %s.",
                support.group(1) if support else "unavailable",
            )
        return rejected

    def _initialize_login(self) -> str:
        logger.debug("Loading Telcel login page.")
        error = "Unable to load the Telcel login page."
        error_type = CarrierError
        try:
            response = self._http.get(
                self.config.login_url,
                params={
                    "sitedomain": self.config.site_domain, "CCode": "52",
                    "Type": "MSISDN", "Invocation": "iFrame",
                },
                headers={"Accept": "text/html", "User-Agent": WEB_USER_AGENT},
                follow_redirects=True,
            )
            rejected = self._log_response(response)
            response.raise_for_status()
            if not rejected:
                return str(response.url)
            error = "Telcel rejected the login page request before authentication."
        except httpx.HTTPStatusError as exc:
            error = f"Telcel login page request failed (HTTP {exc.response.status_code})."
        except httpx.TimeoutException:
            error = "Telcel login page request timed out."
            error_type = CarrierTimeoutError
        except httpx.RequestError:
            error = "Telcel login page request failed due to a connection or timeout error."
        except (httpx.InvalidURL, ValueError):
            pass
        logger.error("%s", error)
        raise error_type(error)

    def login(self, *, auth_mode: Literal["auto", "legacy", "oidc"] = "auto") -> str:
        if auth_mode not in ("auto", "legacy", "oidc"):
            raise ValueError("Unsupported Telcel authentication mode.")
        self._require(TELCEL_USERNAME=self.config.username, TELCEL_PASSWORD=self.config.password)
        if auth_mode == "oidc":
            return self.login_oidc()
        if auth_mode == "legacy":
            return self.login_legacy()
        self._require(site_domain=self.config.site_domain, login_url=self.config.login_url)
        try:
            return self.login_legacy()
        except CarrierError as exc:
            logger.warning("Telcel legacy login failed: %s Trying OIDC once.", exc)
        try:
            return self.login_oidc()
        except CarrierError as exc:
            logger.error("Telcel OIDC fallback failed: %s", exc)
            error_type = CarrierTimeoutError if isinstance(exc, CarrierTimeoutError) else CarrierError
            message = f"Telcel legacy login and OIDC fallback failed. {exc}"
        raise error_type(message)

    def login_oidc(self) -> str:
        self._require(TELCEL_USERNAME=self.config.username, TELCEL_PASSWORD=self.config.password)
        return login_oidc(self._http, self.config, user_agent=WEB_USER_AGENT, log_response=self._log_response)

    def login_legacy(self) -> str:
        logger.info("Trying to log in to Telcel.")
        config = self.config
        self._require(
            TELCEL_USERNAME=config.username,
            TELCEL_PASSWORD=config.password,
            site_domain=config.site_domain,
            login_url=config.login_url,
        )
        page_url = self._initialize_login()
        login_parts = urlsplit(config.login_url)
        login_origin = f"{login_parts.scheme}://{login_parts.netloc}"
        response = self._request("POST", config.login_url, follow_redirects=True, headers={
            "Origin": login_origin,
            "Referer": page_url,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": WEB_USER_AGENT,
        }, data={
            "username": config.username,
            base64.b64decode("dGVsY2VsLXBhc3M=").decode("ascii"): config.password,
            "pB64": base64.b64encode(config.password.encode("utf-8")).decode("ascii"),
            "CCode": "52",
            "sitedomain": config.site_domain,
            "Type": "MSISDN",
            "Invocation": "iFrame",
            "MSISDN": config.username,
            "Source": "",
            "url": login_origin,
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

    def get_basic_auth(self) -> str:
        """Discover the current web-client credential once per live exchange."""
        page_url = urljoin(self.config.site_domain, "/mitelcel/login")

        def download(url: str) -> str:
            for _ in range(4):
                if not same_origin(url, page_url):
                    raise ValueError("Unsupported Telcel configuration origin.")
                response = self._http.get(
                    url, headers={"Accept": "text/html, application/javascript", "Cookie": ""},
                    timeout=5.0, follow_redirects=False,
                )
                self._log_response(response)
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise ValueError("Missing redirect location.")
                    url = urljoin(url, location)
                    continue
                response.raise_for_status()
                return response.text
            raise ValueError("Too many Telcel configuration redirects.")

        try:
            page = download(page_url)
            value = extract_basic_auth(download(find_bundle(page, page_url)))
            logger.debug("Telcel web-client configuration discovered.")
            return value
        except (httpx.HTTPError, ValueError):
            logger.debug("Telcel web-client discovery unavailable; using configured fallback.")
        fallback = self.config.basic_auth.strip()
        if fallback and not any(ord(c) < 32 or ord(c) == 127 for c in fallback):
            return fallback
        raise CarrierError("Unable to discover Telcel client configuration; no Basic-auth fallback is configured.")

    def get_access_token(self, *, login_token: str) -> str:
        logger.info("Retrieving Telcel access token.")
        config = self.config
        self._require(
            TELCEL_USERNAME=config.username,
            scope=config.scope,
            token_url=config.token_url,
            login_token=login_token,
        )
        basic_auth = self.get_basic_auth()
        response = self._request(
            "GET", config.token_url,
            params={"user": config.username, "token": login_token},
            headers={
                "Authorization": f"Basic {basic_auth}",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "tipoRequest": "1",
                "User-Agent": "ktor-client",
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
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Is-iPad": "false",
                "x-wave-sdk": "WEB",
                "x-wave-device": "iPhone",
                "x-wave-device-type": "mobile",
                "x-wave-os": "iOS-web",
                "x-wave-os-version": "18.0",
                "User-Agent": WEB_USER_AGENT,
            },
        )
        logger.info("Telcel home data retrieved successfully.")
        return response

    def get_usage_data(
        self, *, preserve_units: bool = False,
        auth_mode: Literal["auto", "legacy", "oidc"] = "auto",
    ) -> UsageData | dict[str, object]:
        login_token = self.login(auth_mode=auth_mode)
        try:
            access_token = self.get_access_token(login_token=login_token)
            response = self.get_home(access_token=access_token)
            if preserve_units:
                return parse_usage(response, preserve_units=True)
            return parse_usage(response)
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
            self._log_response(response)
            response.raise_for_status()
            logger.info("Telcel SSO revocation request completed.")
        except Exception:
            # Cleanup must not hide a reading or the original carrier/parser failure.
            logger.warning("Unable to revoke Telcel SSO session.")

    def close(self) -> None:
        logger.debug("Closing Telcel HTTP connections.")
        self._http.close()
        logger.debug("Telcel HTTP connections closed.")
