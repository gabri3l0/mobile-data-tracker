# Mobile Data Tracker

An unofficial Python client that retrieves mobile data usage from a carrier account. It logs in, fetches account information, and prints the plan name, data used and remaining, usage percentages, and expiration date.

## Setup

Requires Python 3.11+ and `uv`.

```bash
uv sync --dev
cp .env.example .env
```

Fill in `.env` with your account credentials and carrier API settings. Obtain the details from the carrier web portal, API documentation, or your administrator. The client expects the carrier's specific API format; changing endpoints alone does not make it compatible with other carriers.

Keep `.env` private. It is excluded from Git.

## Run

From the project root:

```bash
uv run python main.py
```

The app prints usage data and closes its HTTP connections when finished, including after a failure.

## Local API and Bruno

Start the API from the project root:

```bash
uv run uvicorn mobile_data_tracker.api:app --reload
```

Interactive documentation is available at <http://127.0.0.1:8000/docs>.
FastAPI generates the OpenAPI schema at <http://127.0.0.1:8000/openapi.json>.
No exported schema file or shared Bruno collection is maintained in this repository.

1. With the API running, select **Import Collection → OpenAPI** in Bruno and import from `http://127.0.0.1:8000/openapi.json`.
2. Save the collection locally; skip **Initialize Git**. Check that requests use `http://127.0.0.1:8000` as their base URL.
3. Open `GET /health` and send it to verify the connection without calling the carrier.
4. Open `POST /v1/usage` and use a JSON body with `username` and `password`. Store real credentials in Bruno's local secret variables, keeping them out of tracked files.

For example, reference those variables in the JSON body:

```json
{
  "username": "{{username}}",
  "password": "{{password}}"
}
```

Reuse the imported collection for subsequent sessions. When API paths, request bodies,
responses, or authentication change, reimport the schema into a new collection and
replace the old collection after checking its requests. Importing does not automatically
keep an existing collection synchronized. Internal implementation changes do not require
reimporting. FastAPI regenerates its schema after the application reloads; no generation
command is needed.

Usage is limited to two attempts per IP address in a rolling 15-minute window.
Carrier failures count; invalid input and health checks do not. A blocked request
returns `429` with a `Retry-After` header in seconds. Counters are in memory and reset
when the server restarts; use one server process. Authentication is not implemented
yet, so keep the API local during this stage.

## Tests

```bash
uv run pytest -v
```

Run one test file:

```bash
uv run pytest tests/test_carrier.py -v
```

Tests use mocked HTTP requests and do not require carrier credentials.

## Logging

For the CLI, set `LOG_LEVEL=INFO` in `.env` for progress and error messages, or `LOG_LEVEL=DEBUG` for diagnostic details. Usernames, endpoints, passwords, and tokens are omitted from application logs.

## Disclaimer

This project is an unofficial, open-source Python client for a mobile carrier's online account service.

It is not affiliated with, endorsed by, or sponsored by the carrier or its operating company.

This software is intended for accessing information from accounts owned or otherwise authorized by the user.

Users are responsible for complying with applicable laws and the carrier's terms of service.

No credentials, authentication tokens, or proprietary carrier software are distributed with this project.
