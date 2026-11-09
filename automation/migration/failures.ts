import { AuditError } from "./audit";
import { EventValidationError, type FailureCategory } from "./events";
import { MigrationGlobalLockError } from "./lock";
import { PreflightError } from "./preflight";
import {
  R2ConflictError,
  R2Error,
  R2UploadError,
  R2UploadUnknownError,
  R2VerificationError,
} from "./r2";
import {
  SourceChangedError,
  SourceHttpStatusError,
  SourceUnavailableError,
  SourceValidationError,
} from "./source";
import { MigrationLockError, MigrationStateError } from "./state";
import { RetryExhaustedError } from "./retry";

export class MigrationObservabilityError extends Error {
  constructor(
    readonly originalError: unknown,
    readonly observabilityError: unknown,
  ) {
    super(
      `Observability failure after operation error: ${
        originalError instanceof Error ? originalError.message : String(originalError)
      }`,
    );
  }
}

export interface FailurePolicy {
  category: FailureCategory;
  retryable: boolean;
  /** The poster can be left for a later pass without endangering the run. */
  skippable: boolean;
  /** No new poster work may start until an operator resumes. */
  pauseBatch: boolean;
  /** The run must stop and cannot auto-resume. */
  stopRun: boolean;
  requiredEvidence: string[];
  operatorAction: string;
}

const POLICY: Record<FailureCategory, Omit<FailurePolicy, "category">> = {
  SOURCE_TRANSIENT: {
    retryable: true,
    skippable: true,
    pauseBatch: false,
    stopRun: false,
    requiredEvidence: ["retry budget exhausted", "last HTTP status or network error"],
    operatorAction:
      "Retry the poster within the bounded budget; if it still fails, leave it pending and continue.",
  },
  SOURCE_PERMANENT: {
    retryable: false,
    skippable: true,
    pauseBatch: false,
    stopRun: false,
    requiredEvidence: ["HTTP status", "source URL host/path without query secrets"],
    operatorAction:
      "Do not retry. Record the poster as unavailable and review the source identity before a later run.",
  },
  SOURCE_CHANGED: {
    retryable: false,
    skippable: false,
    pauseBatch: true,
    stopRun: true,
    requiredEvidence: ["expected SHA-256", "observed SHA-256", "manifest entry"],
    operatorAction:
      "Stop. Reconcile the source revision and regenerate the manifest before any upload.",
  },
  SOURCE_VALIDATION_FAILED: {
    retryable: false,
    skippable: true,
    pauseBatch: false,
    stopRun: false,
    requiredEvidence: ["validation reason", "MIME and dimension observations"],
    operatorAction: "Skip the poster; correct the source or manifest before retrying.",
  },
  OPTIMIZATION_FAILED: {
    retryable: false,
    skippable: true,
    pauseBatch: false,
    stopRun: false,
    requiredEvidence: ["optimizer error", "source SHA-256"],
    operatorAction: "Skip the poster; investigate the optimizer version and input before retrying.",
  },
  R2_TRANSIENT: {
    retryable: true,
    skippable: true,
    pauseBatch: false,
    stopRun: false,
    requiredEvidence: ["attempt number", "HTTP status or network error"],
    operatorAction: "Retry within the bounded budget; if exhausted, leave the poster pending.",
  },
  R2_CONFLICT: {
    retryable: false,
    skippable: false,
    pauseBatch: true,
    stopRun: true,
    requiredEvidence: ["object key", "expected and observed checksums", "object metadata"],
    operatorAction:
      "Stop. Investigate the existing object; never overwrite it. Resolve ownership or choose a new version.",
  },
  R2_AMBIGUOUS: {
    retryable: false,
    skippable: false,
    pauseBatch: true,
    stopRun: true,
    requiredEvidence: ["object key", "bounded read-back results", "attempt number"],
    operatorAction:
      "Stop. Run a read-only verification of the key; do not retry until existence and bytes are established.",
  },
  ORIGIN_VERIFICATION_FAILED: {
    retryable: false,
    skippable: false,
    pauseBatch: true,
    stopRun: true,
    requiredEvidence: ["object key", "expected and observed checksums", "metadata comparison"],
    operatorAction:
      "Stop. Treat the object as unverified and investigate before any further upload.",
  },
  CDN_VERIFICATION_FAILED: {
    retryable: true,
    skippable: true,
    pauseBatch: false,
    stopRun: false,
    requiredEvidence: ["public URL host/path", "HTTP status", "Cache-Control"],
    operatorAction:
      "Retry within the bounded budget; if the CDN failure rate crosses the threshold, pause and investigate.",
  },
  METADATA_MISMATCH: {
    retryable: false,
    skippable: false,
    pauseBatch: true,
    stopRun: true,
    requiredEvidence: ["object key", "expected and observed metadata"],
    operatorAction: "Stop. Never adopt or overwrite the object; reconcile identity metadata first.",
  },
  CHECKSUM_MISMATCH: {
    retryable: false,
    skippable: false,
    pauseBatch: true,
    stopRun: true,
    requiredEvidence: ["object key", "expected and observed SHA-256"],
    operatorAction: "Stop immediately. Do not upload, overwrite or mark the poster verified.",
  },
  LOCK_UNAVAILABLE: {
    retryable: false,
    skippable: false,
    pauseBatch: true,
    stopRun: true,
    requiredEvidence: ["lock path", "owner host/PID/token", "age"],
    operatorAction:
      "Stop. Confirm no migration is running before any explicit stale-lock recovery.",
  },
  STATE_PERSISTENCE_FAILED: {
    retryable: false,
    skippable: false,
    pauseBatch: true,
    stopRun: true,
    requiredEvidence: ["state path", "write/fsync error", "last valid checkpoint"],
    operatorAction:
      "Stop. Repair disk permissions or space; verify the last valid state before resuming.",
  },
  PREFLIGHT_INCOMPLETE: {
    retryable: false,
    skippable: false,
    pauseBatch: true,
    stopRun: true,
    requiredEvidence: ["pre-flight report", "unknown/error classifications", "live evidence mode"],
    operatorAction:
      "Stop. Do not upload until a complete, authorized live pre-flight covers every planned key.",
  },
  INVENTORY_MISMATCH: {
    retryable: false,
    skippable: false,
    pauseBatch: true,
    stopRun: true,
    requiredEvidence: ["planned keys", "observed keys", "unexpected objects"],
    operatorAction: "Stop. Reconcile the inventory before any upload or activation.",
  },
  INTERNAL_ERROR: {
    retryable: false,
    skippable: false,
    pauseBatch: true,
    stopRun: true,
    requiredEvidence: ["redacted error message", "operation and poster context"],
    operatorAction: "Stop and investigate the unexpected internal error before resuming.",
  },
};

