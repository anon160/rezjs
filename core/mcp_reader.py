"""Level 5 Hybrid Discovery Engine: MCP Server Protocol & API Documentation Fallback.
Provides protocol-native MCP (Model Context Protocol) tool & schema discovery with OpenAPI/Swagger API Docs fallback.
"""
import json
import logging
import requests

logger = logging.getLogger("resilient.mcp")
from typing import Dict, Any, Optional
from core.doc_reader import fetch_and_parse_api_doc

def discover_vendor_schema_hybrid(
    mcp_server_url: Optional[str] = None,
    doc_url_or_text: Optional[str] = None
) -> Dict[str, Any]:
    """Hybrid schema discovery:
    1. Attempts protocol-native MCP Server discovery (mcp:// or http JSON-RPC /tools/list).
    2. Falls back to OpenAPI / Swagger / API Documentation URL parsing.
    3. Returns standard schema specification dict.
    """
    # 1. Try MCP Server Protocol Discovery if URL provided
    if mcp_server_url:
        mcp_res = discover_via_mcp_protocol(mcp_server_url)
        if mcp_res.get("status") == "SUCCESS":
            return mcp_res

    # 2. Fallback to API Documentation / OpenAPI spec parsing
    if doc_url_or_text:
        doc_res = fetch_and_parse_api_doc(doc_url_or_text)
        if doc_res.get("status") == "SUCCESS":
            return doc_res

    return {
        "status": "ERROR",
        "message": "Neither MCP Server nor valid API Documentation URL provided."
    }


def discover_via_mcp_protocol(mcp_url: str) -> Dict[str, Any]:
    """Performs JSON-RPC MCP (Model Context Protocol) tool and schema discovery over HTTP/SSE.
    
    Note: This implements JSON-RPC 2.0 over HTTP as a simplified MCP transport. Production
    deployments may need SSE or stdio transport adapters.
    """
    clean_url = mcp_url.replace("mcp://", "https://")
    
    # MCP JSON-RPC 2.0 tools/list request payload
    mcp_request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
        "params": {}
    }

    try:
        resp = requests.post(clean_url, json=mcp_request, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            tools = data.get("result", {}).get("tools", [])
            
            if tools:
                primary_tool = tools[0]
                schema_name = primary_tool.get("name", "MCPSchema")
                input_schema = primary_tool.get("inputSchema", {})
                props = input_schema.get("properties", {})
                
                field_specs = {}
                descriptions = {}
                sample_payload = {}
                
                for k, v in props.items():
                    t = v.get("type", "string")
                    if t in ["integer", "int"]:
                        field_specs[k] = "int"
                        sample_payload[k] = 100
                    elif t in ["number", "float"]:
                        field_specs[k] = "float"
                        sample_payload[k] = 99.9
                    elif t == "boolean":
                        field_specs[k] = "bool"
                        sample_payload[k] = True
                    else:
                        field_specs[k] = "str"
                        sample_payload[k] = f"sample_{k}"
                    
                    if "description" in v:
                        descriptions[k] = v["description"]

                return {
                    "status": "SUCCESS",
                    "source_type": "MCP Server Protocol (Model Context Protocol)",
                    "schema_name": schema_name,
                    "field_specs": field_specs,
                    "descriptions": descriptions,
                    "sample_payload": sample_payload,
                    "mcp_server_url": mcp_url
                }
    except Exception as err:
        logger.warning(f"MCP discovery failed for {mcp_url}: {err}")

    return {"status": "FALLBACK", "message": f"MCP discovery failed for {mcp_url}"}
