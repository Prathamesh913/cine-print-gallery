import {
  HARD_STOP_CATEGORIES,
  classifyFailure,
  isHardStop,
  type FailureCategory,
} from "./failures";
import type { MigrationEvent } from "./events";
import type { EvidenceMode } from "./events";
import type { MigrationResult, MigrationStateEntry } from "./types";

export interface RunSummaryInput {
  runId: string;
  batchId?: string;
  evidence: EvidenceMode;
  plannedPosterIds: string[];
  results?: MigrationResult[];
  stateEntries?: Record<string, MigrationStateEntry>;
  events?: MigrationEvent[];
  expectedObjects?: number;
  startedAt?: string;
  completedAt?: string;
  now?: () => Date;
  auditHealthy?: boolean;
  auditIssues?: number;
}

export interface RunSummary {
  schemaVersion: 1;
  runId: string;
  batchId?: string;
  evidence: EvidenceMode;
  plannedPosters: number;
  startedPosters: number;
  verifiedPosters: number;
  skippedPosters: number;
  failedPosters: number;
  pendingPosters: number;
  plannedObjects: number;
  attemptedObjects: number;
  uploadedObjects: number;
  discoveredObjects: number;
  reconciledObjects: number;
  originVerifiedObjects: number;
  publicVerifiedObjects: number;
  verifiedObjects: number;
  conflictedObjects: number;
  failedObjects: number;
  unknownObjects: number;
  failureCounts: Partial<Record<FailureCategory, number>>;
  retryCount: number;
  sourceBytesRead: number;
  uploadedBytes: number;
  bytesTransferred: number;
  durationMs: number | null;
  postersPerHour: number | null;
  bytesPerSecond: number | null;
  lastSuccessfulCheckpoint: string | null;
  resumeSafe: boolean;
  complete: boolean;
  partialSuccess: boolean;
  liveSuccess: boolean;
  blockingReasons: string[];
}

function terminalKind(
  result: MigrationResult | undefined,
  state: MigrationStateEntry | undefined,
): "verified" | "failed" | "skipped" | "pending" {
  const name = result?.state ?? state?.state;
  if (!name) return "pending";
  if (name === "VERIFIED") return "verified";
  if (name === "FAILED" || name === "CONFLICT" || name === "SOURCE_CHANGED") return "failed";
  if (name === "SOURCE_UNAVAILABLE" || name === "READY_WITH_REVIEW") return "skipped";
  return "pending";
}

