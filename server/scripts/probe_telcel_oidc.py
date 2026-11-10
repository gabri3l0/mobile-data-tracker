"""Run only OIDC: uv run --locked python scripts/probe_telcel_oidc.py."""

from probe_telcel_common import main

if __name__ == "__main__":
    raise SystemExit(main("oidc"))
