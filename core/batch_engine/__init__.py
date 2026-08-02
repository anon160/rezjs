"""Batch Engine package powered by Daft Framework & LangGraph AI Agent for mass legacy data modernization and Parquet analytics."""
from .daft_modernizer import (
    inspect_legacy_file,
    execute_daft_modernization,
    query_parquet_lake,
    generate_sample_legacy_csv,
    align_schema_via_langgraph
)

__all__ = [
    "inspect_legacy_file",
    "execute_daft_modernization",
    "query_parquet_lake",
    "generate_sample_legacy_csv",
    "align_schema_via_langgraph"
]