export function computeRunSummary(input: RunSummaryInput): RunSummary {
  const results = new Map((input.results ?? []).map((result) => [result.posterId, result]));
  const states = input.stateEntries ?? {};
  const events = input.events ?? [];
  const planned = [...new Set(input.plannedPosterIds)];

  let verified = 0;
  let failed = 0;
  let skipped = 0;
  let pending = 0;
  let started = 0;
  for (const posterId of planned) {
    const result = results.get(posterId);
    const state = states[posterId];
    const kind = terminalKind(result, state);
    if (kind === "verified") verified++;
    else if (kind === "failed") failed++;
    else if (kind === "skipped") skipped++;
    else pending++;
    if (result || (state?.attempts ?? 0) > 0) started++;
  }

  const failureCounts: Partial<Record<FailureCategory, number>> = {};
  let retryCount = 0;
  let sourceBytesRead = 0;
  let uploadedBytes = 0;
  let lastCheckpoint: string | null = null;

  const objectKeys = (predicate: (event: MigrationEvent) => boolean): Set<string> => {
    const keys = new Set<string>();
    for (const event of events) {
      if (!predicate(event)) continue;
      const key =
        typeof event.metadata?.key === "string"
          ? event.metadata.key
          : event.posterId
            ? `${event.posterId}:${event.variant ?? "unknown"}`
            : null;
      if (key) keys.add(key);
    }
    return keys;
  };

  const attemptedKeys = objectKeys((event) => event.type === "r2.upload.started");
  const uploadedKeys = objectKeys(
    (event) => event.type === "r2.upload.completed" && event.outcome === "completed",
  );
  const discoveredKeys = objectKeys((event) => event.type === "object.existing.discovered");
  const reconciledKeys = objectKeys((event) => event.type === "object.existing.reconciled");
  const originVerifiedKeys = objectKeys(
    (event) => event.type === "origin.verification.completed" && event.outcome === "completed",
  );
  const publicVerifiedKeys = objectKeys(
    (event) => event.type === "cdn.verification.completed" && event.outcome === "completed",
  );
  const conflictedKeys = objectKeys(
    (event) => event.type === "r2.upload.conflicted" || event.type === "r2.upload.ambiguous",
  );
  const failedObjectKeys = objectKeys(
    (event) =>
      (event.type === "origin.verification.completed" && event.outcome === "failed") ||
      (event.type === "cdn.verification.completed" && event.outcome === "failed") ||
      (event.type === "r2.upload.completed" && event.outcome === "failed"),
  );

  for (const event of events) {
    if (event.failureCategory) {
      failureCounts[event.failureCategory] = (failureCounts[event.failureCategory] ?? 0) + 1;
    }
    if (event.attempt !== undefined && event.attempt > 1) retryCount++;
    if (event.type === "source.download.completed" && event.bytes) {
      sourceBytesRead += event.bytes;
    }
    if (event.type === "r2.upload.completed" && event.bytes) {
      uploadedBytes += event.bytes;
    }
    if (
      event.type === "state.checkpoint.written" &&
      (!lastCheckpoint || event.timestamp > lastCheckpoint)
    ) {
      lastCheckpoint = event.timestamp;
    }
  }

  if (!lastCheckpoint) {
    const updated = Object.values(states)
      .map((entry) => entry.updatedAt)
      .filter(Boolean)
      .sort();
    lastCheckpoint = updated.length > 0 ? updated[updated.length - 1] : null;
  }

  const plannedObjects = input.expectedObjects ?? planned.length * 2;
  const verifiedObjectKeys = new Set(
    [...originVerifiedKeys].filter((key) => publicVerifiedKeys.has(key)),
  );
  // Fallback for callers that supply state but no verification events.
  if (originVerifiedKeys.size === 0 && publicVerifiedKeys.size === 0) {
    for (const posterId of planned) {
      const state = states[posterId];
      if (state?.state === "VERIFIED" || results.get(posterId)?.state === "VERIFIED") {
        verifiedObjectKeys.add(`${posterId}:original`);
        verifiedObjectKeys.add(`${posterId}:optimized`);
      }
    }
  }
  const verifiedObjects = Math.min(plannedObjects, verifiedObjectKeys.size);
  const unresolvedConflicts = new Set(
    [...conflictedKeys].filter((key) => !verifiedObjectKeys.has(key)),
  );
  const unresolvedFailures = new Set(
    [...failedObjectKeys].filter(
      (key) => !verifiedObjectKeys.has(key) && !unresolvedConflicts.has(key),
    ),
  );
  const conflictedObjects = Math.min(plannedObjects, unresolvedConflicts.size);
  const failedObjects = Math.min(plannedObjects, unresolvedFailures.size);
  const accountedObjects = new Set([
    ...verifiedObjectKeys,
    ...unresolvedConflicts,
    ...unresolvedFailures,
  ]);
  const unknownObjects = Math.max(0, plannedObjects - accountedObjects.size);

  const startedAt = input.startedAt ? Date.parse(input.startedAt) : NaN;
  const completedAt = input.completedAt
    ? Date.parse(input.completedAt)
    : (input.now ?? (() => new Date()))().getTime();
  const durationMs =
    Number.isFinite(startedAt) && Number.isFinite(completedAt)
      ? Math.max(0, completedAt - startedAt)
      : null;
  const postersPerHour = durationMs && durationMs > 0 ? (verified / durationMs) * 3_600_000 : null;
  const bytesPerSecond = durationMs && durationMs > 0 ? uploadedBytes / (durationMs / 1_000) : null;

  const blockingReasons: string[] = [];
  for (const category of HARD_STOP_CATEGORIES) {
    if ((failureCounts[category] ?? 0) > 0) {
      blockingReasons.push(`Hard-stop failure recorded: ${category}`);
    }
  }
  if (input.auditHealthy === false) {
    blockingReasons.push("Audit history is unhealthy or incomplete");
  }
  if ((input.auditIssues ?? 0) > 0) {
    blockingReasons.push(`Audit history reports ${input.auditIssues} issue(s)`);
  }
  if (failed > 0) blockingReasons.push(`${failed} poster(s) failed`);
  const resumeSafe = input.auditHealthy !== false && blockingReasons.length === 0;
  if (pending > 0) blockingReasons.push(`${pending} poster(s) are still pending`);
  if (skipped > 0) {
    blockingReasons.push(`${skipped} poster(s) were skipped and are not fully verified`);
  }
  if (unknownObjects > 0) {
    blockingReasons.push(`${unknownObjects} object(s) remain unverified or unknown`);
  }

  const allPostersVerified =
    planned.length > 0 &&
    verified === planned.length &&
    failed === 0 &&
    pending === 0 &&
    skipped === 0;
  const allObjectsVerified = plannedObjects > 0 && verifiedObjects === plannedObjects;
  const complete = allPostersVerified && allObjectsVerified;
  const partialSuccess = verified > 0 && !complete;
  const liveSuccess =
    input.evidence === "live_migration" &&
    complete &&
    blockingReasons.length === 0 &&
    input.auditHealthy !== false &&
    verifiedObjects === plannedObjects;

  return {
    schemaVersion: 1,
    runId: input.runId,
    ...(input.batchId !== undefined ? { batchId: input.batchId } : {}),
    evidence: input.evidence,
    plannedPosters: planned.length,
    startedPosters: started,
    verifiedPosters: verified,
    skippedPosters: skipped,
    failedPosters: failed,
    pendingPosters: pending,
    plannedObjects,
    attemptedObjects: Math.min(plannedObjects, attemptedKeys.size),
    uploadedObjects: Math.min(plannedObjects, uploadedKeys.size),
    discoveredObjects: Math.min(plannedObjects, discoveredKeys.size),
    reconciledObjects: Math.min(plannedObjects, reconciledKeys.size),
    originVerifiedObjects: Math.min(plannedObjects, originVerifiedKeys.size),
    publicVerifiedObjects: Math.min(plannedObjects, publicVerifiedKeys.size),
    verifiedObjects,
    conflictedObjects,
    failedObjects,
    unknownObjects,
    failureCounts,
    retryCount,
    sourceBytesRead,
    uploadedBytes,
    bytesTransferred: uploadedBytes,
    durationMs,
    postersPerHour,
    bytesPerSecond,
    lastSuccessfulCheckpoint: lastCheckpoint,
    resumeSafe,
    complete,
    partialSuccess,
    liveSuccess,
    blockingReasons,
  };
}

