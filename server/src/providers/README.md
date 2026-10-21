# Carrier integration

Supports the single carrier API format currently used by the project.
`carrier.py` performs login, access-token retrieval, and the home-data request.
`carrier_parser.py` extracts plan details, balances, percentages, and carrier dates
from that response.

Configuration comes from the server's environment. Changing endpoint URLs alone
does not add support for another carrier. Keep credentials and tokens private.
See the [server guide](../../README.md) for configuration and the
[test suite](../../tests/README.md) for mocked integration checks.
