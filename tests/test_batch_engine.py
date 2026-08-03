import pytest
import os
import tempfile
from core.batch_engine import (
    generate_sample_legacy_csv,
    inspect_legacy_file,
    execute_daft_modernization,
    query_parquet_lake,
    align_schema_via_langgraph
)

@pytest.fixture
def temp_csv_and_parquet_paths():
    with tempfile.TemporaryDirectory() as tmpdir:
        csv_path = os.path.join(tmpdir, "legacy_5k.csv")
        parquet_path = os.path.join(tmpdir, "modernized_5k.parquet")
        generate_sample_legacy_csv(csv_path, num_rows=5000)
        yield csv_path, parquet_path

def test_generate_sample_legacy_csv(temp_csv_and_parquet_paths):
    csv_path, _ = temp_csv_and_parquet_paths
    assert os.path.exists(csv_path)
    assert os.path.getsize(csv_path) > 0

def test_inspect_legacy_file(temp_csv_and_parquet_paths):
    csv_path, _ = temp_csv_and_parquet_paths
    info = inspect_legacy_file(csv_path)
    
    assert info["total_rows"] == 5000
    assert "cntr_code" in info["columns"]
    assert "gross_weight_lbs" in info["columns"]
    assert len(info["preview_rows"]) == 5

def test_align_schema_via_langgraph_exact_match():
    """Exact field name matches map directly."""
    sample_row = {"container_id": "MSKU100", "status": "IN_TRANSIT", "weight_kg": 1500.0}
    target_specs = {"container_id": "str", "status": "str", "weight_kg": "float"}
    
    mapping = align_schema_via_langgraph(sample_row, target_specs, "TestContract")
    assert mapping["container_id"] == "container_id"
    assert mapping["status"] == "status"
    assert mapping["weight_kg"] == "weight_kg"

def test_execute_daft_modernization_with_field_specs(temp_csv_and_parquet_paths):
    """Tests batch modernization with user-defined field_specs driven by LangGraph AI."""
    csv_path, parquet_path = temp_csv_and_parquet_paths
    field_specs = {
        "container_id": "str",
        "carrier_name": "str",
        "status": "str",
        "origin_port": "str",
        "destination_port": "str",
        "weight_kg": "float",
        "eta_date": "str"
    }
    stats = execute_daft_modernization(csv_path, parquet_path, field_specs=field_specs)
    
    assert stats["status"] == "SUCCESS"
    assert stats["total_rows_processed"] == 5000
    assert os.path.exists(parquet_path)
    assert stats["compressed_parquet_mb"] >= 0.0

def test_execute_daft_modernization_passthrough(temp_csv_and_parquet_paths):
    """Without field_specs, all columns pass through unchanged (pure compression mode)."""
    csv_path, parquet_path = temp_csv_and_parquet_paths
    stats = execute_daft_modernization(csv_path, parquet_path, field_specs=None)
    
    assert stats["status"] == "SUCCESS"
    assert stats["total_rows_processed"] == 5000
    assert stats["column_mapping"] == {}

def test_query_parquet_lake(temp_csv_and_parquet_paths):
    csv_path, parquet_path = temp_csv_and_parquet_paths
    field_specs = {
        "container_id": "str",
        "carrier_name": "str",
        "status": "str",
        "origin_port": "str",
        "destination_port": "str",
        "weight_kg": "float",
        "eta_date": "str"
    }
    execute_daft_modernization(csv_path, parquet_path, field_specs=field_specs)
    
    query = "SELECT COUNT(*) as count FROM parquet_table"
    res = query_parquet_lake(parquet_path, query)
    
    assert res["status"] == "SUCCESS"
    assert res["results"][0]["count"] == 5000
