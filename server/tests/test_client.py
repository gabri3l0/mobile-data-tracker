from unittest.mock import Mock

import pytest

from src import client
from src.client import MobileDataTracker
from src.providers.telcel.config import TelcelConfig


def test_client_only_delegates_normalized_usage_and_cleanup(monkeypatch):
    provider = Mock(spec=["get_usage_data", "close"])
    provider.get_usage_data.return_value = {"remaining_gb": 15.0}
    monkeypatch.setattr(client, "TelcelProvider", Mock(return_value=provider))
    tracker = MobileDataTracker(carrier="telcel")
    assert tracker.get_usage_data() == {"remaining_gb": 15.0}
    tracker.close()
    provider.get_usage_data.assert_called_once_with()
    provider.close.assert_called_once_with()


def test_client_propagates_provider_failure(monkeypatch):
    provider = Mock(spec=["get_usage_data", "close"])
    provider.get_usage_data.side_effect = ValueError("Invalid usage.")
    monkeypatch.setattr(client, "TelcelProvider", Mock(return_value=provider))
    tracker = MobileDataTracker(carrier="telcel")
    try:
        with pytest.raises(ValueError, match="Invalid usage"):
            tracker.get_usage_data()
    finally:
        tracker.close()
    provider.close.assert_called_once_with()


def test_telcel_configuration_reads_only_telcel_variables(monkeypatch):
    monkeypatch.setenv("TELCEL_USERNAME", "telcel-user")
    monkeypatch.setenv("TELCEL_PASSWORD", "telcel-password")
    monkeypatch.setenv("TELCEL_HOME_URL", "https://telcel.example/home")
    monkeypatch.setenv("CARRIER_USERNAME", "another-user")
    config = TelcelConfig.from_env()
    assert config.username == "telcel-user"
    assert config.password == "telcel-password"
    assert config.home_url == "https://telcel.example/home"
    assert "telcel-password" not in repr(config)


def test_client_creates_isolated_accounts_and_preserves_telcel_settings(monkeypatch):
    constructor = Mock()
    monkeypatch.setattr(client, "TelcelProvider", constructor)
    monkeypatch.setenv("TELCEL_USERNAME", "environment-user")
    monkeypatch.setenv("TELCEL_PASSWORD", "environment-password")
    monkeypatch.setenv("TELCEL_SCOPE", "test-scope")
    MobileDataTracker("telcel")
    MobileDataTracker("telcel", username="alice", password="alice-secret")
    MobileDataTracker("telcel", username="bob", password="bob-secret")
    configs = [call.args[0] for call in constructor.call_args_list]
    assert [(c.username, c.password) for c in configs] == [
        ("environment-user", "environment-password"),
        ("alice", "alice-secret"), ("bob", "bob-secret"),
    ]
    assert all(c.scope == "test-scope" for c in configs)
    assert len({id(c) for c in configs}) == 3


@pytest.mark.parametrize("carrier", ["bait", "unknown"])
def test_client_rejects_unsupported_carriers_before_construction(monkeypatch, carrier):
    constructor = Mock()
    monkeypatch.setattr(client, "TelcelProvider", constructor)
    with pytest.raises(ValueError, match="Unsupported carrier"):
        MobileDataTracker(carrier)
    constructor.assert_not_called()