export interface ThresholdConfig {
  sourceFailureRatePause: number;
  r2UploadFailureRatePause: number;
  cdnVerificationFailureRatePause: number;
  http429RatePause: number;
  p95LatencyWarningMs: number;
  /** Percentages are not evaluated below this denominator. */
  minSamples: number;
  /** Completed operations considered for rate metrics; hard stops scan full history. */
  windowSize: number;
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  sourceFailureRatePause: 0.05,
  r2UploadFailureRatePause: 0.02,
  cdnVerificationFailureRatePause: 0.01,
  http429RatePause: 0.05,
  p95LatencyWarningMs: 30_000,
  minSamples: 20,
  windowSize: 500,
};

export interface ThresholdMetrics {
  sourceAttempts: number;
  sourceFailures: number;
  sourceFailureRate: number | null;
  uploadAttempts: number;
  uploadFailures: number;
  uploadFailureRate: number | null;
  cdnAttempts: number;
  cdnFailures: number;
  cdnFailureRate: number | null;
  httpResponses: number;
  http429: number;
  http429Rate: number | null;
  p95LatencyMs: number | null;
}

export interface ThresholdDecision {
  decision: "continue" | "pause" | "stop" | "warning";
  reasons: string[];
  metrics: ThresholdMetrics;
  hardStops: FailureCategory[];
  insufficientSamples: string[];
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

interface OperationOutcome {
  key: string;
  kind: "source" | "upload" | "cdn";
  success: boolean;
  httpStatus?: number;
  durationMs?: number;
  order: number;
}

function outcomeKey(event: MigrationEvent, kind: string): string | null {
  if (typeof event.metadata?.key === "string") return `${kind}:${event.metadata.key}`;
  if (!event.posterId) return null;
  return `${kind}:${event.posterId}:${event.variant ?? "unknown"}`;
}

function collectOutcomes(events: MigrationEvent[]): OperationOutcome[] {
  const outcomes = new Map<string, OperationOutcome>();
  events.forEach((event, order) => {
    let kind: OperationOutcome["kind"] | null = null;
    let success = false;
    if (event.type === "source.download.completed" || event.type === "source.download.failed") {
      kind = "source";
      success = event.type === "source.download.completed";
    } else if (
      event.type === "r2.upload.completed" ||
      event.type === "r2.upload.conflicted" ||
      event.type === "r2.upload.ambiguous"
    ) {
      kind = "upload";
      success = event.type === "r2.upload.completed" && event.outcome === "completed";
    } else if (event.type === "cdn.verification.completed") {
      kind = "cdn";
      success = event.outcome === "completed";
    }
    if (!kind) return;
    const key = outcomeKey(event, kind);
    if (!key) return;
    outcomes.set(key, {
      key,
      kind,
      success,
      ...(event.httpStatus !== undefined ? { httpStatus: event.httpStatus } : {}),
      ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
      order,
    });
  });
  return [...outcomes.values()].sort((a, b) => a.order - b.order);
}

export function evaluateThresholds(
  allEvents: MigrationEvent[],
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
): ThresholdDecision {
  const hardStops = [
    ...new Set(
      allEvents
        .map((event) => event.failureCategory)
        .filter((category): category is FailureCategory => Boolean(category))
        .filter((category) => isHardStop(category)),
    ),
  ];
  // windowSize is a number of completed operations, not raw event positions.
  // This prevents a started/outcome pair from being split by the window.
  const outcomes = collectOutcomes(allEvents).slice(-config.windowSize);
  const sourceOutcomes = outcomes.filter((outcome) => outcome.kind === "source");
  const uploadOutcomes = outcomes.filter((outcome) => outcome.kind === "upload");
  const cdnOutcomes = outcomes.filter((outcome) => outcome.kind === "cdn");

  const sourceAttempts = sourceOutcomes.length;
  const sourceFailures = sourceOutcomes.filter((outcome) => !outcome.success).length;
  const uploadAttempts = uploadOutcomes.length;
  const uploadFailures = uploadOutcomes.filter((outcome) => !outcome.success).length;
  const cdnAttempts = cdnOutcomes.length;
  const cdnFailures = cdnOutcomes.filter((outcome) => !outcome.success).length;
  const httpOutcomes = outcomes.filter((outcome) => outcome.httpStatus !== undefined);
  const httpResponses = httpOutcomes.length;
  const http429 = httpOutcomes.filter((outcome) => outcome.httpStatus === 429).length;
  const p95LatencyMs = percentile(
    outcomes
      .map((outcome) => outcome.durationMs)
      .filter((value): value is number => value !== undefined),
    95,
  );

  const metrics: ThresholdMetrics = {
    sourceAttempts,
    sourceFailures,
    sourceFailureRate: rate(sourceFailures, sourceAttempts),
    uploadAttempts,
    uploadFailures,
    uploadFailureRate: rate(uploadFailures, uploadAttempts),
    cdnAttempts,
    cdnFailures,
    cdnFailureRate: rate(cdnFailures, cdnAttempts),
    httpResponses,
    http429,
    http429Rate: rate(http429, httpResponses),
    p95LatencyMs,
  };

  const insufficientSamples: string[] = [];
  const checkRate = (
    label: string,
    numerator: number,
    denominator: number,
    threshold: number,
  ): string | null => {
    if (denominator === 0) return null;
    if (denominator < config.minSamples) {
      insufficientSamples.push(
        `${label}: ${denominator} sample(s) is below the ${config.minSamples} minimum`,
      );
      return null;
    }
    const observed = numerator / denominator;
    return observed > threshold
      ? `${label} failure rate ${(observed * 100).toFixed(2)}% exceeds ${(threshold * 100).toFixed(2)}%`
      : null;
  };

  const pauseReasons: string[] = [];
  const sourceReason = checkRate(
    "source",
    sourceFailures,
    sourceAttempts,
    config.sourceFailureRatePause,
  );
  if (sourceReason) pauseReasons.push(sourceReason);
  const uploadReason = checkRate(
    "R2 upload",
    uploadFailures,
    uploadAttempts,
    config.r2UploadFailureRatePause,
  );
  if (uploadReason) pauseReasons.push(uploadReason);
  const cdnReason = checkRate(
    "CDN verification",
    cdnFailures,
    cdnAttempts,
    config.cdnVerificationFailureRatePause,
  );
  if (cdnReason) pauseReasons.push(cdnReason);
  const httpReason = checkRate("HTTP 429", http429, httpResponses, config.http429RatePause);
  if (httpReason) {
    pauseReasons.push(`${httpReason}; pause and reduce concurrency after operator review`);
  }

  const warningReasons: string[] = [];
  if (p95LatencyMs !== null && p95LatencyMs > config.p95LatencyWarningMs) {
    warningReasons.push(
      `p95 operation latency ${p95LatencyMs}ms exceeds the ${config.p95LatencyWarningMs}ms warning threshold`,
    );
  }

  if (hardStops.length > 0) {
    return {
      decision: "stop",
      reasons: hardStops.map((category) => `Hard-stop failure present: ${category}`),
      metrics,
      hardStops,
      insufficientSamples,
    };
  }
  if (pauseReasons.length > 0) {
    return {
      decision: "pause",
      reasons: pauseReasons,
      metrics,
      hardStops,
      insufficientSamples,
    };
  }
  if (warningReasons.length > 0) {
    return {
      decision: "warning",
      reasons: warningReasons,
      metrics,
      hardStops,
      insufficientSamples,
    };
  }
  return {
    decision: "continue",
    reasons: [],
    metrics,
    hardStops,
    insufficientSamples,
  };
}

export class BatchPausedError extends Error {}
export class BatchStoppedError extends Error {}

export interface BatchSelection {
  runId: string;
  batchId?: string;
  posterIds: string[];
}

export interface ResumeInput extends BatchSelection {
  validatedState: boolean;
}

function selectionKey(selection: BatchSelection): string {
  return `${selection.runId}::${selection.batchId ?? ""}::${[...selection.posterIds]
    .sort()
    .join(",")}`;
}

export class BatchPauseController {
  private stateValue: "running" | "paused" | "stopped" = "running";
  private activeWorkers = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly events: MigrationEvent[] = [];
  private readonly selection: BatchSelection;
  private readonly config: ThresholdConfig;
  private pauseReason: string | null = null;
  private stopReason: string | null = null;

