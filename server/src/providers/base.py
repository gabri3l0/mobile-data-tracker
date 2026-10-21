from typing import Protocol

from src.models import UsageData


class UsageProvider(Protocol):
    """Each carrier owns authentication, retrieval, and normalization."""

    def get_usage_data(self) -> UsageData: ...

    def close(self) -> None: ...
