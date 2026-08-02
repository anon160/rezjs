import os
import json
import re
from typing import Dict, Any, List, TypedDict, Annotated, Optional
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, AIMessage
from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from core.executor import execute_patch
from core.schemas import SCHEMA_TEMPLATES, validate_dynamic_payload
from core.doc_reader import fetch_and_parse_api_doc

DEFAULT_LOGISTICS_FIELDS = SCHEMA_TEMPLATES["Logistics & Supply Chain (LogisticsShipment)"]["fields"]

# --- LANGCHAIN TOOLS ---

@tool
def verify_patch_tool(patch_code: str, raw_payload_json: str, field_specs_json: str, schema_name: str) -> str:
    """Executes a Python transformation patch against the raw payload and validates against dynamic schema fields."""
    raw_payload = json.loads(raw_payload_json)
    field_specs = json.loads(field_specs_json)
    success, output, logs = execute_patch(patch_code, raw_payload, field_specs, schema_name)
    if success:
        return f"SUCCESS: Patch passed {schema_name} dynamic validation. Output: {json.dumps(output)}"
    else:
        return f"FAILED: {logs}. Fix the transform() function and try again."

@tool
def read_api_docs_tool(doc_url_or_text: str) -> str:
    """Fetches and parses vendor API documentation or OpenAPI/Swagger JSON to extract target field specifications and descriptions."""
    res = fetch_and_parse_api_doc(doc_url_or_text)
    return json.dumps(res, indent=2)

@tool
def tavily_search_tool(query: str) -> str:
    """Searches the web for vendor API documentation, schemas, and developer portal URLs using Tavily AI Search."""
    import requests
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        return "TAVILY_API_KEY not configured. Use read_api_docs_tool with a direct URL instead."
    
    try:
        resp = requests.post(
            "https://api.tavily.com/search",
            json={"api_key": api_key, "query": query, "search_depth": "basic", "max_results": 3},
            timeout=8
        )
        if resp.status_code == 200:
            data = resp.json()
            results = data.get("results", [])
            output = []
            for r in results:
                output.append(f"Title: {r.get('title')}\nURL: {r.get('url')}\nContent: {r.get('content')[:300]}")
            return "\n\n".join(output) if output else "No documentation search results found."
        else:
            return f"Tavily search returned status {resp.status_code}"
    except Exception as err:
        return f"Tavily search error: {err}"


# --- DYNAMIC SYSTEM PROMPT BUILDER ---

def _build_system_prompt(schema_name: str, field_specs: Dict[str, str]) -> str:
    """Builds a schema-aware system prompt directly from user-defined JSON field specifications."""
    lines = [f"- {name} ({field_type})" for name, field_type in field_specs.items()]
    field_spec_str = "\n".join(lines)

    return f"""You are an expert DataOps AI Infrastructure Mechanic.
An external vendor API feed broke due to schema drift.

Your job:
1. Generate a Python function `transform(raw: dict) -> dict` that maps the broken JSON into the user's target contract.
2. Call the verify_patch_tool to test your code against the actual payload.
3. If verification fails, read the error, fix your code, and call verify_patch_tool again.
4. Keep iterating until the tool returns SUCCESS.

TARGET USER-DEFINED SCHEMA — {schema_name}:
{field_spec_str}

Rules:
- Output ONLY the transform() function code when calling the tool — no imports, no if __name__ blocks.
- Handle unit conversions (e.g. lbs→kg: divide by 2.20462 if needed).
- Handle date format normalization to YYYY-MM-DD.
- Handle nested payloads by traversing the dict structure.
"""


# --- LANGGRAPH STATE ---

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]
    raw_payload: Dict[str, Any]
    field_specs: Dict[str, str]
    schema_name: str
    validation_error: str
    final_patch: str


MAX_AGENT_ITERATIONS = 4

def _should_continue(state: AgentState) -> str:
    """Routes to tool execution if the LLM made tool calls, otherwise ends."""
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return "end"


def run_langgraph_self_healing_agent(
    broken_payload: Dict[str, Any],
    field_specs: Optional[Dict[str, str]] = None,
    schema_name: str = "DynamicContract",
    validation_error: str = "Schema validation failed"
) -> tuple[bool, str, str]:
    """Runs a stateful LangGraph agent loop that generates, verifies, and self-corrects transformation patches against user-defined JSON schemas.
    
    If AI self-healing fails or GEMINI_API_KEY is not set, returns (False, "", error_msg) so the payload is quarantined to the Dead Letter Queue (DLQ).
    """

    if not field_specs:
        field_specs = DEFAULT_LOGISTICS_FIELDS

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return False, "", "GEMINI_API_KEY environment variable not set. AI self-healing disabled."

    try:
        model_name = os.environ.get("RESILIENT_LLM_MODEL", "gemini-2.5-flash")
        llm = ChatGoogleGenerativeAI(model=model_name, google_api_key=api_key)
        tools = [verify_patch_tool, read_api_docs_tool, tavily_search_tool]
        llm_with_tools = llm.bind_tools(tools)

        builder = StateGraph(AgentState)

        def agent_node(state: AgentState):
            response = llm_with_tools.invoke(state["messages"])
            return {"messages": [response]}

        tool_node = ToolNode(tools)

        builder.add_node("agent", agent_node)
        builder.add_node("tools", tool_node)

        builder.set_entry_point("agent")
        builder.add_conditional_edges("agent", _should_continue, {"tools": "tools", "end": END})
        builder.add_edge("tools", "agent")

        graph = builder.compile()

        system_prompt = _build_system_prompt(schema_name, field_specs)
        user_prompt = (
            f"BROKEN RAW PAYLOAD:\n{json.dumps(broken_payload, indent=2)}\n\n"
            f"VALIDATION ERROR:\n{validation_error}\n\n"
            f"RAW_PAYLOAD_JSON for tool call: {json.dumps(broken_payload)}\n"
            f"FIELD_SPECS_JSON for tool call: {json.dumps(field_specs)}\n"
            f"SCHEMA_NAME for tool call: {schema_name}\n\n"
            f"Generate the transform() function and verify it using the tool."
        )

        initial_state = {
            "messages": [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)],
            "raw_payload": broken_payload,
            "field_specs": field_specs,
            "schema_name": schema_name,
            "validation_error": validation_error,
            "final_patch": ""
        }

        result_state = graph.invoke(initial_state, {"recursion_limit": MAX_AGENT_ITERATIONS * 2 + 1})

        patch_code = _extract_patch_from_messages(result_state["messages"])
        if patch_code:
            success, output, logs = execute_patch(patch_code, broken_payload, field_specs, schema_name)
            return success, patch_code, logs
        
        return False, "", "AI self-healing agent completed loop without producing a verified patch."

    except Exception as e:
        print(f"[LangGraph Engine] Exception during AI self-healing: {e}")
        return False, "", f"AI self-healing failed with exception: {e}"


def _extract_patch_from_messages(messages: List[BaseMessage]) -> str | None:
    """Walks the message history to find the last valid transform() code block."""
    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i]
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            for tc in msg.tool_calls:
                if tc.get("name") == "verify_patch_tool":
                    code = tc.get("args", {}).get("patch_code", "")
                    if "def transform" in code:
                        if i + 1 < len(messages):
                            next_msg = messages[i + 1]
                            content = getattr(next_msg, "content", "")
                            if isinstance(content, str) and "SUCCESS" in content:
                                return code

    return None
