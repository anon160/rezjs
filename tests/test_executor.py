import pytest
from core.executor import execute_patch

def test_execute_patch_success():
    patch_code = """
def transform(raw: dict) -> dict:
    return {
        "container_id": raw.get("cntr_code"),
        "carrier_name": "Maersk Line",
        "status": "IN_TRANSIT",
        "origin_port": "CNSHA",
        "destination_port": "USLAX",
        "weight_kg": 14250.5,
        "eta_date": "2026-08-12"
    }
"""
    raw = {"cntr_code": "MSKU1234567"}
    success, output, logs = execute_patch(patch_code, raw)
    
    assert success is True
    assert output["container_id"] == "MSKU1234567"
    assert "Patch executed and passed" in logs

def test_execute_patch_runtime_error():
    patch_code = """
def transform(raw: dict) -> dict:
    raise ValueError("Intentional code error")
"""
    raw = {"foo": "bar"}
    success, output, logs = execute_patch(patch_code, raw)
    
    assert success is False
    assert output is None
    assert "Patch runtime error" in logs

def test_execute_patch_timeout():
    patch_code = """
import time
def transform(raw: dict) -> dict:
    time.sleep(10)
    return raw
"""
    raw = {"foo": "bar"}
    success, output, logs = execute_patch(patch_code, raw)
    
    assert success is False
    assert output is None
    assert "timed out" in logs
