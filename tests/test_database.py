import pytest
from server.database import create_client, SessionLocal, DataRecord, DeadLetterRecord, WebhookDeliveryLog, hash_api_key

def test_create_client_returns_tuple():
    client, raw_key = create_client("Vanguard Global", "https://vanguard.com/webhook")
    assert client.company_name == "Vanguard Global"
    assert raw_key.startswith("res_live_")
    assert client.webhook_url == "https://vanguard.com/webhook"

def test_api_key_is_hashed_not_plaintext():
    client, raw_key = create_client("HashTest Corp")
    expected_hash = hash_api_key(raw_key)
    assert client.api_key_hash == expected_hash
    # Verify hash is NOT the raw key itself
    assert client.api_key_hash != raw_key

def test_api_key_prefix_stored():
    client, raw_key = create_client("PrefixTest Corp")
    assert client.api_key_prefix == raw_key[:12]

def test_data_record_persistence_with_lineage():
    db = SessionLocal()
    try:
        rec = DataRecord(
            record_id="rec_test_100",
            source_id="maersk_feed",
            client_id="client_test",
            schema_name="LogisticsShipment",
            clean_data='{"container_id": "MSKU100"}',
            raw_payload='{"raw": "data"}',
            patch_version_applied=3
        )
        db.add(rec)
        db.commit()

        saved = db.query(DataRecord).filter(DataRecord.record_id == "rec_test_100").first()
        assert saved is not None
        assert saved.schema_name == "LogisticsShipment"
        assert saved.client_id == "client_test"
        assert saved.patch_version_applied == 3
    finally:
        db.close()

def test_dead_letter_queue_persistence():
    db = SessionLocal()
    try:
        dlq = DeadLetterRecord(
            record_id="rec_dlq_001",
            source_id="broken_feed",
            client_id="client_test",
            raw_payload='{"corrupt": true}',
            error_logs="AI self-healing failed after 3 attempts"
        )
        db.add(dlq)
        db.commit()

        saved = db.query(DeadLetterRecord).filter(DeadLetterRecord.record_id == "rec_dlq_001").first()
        assert saved is not None
        assert saved.error_logs == "AI self-healing failed after 3 attempts"
        assert saved.client_id == "client_test"
    finally:
        db.close()

def test_webhook_delivery_log_persistence():
    db = SessionLocal()
    try:
        log = WebhookDeliveryLog(
            record_id="rec_wh_001",
            webhook_url="https://example.com/webhook",
            attempt_number=1,
            status_code=200,
            success=True
        )
        db.add(log)
        db.commit()

        saved = db.query(WebhookDeliveryLog).filter(WebhookDeliveryLog.record_id == "rec_wh_001").first()
        assert saved is not None
        assert saved.success is True
        assert saved.status_code == 200
    finally:
        db.close()
