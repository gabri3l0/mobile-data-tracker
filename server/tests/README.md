# Server tests

Regression tests cover the CLI, carrier requests and parsing, API authentication,
rate limits, error handling, and logging. Carrier requests are mocked; no real
credentials or network access are needed.

After installing dependencies as described in the [server guide](../README.md),
run from `server/`:

```bash
uv run pytest -v
```
