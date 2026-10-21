# Central server

Python CLI and FastAPI service for reading mobile data usage. Its goal is to track
family accounts and provide daily consumption, history, and trends.

Currently supports one carrier format and one account per request. Saved accounts,
scheduled collection, and analytics are planned.

## Folder structure

```text
server/
├── src/             API, usage client, and configuration
│   └── providers/   Carrier requests and response parsing
├── tests/           Mocked regression tests
├── scripts/         API-key generation
├── bruno/           Manual API testing template
├── main.py          CLI entry point
├── .env.example     Configuration template
├── pyproject.toml   Dependencies and project settings
└── uv.lock          Locked dependency versions
```

## Current features

- Plan name, expiration, days remaining, and reading timestamp.
- Total, used, and remaining data in GB, with percentages.
- CLI and HTTP API backed by the same carrier client.
- API keys and usage limits per person.
- Sanitized API errors; credentials, tokens, and readings are not saved.

## Limits

- **Two usage attempts per person per rolling 15 minutes**, across accounts and IPs.
- Carrier failures count; invalid input, invalid keys, and health checks do not.
- Exceeding the limit returns `429` with `Retry-After` in seconds.
- Counters reset on restart and are per process. Run one server process.
- Carrier network operations use a 30-second timeout, not a total request deadline.

## API keys

From `server/`, run `uv run python scripts/create_token.py` to generate a unique
key per person, then add it to `.env`:

```dotenv
API_KEYS='{"alice":"<alice-key>","bob":"<bob-key>"}'
```

Valid `API_KEYS` configuration is required to start the server. Send
`Authorization: Bearer <key>` with usage requests. Each key can query different
carrier accounts.

Keys do not expire. Restart the server after adding, replacing, or removing keys.
Keep credentials private and use HTTPS when hosting the API.


## Setup

Requires Python 3.11+ and UV. From the repository root:

```bash
cd server
uv sync
cp .env.example .env
```

Fill in `.env` using the descriptions in [.env.example](.env.example).
Run the commands below from `server/`.

## Commands

| Command | Purpose |
| --- | --- |
| `uv run python main.py` | Print usage for the carrier account in `.env`. |
| `uv run python scripts/create_token.py` | Generate an API key. |
| `uv run uvicorn src.api:app --reload` | Start the API locally. |
| `uv run pytest -v` | Run tests without real credentials or carrier requests. |

The usage CLI needs carrier settings but no API key. API rate limits apply only
to HTTP requests. Set `LOG_LEVEL=DEBUG` for detailed CLI logs.

## Endpoints

Local base URL: `http://127.0.0.1:8000`.

| Method | Path | API key | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | Server health; does not contact the carrier. |
| POST | `/v1/usage` | Yes | Current usage for the submitted account. |
| GET | `/docs` | No | Interactive API documentation. |
| GET | `/redoc` | No | Alternative API documentation. |
| GET | `/openapi.json` | No | OpenAPI schema. |

Send this JSON body to `POST /v1/usage`:

```json
{
  "username": "<phone-number>",
  "password": "<carrier-password>"
}
```

The response includes plan details, dates, data balances, and percentages.
Open `/docs` for the full schema and request examples. Click **Authorize** and
enter your key without the `Bearer` prefix to try a request.

Errors: `401` invalid key, `422` invalid input, `429` rate limit, `502` carrier or
parsing failure, `504` carrier timeout, and `500` unexpected failure.

## Bruno

Import `http://127.0.0.1:8000/openapi.json`, then import
[bruno/local.env.example.json](bruno/local.env.example.json) as an environment.
Fill in `username`, `password`, and `api_key` locally and mark them as secret.
Use `{{base_url}}/v1/usage` with bearer token `{{api_key}}` and this body:

```json
{
  "username": "{{username}}",
  "password": "{{password}}"
}
```

Keep the template blank. Reimport the schema after API changes.
