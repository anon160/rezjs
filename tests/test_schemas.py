import pytest
from core.schemas import create_dynamic_model, validate_dynamic_payload, infer_schema_from_sample, SCHEMA_TEMPLATES

def test_infer_schema_from_sample():
    sample = {
        "order_id": "ORD-9921",
        "quantity": 10,
        "price_usd": 49.99,
        "is_active": True,
        "tags": ["express", "fragile"],
        "metadata": {"origin": "US"}
    }
    inferred = infer_schema_from_sample(sample)
    assert inferred["order_id"] == "str"
    assert inferred["quantity"] == "int"
    assert inferred["price_usd"] == "float"
    assert inferred["is_active"] == "bool"
    assert inferred["tags"] == "list"
    assert inferred["metadata"] == "dict"

def test_create_dynamic_model():
    field_specs = {"tracking_id": "str", "qty": "int", "price": "float"}
    ModelClass = create_dynamic_model("TestContract", field_specs)
    
    obj = ModelClass(tracking_id="TRK123", qty=5, price=99.9)
    assert obj.tracking_id == "TRK123"
    assert obj.qty == 5
    assert obj.price == 99.9

def test_validate_dynamic_payload_success():
    field_specs = {"container_id": "str", "weight_kg": "float"}
    raw = {"container_id": "MSKU99", "weight_kg": 1200.5}
    is_valid, msg, valid_data = validate_dynamic_payload(raw, field_specs)
    
    assert is_valid is True
    assert valid_data["container_id"] == "MSKU99"
    assert valid_data["weight_kg"] == 1200.5

def test_validate_dynamic_payload_failure():
    field_specs = {"container_id": "str", "weight_kg": "float"}
    raw = {"container_id": "MSKU99", "weight_kg": "invalid_number"}
    is_valid, msg, valid_data = validate_dynamic_payload(raw, field_specs)
    
    assert is_valid is False
    assert valid_data is None
    assert "Input should be a valid number" in msg

def test_schema_templates_exist():
    assert "Logistics & Supply Chain (LogisticsShipment)" in SCHEMA_TEMPLATES
    assert "Fintech & Vendor Billing (CarrierInvoice)" in SCHEMA_TEMPLATES
    assert "E-Commerce & Retail (InventoryFeed)" in SCHEMA_TEMPLATES
    assert "Healthcare & Claims (MedicalClaim)" in SCHEMA_TEMPLATES
