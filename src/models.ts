/**
 * Ingestion result models and types for AutoDataOps.
 */

export type IngestionStatus =
  | "SUCCESS"
  | "HEALING_INTERCEPTED"
  | "PENDING_GIT_REVIEW"
  | "HEALING_FAILED";

export type ReviewMode = "autonomous" | "git" | "supervised";

export interface PullRequestDetails {
  branchName?: string;
  prTitle?: string;
  prBody?: string;
  patchFile?: string;
  remotePrUrl?: string | null;
  commitMessage?: string;
  [key: string]: any;
}

export interface IngestionResultOptions<T = any> {
  status: IngestionStatus;
  driftDetected: boolean;
  data?: T | null;
  sourceId?: string;
  schemaName?: string;
  patchCode?: string;
  patchVersion?: number;
  reviewBranch?: string;
  prDetails?: PullRequestDetails;
  error?: string;
}

export class IngestionResult<T = any> {
  public readonly status: IngestionStatus;
  public readonly driftDetected: boolean;
  public readonly data: T | null;
  public readonly sourceId?: string;
  public readonly schemaName?: string;
  public readonly patchCode?: string;
  public readonly patchVersion?: number;
  public readonly reviewBranch?: string;
  public readonly prDetails?: PullRequestDetails;
  public readonly error?: string;

  constructor(options: IngestionResultOptions<T>) {
    this.status = options.status;
    this.driftDetected = options.driftDetected;
    this.data = options.data ?? null;
    this.sourceId = options.sourceId;
    this.schemaName = options.schemaName;
    this.patchCode = options.patchCode;
    this.patchVersion = options.patchVersion;
    this.reviewBranch = options.reviewBranch;
    this.prDetails = options.prDetails;
    this.error = options.error;
  }

  /**
   * Returns true if clean, valid data is ready to be consumed.
   */
  public isSuccess(): boolean {
    return (
      (this.status === "SUCCESS" || this.status === "HEALING_INTERCEPTED") &&
      this.data !== null &&
      this.data !== undefined
    );
  }

  /**
   * Returns true if record requires human approval or DLQ routing.
   */
  public isQuarantined(): boolean {
    return this.status === "PENDING_GIT_REVIEW" || this.status === "HEALING_FAILED";
  }
}
