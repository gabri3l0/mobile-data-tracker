import os
from dataclasses import dataclass


@dataclass(frozen=True, repr=False)
class BaitConfig:
    phone: str = ""
    service_key: str = ""
    base_url: str = "https://mibait.com/api/core/q/dn"

    @classmethod
    def from_env(cls) -> "BaitConfig":
        return cls(
            phone=os.getenv("BAIT_PHONE", ""),
            service_key=os.getenv("BAIT_SERVICE_KEY", ""),
        )
