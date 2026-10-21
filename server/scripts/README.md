# Server scripts

`create_token.py` prints a random API key without saving it. From `server/`, run:

```bash
uv run python scripts/create_token.py
```

Add the generated key to your local `API_KEYS` configuration. For configuration,
key revocation, and usage limits, see the [server guide](../README.md#api).
