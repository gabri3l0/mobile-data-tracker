import math
from threading import Lock
from time import monotonic

from fastapi import HTTPException


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
