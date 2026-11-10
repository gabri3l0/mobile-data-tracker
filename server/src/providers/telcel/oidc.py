"""Telcel's observed OIDC code flow, without browser automation or token storage."""

import logging
from collections.abc import Callable
from time import monotonic
from urllib.parse import parse_qs, unquote_plus, urlsplit
from uuid import uuid4

import httpx

from src.exceptions import CarrierError, CarrierTimeoutError
from src.providers.telcel.config import TelcelConfig

logger = logging.getLogger(__name__)
AUTHORIZE_URL = "https://www.mitelcel.com/oid-authorize-prod/authorize"
TOKEN_URL = "https://www.mitelcel.com/oid-authorize-prod/token"


def json_object(response: httpx.Response) -> dict:
    try:
        value = response.json()
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def authentication_error(candidate: dict) -> str:
    def normalized(value) -> str:
        if not isinstance(value, str):
            return ""
        return " ".join(unquote_plus(value).replace("_", " ").lower().split())

    error = normalized(candidate.get("error"))
    detail = normalized(candidate.get("error_description"))
    details = {
        "password not valid": "Password_not_valid (contraseña rechazada)",
        "user not registered in sso": "User_not_registered_in_SSO (usuario no registrado)",
        "missing parameters": "Missing_Parameters (faltan parámetros)",
        "otp not valid": "OTP_not_valid (se requiere revisar el flujo OTP)",
        "otp over time": "OTP_over_Time (OTP vencido)",
        "too many login atempts, wait for: 15 minutes": "bloqueo temporal: esperar 15 minutos",
        "too many login atempts, wait for: 1 hour": "bloqueo temporal: esperar 1 hora",
        "too many login atempts, wait for: 12 hours": "bloqueo temporal: esperar 12 horas",
    }
    if detail in details:
        return details[detail]
    errors = {
        "access denied": "access_denied (acceso denegado; motivo no reconocido)",
        "invalid client": "invalid_client (configuración del cliente rechazada)",
        "unauthorized client": "unauthorized_client (cliente no autorizado)",
        "invalid request": "invalid_request (solicitud inválida)",
        "invalid grant": "invalid_grant (código vencido, usado o incompatible con cliente/callback)",
        "unsupported grant type": "unsupported_grant_type (tipo de intercambio no admitido)",
        "invalid scope": "invalid_scope (scope rechazado)",
        "server error": "server_error (error del servidor de autenticación)",
        "temporarily unavailable": "temporarily_unavailable (servicio temporalmente no disponible)",
        "bad request parameters": "Bad_Request_Parameters (parámetros rechazados)",
        "user blocked": "user_blocked (bloqueo de usuario; no reintentar)",
        "user not registered": "User_not_registered (usuario no registrado)",
        "login required": "login_required (se requiere iniciar sesión)",
    }
    return errors.get(error, "motivo no reconocido (valores del servidor omitidos)")


def code_from_response(response: httpx.Response, state: str) -> str:
    payload = json_object(response)
    candidates = [payload]
    for location in (
        response.headers.get("x-oidc-redirect-location", ""),
        response.headers.get("location", ""),
        response.text.strip() if not payload else "",
    ):
        # Only interpret a URL or query string, never arbitrary HTML as a code.
        if location and "<" not in location and (
            location.startswith(("https://", "http://", "/", "?", "code=", "error="))
        ):
            query = urlsplit(location).query if "?" in location else location
            candidates.append({k: v[0] for k, v in parse_qs(query, keep_blank_values=True).items()})
    codes = set()
    for candidate in candidates:
        if "state" in candidate and candidate["state"] != state:
            raise CarrierError("authorize: state no coincide; se detuvo el flujo.")
        if candidate.get("error") or candidate.get("error_description"):
            # Only translate known errors; arbitrary server strings may contain account data.
            raise CarrierError(f"authorize: {authentication_error(candidate)}; sin reintentos.")
        code = candidate.get("code")
        if isinstance(code, str) and code.strip():
            codes.add(code.strip())
    if len(codes) != 1:
        raise CarrierError("authorize: falta un código válido o las respuestas son contradictorias.")
    return codes.pop()


