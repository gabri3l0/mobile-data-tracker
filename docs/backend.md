# Backend guide

Set up the Python client, CLI, and usage API.

## Setup

Requires Python 3.11+ and UV. Run commands from the repository root.

```bash
uv sync
cp .env.example .env
```

Fill in the carrier settings in `.env`. Keep credentials and tokens private.
This client supports the current carrier API format; changing URLs does not add support for another carrier.

## CLI

Set `CARRIER_USERNAME` and `CARRIER_PASSWORD` in `.env`, then run:

```bash
uv run python main.py
```

The CLI prints usage data. It does not require an API key.
Set `LOG_LEVEL=DEBUG` for more detailed CLI logs.

## API

Generate a random key for each invited person:

```bash
uv run python scripts/create_token.py
```

The script prints only the key and saves nothing. Add it to `.env`:

```dotenv
API_KEYS='{"alice":"<alice-key>","bob":"<bob-key>"}'
```

Start the server:

```bash
uv run uvicorn mobile_data_tracker.api:app --reload
```

Open <http://127.0.0.1:8000/docs>, click **Authorize**, and enter your key without the `Bearer` prefix.

- `GET /health`: checks the server; no key required.
- `POST /v1/usage`: requires `Authorization: Bearer <key>` and a JSON body:

```json
{
  "username": "<phone-number>",
  "password": "<carrier-password>"
}
```

The API uses the submitted credentials and returns parsed usage data. Credentials and carrier tokens are not saved.
Missing or invalid API keys return `401`; invalid request bodies return `422`.

Keys do not expire. Add, change, or remove entries in `API_KEYS`, then restart the server.
The API requires valid `API_KEYS` configuration to start. Use HTTPS when hosting it.

## Rate limit

Each configured person gets **two usage attempts per rolling 15 minutes**, across IP addresses and carrier accounts.
Carrier failures count; invalid input, invalid keys, and health checks do not.
Extra attempts return `429` with `Retry-After` in seconds.
Counters reset when the server sleeps or restarts. Run one server process.

## Bruno

1. Start the API and import **OpenAPI from URL**: `http://127.0.0.1:8000/openapi.json`.
2. In **Environments → Configure → Import**, select [bruno/local.env.example.json](../bruno/local.env.example.json).
3. Select **Mobile Data Tracker - Local**. Mark `username`, `password`, and `api_key` as secret, then enter your values locally. Leave the repository template blank.
4. Set the usage request URL to `{{base_url}}/v1/usage` and **Auth → Bearer Token** to `{{api_key}}`.
5. Use this JSON body:

```json
{
  "username": "{{username}}",
  "password": "{{password}}"
}
```

Change credentials in the environment to use another carrier account. Keep the same request.
Reimport the OpenAPI schema when paths, schemas, or authentication change; imports do not sync automatically.

## Tests

```bash
uv run pytest -v
```

Tests use mocked carrier requests and do not require real credentials.