export const FAILURE_POLICIES: Record<FailureCategory, FailurePolicy> = Object.fromEntries(
  Object.entries(POLICY).map(([category, policy]) => [
    category,
    { category: category as FailureCategory, ...policy },
  ]),
) as Record<FailureCategory, FailurePolicy>;

export { FAILURE_CATEGORIES } from "./events";

export const HARD_STOP_CATEGORIES: ReadonlySet<FailureCategory> = new Set(
  Object.values(FAILURE_POLICIES)
    .filter((policy) => policy.stopRun)
    .map((policy) => policy.category),
);

export function policyFor(category: FailureCategory): FailurePolicy {
  return FAILURE_POLICIES[category];
}

export function isHardStop(category: FailureCategory): boolean {
  return HARD_STOP_CATEGORIES.has(category);
}

export interface FailureDecision {
  category: FailureCategory;
  policy: FailurePolicy;
  action: "retry" | "skip" | "pause" | "stop";
  reason: string;
}

export function decideFailure(category: FailureCategory): FailureDecision {
  const policy = policyFor(category);
  if (policy.stopRun) {
    return {
      category,
      policy,
      action: "stop",
      reason: `${category} is a hard safety stop`,
    };
  }
  if (policy.pauseBatch) {
    return {
      category,
      policy,
      action: "pause",
      reason: `${category} requires operator review before new work starts`,
    };
  }
  if (policy.retryable) {
    return {
      category,
      policy,
      action: "retry",
      reason: `${category} is transient and retryable`,
    };
  }
  return {
    category,
    policy,
    action: "skip",
    reason: `${category} is non-retryable but skippable`,
  };
}

export function classifyFailure(error: unknown): FailureCategory {
  if (error instanceof MigrationObservabilityError) {
    return classifyFailure(error.originalError);
  }
  if (error instanceof RetryExhaustedError) return classifyFailure(error.lastError);
  if (error instanceof SourceChangedError) return "SOURCE_CHANGED";
  if (error instanceof SourceValidationError) return "SOURCE_VALIDATION_FAILED";
  if (error instanceof SourceHttpStatusError) {
    return error.retryable ? "SOURCE_TRANSIENT" : "SOURCE_PERMANENT";
  }
  if (error instanceof SourceUnavailableError) return "SOURCE_TRANSIENT";
  if (error instanceof R2ConflictError) return "R2_CONFLICT";
  if (error instanceof R2UploadUnknownError) return "R2_AMBIGUOUS";
  if (error instanceof R2VerificationError) return "ORIGIN_VERIFICATION_FAILED";
  if (error instanceof R2UploadError) {
    return error.retryable ? "R2_TRANSIENT" : "INTERNAL_ERROR";
  }
  if (error instanceof R2Error) return "INTERNAL_ERROR";
  if (error instanceof MigrationLockError || error instanceof MigrationGlobalLockError) {
    return "LOCK_UNAVAILABLE";
  }
  if (error instanceof MigrationStateError || error instanceof AuditError) {
    return "STATE_PERSISTENCE_FAILED";
  }
  if (error instanceof PreflightError) return "PREFLIGHT_INCOMPLETE";
  if (error instanceof EventValidationError) return "STATE_PERSISTENCE_FAILED";
  return "INTERNAL_ERROR";
}

export function classifyHttpStatus(status: number): FailureCategory {
  if (status === 429 || status === 408 || status === 425 || status >= 500) {
    return "SOURCE_TRANSIENT";
  }
  if (status >= 400) return "SOURCE_PERMANENT";
  return "INTERNAL_ERROR";
}
