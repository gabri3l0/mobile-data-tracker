import pytest

from src.providers.telcel.parser import parse_usage


CORPORATE_PLAN = "TELCEL CORPORATIVO CONTROLADO VPN 6 SR"


@pytest.fixture
def corporate_home_response(home_response):
    home_response["id"] = "home-corpo"
    home_response["data"]["components"][0] = {
        "id": "text-plan-name", "config": {"value": CORPORATE_PLAN},
    }
    return home_response


def test_nested_home_response(home_response):
    assert parse_usage(home_response) == {
        "plan_name": "Plan 20 GB",
        "expiration_date": "2027-01-02",
        "days_until": 3,
        "last_updated": "2026-12-30T14:35:00",
        "total_gb": 20.0,
        "used_gb": 5.0,
        "remaining_gb": 15.0,
        "used_percentage": 25.0,
        "remaining_percentage": 75.0,
    }


def test_zero_total(home_response):
    home_response["data"]["components"][1]["config"]["value"] = "0"
    result = parse_usage(home_response)
    assert result["used_percentage"] is None
    assert result["remaining_percentage"] is None


@pytest.mark.parametrize("available,unit,expected", [
    ("1,000", "MB", 1.0), ("1000", "MB", 1.0), (1000, "MB", 1.0),
    ("500", "MB", 0.5), ("512.5", "MB", 0.5125), ("5", "MB", 0.005),
    ("1", "MB", 0.001), ("0", "MB", 0.0), ("0.5", "GB", 0.5),
    ("1", "GB", 1.0), ("1,000", "GB", 1000.0),
])
def test_available_mb_normalized_to_gb(home_response, available, unit, expected):
    components = home_response["data"]["components"]
    for component, value in zip(components, ["Amigo Sin Límite 200", "7", "6", available]):
        component["config"]["value"] = value
    components.append({
        "id": "tabs-plans-v2-available-data-unit-0-0-0", "config": {"value": unit},
    })
    result = parse_usage(home_response)
    assert result["total_gb"] == 7
    assert result["used_gb"] == 6
    assert result["remaining_gb"] == expected
    assert result["remaining_percentage"] == round(expected / 7 * 100, 2)


@pytest.mark.parametrize("value", ["1,00", "1,,000", ",1000", "1,000,", "1,5"])
def test_malformed_grouped_number_still_fails(home_response, value):
    home_response["data"]["components"][3]["config"]["value"] = value
    with pytest.raises(ValueError, match="invalid number"):
        parse_usage(home_response)


@pytest.mark.parametrize("kind,index,field", [
    ("total", 1, "total_gb"), ("used", 2, "used_gb"), ("available", 3, "remaining_gb"),
])
def test_data_units_in_nested_rows(home_response, kind, index, field):
    components = home_response["data"]["components"]
    components[index]["config"]["value"] = "5"
    unit = {"id": f"tabs-plans-v2-{kind}-data-unit-0-0-0", "config": {"value": " mb "}}
    components[index] = {"type": "list", "children": [components[index], unit]}
    assert parse_usage(home_response)[field] == 0.005
    for invalid in ("TB", "", None, True):
        unit["config"]["value"] = invalid
        with pytest.raises(ValueError, match="invalid.*data-unit"):
            parse_usage(home_response)


@pytest.mark.parametrize("corporate", [False, True])
def test_plan_name_matches_account_type(home_response, corporate):
    home_response["data"]["components"].append({
        "id": "text-plan-name", "config": {"value": CORPORATE_PLAN},
    })
    if corporate:
        home_response["id"] = "home-corpo"
        home_response["data"]["components"][0]["config"]["value"] = "Datos de mi plan"
    assert parse_usage(home_response)["plan_name"] == (
        CORPORATE_PLAN if corporate else "Plan 20 GB"
    )


@pytest.mark.parametrize("updated,days,expected", [
    ("22/10/2026", 29, "2026-11-20"),
    ("30/12/2026", 3, "2027-01-02"),
    ("28/02/2028", 1, "2028-02-29"),
    ("22/10/2026", 0, "2026-10-22"),
])
def test_corporate_cutoff_without_due_date(corporate_home_response, updated, days, expected):
    components = corporate_home_response["data"]["components"]
    components.pop(5)
    components[4]["config"]["value"] = f"Información al {updated} 20:08 h"
    components[-1]["config"]["segments"] = [
        {"text": "Falta " if days == 1 else "Faltan "},
        {"text": str(days), "fontWeight": 500},
        {"text": " días para el próximo corte"},
    ]
    response = {"id": "home-corpo", "blocks": {"children": components}}
    result = parse_usage(response)
    assert result["plan_name"] == CORPORATE_PLAN
    assert result["expiration_date"] == expected
    assert result["days_until"] == days
    assert result["remaining_gb"] == 15


