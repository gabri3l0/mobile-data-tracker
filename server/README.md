> [!NOTE]
> Para ver la versión en español, [haz clic aquí](README.es.md).

# Central server

Python CLI and FastAPI service for reading mobile data usage from **Telcel and Bait**.
Both carriers support the CLI and usage API, with one account per request.

The longer-term goal is tracking family accounts, daily consumption, history, and
trends. Saved accounts, scheduled collection, and analytics are future work.

## Folder structure

```text
server/
├── src/
│   ├── api/         App, routes, schemas, authentication, limits, and errors
│   ├── providers/
│   │   ├── bait/       Bait provider, parser, and configuration
│   │   └── telcel/     Telcel provider, parser, and configuration
│   ├── client.py    Carrier selection and shared usage client
│   ├── models.py    Carrier names and normalized usage type
│   └── exceptions.py  Shared carrier errors
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
- Total, used, and remaining data with percentages; Telcel CLI output preserves each carrier unit.
- CLI and HTTP API backed by the same carrier client.
- Bait high-speed balances with automatic fallback to throttled data.
- API keys and usage limits per person.
- Sanitized API errors; credentials, tokens, and readings are not saved.
- Diagnostic logs omit credentials, tokens, request URLs, and response bodies.
- SSO logout attempted after each Telcel reading, including failed requests.

Telcel reads each total, used, and available `data-unit` component. It accepts
thousands separators such as `1,000` and uses 1000 MB = 1 GB to calculate
percentages across mixed units. Older responses without unit components default to GB.

## Limits

- **Two usage attempts per person per rolling 15 minutes**, across accounts and IPs.
- Carrier failures count; invalid input, invalid keys, and health checks do not.
- Exceeding the limit returns `429` with `Retry-After` in seconds.
- Counters reset on restart and are per process. Run one server process.
- Carrier network operations use a 30-second timeout, not a total request deadline.
- SSO logout uses a 5-second timeout; failures are logged without failing the reading.

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

Set `TELCEL_USERNAME`, `TELCEL_PASSWORD`, and `TELCEL_BASIC_AUTH` in your local
`.env`; see the [template](.env.example). Use the encoded Basic credential
without the `Basic` prefix. Telcel URLs and scope are defined in
`src/providers/telcel/config.py`.

For Bait, set `BAIT_SERVICE_KEY` and, for CLI use, `BAIT_PHONE`. The API takes the
phone number from each request's `username`. Bait URLs are defined in
`src/providers/bait/config.py`.

Run the commands below from `server/`.

## Commands

| Command | Purpose |
| --- | --- |
| `uv run python main.py --carrier telcel` | Print usage for the Telcel account in `.env`. |
| `uv run python main.py --carrier bait` | Print usage for `BAIT_PHONE` using `BAIT_SERVICE_KEY`. |
| `uv run python scripts/create_token.py` | Generate an API key. |
| `uv run uvicorn src.api.app:app --reload` | Start the API locally. |
| `uv run pytest -v` | Run tests without real credentials or carrier requests. |

The CLI defaults to Telcel when `--carrier` is omitted. It reads the selected
carrier's settings from `.env` and needs no server API key. API rate limits apply only
to HTTP requests. Set `LOG_LEVEL=DEBUG` for detailed CLI logs.

Telcel CLI output preserves each reading's value and unit. Its data fields look
like this (plan details, dates, and percentages are also included):

```json
{
  "total_data": 7.0,
  "total_unit": "GB",
  "used_data": 6.0,
  "used_unit": "GB",
  "remaining_data": 1000.0,
  "remaining_unit": "MB"
}
```

Bait CLI output uses `total_gb`, `used_gb`, and `remaining_gb`. Python callers can
request Telcel's value-and-unit output with
`tracker.get_usage_data(preserve_units=True)`; the default returns balances in GB.

## Endpoints

Local base URL: `http://127.0.0.1:8000`.

| Method | Path | API key | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | Server health; does not contact the carrier. |
| POST | `/v1/usage` | Yes | Current usage for the selected carrier and account. |
| GET | `/docs` | No | Interactive API documentation. |
| GET | `/redoc` | No | Alternative API documentation. |
| GET | `/openapi.json` | No | OpenAPI schema. |

Send a JSON body to `POST /v1/usage`. Both carriers require `username` as the phone
number. Telcel also requires a password:

```json
{
  "carrier": "telcel",
  "username": "<phone-number>",
  "password": "<carrier-password>"
}
```

Bait uses the server's service key and does not require a password:

```json
{
  "carrier": "bait",
  "username": "<phone-number>"
}
```

The HTTP API returns balances in GB as `total_gb`, `used_gb`, and `remaining_gb`
for both carriers. The response also includes plan details, dates, percentages, and
`data_tier` (`high_speed` or `throttled` for Bait, `null` for Telcel).
`last_updated` is Telcel's carrier reading time, or Bait's request completion time
in UTC because Bait does not supply a reading timestamp.
Open `/docs` for the full schema and request examples. Click **Authorize** and
enter your key without the `Bearer` prefix to try a request.

Errors: `401` invalid key, `422` invalid input, `429` rate limit, `502` carrier or
parsing failure, `504` carrier timeout, and `500` unexpected failure.

## Bruno

Import `http://127.0.0.1:8000/openapi.json`, then import
[bruno/local.env.example.json](bruno/local.env.example.json) as an environment.
Fill in `username`, `password`, and `api_key` locally and mark them as secret.
Set `carrier` to `telcel` or `bait` and `username` to the phone number.
The environment defaults to `telcel`.
Use `{{base_url}}/v1/usage` with bearer token `{{api_key}}` and this body:

```json
{
  "carrier": "{{carrier}}",
  "username": "{{username}}",
  "password": "{{password}}"
}
```

For Bait, set `carrier` to `bait`; omit `password` or leave it blank.
The service key stays in the server environment. Keep credentials blank in the
committed template. Reimport the schema after API changes.

## Adding a carrier

Add its `provider.py`, `parser.py`, and `config.py` under `src/providers/<name>/`.
The provider implements `get_usage_data()` and `close()`, owns its authentication
flow, and returns the shared `UsageData` fields. Add carrier selection in the
shared client and `CarrierName`, and add tests.

## Bait balances

Bait shows high-speed data while available, then throttled data, labeled with
`data_tier`. It converts MB to GB using 1024 and uses fetch time in UTC as
`last_updated`. Minutes and messages are excluded.
