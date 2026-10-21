import os
from dataclasses import dataclass


@dataclass(frozen=True, repr=False)
class TelcelConfig:
    username: str = ""
    password: str = ""
    basic_auth: str = ""
    site_domain: str = "https://www.mitelcel.com"
    scope: str = "token:mit|token:b2f"
    login_url: str = "https://wbl.telcel-id.com:8443/login"
    token_url: str = "https://mi-telcel.smapps.mx/security/1.0.0/v2/token"
    home_url: str = "https://api.journeys.telcel.wavebybemobi.com/api/components/flow/home"
    revoke_url: str = "https://dev.smapps.mx:9000/sso/revoke"

    @classmethod
    def from_env(cls) -> "TelcelConfig":
        return cls(
            username=os.getenv("TELCEL_USERNAME", ""),
            password=os.getenv("TELCEL_PASSWORD", ""),
            basic_auth=os.getenv("TELCEL_BASIC_AUTH", ""),
        )
