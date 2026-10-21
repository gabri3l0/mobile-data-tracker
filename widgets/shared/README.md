# Shared usage helper

`usage-data.js` provides `loadUsage(settings)` for both widget designs. It checks
server readiness, requests and validates usage, and maintains a local cache per
account with retry deadlines and stale-data fallback. It does not render UI or
save credentials in the cache.

Copy it into a Scriptable script named **usage-data** alongside your widget scripts.
It currently calls the central server; direct carrier access is future work.
See the [widget guide](../README.md) for configuration, refresh behavior, and diagnostics.
