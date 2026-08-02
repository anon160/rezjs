"""Level 5 Autonomous API Documentation & Vendor Onboarding Integration Test
Verifies:
1. Parsing OpenAPI/Swagger specifications into target schemas.
2. Autonomous pipeline provisioning via /api/v1/onboard-from-docs.
3. LangGraph AI Agent using read_api_docs_tool for documentation-guided self-healing.
"""
import json
from fastapi.testclient import TestClient

from server.main import app
from core.doc_reader import fetch_and_parse_api_doc
from core.langgraph_engine import read_api_docs_tool

client = TestClient(app)

def print_banner(title: str):
    print("\n=======================================================")
    print(f" 🚀 {title}")
    print("=======================================================")

def test_openapi_spec_parsing():
    print_banner("TEST 1: OpenAPI / Swagger Specification Parsing")

    sample_swagger = {
        "openapi": "3.0.0",
        "info": {"title": "CarrierLogisticsAPI", "version": "2.0"},
        "components": {
            "schemas": {
                "ShipmentEvent": {
                    "properties": {
                        "tracking_number": {"type": "string", "description": "Unique shipment identifier"},
                        "weight_lbs": {"type": "number", "description": "Gross weight in pounds"},
                        "is_delivered": {"type": "boolean", "description": "Delivery status flag"}
                    }
                }
            }
        }
    }

    parsed = fetch_and_parse_api_doc(json.dumps(sample_swagger))
    print(f"   Source Type:           {parsed['source_type']}")
    print(f"   Extracted Schema Name: {parsed['schema_name']}")
    print(f"   Extracted Field Specs: {parsed['field_specs']}")
    print(f"   Descriptions:          {parsed['descriptions']}")

    assert parsed["status"] == "SUCCESS"
    assert parsed["schema_name"] == "ShipmentEvent"
    assert parsed["field_specs"]["tracking_number"] == "str"
    assert parsed["field_specs"]["weight_lbs"] == "float"
    assert parsed["field_specs"]["is_delivered"] == "bool"
    print("✅ TEST 1 PASSED: OpenAPI specification parsed into target schema successfully!")


def test_autonomous_onboarding_endpoint():
    print_banner("TEST 2: Autonomous Vendor Onboarding Endpoint (/api/v1/onboard-from-docs)")

    doc_text = """
    # Vendor Logistics API Specification
    `cntr_id` (string): Container identification code
    `weight_kg` (float): Cargo weight in kilograms
    `shipment_status` (string): Operational milestone status
    """

    req_payload = {
        "doc_source": doc_text,
        "source_id": "auto_onboarded_vendor_feed",
        "company_name": "Horizon Shipping Group"
    }

    resp = client.post("/api/v1/onboard-from-docs", json=req_payload)
    assert resp.status_code == 200
    data = resp.json()

    print(f"   Status:            {data['status']}")
    print(f"   Level:             {data['level']}")
    print(f"   Client ID:         {data['client_id']}")
    print(f"   Live API Key:      {data['live_api_key']}")
    print(f"   Field Specs:       {data['extracted_field_specs']}")
    print(f"   Ingestion URL:     {data['ingestion_endpoint']}")

    assert data["status"] == "SUCCESS"
    assert data["level"] == "Level 5 Autonomous Data Fabric"
    assert "cntr_id" in data["extracted_field_specs"]

    # Ingest clean payload into the newly auto-provisioned pipeline!
    clean_payload = {
        "cntr_id": "HZ100200300",
        "weight_kg": 24500.0,
        "shipment_status": "DISCHARGED"
    }
    headers = {"X-API-Key": data["live_api_key"]}
    ingest_resp = client.post(data["ingestion_endpoint"], json=clean_payload, headers=headers)
    assert ingest_resp.status_code == 200
    ingest_data = ingest_resp.json()

    print(f"\n   Ingestion Result:  {ingest_data['status']}")
    print(f"   Delivered Data:    {ingest_data['delivered_data']}")
    assert ingest_data["status"] == "SUCCESS"
    assert ingest_data["delivered_data"]["cntr_id"] == "HZ100200300"
    print("✅ TEST 2 PASSED: Vendor onboarded directly from API docs & live payload ingested!")


def test_langgraph_read_api_docs_tool():
    print_banner("TEST 3: LangGraph read_api_docs_tool Integration")

    doc_snippet = "`order_id` (string): Order number\n`total_amount` (float): Total bill"
    tool_output = read_api_docs_tool.invoke({"doc_url_or_text": doc_snippet})
    parsed_output = json.loads(tool_output)

    print(f"   Tool Output Status: {parsed_output['status']}")
    print(f"   Tool Field Specs:   {parsed_output['field_specs']}")

    assert parsed_output["status"] == "SUCCESS"
    assert "order_id" in parsed_output["field_specs"]
    print("✅ TEST 3 PASSED: LangGraph read_api_docs_tool successfully invoked!")


if __name__ == "__main__":
    print_banner("LEVEL 5 AUTONOMOUS API DOCS INTEGRATION VERIFICATION")
    test_openapi_spec_parsing()
    test_autonomous_onboarding_endpoint()
    test_langgraph_read_api_docs_tool()
    print_banner("🎉 ALL LEVEL 5 INTEGRATION TESTS PASSED!")
