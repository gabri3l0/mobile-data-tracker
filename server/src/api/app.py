import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI

from src.api.auth import load_api_keys
from src.api.errors import configure_error_handling
from src.api.rate_limit import UsageRateLimiter
from src.api.routes import router

load_dotenv()
for name in ("httpx", "httpcore"):
    logging.getLogger(name).setLevel(logging.CRITICAL + 1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.api_keys = load_api_keys()
    yield


app = FastAPI(title="Mobile Data Tracker", lifespan=lifespan)
app.state.usage_limiter = UsageRateLimiter()
configure_error_handling(app)
app.include_router(router)
