/**
 * AutoDataOps — Pure TypeScript AI-Native Data Resilience & Self-Healing Library.
 *
 * Pluggable SDK for real-time schema drift interception, autonomous AI self-healing,
 * WebAssembly QuickJS isolate sandboxing, and Enterprise GitOps PR review.
 *
 * Zero Database or HTTP Server Overhead.
 */

import { z } from "zod";
import {
  IngestionResult,
  IngestionStatus,
  ReviewMode,
  PullRequestDetails,
} from "./models.js";
import {
  SCHEMA_TEMPLATES,
  createDynamicSchema,
  validatePayload,
  inferSchemaFromSample,
} from "./contracts.js";
import {
  BasePatchCatalog,
  MemoryPatchCatalog,
  FilePatchCatalog,
} from "./catalog.js";
import { executePatch, cleanPatchCode } from "./sandbox.js";
import {
  createGitReviewBranch,
  exportPatchFile,
  generatePrMarkdown,
  generateSemanticCommitMessage,
  GitReviewResult,
} from "./git-review.js";
import {
  runSelfHealingAgent,
  PatchResult,
  resolveLanguageModel,
  hasConfiguredCredentials,
} from "./ai-engine.js";

export interface AutoDataOpsOptions {
  schema?: string;
  fieldSpecs?: Record<string, string>;
  reviewMode?: ReviewMode;
  catalog?: BasePatchCatalog;
  repoDir?: string;
  pushRemote?: boolean;
}

export class AutoDataOps {
  public readonly schemaName: string;
  public readonly fieldSpecs: Record<string, string>;
  public readonly reviewMode: ReviewMode;
  public readonly catalog: BasePatchCatalog;
  public readonly repoDir?: string;
  public readonly pushRemote: boolean;

  constructor(options: AutoDataOpsOptions = {}) {
    this.schemaName = options.schema || "LogisticsShipment";
    const envReviewMode = process.env.AUTODATAOPS_REVIEW_MODE as ReviewMode | undefined;
    this.reviewMode = envReviewMode || options.reviewMode || "autonomous";
    this.repoDir = options.repoDir;
    this.pushRemote = options.pushRemote ?? false;

    if (options.fieldSpecs) {
      this.fieldSpecs = options.fieldSpecs;
    } else if (this.schemaName in SCHEMA_TEMPLATES) {
      this.fieldSpecs = SCHEMA_TEMPLATES[this.schemaName].fields;
    } else {
      this.fieldSpecs = {};
    }

    this.catalog = options.catalog ?? new MemoryPatchCatalog();
  }

