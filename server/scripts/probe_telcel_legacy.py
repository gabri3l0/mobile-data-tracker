"""Run only normal login: uv run --locked python scripts/probe_telcel_legacy.py."""

from probe_telcel_common import main

if __name__ == "__main__":
    raise SystemExit(main("legacy"))
