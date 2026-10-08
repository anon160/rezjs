import { z } from "zod";

/**
 * Standard schema templates for common domains.
 */
export const SCHEMA_TEMPLATES: Record<string, { fields: Record<string, string>; description: string }> = {
  LogisticsShipment: {
    description: "Standard containerized freight tracking contract",
    fields: {
      container_id: "str",
      carrier_name: "str",
      status: "str",
      origin_port: "str",
      destination_port: "str",
      weight_kg: "float",
      eta_date: "str",
    },
  },
  InventoryProduct: {
    description: "E-Commerce and inventory product catalog contract",
    fields: {
      product_id: "int",
      product_name: "str",
      unit_price: "float",
      quantity_available: "int",
    },
  },
  FinancialTransaction: {
    description: "Standard financial payment and invoice ledger contract",
    fields: {
      transaction_id: "str",
      amount: "float",
      currency: "str",
    },
  },
};

/**
 * Normalizes type strings into canonical type keys.
 */
export function normalizeTypeName(rawType: string): string {
  const t = String(rawType).toLowerCase().trim();
  if (t === "int" || t === "integer") return "int";
  if (t === "float" || t === "number" || t === "double" || t === "decimal") return "float";
  if (t === "bool" || t === "boolean") return "bool";
  if (t === "array" || t === "list") return "list";
  if (t === "object" || t === "dict") return "dict";
  return "str";
}

/**
 * Dynamically builds a Zod schema from a dictionary of field specifications.
 * e.g. { container_id: "str", weight_kg: "float", in_transit: "bool" }
 */
export function createDynamicSchema(fieldSpecs: Record<string, string>): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, typeStr] of Object.entries(fieldSpecs)) {
    const norm = normalizeTypeName(typeStr);
    switch (norm) {
      case "int":
        shape[key] = z.preprocess(
          (val) => (val === undefined || val === null ? val : Number(val)),
          z.number().int()
        );
        break;
      case "float":
        shape[key] = z.preprocess(
          (val) => (val === undefined || val === null ? val : Number(val)),
          z.number()
        );
        break;
      case "bool":
        shape[key] = z.preprocess((val) => {
          if (val === undefined || val === null) return val;
          if (typeof val === "boolean") return val;
          if (val === "true" || val === 1 || val === "1") return true;
          if (val === "false" || val === 0 || val === "0") return false;
          return Boolean(val);
        }, z.boolean());
        break;
      case "list":
        shape[key] = z.array(z.any());
        break;
      case "dict":
        shape[key] = z.record(z.any());
        break;
      case "str":
      default:
        shape[key] = z.preprocess(
          (val) => (val === undefined || val === null ? val : String(val)),
          z.string()
        );
        break;
    }
  }

  return z.object(shape);
}

/**
 * Validates a raw payload against a Zod schema or field specification dictionary.
 */
export function validatePayload<T = any>(
  rawPayload: any,
  schemaOrSpecs: z.ZodTypeAny | Record<string, string>
): { isValid: boolean; error?: string; data?: T } {
  let schema: z.ZodTypeAny;

  if (schemaOrSpecs instanceof z.ZodType) {
    schema = schemaOrSpecs;
  } else {
    schema = createDynamicSchema(schemaOrSpecs);
  }

  const result = schema.safeParse(rawPayload);
  if (result.success) {
    return {
      isValid: true,
      data: result.data as T,
    };
  } else {
    const formattedError = result.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    return {
      isValid: false,
      error: formattedError,
    };
  }
}

/**
 * Infers field specifications directly from a sample JSON object.
 */
export function inferSchemaFromSample(samplePayload: Record<string, any>): Record<string, string> {
  const specs: Record<string, string> = {};

  for (const [key, value] of Object.entries(samplePayload)) {
    if (value === null || value === undefined) {
      specs[key] = "str";
    } else if (typeof value === "number") {
      specs[key] = Number.isInteger(value) ? "int" : "float";
    } else if (typeof value === "boolean") {
      specs[key] = "bool";
    } else if (Array.isArray(value)) {
      specs[key] = "list";
    } else if (typeof value === "object") {
      specs[key] = "dict";
    } else {
      specs[key] = "str";
    }
  }

  return specs;
}
