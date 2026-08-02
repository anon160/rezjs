import pytest
import json
from fastapi.testclient import TestClient
from server.main import app
from server.registry import save_patch
from server.database import SessionLocal, DeadLetterRecord

client = TestClient(app)

def test_health_check():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["database"] == "SQLite"

def test_auth_rejection_invalid_api_key():
    response = client.post("/api/v1/ingest/test_feed", json={"foo": "bar"}, headers={"X-API-Key": "invalid_key"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or revoked API Key."

def test_clean_payload_ingestion():
    clean_payload = {
        "container_id": "MSKU9876543",
        "carrier_name": "Maersk Line",
        "status": "IN_TRANSIT",
        "origin_port": "CNSHA",
        "destination_port": "USLAX",
        "weight_kg": 14250.5,
        "eta_date": "2026-08-12"
    }
    response = client.post("/api/v1/ingest/clean_maersk", json=clean_payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "SUCCESS"
    assert data["drift_detected"] is False
    assert data["delivered_data"]["container_id"] == "MSKU9876543"

def test_schema_drift_interception():
    broken_payload = {
        "cntr_code": "MSKU9876543",
        "shipping_line": "Maersk Line",
        "shipment_state": "IN_TRANSIT",
        "dept_port": "CNSHA",
        "arr_port": "USLAX",
        "gross_weight_lbs": 31417.0,
        "expected_delivery_timestamp": "2026-08-12T00:00:00Z"
    }
    response = client.post("/api/v1/ingest/broken_maersk_v2", json=broken_payload)
    assert response.status_code == 200
    data = response.json()
    assert data["drift_detected"] is True
    assert data["status"] in ["SUCCESS", "HEALING_FAILED"]

def test_custom_json_schema_ingestion():
    custom_specs = {"invoice_number": "str", "total_amount": "float", "currency": "str"}
    payload = {"invoice_number": "INV-8811", "total_amount": 999.50, "currency": "USD"}
    
    url = f"/api/v1/ingest/custom_feed?schema_name=CustomInvoice&field_specs_json={json.dumps(custom_specs)}"
    response = client.post(url, json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "SUCCESS"
    assert data["delivered_data"]["invoice_number"] == "INV-8811"

def test_saved_patch_failure_quarantines_to_dlq():
    """Verifies that a crashing saved patch quarantines the payload to DLQ instead of losing it."""
    save_patch("crashing_feed", "def transform(raw): raise ValueError('intentional failure')", client_id="client_logistics_demo")
    response = client.post("/api/v1/ingest/crashing_feed", json={"foo": "bar"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "PATCH_FAILURE"
    assert "quarantined" in data["message"].lower() or "DLQ" in data["message"]

    # Verify the payload was persisted to DLQ
    db = SessionLocal()
    try:
        dlq = db.query(DeadLetterRecord).filter(DeadLetterRecord.source_id == "crashing_feed").first()
        assert dlq is not None
        assert "intentional failure" in dlq.error_logs
    finally:
        db.close()

def test_dead_letter_queue_endpoint():
    """Verifies the DLQ list endpoint returns quarantined records scoped to client."""
    response = client.get("/api/v1/dead-letter-queue")
    assert response.status_code == 200
    data = response.json()
    assert "entries" in data
    assert "total_quarantined" in data

def test_patch_version_in_response():
    """Verifies that patch_version is returned in the ingest response for lineage tracking."""
    save_patch("versioned_feed", "def transform(raw): return {'container_id': 'MSKU123', 'carrier_name': 'Test', 'status': 'OK', 'origin_port': 'A', 'destination_port': 'B', 'weight_kg': 1.0, 'eta_date': '2026-01-01'}", client_id="client_logistics_demo")
    response = client.post("/api/v1/ingest/versioned_feed", json={"raw": "data"})
    assert response.status_code == 200
    data = response.json()
    if data["status"] == "SUCCESS":
        assert data["patch_version"] is not None
        assert data["patch_version"] >= 1

def test_pipelines_endpoint_scoped_to_client():
    """Verifies pipelines endpoint returns client-scoped data."""
    response = client.get("/api/v1/pipelines")
    assert response.status_code == 200
    data = response.json()
    assert "client_id" in data
    assert "total_active_patches" in data
