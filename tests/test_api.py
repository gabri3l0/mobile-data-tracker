from unittest.mock import patch

from fastapi.testclient import TestClient

from mobile_data_tracker.api import app


def test_health_does_not_contact_carrier():
    with patch("mobile_data_tracker.providers.carrier.httpx.Client") as carrier_http:
        with TestClient(app) as client:
            response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    carrier_http.assert_not_called()
