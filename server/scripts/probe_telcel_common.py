"""CLI support for isolated Telcel authentication probes."""

import argparse
import json
import logging
import sys
from dataclasses import replace
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.exceptions import CarrierError
from src.providers.telcel.config import TelcelConfig
from src.providers.telcel.provider import TelcelProvider

logger = logging.getLogger("telcel_probe")


class ProbeProvider(TelcelProvider):
    @staticmethod
    def _log_response(response):
        logger.info(
            "HTTP %s; tipo=%s; bytes=%s",
            response.status_code,
            response.headers.get("content-type", "").split(";", 1)[0],
            len(response.content),
        )
        return TelcelProvider._log_response(response)


def main(auth_mode: str, argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=f"Prueba Telcel exclusivamente {auth_mode}: login → intercambio → consumo → logout. Sin fallback ni caché.",
    )
    if auth_mode == "oidc":
        parser.add_argument("--client-id")
        parser.add_argument("--redirect-uri")
    args = parser.parse_args(argv)
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    config = TelcelConfig.from_env()
    if auth_mode == "oidc":
        config = replace(
            config,
            oidc_client_id=args.client_id if args.client_id is not None else config.oidc_client_id,
            oidc_redirect_uri=args.redirect_uri if args.redirect_uri is not None else config.oidc_redirect_uri,
        )
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.CRITICAL + 1)
    logging.getLogger("src").setLevel(logging.INFO)
    provider = ProbeProvider(config)
    try:
        logger.info("Flujo %s: iniciando; no se intentará otro método de login.", auth_mode)
        data = provider.get_usage_data(preserve_units=True, auth_mode=auth_mode)
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0
    except (CarrierError, ValueError) as exc:
        logger.error("Flujo %s falló: %s", auth_mode, exc)
        return 1
    except Exception:
        logger.error("Flujo %s falló; detalles inesperados omitidos.", auth_mode)
        return 1
    finally:
        provider.close()
