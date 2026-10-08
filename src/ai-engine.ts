import { generateObject, generateText, tool, LanguageModel } from "ai";
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

export function hasConfiguredCredentials(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OLLAMA_BASE_URL
  );
}

export function resolveLanguageModel(): LanguageModel {
  const custom = process.env.AUTODATAOPS_MODEL || process.env.RESILIENT_LLM_MODEL;

  if (custom) {
    if (custom.startsWith("google:") || custom.startsWith("gemini")) {
      const modelName = custom.replace(/^google:/, "");
      return google(modelName);
    }
    if (custom.startsWith("anthropic:") || custom.startsWith("claude")) {
      const modelName = custom.replace(/^anthropic:/, "");
      return anthropic(modelName);
    }
    if (custom.startsWith("openai:") || custom.startsWith("gpt")) {
      const modelName = custom.replace(/^openai:/, "");
      return openai(modelName);
    }
    if (custom.startsWith("ollama:")) {
      const modelName = custom.replace(/^ollama:/, "");
      const baseURL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
      const customOpenAI = createOpenAI({ baseURL, apiKey: "ollama" });
      return customOpenAI(modelName);
    }
  }

  // Fallback to active credentials
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY) {
    return google("gemini-2.5-flash");
  }
  if (process.env.OPENAI_API_KEY) {
    return openai("gpt-4o");
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return anthropic("claude-3-5-sonnet-latest");
  }
  if (process.env.OLLAMA_BASE_URL) {
    const customOpenAI = createOpenAI({ baseURL: process.env.OLLAMA_BASE_URL, apiKey: "ollama" });
    return customOpenAI("qwen2.5-coder");
  }

  // Default to Google
  return google("gemini-2.5-flash");
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
}): Promise<SelfHealingResponse> {
  const {
    brokenPayload,
    fieldSpecs = DEFAULT_LOGISTICS_FIELDS,
    schemaName = "DynamicContract",
    validationError = "Schema validation failed",
  } = options;

  if (!hasConfiguredCredentials()) {
    return {
      success: false,
      patchCode: "",
      logs: "No LLM API key configured (set GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_BASE_URL). AI self-healing disabled.",
    };
  }

  try {
    const model = resolveLanguageModel();
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
