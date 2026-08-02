import os
import hashlib
import secrets
from datetime import datetime
from typing import Generator, Optional

from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, Text, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# SQLite Database — configurable via environment variable
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:////home/anon/Documents/corp/resilient.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- UTILITY ---

def hash_api_key(raw_key: str) -> str:
    """Returns a SHA-256 hash of the raw API key for secure storage."""
    return hashlib.sha256(raw_key.encode()).hexdigest()

# --- SQL ORM MODELS ---

class Client(Base):
    """Client Account & Authentication Model."""
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(String, unique=True, index=True, nullable=False)
    company_name = Column(String, nullable=False)
    api_key_hash = Column(String, unique=True, index=True, nullable=False)
    api_key_prefix = Column(String, nullable=False)  # First 8 chars for display (e.g. "res_live_")
    webhook_url = Column(String, nullable=True)
    doc_url = Column(String, nullable=True)
    mcp_server_url = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class PatchCatalog(Base):
    """SQL Patch Catalog for Approved Transformation Patches with versioning."""
    __tablename__ = "patch_catalog"

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(String, index=True, nullable=False)
    client_id = Column(String, index=True, default="default")
    patch_code = Column(Text, nullable=False)
    patch_version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class DataRecord(Base):
    """Generic delivered clean data sink — stores any schema as JSON."""
    __tablename__ = "data_records"

    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(String, unique=True, index=True, nullable=False)
    source_id = Column(String, index=True, nullable=False)
    client_id = Column(String, index=True, default="default")
    schema_name = Column(String, index=True, nullable=False)
    clean_data = Column(Text, nullable=False)
    raw_payload = Column(Text, nullable=False)
    patch_version_applied = Column(Integer, nullable=True)  # Which patch version transformed this record
    created_at = Column(DateTime, default=datetime.utcnow)

class DeadLetterRecord(Base):
    """Quarantine table for payloads that could not be healed by AI or any saved patch."""
    __tablename__ = "dead_letter_queue"

    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(String, unique=True, index=True, nullable=False)
    source_id = Column(String, index=True, nullable=False)
    client_id = Column(String, index=True, default="default")
    raw_payload = Column(Text, nullable=False)
    error_logs = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class WebhookDeliveryLog(Base):
    """Tracks webhook delivery attempts with retry status."""
    __tablename__ = "webhook_delivery_log"

    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(String, index=True, nullable=False)
    webhook_url = Column(String, nullable=False)
    attempt_number = Column(Integer, default=1)
    status_code = Column(Integer, nullable=True)
    success = Column(Boolean, default=False)
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

# --- DATABASE HELPERS ---

# Demo key constant — stored hashed in DB, raw form used only for test/demo auth
DEMO_API_KEY_RAW = "res_live_demo123"

def init_db(force: bool = False):
    """Initializes SQLite database tables and seeds a default demo client. Safe to call multiple times."""
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        demo_hash = hash_api_key(DEMO_API_KEY_RAW)
        demo_client = db.query(Client).filter(Client.api_key_hash == demo_hash).first()
        if not demo_client:
            demo_client = Client(
                client_id="client_logistics_demo",
                company_name="Apex Logistics Ltd",
                api_key_hash=demo_hash,
                api_key_prefix=DEMO_API_KEY_RAW[:12],
                webhook_url=None,
                is_active=True
            )
            db.add(demo_client)
            db.commit()
    finally:
        db.close()

def create_client(
    company_name: str,
    webhook_url: Optional[str] = None,
    doc_url: Optional[str] = None,
    mcp_server_url: Optional[str] = None
) -> tuple:
    """Helper to onboard a new pilot client. Returns (Client, raw_api_key) — raw key is shown once only."""
    init_db()
    db = SessionLocal()
    try:
        clean_name = company_name.lower().replace(" ", "_")
        client_id = f"client_{clean_name}_{secrets.token_hex(3)}"
        raw_api_key = f"res_live_{secrets.token_hex(12)}"
        key_hash = hash_api_key(raw_api_key)
        
        new_client = Client(
            client_id=client_id,
            company_name=company_name,
            api_key_hash=key_hash,
            api_key_prefix=raw_api_key[:12],
            webhook_url=webhook_url,
            doc_url=doc_url,
            mcp_server_url=mcp_server_url,
            is_active=True
        )
        db.add(new_client)
        db.commit()
        db.refresh(new_client)
        return new_client, raw_api_key
    finally:
        db.close()

def get_db() -> Generator[Session, None, None]:
    """FastAPI Dependency for database session management."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
