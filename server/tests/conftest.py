from types import SimpleNamespace

import httpx
import pytest

from src.models import CarrierConfig
from src.providers.carrier import CarrierProvider


@pytest.fixture
def carrier(monkeypatch):
    """Provide a carrier backed entirely by an in-memory HTTP transport."""
    state = SimpleNamespace(requests=[], payload={}, status=200, content=None)

    def respond(request):
        state.requests.append(request)
        if state.content is not None:
            return httpx.Response(state.status, content=state.content)
        return httpx.Response(state.status, json=state.payload)

    config = CarrierConfig(
        username="test-user", password="test-password", basic_auth="test-basic",
        site_domain="https://carrier.example", scope="test-scope",
        login_url="https://carrier.example/login",
        token_url="https://carrier.example/token",
        home_url="https://carrier.example/home",
    )
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        monkeypatch.setattr(
            "src.providers.carrier.httpx.Client", lambda **kwargs: http,
        )
        state.provider = CarrierProvider(config)
        state.http = http
        yield state


@pytest.fixture
def home_response():
    values = {
        "tabs-plans-v2-plan-name-0-0-0": "Plan 20 GB",
        "tabs-plans-v2-total-data-value-0-0-0": "20",
        "tabs-plans-v2-used-data-value-0-0-0": 5,
        "tabs-plans-v2-available-data-value-0-0-0": "15",
        "last-update-text": "Información al 30/12/2026 14:35 h",
        "text-due-value": "2 de enero",
    }
    components = [
        {"id": component_id, "config": {"value": value}}
        for component_id, value in values.items()
    ]
    components.append({
        "id": "tabs-plans-v2-limited-cutoff-message-0-0-0",
        "config": {"segments": [{"text": "Faltan "}, {"text": "3 días"}]},
    })
    return {"data": {"components": components}}
