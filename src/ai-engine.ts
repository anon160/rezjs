import { generateObject, createProviderRegistry, LanguageModel } from "ai";
import { google } from "@ai-sdk/google";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { executePatch, cleanPatchCode } from "./sandbox.js";
import { SCHEMA_TEMPLATES } from "./contracts.js";

const DEFAULT_LOGISTICS_FIELDS = SCHEMA_TEMPLATES.LogisticsShipment.fields;

export const PatchResultSchema = z.object({
  patchCode: z.string().describe("Complete JavaScript function `function transform(raw) { ... }` that maps broken input to target schema."),
  commitMessage: z.string().describe("Informative Conventional Commit message, e.g. 'fix(feed): normalize gross_kg to number'"),
  prSummary: z.string().describe("Markdown summary explaining what fields drifted and how they were transformed"),
});

export type PatchResult = z.infer<typeof PatchResultSchema>;

/**
 * OpenCode-style unified multi-provider registry.
 * Connects first-party providers and OpenAI-compatible gateways under a single registry.
 */
export function createUnifiedModelRegistry() {
  return createProviderRegistry({
    google,
    openai,
    anthropic,
    // Universal OpenAI-compatible endpoints:
    openrouter: createOpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY || "",
    }),
    deepseek: createOpenAI({
      baseURL: "https://api.deepseek.com/v1",
      apiKey: process.env.DEEPSEEK_API_KEY || "",
    }),
    groq: createOpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY || "",
    }),
    ollama: createOpenAI({
      baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
      apiKey: "ollama",
    }),
  });
}

export function hasConfiguredCredentials(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.OLLAMA_BASE_URL
  );
}

/**
 * Resolves any model string dynamically through the unified registry.
 * Accepts formats:
 * - 'google:gemini-2.5-flash'
 * - 'anthropic:claude-3-5-sonnet'
 * - 'openai:gpt-4o'
 * - 'openrouter:meta-llama/llama-3.3-70b-instruct'
 * - 'deepseek:deepseek-chat'
 * - 'groq:llama-3.3-70b-versatile'
 * - 'ollama:qwen2.5-coder'
 */
export function resolveLanguageModel(
  modelOverride?: string | { model?: string; provider?: string; name?: string; fallback?: string; baseURL?: string; apiKey?: string }
): LanguageModel {
  if (typeof modelOverride === "object" && modelOverride !== null) {
    if (modelOverride.baseURL) {
      const customOpenAI = createOpenAI({
        baseURL: modelOverride.baseURL,
        apiKey: modelOverride.apiKey || "custom",
      });
      const modelName = modelOverride.name || modelOverride.model || "default";
      return customOpenAI(modelName);
    }
    const requestedStr =
      modelOverride.model ||
      (modelOverride.provider && modelOverride.name ? `${modelOverride.provider}:${modelOverride.name}` : undefined);
    return resolveLanguageModel(requestedStr);
  }

  const registry = createUnifiedModelRegistry();
  const requested = modelOverride || process.env.AUTODATAOPS_MODEL || process.env.RESILIENT_LLM_MODEL;

  if (requested) {
    if (requested.includes(":")) {
      return registry.languageModel(requested as any);
    }
    // Shorthand prefixes
    if (requested.startsWith("gemini")) return registry.languageModel(`google:${requested}` as any);
    if (requested.startsWith("claude")) return registry.languageModel(`anthropic:${requested}` as any);
    if (requested.startsWith("gpt") || requested.startsWith("o1") || requested.startsWith("o3")) {
      return registry.languageModel(`openai:${requested}` as any);
    }
    if (requested.startsWith("qwen") || requested.startsWith("llama")) {
      return registry.languageModel(`ollama:${requested}` as any);
    }
    return registry.languageModel(`google:${requested}` as any);
  }

  // Auto-detect based on available active API keys
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY) {
    return registry.languageModel("google:gemini-2.5-flash");
  }
  if (process.env.OPENROUTER_API_KEY) {
    return registry.languageModel("openrouter:google/gemini-2.5-flash");
  }
  if (process.env.OPENAI_API_KEY) {
    return registry.languageModel("openai:gpt-4o");
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return registry.languageModel("anthropic:claude-3-5-sonnet-latest");
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return registry.languageModel("deepseek:deepseek-chat");
  }
  if (process.env.GROQ_API_KEY) {
    return registry.languageModel("groq:llama-3.3-70b-versatile");
  }
  if (process.env.OLLAMA_BASE_URL) {
    return registry.languageModel("ollama:qwen2.5-coder");
  }

  return registry.languageModel("google:gemini-2.5-flash");
}

