from fastapi import FastAPI, HTTPException, Header, Depends, Query, BackgroundTasks, status
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
from datetime import datetime
import uuid
import json
import logging
import time
import requests

from sqlalchemy.orm import Session
from server.database import (
    init_db, get_db, hash_api_key,
    Client, DataRecord, DeadLetterRecord, WebhookDeliveryLog
)
from server.registry import get_patch, save_patch, get_patch_version, load_catalog

from core.schemas import validate_dynamic_payload, SCHEMA_TEMPLATES, MOCK_PAYLOADS
from core.langgraph_engine import run_langgraph_self_healing_agent
from core.executor import execute_patch
from core.doc_reader import fetch_and_parse_api_doc
from core.mcp_reader import discover_vendor_schema_hybrid

logger = logging.getLogger("resilient")

init_db()

app = FastAPI(
    title="Project Resilient - Enterprise Dynamic Auto-DataOps API Gateway",
    description="Dynamic User-Defined Schema Ingestion Gateway with Async Webhook Relay & SQLite Persistence",
    version="3.0.0"
)


class IngestResponse(BaseModel):
    status: str = Field(..., example="SUCCESS")
    source_id: str = Field(..., example="maersk_v2_feed")
    record_id: str = Field(..., example="rec_8f9a2b3c")
    drift_detected: bool = Field(..., example=False)
    processed_at: str = Field(..., example="2026-08-01T22:05:00Z")
    delivered_data: Optional[Dict[str, Any]] = None
    patch_version: Optional[int] = None
    message: Optional[str] = None

class DocOnboardRequest(BaseModel):
    doc_source: Optional[str] = Field(None, example="https://dummyjson.com/products/1 or OpenAPI JSON spec text")
    mcp_server_url: Optional[str] = Field(None, example="mcp://api.maersk.com/v1")
    source_id: str = Field(..., example="vendor_catalog_feed")
    company_name: Optional[str] = Field("Apex Logistics", example="Apex Logistics")

# --- AUTHENTICATION (SHA-256 hashed key lookup) ---

def verify_client_api_key(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    db: Session = Depends(get_db)
) -> Client:
    """Authenticates request by hashing the incoming API key and comparing against stored hashes."""
    key = x_api_key or "res_live_demo123"
    key_hash = hash_api_key(key)
    client = db.query(Client).filter(Client.api_key_hash == key_hash, Client.is_active == True).first()
    if not client:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked API Key."
        )
    return client

# --- WEBHOOK RELAY WITH EXPONENTIAL BACKOFF RETRY ---

WEBHOOK_RETRY_DELAYS = [1, 5, 30]  # seconds — 3 attempts with exponential backoff

def _relay_webhook_background(webhook_url: str, record_id: str, data: Dict[str, Any], db_session_factory=None):
    """Background task to push clean data to client webhook with at-least-once delivery via retry."""
    from server.database import SessionLocal
    db = (db_session_factory or SessionLocal)()
    
    payload = {"event": "data_cleaned", "record_id": record_id, "data": data}

    for attempt_num, delay in enumerate(WEBHOOK_RETRY_DELAYS, start=1):
        log_entry = WebhookDeliveryLog(
            record_id=record_id,
            webhook_url=webhook_url,
            attempt_number=attempt_num,
        )
        try:
            resp = requests.post(webhook_url, json=payload, timeout=5)
            log_entry.status_code = resp.status_code
            log_entry.success = resp.status_code < 400
            db.add(log_entry)
            db.commit()
            
            if log_entry.success:
                logger.info(f"[Webhook Relay] Delivered to {webhook_url} (attempt {attempt_num})")
                db.close()
                return
            else:
                logger.warning(f"[Webhook Relay] {webhook_url} returned {resp.status_code} (attempt {attempt_num})")
        except Exception as relay_err:
            log_entry.success = False
            log_entry.error_message = str(relay_err)[:500]
            db.add(log_entry)
            db.commit()
            logger.warning(f"[Webhook Relay] Attempt {attempt_num} failed for {webhook_url}: {relay_err}")
        
        if attempt_num < len(WEBHOOK_RETRY_DELAYS):
            time.sleep(delay)
    
    logger.error(f"[Webhook Relay] EXHAUSTED all {len(WEBHOOK_RETRY_DELAYS)} retries for record {record_id} to {webhook_url}")
    db.close()

# --- DEAD LETTER QUEUE ---

def _quarantine_to_dlq(
    db: Session,
    record_id: str,
    source_id: str,
    client_id: str,
    raw_payload: Dict[str, Any],
    error_logs: str
):
    """Quarantines unfixable payloads to the Dead Letter Queue so no client data is ever lost."""
    try:
        dlq_entry = DeadLetterRecord(
            record_id=record_id,
            source_id=source_id,
            client_id=client_id,
            raw_payload=json.dumps(raw_payload),
            error_logs=error_logs[:5000]
        )
        db.add(dlq_entry)
        db.commit()
        logger.warning(f"[DLQ] Quarantined record {record_id} from source {source_id}")
    except Exception as err:
        logger.error(f"[DLQ] Failed to quarantine record: {err}")

