import os
from dataclasses import dataclass, fields


@dataclass(frozen=True, repr=False)
class CarrierConfig:
    username: str = ""
    password: str = ""
    basic_auth: str = ""
    site_domain: str = ""
    scope: str = ""
    login_url: str = ""
    token_url: str = ""
    home_url: str = ""

    @classmethod
    def from_env(cls) -> "CarrierConfig":
        return cls(**{
            field.name: os.environ[f"CARRIER_{field.name.upper()}"]
            for field in fields(cls)
            if f"CARRIER_{field.name.upper()}" in os.environ
        })
