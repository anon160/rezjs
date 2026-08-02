from pydantic import BaseModel, create_model, ValidationError
from typing import Dict, Any, Tuple, Optional
from functools import lru_cache
from genson import SchemaBuilder

# =====================================================================
# 🌐 DYNAMIC USER-DEFINED SCHEMA ENGINE (JSON ➔ PYDANTIC)
# =====================================================================

# Mapping of string data types to native Python types
TYPE_MAPPING: Dict[str, type] = {
    "str": str,
    "string": str,
    "int": int,
    "integer": int,
    "float": float,
    "number": float,
    "bool": bool,
    "boolean": bool,
    "list": list,
    "array": list,
    "dict": dict,
    "object": dict,
    "any": Any
}

def infer_schema_from_sample(sample_payload: Dict[str, Any]) -> Dict[str, str]:
    """Infers a target field specification dictionary directly from a sample raw JSON dictionary using genson."""
    builder = SchemaBuilder()
    builder.add_object(sample_payload)
    schema = builder.to_schema()
    
    field_specs = {}
    props = schema.get("properties", {})
    for k, v in props.items():
        t = v.get("type", "string")
        if isinstance(t, list):
            t = t[0] if t else "string"
        if t in ["integer", "int"]:
            field_specs[k] = "int"
        elif t in ["number", "float"]:
            field_specs[k] = "float"
        elif t in ["boolean", "bool"]:
            field_specs[k] = "bool"
        elif t == "array":
            field_specs[k] = "list"
        elif t == "object":
            field_specs[k] = "dict"
        else:
            field_specs[k] = "str"
            
    return field_specs

def create_dynamic_model(model_name: str, field_specs: Dict[str, str]) -> type[BaseModel]:
    """Dynamically constructs a live Pydantic Model from user-defined JSON field specifications.
    
    Example field_specs:
        {
            "container_id": "str",
            "weight_kg": "float",
            "status": "str"
        }
    
    Raises ValueError if an unsupported type string is provided.
    """
    fields: Dict[str, Tuple[type, Any]] = {}
    for field_name, type_str in field_specs.items():
        py_type = TYPE_MAPPING.get(type_str.lower())
        if py_type is None:
            raise ValueError(
                f"Unsupported field type '{type_str}' for field '{field_name}'. "
                f"Supported types: {list(TYPE_MAPPING.keys())}"
            )
        # Mark all defined fields as required (...) by default
        fields[field_name] = (py_type, ...)
    
    return create_model(model_name, **fields)

@lru_cache(maxsize=256)
def _get_or_create_model(model_name: str, frozen_specs: tuple) -> type[BaseModel]:
    """Cached Pydantic model factory. Avoids recreating models for repeated schema validations."""
    field_specs = dict(frozen_specs)
    return create_dynamic_model(model_name, field_specs)

def validate_dynamic_payload(
    raw_payload: Dict[str, Any],
    field_specs: Dict[str, str],
    model_name: str = "DynamicContract"
) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """Validates raw payload against a dynamic user-defined JSON schema specification.
    
    Uses an LRU-cached model factory to avoid recreating Pydantic classes on every call.
    """
    try:
        frozen_specs = tuple(sorted(field_specs.items()))
        dynamic_class = _get_or_create_model(model_name, frozen_specs)
        validated_obj = dynamic_class(**raw_payload)
        return True, "Validation Passed", validated_obj.model_dump()
    except ValidationError as e:
        return False, str(e), None
    except ValueError as e:
        return False, f"Schema Definition Error: {e}", None
    except Exception as err:
        return False, f"Unexpected validation error: {err}", None


# =====================================================================
# 🗂️ PRESET DYNAMIC SCHEMA TEMPLATES FOR DEMOS & DOMAIN VERTICALS
# =====================================================================

SCHEMA_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "Logistics & Supply Chain (LogisticsShipment)": {
        "domain": "Logistics & Supply Chain",
        "schema_name": "LogisticsShipment",
        "fields": {
            "container_id": "str",
            "carrier_name": "str",
            "status": "str",
            "origin_port": "str",
            "destination_port": "str",
            "weight_kg": "float",
            "eta_date": "str"
        }
    },
    "Fintech & Vendor Billing (CarrierInvoice)": {
        "domain": "Fintech & Billing",
        "schema_name": "CarrierInvoice",
        "fields": {
            "invoice_number": "str",
            "carrier_name": "str",
            "bill_of_lading": "str",
            "total_amount": "float",
            "currency": "str",
            "invoice_date": "str"
        }
    },
    "E-Commerce & Retail (InventoryFeed)": {
        "domain": "E-Commerce & Retail",
        "schema_name": "InventoryFeed",
        "fields": {
            "sku": "str",
            "product_name": "str",
            "warehouse_code": "str",
            "units_available": "int",
            "unit_price_usd": "float",
            "reorder_threshold": "int"
        }
    },
    "Healthcare & Claims (MedicalClaim)": {
        "domain": "Healthcare & Insurance",
        "schema_name": "MedicalClaim",
        "fields": {
            "claim_id": "str",
            "patient_id": "str",
            "provider_npi": "str",
            "diagnosis_code": "str",
            "claim_amount": "float",
            "claim_status": "str"
        }
    }
}

# =====================================================================
# 🧪 MOCK PAYLOADS FOR DEMOS & TESTING
# =====================================================================

MOCK_PAYLOADS: Dict[str, Dict[str, Any]] = {
    "valid_maersk_feed": {
        "container_id": "MSKU9876543",
        "carrier_name": "Maersk Line",
        "status": "IN_TRANSIT",
        "origin_port": "CNSHA",
        "destination_port": "USLAX",
        "weight_kg": 14250.5,
        "eta_date": "2026-08-12"
    },
    "broken_maersk_v2_drift": {
        "cntr_code": "MSKU9876543",
        "shipping_line": "Maersk Line",
        "shipment_state": "IN_TRANSIT",
        "dept_port": "CNSHA",
        "arr_port": "USLAX",
        "gross_weight_lbs": 31417.0,
        "expected_delivery_timestamp": "2026-08-12T00:00:00Z"
    },
    "broken_dhl_nested_drift": {
        "telemetry": {
            "equipment": {"id": "DHLU441209"},
            "carrier": "DHL Global Forwarding",
            "milestone": "DELAYED",
            "route": {"from": "DEHAM", "to": "USNYC"},
            "cargo_specs": {"weight_kilos": 8900.0},
            "estimated_arrival": "2026-08-18"
        }
    },
    "broken_invoice_vendor_drift": {
        "inv_no": "INV-998877",
        "billing_carrier": "Apex Ocean Freight",
        "bl_reference": "BOL-4439001",
        "amount_due": "4500.00",
        "currency_code": "USD",
        "issue_date": "2026-08-01"
    }
}