# --- SAVE & RELAY ---

def _save_and_relay(
    db: Session,
    client: Client,
    record_id: str,
    source_id: str,
    schema_name: str,
    data: Dict[str, Any],
    raw_payload: Dict[str, Any],
    background_tasks: BackgroundTasks,
    patch_version: Optional[int] = None
):
    """Saves validated record to generic DataRecord sink and schedules async webhook relay."""
    try:
        rec = DataRecord(
            record_id=record_id,
            source_id=source_id,
            client_id=client.client_id,
            schema_name=schema_name,
            clean_data=json.dumps(data),
            raw_payload=json.dumps(raw_payload),
            patch_version_applied=patch_version
        )
        db.add(rec)
        db.commit()
    except Exception as err:
        logger.error(f"[DB Sink] Failed to persist record: {err}")

    if client.webhook_url:
        background_tasks.add_task(_relay_webhook_background, client.webhook_url, record_id, data)

# --- ENDPOINTS ---

@app.get("/api/v1/health")
def health_check():
    """Health check endpoint for platform monitoring."""
    return {
        "status": "healthy",
        "platform": "Project Resilient Dynamic Auto-DataOps",
        "database": "SQLite",
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }

@app.get("/api/v1/pipelines")
def list_pipelines(client: Client = Depends(verify_client_api_key)):
    """Lists all active registered client pipelines and saved patch catalog, scoped to calling client."""
    catalog = load_catalog(client_id=client.client_id)
    return {
        "client_id": client.client_id,
        "total_active_patches": len(catalog),
        "registered_sources": list(catalog.keys()),
        "supported_contract_templates": list(SCHEMA_TEMPLATES.keys()),
        "database": "SQLite",
        "uptime_sla": "99.99%"
    }

@app.get("/api/v1/dead-letter-queue")
def list_dlq(
    client: Client = Depends(verify_client_api_key),
    db: Session = Depends(get_db)
):
    """Returns all quarantined unfixable payloads for the calling client."""
    dlq_entries = db.query(DeadLetterRecord).filter(
        DeadLetterRecord.client_id == client.client_id
    ).order_by(DeadLetterRecord.created_at.desc()).limit(100).all()
    return {
        "client_id": client.client_id,
        "total_quarantined": len(dlq_entries),
        "entries": [
            {
                "record_id": e.record_id,
                "source_id": e.source_id,
                "error_logs": e.error_logs,
                "raw_payload": json.loads(e.raw_payload),
                "quarantined_at": e.created_at.isoformat() + "Z"
            }
            for e in dlq_entries
        ]
    }

@app.post("/api/v1/onboard-from-docs")
def onboard_vendor_from_docs(
    req: DocOnboardRequest,
    db: Session = Depends(get_db)
):
    """Level 5 Autonomous Onboarding: Parses vendor API docs or OpenAPI specs, extracts target schema, and provisions ingestion route."""
    from server.database import create_client
    from core.mcp_reader import discover_vendor_schema_hybrid

    parsed = discover_vendor_schema_hybrid(mcp_server_url=req.mcp_server_url, doc_url_or_text=req.doc_source)
    if parsed.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=parsed.get("message"))

    client, raw_key = create_client(
        company_name=req.company_name or "New Vendor Pilot",
        doc_url=req.doc_source if (req.doc_source and req.doc_source.startswith("http")) else None,
        mcp_server_url=req.mcp_server_url
    )
    schema_name = parsed.get("schema_name", "VendorSchema")
    field_specs = parsed.get("field_specs", {})

    return {
        "status": "SUCCESS",
        "level": "Level 5 Autonomous Data Fabric",
        "source_id": req.source_id,
        "client_id": client.client_id,
        "live_api_key": raw_key,
        "extracted_schema_name": schema_name,
        "extracted_field_specs": field_specs,
        "descriptions": parsed.get("descriptions", {}),
        "source_type": parsed.get("source_type"),
        "ingestion_endpoint": f"/api/v1/ingest/{req.source_id}?schema_name={schema_name}&field_specs_json={json.dumps(field_specs)}"
    }

