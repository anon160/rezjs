import os
import pytest
from core.vector_engine import (
    compute_text_vector,
    cosine_similarity,
    align_columns_vectorized,
    query_parquet_vector_lake
)
from core.batch_engine import execute_daft_modernization

TEST_DIR = "/home/anon/Documents/corp/real_world_test_data"

def test_compute_text_vector():
    vec1 = compute_text_vector("Maersk Container Shipment")
    vec2 = compute_text_vector("Maersk Container Shipment")
    vec3 = compute_text_vector("DHL Express Cargo")
    
    assert len(vec1) == 384
    assert len(vec2) == 384
    assert len(vec3) == 384
    
    # Identical texts must have cosine similarity = 1.0
    sim_same = cosine_similarity(vec1, vec2)
    assert abs(sim_same - 1.0) < 1e-4
    
    # Different texts must have lower similarity
    sim_diff = cosine_similarity(vec1, vec3)
    assert sim_diff < 0.90

def test_align_columns_vectorized():
    source_cols = ["cntr_code", "gross_weight_lbs", "shipment_state", "arr_port"]
    target_specs = {
        "container_id": "str",
        "weight_kg": "float",
        "status": "str",
        "destination_port": "str"
    }
    
    mapping = align_columns_vectorized(source_cols, target_specs)
    assert mapping.get("cntr_code") == "container_id"
    assert mapping.get("arr_port") == "destination_port"

def test_vector_embedded_parquet_lake_query():
    input_csv = os.path.join(TEST_DIR, "cargo_shipments.csv")
    output_parquet = os.path.join(TEST_DIR, "modernized_vector_cargo_lake.parquet")
    
    target_specs = {
        "cargo_id": "int",
        "fare_amount": "float",
        "passenger_name": "str",
        "departure_port": "str"
    }
    
    # Modernize dataset with native Daft + PyArrow 384-dim vector embeddings
    stats = execute_daft_modernization(input_csv, output_parquet, field_specs=target_specs)
    assert stats["status"] == "SUCCESS"
    assert os.path.exists(output_parquet)
    
    # Run DuckDB Vector Similarity Search over Parquet Data Lake
    res = query_parquet_vector_lake(output_parquet, query_text="Cargo Manifest Passenger", top_k=5)
    assert res["status"] == "SUCCESS"
    assert len(res["results"]) > 0
    assert "similarity_score" in res["results"][0]
    assert res["results"][0]["similarity_score"] > 0.0
