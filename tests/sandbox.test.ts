import { describe, it, expect } from "vitest";
import { executePatch, cleanPatchCode } from "../src/sandbox.js";

describe("WebAssembly QuickJS Sandbox", () => {
  it("should strip markdown fences and export keywords cleanly", () => {
    const raw = "```typescript\nexport function transform(raw) {\n  return raw;\n}\n```";
    const cleaned = cleanPatchCode(raw);
    expect(cleaned).toBe("function transform(raw) {\n  return raw;\n}");
  });

  it("should successfully execute a valid transformation patch in WASM isolate", async () => {
    const patch = `
    function transform(raw) {
      return {
        container_id: String(raw.cntr),
        weight_kg: parseFloat(raw.gross_kg),
        status: "IN_TRANSIT"
      };
    }
    `;

    const rawPayload = {
      cntr: "CMA-9911",
      gross_kg: "32000.5",
    };

    const targetSpecs = {
      container_id: "str",
      weight_kg: "float",
      status: "str",
    };

    const res = await executePatch(patch, rawPayload, targetSpecs);
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      container_id: "CMA-9911",
      weight_kg: 32000.5,
      status: "IN_TRANSIT",
    });
  });

  it("should catch runtime errors inside the patch safely without crashing host", async () => {
    const badPatch = `
    function transform(raw) {
      throw new Error("Deliberate failure in transformation logic");
    }
    `;

    const res = await executePatch(badPatch, { some: "data" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("Deliberate failure");
  });

  it("should interrupt and terminate infinite loops via deadline timer", async () => {
    const infiniteLoopPatch = `
    function transform(raw) {
      while(true) {}
    }
    `;

    const res = await executePatch(infiniteLoopPatch, { some: "data" }, undefined, 100);
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("should reject output if transformed result does not match target schema", async () => {
    const mismatchPatch = `
    function transform(raw) {
      return {
        wrong_field: 123
      };
    }
    `;

    const targetSpecs = {
      container_id: "str",
    };

    const res = await executePatch(mismatchPatch, { a: 1 }, targetSpecs);
    expect(res.success).toBe(false);
    expect(res.error).toContain("Transformed output failed schema contract validation");
  });
});
