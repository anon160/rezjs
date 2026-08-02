from typing import Dict, Optional
from server.database import SessionLocal, PatchCatalog

def load_catalog(client_id: str = "default") -> Dict[str, str]:
    """Loads approved patches catalog from database, scoped to a specific client."""
    db = SessionLocal()
    try:
        patches = db.query(PatchCatalog).filter(PatchCatalog.client_id == client_id).all()
        return {p.source_id: p.patch_code for p in patches}
    finally:
        db.close()

def save_patch(vendor_id: str, patch_code: str, client_id: str = "default") -> int:
    """Saves or updates an approved patch code in database. Returns the new patch_version."""
    db = SessionLocal()
    try:
        existing = db.query(PatchCatalog).filter(
            PatchCatalog.source_id == vendor_id,
            PatchCatalog.client_id == client_id
        ).first()
        if existing:
            existing.patch_code = patch_code
            existing.patch_version = (existing.patch_version or 0) + 1
            db.commit()
            return existing.patch_version
        else:
            new_patch = PatchCatalog(
                source_id=vendor_id,
                patch_code=patch_code,
                client_id=client_id,
                patch_version=1
            )
            db.add(new_patch)
            db.commit()
            return 1
    finally:
        db.close()

def get_patch(vendor_id: str, client_id: str = "default") -> Optional[str]:
    """Retrieves approved patch code for a given vendor feed, scoped to client."""
    db = SessionLocal()
    try:
        patch = db.query(PatchCatalog).filter(
            PatchCatalog.source_id == vendor_id,
            PatchCatalog.client_id == client_id
        ).first()
        return patch.patch_code if patch else None
    finally:
        db.close()

def get_patch_version(vendor_id: str, client_id: str = "default") -> Optional[int]:
    """Gets the current patch version number for lineage tracking."""
    db = SessionLocal()
    try:
        patch = db.query(PatchCatalog).filter(
            PatchCatalog.source_id == vendor_id,
            PatchCatalog.client_id == client_id
        ).first()
        return patch.patch_version if patch else None
    finally:
        db.close()

def clear_catalog(client_id: Optional[str] = None):
    """Resets the patch catalog. If client_id given, only clears that client's patches."""
    db = SessionLocal()
    try:
        query = db.query(PatchCatalog)
        if client_id:
            query = query.filter(PatchCatalog.client_id == client_id)
        query.delete()
        db.commit()
    finally:
        db.close()
