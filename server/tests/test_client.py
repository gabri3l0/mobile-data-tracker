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


def test_telcel_configuration_loads_credentials_and_keeps_builtin_endpoints(monkeypatch):
    monkeypatch.setenv("TELCEL_USERNAME", "telcel-user")
    monkeypatch.setenv("TELCEL_PASSWORD", "telcel-password")
    monkeypatch.setenv("TELCEL_BASIC_AUTH", "test-basic")
    monkeypatch.setenv("TELCEL_SITE_DOMAIN", "stale-value")
    monkeypatch.setenv("TELCEL_SCOPE", "stale-value")
    monkeypatch.setenv("TELCEL_LOGIN_URL", "stale-value")
    monkeypatch.setenv("TELCEL_TOKEN_URL", "stale-value")
    monkeypatch.setenv("TELCEL_HOME_URL", "stale-value")
    monkeypatch.setenv("CARRIER_USERNAME", "another-user")
    config = TelcelConfig.from_env()
    assert config.username == "telcel-user"
    assert config.password == "telcel-password"
    assert config.basic_auth == "test-basic"
    assert config.site_domain == "https://www.mitelcel.com"
    assert config.scope == "token:mit|token:b2f"
    assert config.login_url == "https://wbl.telcel-id.com:8443/login"
    assert config.token_url == "https://mi-telcel.smapps.mx/security/1.0.0/v2/token"
    assert config.home_url == "https://api.journeys.telcel.wavebybemobi.com/api/components/flow/home"
    assert "telcel-password" not in repr(config)


def test_client_creates_isolated_accounts_and_preserves_telcel_settings(monkeypatch):
    constructor = Mock()
    monkeypatch.setattr(client, "TelcelProvider", constructor)
    monkeypatch.setenv("TELCEL_USERNAME", "environment-user")
    monkeypatch.setenv("TELCEL_PASSWORD", "environment-password")
    MobileDataTracker("telcel")
    MobileDataTracker("telcel", username="alice", password="alice-secret")
    MobileDataTracker("telcel", username="bob", password="bob-secret")
    configs = [call.args[0] for call in constructor.call_args_list]
    assert [(c.username, c.password) for c in configs] == [
        ("environment-user", "environment-password"),
        ("alice", "alice-secret"), ("bob", "bob-secret"),
    ]
    assert all(c.scope == "token:mit|token:b2f" for c in configs)
    assert len({id(c) for c in configs}) == 3


@pytest.mark.parametrize("carrier", ["unknown", ""])
def test_client_rejects_unsupported_carriers_before_construction(monkeypatch, carrier):
    constructor = Mock()
    monkeypatch.setattr(client, "TelcelProvider", constructor)
    with pytest.raises(ValueError, match="Unsupported carrier"):
        MobileDataTracker(carrier)
    constructor.assert_not_called()


def test_bait_selection_uses_server_key_and_isolates_phone_overrides(monkeypatch):
    constructor = Mock()
    telcel = Mock()
    monkeypatch.setattr(client, "BaitProvider", constructor)
    monkeypatch.setattr(client, "TelcelProvider", telcel)
    monkeypatch.setenv("BAIT_PHONE", "5512345678")
    monkeypatch.setenv("BAIT_SERVICE_KEY", "private-key")
    MobileDataTracker("bait")
    MobileDataTracker("bait", username="5587654321", password="unused")
    MobileDataTracker("bait", username="5598765432")
    configs = [call.args[0] for call in constructor.call_args_list]
    assert [config.phone for config in configs] == ["5512345678", "5587654321", "5598765432"]
    assert all(config.service_key == "private-key" for config in configs)
    assert len({id(config) for config in configs}) == 3
    telcel.assert_not_called()


def test_bait_client_delegates_usage_and_closes_provider(monkeypatch):
    provider = Mock(spec=["get_usage_data", "close"])
    provider.get_usage_data.return_value = {"remaining_gb": 105.0, "data_tier": "throttled"}
    monkeypatch.setattr(client, "BaitProvider", Mock(return_value=provider))
    tracker = MobileDataTracker("bait", username="5512345678")
    assert tracker.get_usage_data()["data_tier"] == "throttled"
    tracker.close()
    provider.close.assert_called_once_with()
