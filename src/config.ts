import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export interface GitConfig {
  /**
   * Target base branch for PRs (default: "main").
   */
  baseBranch?: string;
  /**
   * Directory in the repository where generated patches are saved (default: "patches").
   */
  patchDir?: string;
  /**
   * Root repository directory (default: process.cwd()).
   */
  repoDir?: string;
  /**
   * Automatically push review branch to remote origin (default: false unless GITHUB_TOKEN set).
   */
  autoPush?: boolean;
  /**
   * Automatically open Pull Request via Octokit if GITHUB_TOKEN & GITHUB_REPOSITORY are set (default: true).
   */
  createPullRequest?: boolean;
}

export interface ModelConfig {
  /**
   * Model string, e.g. "google:gemini-2.5-flash", "openai:gpt-4o", "anthropic:claude-3-5-sonnet",
   * "openrouter:meta-llama/llama-3.3-70b-instruct", "deepseek:deepseek-chat", "groq:llama-3.3-70b-versatile", "ollama:qwen2.5-coder".
   */
  model?: string;
  /**
   * Shorthand provider name (e.g. "google", "openai", "anthropic", "openrouter", "deepseek", "groq", "ollama").
   */
  provider?: string;
  /**
   * Shorthand model name (e.g. "gemini-2.5-flash", "gpt-4o", "claude-3-5-sonnet").
   */
  name?: string;
  /**
   * Optional fallback model if primary fails.
   */
  fallback?: string;
  /**
   * Custom OpenAI-compatible endpoint URL (e.g. for vLLM or local Ollama).
   */
  baseURL?: string;
  /**
   * Custom API Key.
   */
  apiKey?: string;
}

export type ContractDefinition = z.ZodTypeAny | Record<string, string>;

export interface ResilientConfig {
  /**
   * LLM model and provider configuration.
   */
  model?: ModelConfig | string;
  /**
   * Mandatory Git ledger and PR review settings.
   */
  git?: GitConfig;
  /**
   * User-defined contract schemas.
   */
  contracts?: Record<string, ContractDefinition>;
}

/**
 * Type-safe helper to define Resilient / AutoDataOps configuration.
 */
export function defineConfig(config: ResilientConfig): ResilientConfig {
  return config;
}

const CONFIG_CANDIDATES = [
  "resilient.config.ts",
  "resilient.config.js",
  "resilient.config.mjs",
  "resilient.config.json",
  "autodataops.config.ts",
  "autodataops.config.js",
  "autodataops.config.json",
];

/**
 * Discovers and loads configuration from disk or returns defaults.
 */
export async function loadConfig(
  explicitConfig?: ResilientConfig,
  cwd: string = process.cwd()
): Promise<ResilientConfig> {
  const root = path.resolve(cwd);
  let diskConfig: ResilientConfig = {};

  for (const filename of CONFIG_CANDIDATES) {
    const fullPath = path.join(root, filename);
    if (fs.existsSync(fullPath)) {
      try {
        if (filename.endsWith(".json")) {
          const raw = fs.readFileSync(fullPath, "utf-8");
          diskConfig = JSON.parse(raw);
          break;
        } else {
          const fileUrl = pathToFileURL(fullPath).href;
          const imported = await import(fileUrl);
          diskConfig = imported.default || imported;
          break;
        }
      } catch (err: any) {
        console.warn(`[AutoDataOps] Warning: failed to load config from ${filename}: ${err?.message || err}`);
      }
    }
  }

  // Merge: defaults < diskConfig < explicitConfig
  const defaultGit: GitConfig = {
    baseBranch: "main",
    patchDir: "patches",
    repoDir: root,
    autoPush: Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY),
    createPullRequest: true,
  };

  const mergedGit: GitConfig = {
    ...defaultGit,
    ...(diskConfig.git || {}),
    ...(explicitConfig?.git || {}),
  };

  let mergedModel: ModelConfig | string | undefined =
    explicitConfig?.model ?? diskConfig.model ?? process.env.AUTODATAOPS_MODEL ?? process.env.RESILIENT_LLM_MODEL;

  const mergedContracts: Record<string, ContractDefinition> = {
    ...(diskConfig.contracts || {}),
    ...(explicitConfig?.contracts || {}),
  };

  return {
    model: mergedModel,
    git: mergedGit,
    contracts: mergedContracts,
  };
}
