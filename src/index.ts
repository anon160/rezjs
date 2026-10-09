/**
 * AutoDataOps / Resilient — Pure TypeScript AI-Native Data Resilience & Schema Drift Engine.
 *
 * Intercepts schema drift, sandboxes AI-synthesized patches in WebAssembly QuickJS,
 * and enforces Git as the mandatory versioned patch ledger & review system.
 */

import * as path from "node:path";
import { IngestionResult } from "./models.js";
import { validatePayload, extractFieldSpecs } from "./contracts.js";
import { BasePatchCatalog, FilePatchCatalog } from "./catalog.js";
import { executePatch } from "./sandbox.js";
import { createGitReviewBranch, isGitRepository } from "./git-review.js";
import { runSelfHealingAgent } from "./ai-engine.js";
import { ResilientConfig, ModelConfig, ContractDefinition, defineConfig, loadConfig } from "./config.js";

export interface AutoDataOpsOptions {
  config?: ResilientConfig;
  schema?: string;
  fieldSpecs?: Record<string, string>;
  contract?: ContractDefinition;
  contracts?: Record<string, ContractDefinition>;
  catalog?: BasePatchCatalog;
  repoDir?: string;
  patchDir?: string;
  baseBranch?: string;
  autoPush?: boolean;
  createPullRequest?: boolean;
  model?: ModelConfig | string;
}

export interface IngestOptions<T = any> {
  source: string;
  payload: Record<string, any>;
  schema?: string | ContractDefinition;
  model?: ModelConfig | string;
}

export class AutoDataOps {
  public defaultSchemaName: string;
  public repoDir: string;
  public patchDir: string;
  public baseBranch: string;
  public autoPush: boolean;
  public createPullRequest: boolean;
  public modelConfig?: ModelConfig | string;
  public catalog: BasePatchCatalog;
  private contracts = new Map<string, ContractDefinition>();

  constructor(options: AutoDataOpsOptions = {}) {
    this.repoDir = path.resolve(options.repoDir || options.config?.git?.repoDir || process.cwd());
    this.patchDir = options.patchDir || options.config?.git?.patchDir || "patches";
    this.baseBranch = options.baseBranch || options.config?.git?.baseBranch || "main";
    this.autoPush = options.autoPush ?? options.config?.git?.autoPush ?? Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY);
    this.createPullRequest = options.createPullRequest ?? options.config?.git?.createPullRequest ?? true;
    this.modelConfig = options.model ?? options.config?.model;
    this.defaultSchemaName = options.schema || "DefaultContract";

    // Register user-defined contracts from options and config
    if (options.config?.contracts) {
      for (const [name, contract] of Object.entries(options.config.contracts)) {
        this.contracts.set(name, contract);
      }
    }
    if (options.contracts) {
      for (const [name, contract] of Object.entries(options.contracts)) {
        this.contracts.set(name, contract);
      }
    }
    if (options.fieldSpecs) {
      this.contracts.set(this.defaultSchemaName, options.fieldSpecs);
    }
    if (options.contract) {
      this.contracts.set(this.defaultSchemaName, options.contract);
    }

