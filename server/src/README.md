# Server source

Python package `src` contains the FastAPI application (`api.py`), usage client
(`client.py`), and environment-backed carrier configuration (`models.py`).
The client runs the carrier authentication and usage flow, then returns normalized
plan and consumption fields.

[Providers](providers/README.md) handles carrier HTTP requests and response parsing.
The API is stateless: each usage request supplies one account's credentials.

From `server/`, start the API with `uv run uvicorn src.api:app --reload` or run the
CLI with `uv run python main.py`. See the [server guide](../README.md) for setup,
authentication, current capabilities, and planned multi-account tracking.
