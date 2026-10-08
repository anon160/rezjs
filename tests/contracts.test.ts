import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createDynamicSchema,
  validatePayload,
  inferSchemaFromSample,
  SCHEMA_TEMPLATES,
} from "../src/contracts.js";

describe("Contracts & Zod Schema Validation", () => {
  it("should validate payloads against dynamic schemas", () => {
    const specs = {
      container_id: "str",
      weight_kg: "float",
      is_active: "bool",
    };
    const schema = createDynamicSchema(specs);

    const validPayload = {
      container_id: "MSKU12345",
      weight_kg: 24500.5,
      is_active: true,
    };
    const res = validatePayload(validPayload, schema);
    expect(res.isValid).toBe(true);
    expect(res.data.container_id).toBe("MSKU12345");
  });

  it("should fail validation on missing or incorrect fields", () => {
    const specs = {
      product_id: "int",
      unit_price: "float",
    };
    const schema = createDynamicSchema(specs);

    const invalidPayload = {
      product_id: "not-an-int",
      unit_price: "bad-number",
    };
    const res = validatePayload(invalidPayload, schema);
    expect(res.isValid).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("should infer field specifications from a sample JSON payload", () => {
    const sample = {
      order_id: "ORD-99",
      quantity: 5,
      unit_price: 19.99,
      delivered: false,
      items: ["item1", "item2"],
    };

    const specs = inferSchemaFromSample(sample);
    expect(specs.order_id).toBe("str");
    expect(specs.quantity).toBe("int");
    expect(specs.unit_price).toBe("float");
    expect(specs.delivered).toBe("bool");
    expect(specs.items).toBe("list");
  });

  it("should provide pre-defined domain schema templates", () => {
    expect(SCHEMA_TEMPLATES.LogisticsShipment).toBeDefined();
    expect(SCHEMA_TEMPLATES.LogisticsShipment.fields.container_id).toBe("str");
    expect(SCHEMA_TEMPLATES.InventoryProduct).toBeDefined();
    expect(SCHEMA_TEMPLATES.FinancialTransaction).toBeDefined();
  });
});