function buildSystemPrompt(schemaName: string, fieldSpecs: Record<string, string>): string {
  const specLines = Object.entries(fieldSpecs).map(([name, type]) => `- ${name} (${type})`);
  return `You are an expert DataOps AI Infrastructure Mechanic.
An external vendor API feed broke due to schema drift.

Your job:
1. Generate a JavaScript function \`function transform(raw) { ... }\` that maps the broken JSON into the user's target contract.
2. Ensure all target fields are mapped and converted properly.
3. Unit conversions: convert lbs to kg (divide by 2.20462) if necessary.
4. Date conversions: normalize dates to YYYY-MM-DD.
5. Provide an informative Conventional Commit message and a Markdown PR summary.

TARGET CONTRACT SCHEMA — ${schemaName}:
${specLines.join("\n")}

Rules:
- Output valid JavaScript with no markdown fences.
- Do NOT use require(), import, or process.
`;
}

export interface SelfHealingResponse {
  success: boolean;
  patchCode: string;
  logs: string;
  patchResult?: PatchResult;
}

export async function runSelfHealingAgent(options: {
  brokenPayload: Record<string, any>;
  fieldSpecs?: Record<string, string>;
  schemaName?: string;
  validationError?: string;
  modelOverride?: string | Record<string, any>;
}): Promise<SelfHealingResponse> {
  const {
    brokenPayload,
    fieldSpecs = DEFAULT_LOGISTICS_FIELDS,
    schemaName = "DynamicContract",
    validationError = "Schema validation failed",
    modelOverride,
  } = options;

  if (!hasConfiguredCredentials()) {
    return {
      success: false,
      patchCode: "",
      logs: "No LLM API key configured (set GEMINI_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, or OLLAMA_BASE_URL). AI self-healing disabled.",
    };
  }

  try {
    const model = resolveLanguageModel(modelOverride);
    const systemPrompt = buildSystemPrompt(schemaName, fieldSpecs);

    const userPrompt = `BROKEN RAW PAYLOAD:
${JSON.stringify(brokenPayload, null, 2)}

VALIDATION ERROR:
${validationError}

TARGET SCHEMA: ${schemaName}
${JSON.stringify(fieldSpecs, null, 2)}

Synthesize the transform(raw) function, conventional commit message, and PR summary.`;

    // Generate structured PatchResult via Vercel AI SDK
    const { object: patchResult } = await generateObject({
      model,
      schema: PatchResultSchema,
      system: systemPrompt,
      prompt: userPrompt,
    });

    const cleanCode = cleanPatchCode(patchResult.patchCode);

    // Verify in WebAssembly QuickJS isolate sandbox
    const execRes = await executePatch(cleanCode, brokenPayload, fieldSpecs);

    if (execRes.success) {
      return {
        success: true,
        patchCode: cleanCode,
        logs: `Self-healing succeeded: ${patchResult.commitMessage}`,
        patchResult,
      };
    } else {
      return {
        success: false,
        patchCode: "",
        logs: `Agent-generated patch failed sandbox verification: ${execRes.error}`,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      patchCode: "",
      logs: `AI self-healing exception: ${err?.message || String(err)}`,
    };
  }
}