def test_noncorporate_missing_due_date_still_fails(home_response):
    home_response["data"]["components"].pop(5)
    with pytest.raises(ValueError, match="missing text-due-value"):
        parse_usage(home_response)


@pytest.mark.parametrize("due_config", [None, {}, {"value": "invalid"}])
def test_corporate_malformed_due_date_still_fails(corporate_home_response, due_config):
    corporate_home_response["id"] = "home-corpo"
    corporate_home_response["data"]["components"][5]["config"] = due_config
    with pytest.raises(ValueError, match="invalid.*text-due-value"):
        parse_usage(corporate_home_response)


def test_corporate_explicit_due_date_takes_precedence(corporate_home_response):
    corporate_home_response["id"] = "home-corpo"
    corporate_home_response["data"]["components"][5]["config"]["value"] = "5 de enero"
    assert parse_usage(corporate_home_response)["expiration_date"] == "2027-01-05"


@pytest.mark.parametrize("prefix,days,suffix", [
    ("Falta ", 1, "día"),
    ("Faltan ", 2, "días"),
    ("Faltan ", 0, "días"),
    ("FALTA\u00a0", 1, "día"),
])
def test_singular_and_plural_cutoff_messages(home_response, prefix, days, suffix):
    home_response["data"]["components"][6]["config"]["segments"] = [
        {"text": prefix},
        {"text": f"{days} {suffix}", "fontWeight": 500},
        {"text": " para que venza tu paquete"},
    ]
    assert parse_usage(home_response)["days_until"] == days


@pytest.mark.parametrize("corporate", [False, True])
@pytest.mark.parametrize("message", ["Hoy vence tu paquete", " HOY\u00a0VENCE TU PAQUETE. "])
def test_package_expires_today(home_response, corporate, message, caplog, capsys):
    components = home_response["data"]["components"]
    components[5]["config"]["value"] = "30 de diciembre"
    components[6]["config"]["segments"] = [
        {"text": message[:4]}, {"text": message[4:], "fontWeight": 500},
    ]
    if corporate:
        home_response["id"] = "home-corpo"
        components[0]["id"] = "text-plan-name"
        components.pop(5)
    with caplog.at_level("DEBUG", logger="src.providers.telcel.parser"):
        result = parse_usage(home_response)
    assert result["days_until"] == 0
    assert result["expiration_date"] == "2026-12-30"
    assert "Telcel days remaining: 0" in caplog.text
    assert message not in caplog.text
    assert capsys.readouterr().out == ""


@pytest.mark.parametrize("message", ["Hoy no vence tu paquete", "Mañana vence tu paquete"])
def test_other_cutoff_messages_still_fail(home_response, message):
    home_response["data"]["components"][6]["config"]["segments"] = [{"text": message}]
    with pytest.raises(ValueError, match="missing the number of days"):
        parse_usage(home_response)


@pytest.mark.parametrize("level", ["INFO", "DEBUG"])
def test_days_debug_log_omits_response_text(home_response, caplog, capsys, level):
    home_response["data"]["components"][6]["config"]["segments"] = [
        {"text": "Falta "}, {"text": "1 día", "fontWeight": 500},
        {"text": " para que venza tu paquete"},
    ]
    with caplog.at_level(level, logger="src.providers.telcel.parser"):
        assert parse_usage(home_response)["days_until"] == 1
    assert ("Telcel days remaining: 1" in caplog.text) == (level == "DEBUG")
    for value in ("Falta ", "para que venza tu paquete", "fontWeight", "Plan 20 GB"):
        assert value not in caplog.text
    assert capsys.readouterr().out == ""


def test_missing_component():
    with pytest.raises(ValueError, match="missing tabs-plans-v2-plan-name"):
        parse_usage({})


@pytest.mark.parametrize("index,config,error", [
    (1, {"value": "invalid"}, "invalid number"),
    (4, {"value": "invalid"}, "invalid last-update-text"),
    (5, {"value": "2 de invalid"}, "invalid text-due-value"),
    (6, {"segments": None}, "invalid cutoff message segments"),
    (6, {"segments": [{"text": "Sin fecha"}]}, "missing the number of days"),
])
def test_malformed_fields(home_response, index, config, error):
    home_response["data"]["components"][index]["config"] = config
    with pytest.raises(ValueError, match=error):
        parse_usage(home_response)
