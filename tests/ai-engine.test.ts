import { describe, it, expect } from "vitest";
import {
  PatchResultSchema,
  hasConfiguredCredentials,
  runSelfHealingAgent,
  resolveLanguageModel,
  createUnifiedModelRegistry,
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

  it("should create unified model registry with all supported providers", () => {
    const registry = createUnifiedModelRegistry();
    expect(registry).toBeDefined();
  });

  it("should resolve explicit provider models accurately", () => {
    const googleModel = resolveLanguageModel("google:gemini-2.5-flash");
    expect(googleModel).toBeDefined();
    expect(googleModel.modelId).toBe("gemini-2.5-flash");

    const openaiModel = resolveLanguageModel("openai:gpt-4o");
    expect(openaiModel).toBeDefined();
    expect(openaiModel.modelId).toBe("gpt-4o");

    const anthropicModel = resolveLanguageModel("anthropic:claude-3-5-sonnet-20241022");
    expect(anthropicModel).toBeDefined();
    expect(anthropicModel.modelId).toBe("claude-3-5-sonnet-20241022");

    const openrouterModel = resolveLanguageModel("openrouter:meta-llama/llama-3.3-70b-instruct");
    expect(openrouterModel).toBeDefined();
    expect(openrouterModel.modelId).toBe("meta-llama/llama-3.3-70b-instruct");

    const deepseekModel = resolveLanguageModel("deepseek:deepseek-chat");
    expect(deepseekModel).toBeDefined();
    expect(deepseekModel.modelId).toBe("deepseek-chat");

    const groqModel = resolveLanguageModel("groq:llama-3.3-70b-versatile");
    expect(groqModel).toBeDefined();
    expect(groqModel.modelId).toBe("llama-3.3-70b-versatile");

    const ollamaModel = resolveLanguageModel("ollama:qwen2.5-coder:7b");
    expect(ollamaModel).toBeDefined();
    expect(ollamaModel.modelId).toBe("qwen2.5-coder:7b");
  });

  it("should resolve shorthand model names without provider prefix", () => {
    const gemini = resolveLanguageModel("gemini-2.5-flash");
    expect(gemini.modelId).toBe("gemini-2.5-flash");

    const gpt = resolveLanguageModel("gpt-4o-mini");
    expect(gpt.modelId).toBe("gpt-4o-mini");

    const claude = resolveLanguageModel("claude-3-5-haiku-20241022");
    expect(claude.modelId).toBe("claude-3-5-haiku-20241022");

    const qwen = resolveLanguageModel("qwen2.5-coder");
    expect(qwen.modelId).toBe("qwen2.5-coder");
  });

  it("should return clean failure if no API key is configured", async () => {
    const originalEnv = { ...process.env };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GROQ_API_KEY;
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
