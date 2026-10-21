class CarrierError(Exception):
    """An API failure with credentials and request URLs omitted."""


class CarrierTimeoutError(CarrierError):
    """The carrier did not respond within the configured timeout."""
