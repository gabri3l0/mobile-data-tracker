import logging
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import main


@pytest.fixture
def cli(monkeypatch):
    tracker = Mock()
    configure = Mock()
    get_logger = Mock()
    monkeypatch.setattr(main, "load_dotenv", Mock())
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    # Replace only the CLI's logging reference so pytest's log capture stays intact.
    monkeypatch.setattr(main, "logging", SimpleNamespace(
        basicConfig=configure, getLogger=get_logger, CRITICAL=logging.CRITICAL,
    ))
    monkeypatch.setattr(main, "MobileDataTracker", Mock(return_value=tracker))
    return tracker, configure, get_logger


def test_success_prints_usage_and_closes_tracker(cli, capsys):
    tracker, configure, get_logger = cli
    tracker.get_usage_data.return_value = {"remaining_gb": 15}
    main.main([])
    assert capsys.readouterr().out == "{'remaining_gb': 15}\n"
    tracker.close.assert_called_once_with()
    configure.assert_called_once_with(
        level="DEBUG", format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    assert [call.args[0] for call in get_logger.call_args_list] == ["httpx", "httpcore"]
    assert get_logger.return_value.setLevel.call_count == 2
    get_logger.return_value.setLevel.assert_called_with(logging.CRITICAL + 1)


def test_failure_closes_tracker_and_logs_no_exception_details(cli, caplog):
    tracker, _, _ = cli
    tracker.get_usage_data.side_effect = RuntimeError("https://private.example/?token=secret")
    with pytest.raises(SystemExit) as error:
        main.main([])
    assert error.value.code == 1
    tracker.close.assert_called_once_with()
    assert "Unable to retrieve usage data" in caplog.text
    assert "private.example" not in caplog.text
    assert "secret" not in caplog.text


def test_cli_selects_telcel_by_default_and_explicitly(cli):
    for argv in [[], ["--carrier", "telcel"]]:
        main.main(argv)
    assert main.MobileDataTracker.call_count == 2
    main.MobileDataTracker.assert_called_with(carrier="telcel")


def test_cli_rejects_unimplemented_carrier_before_network_calls(cli):
    with pytest.raises(SystemExit) as error:
        main.main(["--carrier", "bait"])
    assert error.value.code == 2
    main.MobileDataTracker.assert_not_called()


def test_cli_initialization_failure_is_sanitized(cli, caplog):
    main.MobileDataTracker.side_effect = ValueError("private-configuration")
    with pytest.raises(SystemExit) as error:
        main.main([])
    assert error.value.code == 1
    assert "private-configuration" not in caplog.text
