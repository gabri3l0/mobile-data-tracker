from datetime import date, datetime
from typing import Self

from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator

from src.models import CarrierName, DataTier


class UsageRequest(BaseModel):
    carrier: CarrierName
    username: str
    password: SecretStr | None = Field(
        default=None, description="Required for Telcel; unused for Bait.",
    )

    @field_validator("username")
    @classmethod
    def require_nonempty_username(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Must not be empty")
        return value

    @model_validator(mode="after")
    def require_telcel_password(self) -> Self:
        if self.carrier == "telcel" and (
            self.password is None or not self.password.get_secret_value().strip()
        ):
            raise ValueError("Telcel requires a nonempty password.")
        return self


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
    data_tier: DataTier | None = None