  /**
   * Processes an incoming data payload through validation, patch execution, and AI self-healing.
   *
   * 1. Checks catalog for existing patch -> executes patch in <1ms if present.
   * 2. Validates clean payload against target contract schema.
   * 3. If drift is detected, invokes AI agent to generate and verify a patch in QuickJS WASM.
   * 4. Provisions an isolated Git review branch with Conventional Commit and PR info.
   * 5. In 'autonomous' mode: deploys patch to active catalog and delivers clean data.
   *    In 'git'/'supervised' mode: returns PENDING_GIT_REVIEW (quarantined awaiting merge).
   */
  public async process<T = any>(
    sourceId: string,
    rawPayload: Record<string, any>,
    overrideFieldSpecs?: Record<string, string>,
    overrideSchemaName?: string
  ): Promise<IngestionResult<T>> {
    const specs = overrideFieldSpecs || this.fieldSpecs;
    const name = overrideSchemaName || this.schemaName;

    // 1. Fast-Path: Check active patch catalog
    const activePatch = this.catalog.getPatch(sourceId);
    const patchVer = this.catalog.getPatchVersion(sourceId);

    if (activePatch) {
      const patchExec = await executePatch<T>(activePatch, rawPayload, specs);
      if (patchExec.success && patchExec.data !== undefined) {
        return new IngestionResult<T>({
          status: "SUCCESS",
          driftDetected: false,
          data: patchExec.data,
          sourceId,
          schemaName: name,
          patchVersion: patchVer ?? undefined,
        });
      }
      // If cached patch failed, schema has drifted again; proceed to re-heal
    }

    // 2. Baseline: Validate clean payload directly against contract
    const validation = validatePayload<T>(rawPayload, specs);
    if (validation.isValid && validation.data !== undefined) {
      return new IngestionResult<T>({
        status: "SUCCESS",
        driftDetected: false,
        data: validation.data,
        sourceId,
        schemaName: name,
      });
    }

    // 3. Drift Interception: Invoke AI Self-Healing Agent
    const healing = await runSelfHealingAgent({
      brokenPayload: rawPayload,
      fieldSpecs: specs,
      schemaName: name,
      validationError: validation.error,
    });

    if (!healing.success || !healing.patchCode) {
      return new IngestionResult<T>({
        status: "HEALING_FAILED",
        driftDetected: true,
        sourceId,
        schemaName: name,
        error: `AI self-healing failed: ${healing.logs}`,
      });
    }

    // 4. Verify candidate patch in WebAssembly QuickJS isolate sandbox
    const testExec = await executePatch<T>(healing.patchCode, rawPayload, specs);
    if (!testExec.success || testExec.data === undefined) {
      return new IngestionResult<T>({
        status: "HEALING_FAILED",
        driftDetected: true,
        sourceId,
        schemaName: name,
        error: `Generated patch failed sandbox execution: ${testExec.error}`,
      });
    }

    // 5. GitOps HITL: Provision review branch and author Conventional Commit
    const nextVer = (this.catalog.getPatchVersion(sourceId) || 0) + 1;
    const gitInfo = await createGitReviewBranch({
      sourceId,
      schemaName: name,
      patchCode: healing.patchCode,
      version: nextVer,
      repoDir: this.repoDir,
      pushRemote: this.pushRemote,
      validationError: validation.error,
      customCommitMsg: healing.patchResult?.commitMessage,
      customPrBody: healing.patchResult?.prSummary,
    });

    // 6. Governance: Autonomous Hot-Patching vs. Supervised Quarantine
    const currentMode = (process.env.AUTODATAOPS_REVIEW_MODE as ReviewMode) || this.reviewMode;

    if (currentMode === "git" || currentMode === "supervised") {
      // Quarantine mode: return PENDING_GIT_REVIEW, do not apply to active catalog
      return new IngestionResult<T>({
        status: "PENDING_GIT_REVIEW",
        driftDetected: true,
        data: null,
        sourceId,
        schemaName: name,
        patchCode: healing.patchCode,
        patchVersion: nextVer,
        reviewBranch: gitInfo.branchName,
        prDetails: gitInfo,
        error: "Quarantined pending Git PR review and merge.",
      });
    } else {
      // Autonomous mode: save patch immediately to active catalog and deliver clean data
      this.catalog.savePatch(sourceId, healing.patchCode);
      return new IngestionResult<T>({
        status: "HEALING_INTERCEPTED",
        driftDetected: true,
        data: testExec.data,
        sourceId,
        schemaName: name,
        patchCode: healing.patchCode,
        patchVersion: nextVer,
        reviewBranch: gitInfo.branchName,
        prDetails: gitInfo,
      });
    }
  }

  // --- STATIC UTILITY METHODS ---

  public static inferSchema(samplePayload: Record<string, any>): Record<string, string> {
    return inferSchemaFromSample(samplePayload);
  }

  public static validate<T = any>(
    payload: any,
    schemaOrSpecs: z.ZodTypeAny | Record<string, string>
  ) {
    return validatePayload<T>(payload, schemaOrSpecs);
  }

  public static async transform<T = any>(
    patchCode: string,
    rawPayload: Record<string, any>,
    schemaOrSpecs?: z.ZodTypeAny | Record<string, string>
  ) {
    return executePatch<T>(patchCode, rawPayload, schemaOrSpecs);
  }

  public static async heal(
    brokenPayload: Record<string, any>,
    fieldSpecs: Record<string, string>,
    schemaName?: string
  ) {
    return runSelfHealingAgent({ brokenPayload, fieldSpecs, schemaName });
  }

  public static async createGitReview(options: Parameters<typeof createGitReviewBranch>[0]) {
    return createGitReviewBranch(options);
  }

  public static exportPatch(
    patchCode: string,
    sourceId: string,
    schemaName?: string,
    version?: number,
    baseDir?: string
  ) {
    return exportPatchFile(patchCode, sourceId, schemaName, version, baseDir);
  }
}

// Resilient is an alias for AutoDataOps
export const Resilient = AutoDataOps;

// Re-export all submodules
export * from "./models.js";
export * from "./contracts.js";
export * from "./catalog.js";
export * from "./sandbox.js";
export * from "./git-review.js";
export * from "./ai-engine.js";
