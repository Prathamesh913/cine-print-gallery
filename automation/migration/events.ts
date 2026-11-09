import crypto from "node:crypto";
import { redactString } from "./redaction";

export const EVENT_SCHEMA_VERSION = 1 as const;

export const EVENT_TYPES = [
  "run.started",
  "run.completed",
  "batch.started",
  "batch.completed",
  "poster.started",
  "poster.verified",
  "poster.skipped",
  "poster.failed",
  "source.download.started",
  "source.download.completed",
  "source.download.failed",
  "optimization.started",
  "optimization.completed",
  "optimization.failed",
  "r2.upload.started",
  "r2.upload.completed",
  "r2.upload.conflicted",
  "r2.upload.ambiguous",
  "origin.verification.started",
  "origin.verification.completed",
  "cdn.verification.started",
  "cdn.verification.completed",
  "object.existing.discovered",
  "object.existing.reconciled",
  "source.checksum.changed",
  "source.revision.changed",
  "preflight.started",
  "preflight.completed",
  "lock.acquired",
  "lock.rejected",
  "lock.recovered",
  "lock.released",
  "state.checkpoint.written",
  "state.checkpoint.rejected",
  "operator.pause",
  "operator.abort",
  "operator.resume",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_OUTCOMES = [
  "started",
  "completed",
  "failed",
  "skipped",
  "verified",
  "conflicted",
  "ambiguous",
  "paused",
  "aborted",
  "resumed",
  "rejected",
  "recovered",
  "reconciled",
  "written",
  "discovered",
  "changed",
  "incomplete",
  "warning",
] as const;
export type EventOutcome = (typeof EVENT_OUTCOMES)[number];

export const EVIDENCE_MODES = ["local_plan", "mock", "live_preflight", "live_migration"] as const;
export type EvidenceMode = (typeof EVIDENCE_MODES)[number];

export const FAILURE_CATEGORIES = [
  "SOURCE_TRANSIENT",
  "SOURCE_PERMANENT",
  "SOURCE_CHANGED",
  "SOURCE_VALIDATION_FAILED",
  "OPTIMIZATION_FAILED",
  "R2_TRANSIENT",
  "R2_CONFLICT",
  "R2_AMBIGUOUS",
  "ORIGIN_VERIFICATION_FAILED",
  "CDN_VERIFICATION_FAILED",
  "METADATA_MISMATCH",
  "CHECKSUM_MISMATCH",
  "LOCK_UNAVAILABLE",
  "STATE_PERSISTENCE_FAILED",
  "PREFLIGHT_INCOMPLETE",
  "INVENTORY_MISMATCH",
  "INTERNAL_ERROR",
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const EVENT_VARIANTS = ["original", "optimized"] as const;
export type EventVariant = (typeof EVENT_VARIANTS)[number];

export class EventValidationError extends Error {}

export interface MigrationEvent {
  schemaVersion: typeof EVENT_SCHEMA_VERSION;
  eventId: string;
  timestamp: string;
  runId: string;
  sequence?: number;
  batchId?: string;
  type: EventType;
  outcome: EventOutcome;
  evidence: EvidenceMode;
  posterId?: string;
  variant?: EventVariant;
  operation?: string;
  attempt?: number;
  durationMs?: number;
  httpStatus?: number;
  bytes?: number;
  expectedSha256?: string;
  observedSha256?: string;
  failureCategory?: FailureCategory;
  retryable?: boolean;
  message?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface EventDraft extends Omit<
  MigrationEvent,
  "schemaVersion" | "eventId" | "timestamp" | "message" | "metadata"
> {
  eventId?: string;
  timestamp?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

const EVENT_ID_PATTERN = /^evt-[A-Za-z0-9][A-Za-z0-9._:-]{2,200}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const ALLOWED_KEYS = new Set([
  "schemaVersion",
  "eventId",
  "timestamp",
  "runId",
  "sequence",
  "batchId",
  "type",
  "outcome",
  "evidence",
  "posterId",
  "variant",
  "operation",
  "attempt",
  "durationMs",
  "httpStatus",
  "bytes",
  "expectedSha256",
  "observedSha256",
  "failureCategory",
  "retryable",
  "message",
  "metadata",
]);

export function eventIdFor(runId: string, sequence: number): string {
  return `evt-${runId}-${String(sequence).padStart(8, "0")}`;
}

function isIsoDate(value: string): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateMetadata(metadata: Record<string, unknown> | undefined, errors: string[]): void {
  if (metadata === undefined) return;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    errors.push("metadata must be a flat object");
    return;
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(key)) {
      errors.push(`metadata key is unsafe: ${key}`);
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      errors.push(`metadata value for ${key} must be a string, number or boolean`);
    }
    if (typeof value === "string" && value.length > 2_000) {
      errors.push(`metadata value for ${key} is too long`);
    }
  }
}

export function validateEvent(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["Event must be an object"];
  }
  const event = value as Record<string, unknown>;
  for (const key of Object.keys(event)) {
    if (!ALLOWED_KEYS.has(key)) errors.push(`Unknown event field: ${key}`);
  }
  if (event.schemaVersion !== EVENT_SCHEMA_VERSION) {
    errors.push(`Unsupported event schemaVersion: ${String(event.schemaVersion)}`);
  }
  if (typeof event.eventId !== "string" || !EVENT_ID_PATTERN.test(event.eventId)) {
    errors.push("eventId is invalid");
  }
  if (typeof event.runId !== "string" || !RUN_ID_PATTERN.test(event.runId)) {
    errors.push("runId is invalid");
  }
  if (typeof event.timestamp !== "string" || !isIsoDate(event.timestamp)) {
    errors.push("timestamp must be a valid ISO date");
  }
  if (!EVENT_TYPES.includes(event.type as EventType)) {
    errors.push(`Unknown event type: ${String(event.type)}`);
  }
  if (!EVENT_OUTCOMES.includes(event.outcome as EventOutcome)) {
    errors.push(`Unknown event outcome: ${String(event.outcome)}`);
  }
  if (!EVIDENCE_MODES.includes(event.evidence as EvidenceMode)) {
    errors.push(`Unknown evidence mode: ${String(event.evidence)}`);
  }
  if (event.sequence !== undefined) {
    if (!Number.isInteger(event.sequence) || (event.sequence as number) < 1) {
      errors.push("sequence must be a positive integer");
    }
  }
  if (event.batchId !== undefined && (typeof event.batchId !== "string" || !event.batchId)) {
    errors.push("batchId must be a non-empty string");
  }
  if (
    event.posterId !== undefined &&
    (typeof event.posterId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(event.posterId))
  ) {
    errors.push("posterId is invalid");
  }
  if (event.variant !== undefined && !EVENT_VARIANTS.includes(event.variant as EventVariant)) {
    errors.push("variant is invalid");
  }
  if (
    event.operation !== undefined &&
    (typeof event.operation !== "string" || event.operation.length > 128)
  ) {
    errors.push("operation is invalid");
  }
  if (
    event.attempt !== undefined &&
    (!Number.isInteger(event.attempt) || (event.attempt as number) < 1)
  ) {
    errors.push("attempt must be a positive integer");
  }
  if (
    event.durationMs !== undefined &&
    (typeof event.durationMs !== "number" ||
      !Number.isFinite(event.durationMs) ||
      event.durationMs < 0)
  ) {
    errors.push("durationMs must be a non-negative number");
  }
  if (
    event.httpStatus !== undefined &&
    (!Number.isInteger(event.httpStatus) ||
      (event.httpStatus as number) < 100 ||
      (event.httpStatus as number) > 599)
  ) {
    errors.push("httpStatus must be an integer between 100 and 599");
  }
  if (
    event.bytes !== undefined &&
    (!Number.isInteger(event.bytes) || (event.bytes as number) < 0)
  ) {
    errors.push("bytes must be a non-negative integer");
  }
  for (const field of ["expectedSha256", "observedSha256"] as const) {
    const hash = event[field];
    if (hash !== undefined && (typeof hash !== "string" || !SHA256_PATTERN.test(hash))) {
      errors.push(`${field} must be a 64-character hex SHA-256`);
    }
  }
  if (
    event.failureCategory !== undefined &&
    !FAILURE_CATEGORIES.includes(event.failureCategory as FailureCategory)
  ) {
    errors.push(`Unknown failure category: ${String(event.failureCategory)}`);
  }
  if (event.retryable !== undefined && typeof event.retryable !== "boolean") {
    errors.push("retryable must be a boolean");
  }
  if (event.message !== undefined) {
    if (typeof event.message !== "string") {
      errors.push("message must be a string");
    } else if (event.message.length > 4_000) {
      errors.push("message is too long");
    }
  }
  validateMetadata(event.metadata as Record<string, unknown> | undefined, errors);
  return errors;
}

export function assertValidEvent(value: unknown): asserts value is MigrationEvent {
  const errors = validateEvent(value);
  if (errors.length > 0) {
    throw new EventValidationError(`Invalid migration event:\n- ${errors.join("\n- ")}`);
  }
}

function redactMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!metadata) return undefined;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") {
      result[key] = redactString(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    } else {
      throw new EventValidationError(`Event metadata ${key} must be a string, number or boolean`);
    }
  }
  return result;
}

