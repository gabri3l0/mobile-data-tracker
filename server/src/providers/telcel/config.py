import os
from dataclasses import dataclass


@dataclass(frozen=True, repr=False)
class TelcelConfig:
    username: str = ""
    password: str = ""
    basic_auth: str = ""  # Optional fallback when web-client discovery is unavailable.
    site_domain: str = "https://www.mitelcel.com"
    scope: str = "token:mit|token:b2f"
    login_url: str = "https://wbl.telcel-id.com:8443/login"
    token_url: str = "https://mi-telcel.smapps.mx/security/1.0.0/v2/token"
    home_url: str = "https://api.journeys.telcel.wavebybemobi.com/api/components/flow/home"
    revoke_url: str = "https://dev.smapps.mx:9000/sso/revoke"
    oidc_client_id: str = "31f419f6-5446-4e7e-a275-daf60f568698"
    oidc_redirect_uri: str = "https://mtl.smapps.mx:1333/sso/callback"

    @classmethod
    def from_env(cls) -> "TelcelConfig":
        return cls(
            username=os.getenv("TELCEL_USERNAME", ""),
            password=os.getenv("TELCEL_PASSWORD", ""),
            basic_auth=os.getenv("TELCEL_BASIC_AUTH", ""),
            oidc_client_id=os.getenv("TELCEL_OIDC_CLIENT_ID", cls.oidc_client_id),
            oidc_redirect_uri=os.getenv("TELCEL_OIDC_REDIRECT_URI", cls.oidc_redirect_uri),
        )