  constructor(selection: BatchSelection, config: ThresholdConfig = DEFAULT_THRESHOLDS) {
    if (selection.posterIds.length === 0) {
      throw new Error("Batch selection must contain at least one poster");
    }
    this.selection = {
      runId: selection.runId,
      ...(selection.batchId !== undefined ? { batchId: selection.batchId } : {}),
      posterIds: [...selection.posterIds],
    };
    this.config = config;
  }

  get state(): "running" | "paused" | "stopped" {
    return this.stateValue;
  }

  get runningWorkers(): number {
    return this.activeWorkers;
  }

  get reason(): string | null {
    return this.stopReason ?? this.pauseReason;
  }

  get recordedEvents(): MigrationEvent[] {
    return [...this.events];
  }

  beginPoster(posterId?: string): void {
    if (this.stateValue === "stopped") {
      throw new BatchStoppedError(`Run is stopped: ${this.stopReason ?? "hard safety stop"}`);
    }
    if (this.stateValue === "paused") {
      throw new BatchPausedError(
        `Batch is paused: ${this.pauseReason ?? "operator review required"}`,
      );
    }
    if (posterId !== undefined && !this.selection.posterIds.includes(posterId)) {
      throw new Error(`Poster ${posterId} is not part of this batch selection`);
    }
    this.activeWorkers++;
  }