export function createEvent(draft: EventDraft): MigrationEvent {
  const timestamp = draft.timestamp ?? new Date().toISOString();
  const sequence = draft.sequence;
  const eventId =
    draft.eventId ??
    (sequence !== undefined
      ? eventIdFor(draft.runId, sequence)
      : `evt-${draft.runId}-${crypto.randomUUID()}`);
  const event: MigrationEvent = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId,
    timestamp,
    runId: draft.runId,
    ...(sequence !== undefined ? { sequence } : {}),
    ...(draft.batchId !== undefined ? { batchId: draft.batchId } : {}),
    type: draft.type,
    outcome: draft.outcome,
    evidence: draft.evidence,
    ...(draft.posterId !== undefined ? { posterId: draft.posterId } : {}),
    ...(draft.variant !== undefined ? { variant: draft.variant } : {}),
    ...(draft.operation !== undefined ? { operation: draft.operation } : {}),
    ...(draft.attempt !== undefined ? { attempt: draft.attempt } : {}),
    ...(draft.durationMs !== undefined ? { durationMs: draft.durationMs } : {}),
    ...(draft.httpStatus !== undefined ? { httpStatus: draft.httpStatus } : {}),
    ...(draft.bytes !== undefined ? { bytes: draft.bytes } : {}),
    ...(draft.expectedSha256 !== undefined
      ? { expectedSha256: draft.expectedSha256.toLowerCase() }
      : {}),
    ...(draft.observedSha256 !== undefined
      ? { observedSha256: draft.observedSha256.toLowerCase() }
      : {}),
    ...(draft.failureCategory !== undefined ? { failureCategory: draft.failureCategory } : {}),
    ...(draft.retryable !== undefined ? { retryable: draft.retryable } : {}),
    ...(draft.message !== undefined ? { message: redactString(draft.message) } : {}),
    ...(draft.metadata !== undefined ? { metadata: redactMetadata(draft.metadata) } : {}),
  };
  assertValidEvent(event);
  return event;
}

export function isFailureCategory(value: unknown): value is FailureCategory {
  return FAILURE_CATEGORIES.includes(value as FailureCategory);
}

export function isEventType(value: unknown): value is EventType {
  return EVENT_TYPES.includes(value as EventType);
}
