from datetime import date, datetime

from pydantic import BaseModel, SecretStr, field_validator

from src.models import CarrierName


class UsageRequest(BaseModel):
    carrier: CarrierName
    username: str
    password: SecretStr

    @field_validator("username", "password")
    @classmethod
    def require_nonempty(cls, value: str | SecretStr) -> str | SecretStr:
        text = value.get_secret_value() if isinstance(value, SecretStr) else value
        if not text.strip():
            raise ValueError("Must not be empty")
        return value


class UsageResponse(BaseModel):
    plan_name: str
    expiration_date: date
    days_until: int
    last_updated: datetime
    total_gb: float
    used_gb: float
    remaining_gb: float
    used_percentage: float | None
    remaining_percentage: float | None