def sso_token(response: httpx.Response) -> str:
    payload = json_object(response)
    # The web accepts a valid token first. Telcel may also return error="Seccessful".
    value = payload.get("access_token")
    if not isinstance(value, str) or not value.strip():
        nested = payload.get("tokenResponse")
        entries = nested.get("tokens") if isinstance(nested, dict) else None
        value = next((e.get("access_token") for e in entries
                      if isinstance(e, dict) and e.get("id") == "token:mit"), None) if isinstance(entries, list) else None
    if isinstance(value, str) and value.strip():
        return value
    if payload.get("error"):
        raise CarrierError(f"token: {authentication_error(payload)}; sin reintentos.")
    raise CarrierError("token: falta un access_token SSO válido.")


def login_oidc(
    http: httpx.Client, config: TelcelConfig, *, user_agent: str,
    log_response: Callable[[httpx.Response], bool],
) -> str:
    username = config.username.strip()
    if len(username) != 10 or not username.isascii() or not username.isdigit():
        raise CarrierError("OIDC requires a 10-digit Telcel username.")
    if not config.oidc_client_id.strip() or not config.oidc_redirect_uri.strip():
        raise CarrierError("Missing OIDC client or callback configuration.")
    callback = urlsplit(config.oidc_redirect_uri)
    if callback.scheme != "https" or not callback.hostname or callback.username or callback.password:
        raise CarrierError("OIDC callback must be an HTTPS URL without credentials.")

    def request(stage: str, method: str, url: str, **kwargs) -> httpx.Response:
        started = monotonic()
        logger.info("Telcel OIDC %s: started.", stage)
        error = None
        timeout = False
        try:
            response = http.request(method, url, follow_redirects=False, timeout=30.0, **kwargs)
            rejected = log_response(response)
            if rejected:
                error = f"Telcel OIDC {stage}: security rejection."
            elif response.status_code >= 400:
                error = f"Telcel OIDC {stage}: HTTP {response.status_code}."
            else:
                return response
        except httpx.TimeoutException:
            error = f"Telcel OIDC {stage}: request timed out."
            timeout = True
        except (httpx.HTTPError, httpx.InvalidURL, ValueError):
            error = f"Telcel OIDC {stage}: invalid request or connection failure."
        finally:
            logger.info("Telcel OIDC %s: %.0f ms.", stage, (monotonic() - started) * 1000)
        # Raise outside HTTP handlers to avoid retaining sensitive request objects.
        raise (CarrierTimeoutError if timeout else CarrierError)(error)

    state = str(uuid4())
    response = request(
        "authorize", "GET", AUTHORIZE_URL,
        params={"client_id": config.oidc_client_id, "redirect_uri": config.oidc_redirect_uri,
                "response_type": "code", "scope": "openid", "acr_values": "1",
                "state": state, "nonce": str(uuid4())},
        headers={"USERNAME": f"52{username}", "PASSWORD": config.password,
                 "Accept": "application/json", "Accept-Charset": "UTF-8",
                 "User-Agent": user_agent},
    )
    if not response.content.strip() and not (
        response.headers.get("x-oidc-redirect-location") or response.headers.get("location")
    ):
        raise CarrierError("Telcel OIDC authorize: empty response without a code location.")
    code = code_from_response(response, state)
    response = request(
        "token", "POST", TOKEN_URL,
        headers={"Accept": "application/json", "User-Agent": user_agent,
                 "Content-Type": "application/x-www-form-urlencoded"},
        data={"grant_type": "authorization_code", "client_id": config.oidc_client_id,
              "redirect_uri": config.oidc_redirect_uri, "code": code},
    )
    if not response.is_success:
        raise CarrierError("Telcel OIDC token: unexpected redirect.")
    token = sso_token(response)
    logger.info("Telcel OIDC login successful.")
    return token
