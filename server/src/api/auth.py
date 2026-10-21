import json
import os
import secrets

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


bearer = HTTPBearer(auto_error=False)


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
