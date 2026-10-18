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

Set `LOG_LEVEL=INFO` in `.env` for progress and error messages, or `LOG_LEVEL=DEBUG` for diagnostic details, including the username. Endpoints, passwords, and tokens are omitted from application logs.

## Disclaimer

This project is an unofficial, open-source Python client for a mobile carrier's online account service.

It is not affiliated with, endorsed by, or sponsored by the carrier or its operating company.

This software is intended for accessing information from accounts owned or otherwise authorized by the user.

Users are responsible for complying with applicable laws and the carrier's terms of service.

No credentials, authentication tokens, or proprietary carrier software are distributed with this project.