    // Default patch catalog is FilePatchCatalog rooted at the git-tracked patch directory
    this.catalog = options.catalog ?? new FilePatchCatalog(path.join(this.repoDir, this.patchDir));
  }

  public get schemaName(): string {
    return this.defaultSchemaName;
  }

  public get fieldSpecs(): Record<string, string> {
    const contract = this.contracts.get(this.defaultSchemaName);
    return contract ? extractFieldSpecs(contract) : {};
  }

  /**
   * Registers a user-defined schema contract (Zod object or field specification mapping).
   */
  public registerContract(name: string, contract: ContractDefinition): this {
    this.contracts.set(name, contract);
    return this;
  }

  /**
   * Retrieves a registered contract by name.
   */
  public getContract(name: string): ContractDefinition | undefined {
    return this.contracts.get(name);
  }

  /**
   * Verifies that the instance is running inside a Git repository.
   * Throws an error if Git is not present, because Git is the mandatory patch ledger.
   */
  public async ensureGitRepository(): Promise<void> {
    const isRepo = await isGitRepository(this.repoDir);
    if (!isRepo) {
      throw new Error(
        `[AutoDataOps] Git repository is mandatory. AutoDataOps uses Git as its versioned patch ledger and review system. Please initialize a git repository ('git init') or specify a valid 'repoDir' in config.`
      );
    }
  }

  /**
   * Primary developer ingestion API:
   * Validates payload -> Checks Git patch catalog -> Sandboxes patch -> Synthesizes & Git-commits on drift.
   */
  public async ingest<T = any>(options: IngestOptions<T>): Promise<IngestionResult<T>> {
    const { source, payload, schema, model } = options;

    // 1. Mandatory Git check
    await this.ensureGitRepository();

    // 2. Resolve contract & field specifications
    let contractToUse: ContractDefinition;
    let schemaName: string;

    if (typeof schema === "string") {
      schemaName = schema;
      const found = this.contracts.get(schema);
      if (!found) {
        throw new Error(
          `[AutoDataOps] Contract "${schema}" is not registered. Define it in resilient.config.ts or call registerContract().`
        );
      }
      contractToUse = found;
    } else if (schema) {
      schemaName = "CustomContract";
      contractToUse = schema;
    } else {
      schemaName = this.defaultSchemaName;
      const found = this.contracts.get(this.defaultSchemaName);
      if (!found) {
        throw new Error(
          `[AutoDataOps] Default contract "${this.defaultSchemaName}" is not registered. Provide a contract in config or options.`
        );
      }
      contractToUse = found;
    }

    const fieldSpecs = extractFieldSpecs(contractToUse);

    // 3. Fast-Path: Check active patch catalog in Git repository
    const activePatch = this.catalog.getPatch(source);
    const patchVer = this.catalog.getPatchVersion(source);

    if (activePatch) {
      const patchExec = await executePatch<T>(activePatch, payload, contractToUse);
      if (patchExec.success && patchExec.data !== undefined) {
        return new IngestionResult<T>({
          status: "SUCCESS",
          driftDetected: false,
          data: patchExec.data,
          sourceId: source,
          schemaName,
          patchVersion: patchVer ?? undefined,
        });
      }
    }

    // 4. Baseline: Validate payload directly against contract
    const validation = validatePayload<T>(payload, contractToUse);
    if (validation.isValid && validation.data !== undefined) {
      return new IngestionResult<T>({
        status: "SUCCESS",
        driftDetected: false,
        data: validation.data,
        sourceId: source,
        schemaName,
      });
    }

    // 5. Drift Interception: Synthesize patch using AI engine
    const healing = await runSelfHealingAgent({
      brokenPayload: payload,
      fieldSpecs,
      schemaName,
      validationError: validation.error,
      modelOverride: model || this.modelConfig,
    });

    if (!healing.success || !healing.patchCode) {
      return new IngestionResult<T>({
        status: "HEALING_FAILED",
        driftDetected: true,
        sourceId: source,
        schemaName,
        error: `AI self-healing failed: ${healing.logs}`,
      });
    }

    // 6. Verify synthesized patch in WebAssembly QuickJS isolate sandbox (<1ms)
    const testExec = await executePatch<T>(healing.patchCode, payload, contractToUse);
    if (!testExec.success || testExec.data === undefined) {
      return new IngestionResult<T>({
        status: "HEALING_FAILED",
        driftDetected: true,
        sourceId: source,
        schemaName,
        error: `Generated patch failed sandbox verification: ${testExec.error}`,
      });
    }

    // 7. Mandatory GitOps Review: Create isolated review branch & Conventional Commit via simple-git
    const nextVer = (this.catalog.getPatchVersion(source) || 0) + 1;
    const gitInfo = await createGitReviewBranch({
      sourceId: source,
      schemaName,
      patchCode: healing.patchCode,
      version: nextVer,
      repoDir: this.repoDir,
      pushRemote: this.autoPush,
      validationError: validation.error,
      customCommitMsg: healing.patchResult?.commitMessage,
      customPrBody: healing.patchResult?.prSummary,
    });

    // 8. Payload Quarantine: Git is mandatory; unmerged patches are quarantined awaiting PR merge
    return new IngestionResult<T>({
      status: "PENDING_GIT_REVIEW",
      driftDetected: true,
      data: null,
      sourceId: source,
      schemaName,
      patchCode: healing.patchCode,
      patchVersion: nextVer,
      reviewBranch: gitInfo.branchName,
      prDetails: gitInfo,
      error: `Schema drift intercepted. Verified patch committed to Git review branch '${gitInfo.branchName}'. Quarantined awaiting human PR review and merge.`,
    });
  }

  public static defineConfig = defineConfig;
  public static loadConfig = loadConfig;
}

// Resilient is an alias for AutoDataOps
export const Resilient = AutoDataOps;

// Default singleton instance ready for immediate import
export const resilient = new AutoDataOps();

// Re-export submodules
export * from "./models.js";
export * from "./contracts.js";
export * from "./catalog.js";
export * from "./sandbox.js";
export * from "./git-review.js";
export * from "./ai-engine.js";
export * from "./config.js";
