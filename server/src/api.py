import logging
import math
import json
import os
import secrets
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import date, datetime
from threading import Lock
from time import monotonic

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, SecretStr, field_validator

from src.client import MobileDataTracker
from src.models import CarrierConfig
from src.providers.carrier import (
    CarrierError,
    CarrierProvider,
    CarrierTimeoutError,
)

load_dotenv()
for name in ("httpx", "httpcore"):
    logging.getLogger(name).setLevel(logging.CRITICAL + 1)


class UsageRequest(BaseModel):
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


class UsageRateLimiter:
    """Two attempts per caller in a rolling 15-minute window, per process."""

    def __init__(self) -> None:
        self._attempts: dict[str, list[float]] = {}
        self._lock = Lock()

    def check(self, caller: str) -> None:
        with self._lock:
            now = monotonic()
            # Discard inactive callers so their entries do not accumulate forever.
            self._attempts = {
                key: recent
                for key, attempts in self._attempts.items()
                if (recent := [timestamp for timestamp in attempts if timestamp > now - 900])
            }
            attempts = self._attempts.setdefault(caller, [])
            if len(attempts) >= 2:
                retry_after = max(1, math.ceil(attempts[0] + 900 - now))
                raise HTTPException(
                    status_code=429,
                    detail="Usage limit reached. Try again later.",
                    headers={"Retry-After": str(retry_after)},
                )
            attempts.append(now)


def load_api_keys() -> dict[str, str]:
    try:
        keys = json.loads(os.environ.get("API_KEYS", ""))
    except ValueError:
        raise RuntimeError("API_KEYS must be a nonempty JSON mapping of people to unique keys.") from None
    if (
        not isinstance(keys, dict)
        or not keys
        or any(
            not isinstance(person, str) or not person.strip()
            or not isinstance(key, str) or not key.strip()
            or key != key.strip() or any(char.isspace() for char in key)
            for person, key in keys.items()
        )
        or len(set(keys.values())) != len(keys)
    ):
        raise RuntimeError("API_KEYS must be a nonempty JSON mapping of people to unique keys.")
    return keys


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.api_keys = load_api_keys()
    yield


app = FastAPI(title="Mobile Data Tracker", lifespan=lifespan)
usage_limiter = UsageRateLimiter()
bearer = HTTPBearer(auto_error=False)


def authenticate(
    request: Request,
    authorization: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> str:
    if authorization is not None:
        supplied_key = authorization.credentials.encode("utf-8")
        for person, key in request.app.state.api_keys.items():
            if secrets.compare_digest(supplied_key, key.encode("utf-8")):
                return person
    raise HTTPException(
        status_code=401,
        detail="Missing or invalid API key.",
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Default validation errors may include submitted credentials in `input`.
    return JSONResponse(status_code=422, content={"detail": "Invalid request body."})


@app.middleware("http")
async def prevent_usage_caching(request: Request, call_next):
    response = await call_next(request)
    if request.url.path == "/v1/usage":
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/usage", response_model=UsageResponse)
def get_usage(credentials: UsageRequest, caller: str = Depends(authenticate)) -> UsageResponse:
    usage_limiter.check(caller)
    tracker = None
    try:
        config = replace(
            CarrierConfig.from_env(),
            username=credentials.username,
            password=credentials.password.get_secret_value(),
        )
        tracker = MobileDataTracker(CarrierProvider(config))
        return UsageResponse(**tracker.get_usage_data())
    except CarrierTimeoutError:
        raise HTTPException(status_code=504, detail="Carrier request timed out.") from None
    except (CarrierError, ValueError):
        raise HTTPException(status_code=502, detail="Unable to retrieve carrier usage.") from None
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to process usage request.") from None
    finally:
        if tracker is not None:
            tracker.close()