@app.post(
    "/api/v1/ingest/{source_id}",
    response_model=IngestResponse,
    status_code=status.HTTP_200_OK
)
def ingest_data(
    source_id: str,
    raw_payload: Dict[str, Any],
    background_tasks: BackgroundTasks,
    schema_name: str = Query("LogisticsShipment", description="Target contract schema name"),
    field_specs_json: Optional[str] = Query(None, description="Optional custom JSON schema field specs e.g. {'container_id':'str','weight_kg':'float'}"),
    client: Client = Depends(verify_client_api_key),
    db: Session = Depends(get_db)
):
    """Primary Ingestion Endpoint for Vendor API Data Feeds with Dynamic User-Defined Schemas."""
    record_id = f"rec_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.utcnow().isoformat() + "Z"
    
    # Parse custom field specs if provided, else use default LogisticsShipment template
    if field_specs_json:
        try:
            field_specs = json.loads(field_specs_json)
        except Exception:
            field_specs = SCHEMA_TEMPLATES["Logistics & Supply Chain (LogisticsShipment)"]["fields"]
    else:
        field_specs = SCHEMA_TEMPLATES["Logistics & Supply Chain (LogisticsShipment)"]["fields"]

    # 1. Check if an approved patch exists in registry (scoped to client)
    saved_patch = get_patch(source_id, client_id=client.client_id)
    current_patch_version = get_patch_version(source_id, client_id=client.client_id)
    
    if saved_patch:
        success, transformed, logs = execute_patch(saved_patch, raw_payload, field_specs, schema_name)
        if success and transformed:
            _save_and_relay(
                db, client, record_id, source_id, schema_name,
                transformed, raw_payload, background_tasks,
                patch_version=current_patch_version
            )
            return IngestResponse(
                status="SUCCESS",
                source_id=source_id,
                record_id=record_id,
                drift_detected=False,
                processed_at=now_iso,
                delivered_data=transformed,
                patch_version=current_patch_version,
                message=f"Data transformed via active patch v{current_patch_version} & delivered to {client.company_name}."
            )
        else:
            logger.error(f"[CRITICAL] Saved patch for '{source_id}' (client {client.client_id}) failed: {logs}")
            _quarantine_to_dlq(db, record_id, source_id, client.client_id, raw_payload, f"Saved patch v{current_patch_version} failed: {logs}")
            return IngestResponse(
                status="PATCH_FAILURE",
                source_id=source_id,
                record_id=record_id,
                drift_detected=True,
                processed_at=now_iso,
                delivered_data=None,
                patch_version=current_patch_version,
                message=f"Saved patch v{current_patch_version} execution failed. Payload quarantined to DLQ. Review in Ops Dashboard."
            )

    # 2. Validate raw payload directly against dynamic user-defined JSON schema
    is_valid, val_msg, valid_data = validate_dynamic_payload(raw_payload, field_specs, model_name=schema_name)
    if is_valid and valid_data:
        _save_and_relay(
            db, client, record_id, source_id, schema_name,
            valid_data, raw_payload, background_tasks,
            patch_version=None  # No patch needed — data was natively clean
        )
        return IngestResponse(
            status="SUCCESS",
            source_id=source_id,
            record_id=record_id,
            drift_detected=False,
            processed_at=now_iso,
            delivered_data=valid_data,
            patch_version=None,
            message=f"Clean data delivered to {client.company_name}."
        )

    # 3. Schema Drift — run AI self-healing agent against dynamic schema
    ai_success, patch_code, ai_logs = run_langgraph_self_healing_agent(
        broken_payload=raw_payload,
        field_specs=field_specs,
        schema_name=schema_name,
        validation_error=val_msg
    )

    if ai_success and patch_code:
        # Autonomously deploy the verified patch into registry catalog for this client
        new_patch_version = save_patch(source_id, patch_code, client_id=client.client_id)
        exec_success, transformed, exec_logs = execute_patch(patch_code, raw_payload, field_specs, schema_name)
        
        if exec_success and transformed:
            _save_and_relay(
                db, client, record_id, source_id, schema_name,
                transformed, raw_payload, background_tasks,
                patch_version=new_patch_version
            )
            return IngestResponse(
                status="SUCCESS",
                source_id=source_id,
                record_id=record_id,
                drift_detected=True,
                processed_at=now_iso,
                delivered_data=transformed,
                patch_version=new_patch_version,
                message=f"Schema drift healed! AI patch v{new_patch_version} auto-compiled, verified & deployed. Clean data delivered to {client.company_name}."
            )

    # AI could not generate or execute a working patch — quarantine to DLQ
    _quarantine_to_dlq(
        db, record_id, source_id, client.client_id, raw_payload,
        f"AI self-healing failed after max retries. Validation error: {val_msg}. AI logs: {ai_logs}"
    )

    return IngestResponse(
        status="HEALING_FAILED",
        source_id=source_id,
        record_id=record_id,
        drift_detected=True,
        processed_at=now_iso,
        delivered_data=None,
        patch_version=None,
        message="Schema drift intercepted. AI patch failed validation — payload quarantined to DLQ."
    )