  endPoster(): void {
    this.activeWorkers = Math.max(0, this.activeWorkers - 1);
    if (this.activeWorkers === 0) {
      for (const resolve of this.waiters.splice(0)) resolve();
    }
  }

  settle(): Promise<void> {
    if (this.activeWorkers === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  record(event: MigrationEvent): ThresholdDecision {
    if (event.runId !== this.selection.runId) {
      throw new Error(
        `Event runId ${event.runId} does not match batch run ${this.selection.runId}`,
      );
    }
    if (this.selection.batchId !== undefined && event.batchId !== this.selection.batchId) {
      throw new Error(
        `Event batchId ${event.batchId ?? "(none)"} does not match batch ${this.selection.batchId}`,
      );
    }
    this.events.push(event);
    const decision = evaluateThresholds(this.events, this.config);
    if (decision.decision === "stop" && this.stateValue !== "stopped") {
      this.stateValue = "stopped";
      this.stopReason = decision.reasons.join("; ");
    } else if (decision.decision === "pause" && this.stateValue === "running") {
      this.stateValue = "paused";
      this.pauseReason = decision.reasons.join("; ");
    }
    return decision;
  }

  pause(reason = "Operator pause"): void {
    if (this.stateValue === "stopped") return;
    this.stateValue = "paused";
    this.pauseReason = reason;
  }

  abort(reason = "Operator abort"): void {
    this.stateValue = "stopped";
    this.stopReason = reason;
  }

  resume(input: ResumeInput): void {
    if (this.stateValue === "stopped") {
      throw new BatchStoppedError(
        `Cannot resume a hard-stopped run: ${this.stopReason ?? "hard safety stop"}`,
      );
    }
    if (!input.validatedState) {
      throw new BatchPausedError("Resume requires validated state");
    }
    if (selectionKey(input) !== selectionKey(this.selection)) {
      throw new BatchPausedError(
        "Resume requires the same run, batch and explicit poster selection",
      );
    }
    this.stateValue = "running";
    this.pauseReason = null;
  }
}

export function classifyEventFailure(event: MigrationEvent): FailureCategory | null {
  return event.failureCategory ?? null;
}

export { classifyFailure };
