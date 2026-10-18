import base64

import httpx

from mobile_data_tracker.models import CarrierConfig


class CarrierError(Exception):
    """An API failure with credentials and request URLs omitted."""


class CarrierProvider:
    def __init__(self, config: CarrierConfig) -> None:
        self.config = config
        self._http = httpx.Client(timeout=30.0, verify=True)

    @staticmethod
    def _require(**values: str) -> None:
        missing = [name for name, value in values.items() if not value.strip()]
        if missing:
            raise ValueError(f"Missing required configuration: {', '.join(missing)}")

    def _request(self, method: str, url: str, **kwargs) -> dict[str, object]:
        error = "Carrier request failed."
        try:
            response = self._http.request(method, url, **kwargs)
            response.raise_for_status()
            result = response.json()
            if isinstance(result, dict):
                return result
            error = "Carrier returned a JSON value that is not an object."
        except httpx.HTTPStatusError as exc:
            error = f"Carrier request failed (HTTP {exc.response.status_code})."
        except httpx.RequestError:
            error = "Carrier request failed due to a connection or timeout error."
        except (ValueError, httpx.InvalidURL):
            error = "Invalid request URL or carrier JSON response."
        # Raise outside the handler to avoid retaining a sensitive HTTP exception.
        raise CarrierError(error)

    def login(self) -> str:
        config = self.config
        self._require(
            CARRIER_USERNAME=config.username,
            CARRIER_PASSWORD=config.password,
            CARRIER_SITE_DOMAIN=config.site_domain,
            CARRIER_LOGIN_URL=config.login_url,
        )
        response = self._request("POST", config.login_url, data={
            "username": config.username,
            "telcel-pass": config.password,
            "pB64": base64.b64encode(config.password.encode("utf-8")).decode("ascii"),
            "CCode": "52",
            "sitedomain": config.site_domain,
        })
        if response.get("estatus") != "ok":
            raise CarrierError("Login failed.")

        token = response.get("token")
        if not isinstance(token, str) or not token.strip():
            raise CarrierError("Login response is missing a valid token.")
        return token

    def get_access_token(self, *, login_token: str) -> str:
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
            raise CarrierError("Failed to get access token.")

        token = response
        for key in ("tokenResponse", "tokens", "token:b2f", "access_token"):
            if not isinstance(token, dict):
                raise CarrierError("Access token response is missing a valid token.")
            token = token.get(key)

        if not isinstance(token, str) or not token.strip():
            raise CarrierError("Access token response is missing a valid token.")
        return token

    def get_home(self, *, access_token: str) -> dict[str, object]:
        config = self.config
        self._require(
            CARRIER_USERNAME=config.username,
            CARRIER_HOME_URL=config.home_url,
            bearer_token=access_token,
        )
        return self._request(
            "GET", config.home_url,
            params={"externalCode": config.username},
            headers={"Authorization": f"Bearer {access_token}"},
        )

    def close(self) -> None:
        self._http.close()
