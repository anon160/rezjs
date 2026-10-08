import { describe, it, expect } from "vitest";
import {
  PatchResultSchema,
  hasConfiguredCredentials,
  runSelfHealingAgent,
} from "../src/ai-engine.js";

describe("AI Engine & Multi-Provider Resolver", () => {
  it("should validate PatchResultSchema with required fields", () => {
    const valid = {
      patchCode: "function transform(raw) { return raw; }",
      commitMessage: "fix(feed): adjust schema mapping",
      prSummary: "Summary of changes",
    };
    const parsed = PatchResultSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("should return clean failure if no API key is configured", async () => {
    const originalEnv = { ...process.env };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OLLAMA_BASE_URL;

    expect(hasConfiguredCredentials()).toBe(false);

    const res = await runSelfHealingAgent({
      brokenPayload: { bad: "field" },
      fieldSpecs: { container_id: "str" },
      schemaName: "TestContract",
    });

    expect(res.success).toBe(false);
    expect(res.logs).toContain("No LLM API key configured");

    // Restore env
    process.env = originalEnv;
  });
});
