"""Project Resilient — Core Auto-DataOps AI Engine & SDK.
Pure Python SDK for real-time AI schema self-healing, dynamic contract enforcement,
OpenAPI/MCP discovery, and Daft Multimodal Rust batch modernization.

Zero Database or Web Framework Dependencies.
"""
from typing import Dict, Any, Optional

from core.schemas import create_dynamic_model, validate_dynamic_payload, infer_schema_from_sample, SCHEMA_TEMPLATES
from core.executor import execute_patch
from core.langgraph_engine import run_langgraph_self_healing_agent
from core.doc_reader import fetch_and_parse_api_doc
from core.mcp_reader import discover_vendor_schema_hybrid
from core.batch_engine import inspect_legacy_file, execute_daft_modernization, query_parquet_lake, align_schema_via_langgraph
from core.vector_engine import compute_text_vector, align_columns_vectorized, query_parquet_vector_lake

class AutoDataOps:
    """Core SDK entry point for autonomous data operations."""

    @staticmethod
    def infer_schema(sample_payload: Dict[str, Any]) -> Dict[str, str]:
        """Infers a dynamic JSON field specification directly from a sample payload using genson."""
        return infer_schema_from_sample(sample_payload)

    @staticmethod
    def validate(payload: Dict[str, Any], field_specs: Dict[str, str], schema_name: str = "DynamicSchema"):
        """Validates a raw JSON payload directly against user-defined field specs."""
        return validate_dynamic_payload(payload, field_specs, model_name=schema_name)

    @staticmethod
    def heal(broken_payload: Dict[str, Any], field_specs: Dict[str, str], schema_name: str = "DynamicSchema"):
        """Invokes LangGraph AI agent to self-heal schema drift and return a compiled Python patch."""
        return run_langgraph_self_healing_agent(broken_payload, field_specs, schema_name)

    @staticmethod
    def transform(patch_code: str, raw_payload: Dict[str, Any], field_specs: Dict[str, str], schema_name: str = "DynamicSchema"):
        """Executes a Python transformation patch in an isolated 5s subprocess."""
        return execute_patch(patch_code, raw_payload, field_specs, schema_name)

    @staticmethod
    def modernize_batch(input_file: str, output_parquet: str, field_specs: Optional[Dict[str, str]] = None, schema_name: str = "BatchSchema"):
        """Modernizes legacy CSV/JSON files using Daft Rust engine + LangGraph AI schema alignment + Native 384-dim Vector Embeddings."""
        return execute_daft_modernization(input_file, output_parquet, field_specs=field_specs, schema_name=schema_name)

    @staticmethod
    def query_lake(parquet_path: str, sql_query: str):
        """Executes microsecond DuckDB SQL queries over Parquet data lakes."""
        return query_parquet_lake(parquet_path, sql_query)

    @staticmethod
    def query_vector_lake(parquet_path: str, query_text: str, top_k: int = 10):
        """Executes DuckDB vector similarity search over vector-embedded Parquet data lakes."""
        return query_parquet_vector_lake(parquet_path, query_text, top_k=top_k)

    @staticmethod
    def embed_text(text: str) -> list:
        """Generates a 384-dimensional vector embedding for text."""
        return compute_text_vector(text)

    @staticmethod
    def align_columns_vectorized(source_columns: list, target_fields: dict, threshold: float = 0.30):
        """Aligns source batch columns to target schema fields using vector cosine similarity."""
        return align_columns_vectorized(source_columns, target_fields, threshold=threshold)

    @staticmethod
    def discover_schema(mcp_server_url: Optional[str] = None, doc_url_or_text: Optional[str] = None):
        """Discovers target schemas from MCP Server URLs or OpenAPI/Swagger documentation."""
        return discover_vendor_schema_hybrid(mcp_server_url=mcp_server_url, doc_url_or_text=doc_url_or_text)


__all__ = [
    "AutoDataOps",
    "create_dynamic_model",
    "validate_dynamic_payload",
    "infer_schema_from_sample",
    "execute_patch",
    "run_langgraph_self_healing_agent",
    "fetch_and_parse_api_doc",
    "discover_vendor_schema_hybrid",
    "inspect_legacy_file",
    "execute_daft_modernization",
    "query_parquet_lake",
    "query_parquet_vector_lake",
    "compute_text_vector",
    "align_columns_vectorized",
    "align_schema_via_langgraph",
    "SCHEMA_TEMPLATES"
]
