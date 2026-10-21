from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.exceptions import CarrierError, CarrierTimeoutError


def usage_error(error: Exception) -> HTTPException:
    """Translate failures without exposing credentials, URLs, or response bodies."""
    if isinstance(error, CarrierTimeoutError):
        return HTTPException(status_code=504, detail="Carrier request timed out.")
    if isinstance(error, (CarrierError, ValueError)):
        return HTTPException(status_code=502, detail="Unable to retrieve carrier usage.")
    return HTTPException(status_code=500, detail="Unable to process usage request.")


def configure_error_handling(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Default validation errors can include submitted credentials in `input`.
        return JSONResponse(status_code=422, content={"detail": "Invalid request body."})

    @app.middleware("http")
    async def prevent_usage_caching(request: Request, call_next):
        response = await call_next(request)
        if request.url.path == "/v1/usage":
            response.headers["Cache-Control"] = "no-store"
        return response
