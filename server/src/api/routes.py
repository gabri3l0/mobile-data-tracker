from fastapi import APIRouter, Depends, Request

from src.api.auth import authenticate
from src.api.errors import usage_error
from src.api.schemas import UsageRequest, UsageResponse
from src.client import MobileDataTracker

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/v1/usage", response_model=UsageResponse)
def get_usage(
    credentials: UsageRequest, request: Request, caller: str = Depends(authenticate),
) -> UsageResponse:
    request.app.state.usage_limiter.check(caller)
    try:
        tracker = MobileDataTracker(
            carrier=credentials.carrier,
            username=credentials.username,
            password=credentials.password.get_secret_value(),
        )
        try:
            return UsageResponse(**tracker.get_usage_data())
        finally:
            tracker.close()
    except Exception as error:
        raise usage_error(error) from None
