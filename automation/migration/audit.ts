import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertValidEvent,
  createEvent,
  eventIdFor,
  validateEvent,
  type EventDraft,
  type MigrationEvent,
} from "./events";

export class AuditError extends Error {}
export class AuditLockError extends AuditError {}
export class AuditCorruptionError extends AuditError {}
export class AuditSequenceError extends AuditError {}
export class AuditDuplicateEventError extends AuditError {}
export class AuditWriteError extends AuditError {}

export interface AuditIssue {
  line: number;
  kind:
    "partial_final_line" | "malformed" | "duplicate_sequence" | "out_of_order" | "missing_sequence";
  fatal: boolean;
  message: string;
}

export interface AuditRecovery {
  issues: AuditIssue[];
  partialFinalLine: boolean;
  eventCount: number;
  nextSequence: number;
}

export interface AuditReadResult {
  events: MigrationEvent[];
  issues: AuditIssue[];
  partialFinalLine: boolean;
}

export interface AuditLogOptions {
  path: string;
  runId: string;
  staleLockMs?: number;
  /** Explicit recovery for a provably stale audit lock. */
  breakLock?: boolean;
}

interface AuditLockRecord {
  scope?: string;
  path?: string;
  pid?: number;
  hostname?: string;
  startedAt?: string;
  runId?: string;
  token?: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function fsyncDirectory(directory: string): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(directory, "r");
    fs.fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EINVAL", "EPERM", "EBADF", "EISDIR", "ENOTSUP", "EACCES"].includes(code ?? "")) {
      throw error;
    }
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Best effort.
      }
    }
  }
}

function parseLines(
  content: string,
  runId: string,
  knownPartialLine: number | null,
): { events: MigrationEvent[]; issues: AuditIssue[]; partialFinalLine: boolean } {
  const events: MigrationEvent[] = [];
  const issues: AuditIssue[] = [];
  const seenEventIds = new Set<string>();
  const lines = content.split("\n");
  const endsWithNewline = content.endsWith("\n");
  const completeLineCount = endsWithNewline ? lines.length - 1 : lines.length - 1;
  const partialFinalLine = !endsWithNewline && content.length > 0;
  let previousSequence = 0;

  for (let index = 0; index < completeLineCount; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      const knownPartial = knownPartialLine === lineNumber;
      issues.push({
        line: lineNumber,
        kind: knownPartial ? "partial_final_line" : "malformed",
        fatal: !knownPartial,
        message: knownPartial
          ? "Known partial final line preserved from an interrupted append"
          : "Line is not valid JSON",
      });
      continue;
    }
    const errors = validateEvent(parsed);
    if (errors.length > 0) {
      issues.push({
        line: lineNumber,
        kind: "malformed",
        fatal: true,
        message: errors.join("; "),
      });
      continue;
    }
    const event = parsed as MigrationEvent;
    if (event.runId !== runId) {
      issues.push({
        line: lineNumber,
        kind: "malformed",
        fatal: true,
        message: `Event runId ${event.runId} does not match audit run ${runId}`,
      });
      continue;
    }
    if (event.sequence === undefined) {
      issues.push({
        line: lineNumber,
        kind: "missing_sequence",
        fatal: true,
        message: "Audit event has no sequence",
      });
      continue;
    }
    if (seenEventIds.has(event.eventId)) {
      issues.push({
        line: lineNumber,
        kind: "duplicate_event_id",
        fatal: true,
        message: `Duplicate event ID: ${event.eventId}`,
      });
      continue;
    }
    seenEventIds.add(event.eventId);
    if (event.sequence <= previousSequence) {
      issues.push({
        line: lineNumber,
        kind: event.sequence === previousSequence ? "duplicate_sequence" : "out_of_order",
        fatal: true,
        message: `Sequence ${event.sequence} is not greater than ${previousSequence}`,
      });
      continue;
    }
    previousSequence = event.sequence;
    events.push(event);
  }

  if (partialFinalLine) {
    issues.push({
      line: completeLineCount + 1,
      kind: "partial_final_line",
      fatal: false,
      message: "Final line has no trailing newline; preserved but not treated as a record",
    });
  }

  return { events, issues, partialFinalLine };
}

export class AuditLog {
  private readonly filePath: string;
  private readonly lockPath: string;
  private readonly runId: string;
  private readonly staleLockMs: number;
  private readonly breakLockOnOpen: boolean;
  private readonly fd: number;
  private readonly lockToken: string;
  private nextSequenceValue: number;
  private readonly recoveryValue: AuditRecovery;
  private readonly seenEventIds: Set<string>;
  private closed = false;

  private constructor(
    options: AuditLogOptions,
    fd: number,
    lockToken: string,
    recovery: AuditRecovery,
    seenEventIds: Set<string>,
  ) {
    this.filePath = options.path;
    this.lockPath = `${options.path}.lock`;
    this.runId = options.runId;
    this.staleLockMs = options.staleLockMs ?? 6 * 60 * 60 * 1000;
    this.breakLockOnOpen = options.breakLock ?? false;
    this.fd = fd;
    this.lockToken = lockToken;
    this.nextSequenceValue = recovery.nextSequence;
    this.recoveryValue = recovery;
    this.seenEventIds = seenEventIds;
  }

  static open(options: AuditLogOptions): AuditLog {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(options.runId)) {
      throw new AuditError(`Invalid run ID: ${options.runId}`);
    }
    fs.mkdirSync(path.dirname(options.path), { recursive: true });
    const lockToken = acquireAuditLock(options);
    try {
      let content = "";
      if (fs.existsSync(options.path)) {
        content = fs.readFileSync(options.path, "utf8");
      }
      const issues: AuditIssue[] = [...findPreservedPartialIssues(options.path)];
      let partialFinalLine = false;
      if (content.length > 0 && !content.endsWith("\n")) {
        const lastNewline = content.lastIndexOf("\n");
        const tailStart = lastNewline + 1;
        const tail = content.slice(tailStart);
        if (tail.length > 0) {
          const preservedPath = `${options.path}.partial-${Date.now()}.log`;
          // Preserve the incomplete tail as sidecar evidence, then remove only
          // that incomplete tail. Complete records are never rewritten.
          fs.writeFileSync(preservedPath, tail, { encoding: "utf8", mode: 0o600 });
          fs.truncateSync(options.path, Buffer.byteLength(content.slice(0, tailStart)));
          content = content.slice(0, tailStart);
          partialFinalLine = true;
          issues.push({
            line: content.split("\n").length,
            kind: "partial_final_line",
            fatal: false,
            message: `Incomplete final line preserved at ${preservedPath}`,
          });
        }
      }
      const parsed = parseLines(content, options.runId, null);
      issues.push(...parsed.issues);
      const fatal = issues.filter((issue) => issue.fatal);
      if (fatal.length > 0) {
        throw new AuditCorruptionError(
          `Audit log ${options.path} is corrupt:\n- ${fatal
            .map((issue) => `line ${issue.line}: ${issue.message}`)
            .join("\n- ")}`,
        );
      }
      const fd = fs.openSync(options.path, "a", 0o600);
      const nextSequence =
        parsed.events.length > 0 ? parsed.events[parsed.events.length - 1].sequence! + 1 : 1;
      const recovery: AuditRecovery = {
        issues,
        partialFinalLine:
          partialFinalLine || issues.some((issue) => issue.kind === "partial_final_line"),
        eventCount: parsed.events.length,
        nextSequence,
      };
      return new AuditLog(
        options,
        fd,
        lockToken,
        recovery,
        new Set(parsed.events.map((event) => event.eventId)),
      );
    } catch (error) {
      releaseAuditLock(options.path, lockToken);
      throw error;
    }
  }

  get path(): string {
    return this.filePath;
  }

  get recovery(): AuditRecovery {
    return this.recoveryValue;
  }

  get nextSequence(): number {
    return this.nextSequenceValue;
  }

  append(draft: EventDraft): MigrationEvent {
    if (this.closed) throw new AuditWriteError("Audit log is closed");
    if (draft.runId !== this.runId) {
      throw new AuditError(`Event runId ${draft.runId} does not match audit run ${this.runId}`);
    }
    if (draft.sequence !== undefined && draft.sequence !== this.nextSequenceValue) {
      throw new AuditSequenceError(
        `Event sequence ${draft.sequence} does not match the next audit sequence ${this.nextSequenceValue}`,
      );
    }
    const sequence = this.nextSequenceValue;
    const expectedEventId = eventIdFor(this.runId, sequence);
    if (draft.eventId !== undefined && draft.eventId !== expectedEventId) {
      throw new AuditSequenceError(
        `Event ID ${draft.eventId} is not the deterministic ID for sequence ${sequence}`,
      );
    }
    const event = createEvent({
      ...draft,
      sequence,
      eventId: expectedEventId,
    });
    assertValidEvent(event);
    if (this.seenEventIds.has(event.eventId)) {
      throw new AuditDuplicateEventError(`Duplicate event ID: ${event.eventId}`);
    }
    const line = `${JSON.stringify(event)}\n`;
    try {
      fs.writeSync(this.fd, line, undefined, "utf8");
    } catch (error) {
      throw new AuditWriteError(
        `Unable to append audit event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.seenEventIds.add(event.eventId);
    this.nextSequenceValue = sequence + 1;
    return event;
  }

  checkpoint(): void {
    if (this.closed) return;
    try {
      fs.fsyncSync(this.fd);
      fsyncDirectory(path.dirname(this.filePath));
    } catch (error) {
      throw new AuditWriteError(
        `Unable to flush audit log: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  readAll(): AuditReadResult {
    const content = fs.existsSync(this.filePath) ? fs.readFileSync(this.filePath, "utf8") : "";
    const parsed = parseLines(content, this.runId, null);
    const issues = [...this.recoveryValue.issues];
    for (const issue of parsed.issues) {
      if (
        !issues.some(
          (existing) =>
            existing.line === issue.line &&
            existing.kind === issue.kind &&
            existing.message === issue.message,
        )
      ) {
        issues.push(issue);
      }
    }
    return {
      events: parsed.events,
      issues,
      partialFinalLine: this.recoveryValue.partialFinalLine || parsed.partialFinalLine,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      fs.fsyncSync(this.fd);
    } catch (error) {
      throw new AuditWriteError(
        `Unable to flush audit log before close: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      try {
        fs.closeSync(this.fd);
      } finally {
        releaseAuditLock(this.filePath, this.lockToken);
      }
    }
  }
}

function findPreservedPartialIssues(auditPath: string): AuditIssue[] {
  const directory = path.dirname(auditPath);
  const base = path.basename(auditPath);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.startsWith(`${base}.partial-`) && name.endsWith(".log"))
    .sort()
    .map((name) => ({
      line: 0,
      kind: "partial_final_line" as const,
      fatal: false,
      message: `Preserved incomplete audit tail: ${path.join(directory, name)}`,
    }));
}

function acquireAuditLock(options: AuditLogOptions): string {
  const lockPath = `${options.path}.lock`;
  const staleLockMs = options.staleLockMs ?? 6 * 60 * 60 * 1000;
  if (options.breakLock && fs.existsSync(lockPath)) {
    breakAuditLock(lockPath, options.path, options.runId, staleLockMs);
  }
  const token = crypto.randomUUID();
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(
      fd,
      `${JSON.stringify(
        {
          scope: "audit",
          path: options.path,
          pid: process.pid,
          hostname: os.hostname(),
          startedAt: new Date().toISOString(),
          runId: options.runId,
          token,
        },
        null,
        2,
      )}\n`,
    );
    fs.closeSync(fd);
    return token;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") {
      throw new AuditLockError(
        `Unable to acquire audit lock: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  let ageMs = 0;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as AuditLockRecord;
    const startedAt = lock.startedAt ? Date.parse(lock.startedAt) : NaN;
    if (Number.isFinite(startedAt)) ageMs = Date.now() - startedAt;
  } catch {
    ageMs = 0;
  }
  throw new AuditLockError(
    `Audit log is already open at ${lockPath}` +
      (ageMs > staleLockMs
        ? `. The lock appears stale. Re-run with --break-lock after confirming no writer is active, or inspect and remove it manually.`
        : ". Another process may be appending to this run."),
  );
}

function breakAuditLock(
  lockPath: string,
  auditPath: string,
  runId: string,
  staleLockMs: number,
): void {
  if (!fs.existsSync(lockPath)) return;
  let lock: AuditLockRecord;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as AuditLockRecord;
  } catch {
    throw new AuditLockError(
      `Refusing to remove malformed audit lock at ${lockPath}; inspect it manually.`,
    );
  }
  if (lock.scope !== "audit" || lock.path !== auditPath || lock.runId !== runId) {
    throw new AuditLockError(
      `Refusing to remove audit lock at ${lockPath}: it is not scoped to this audit run.`,
    );
  }
  if (lock.hostname !== os.hostname()) {
    throw new AuditLockError(
      `Refusing to remove audit lock at ${lockPath}: it was created on another host.`,
    );
  }
  if (typeof lock.pid !== "number" || !Number.isInteger(lock.pid) || lock.pid <= 0) {
    throw new AuditLockError(`Refusing to remove audit lock at ${lockPath}: no valid PID.`);
  }
  if (isProcessAlive(lock.pid)) {
    throw new AuditLockError(
      `Refusing to remove audit lock at ${lockPath}: process ${lock.pid} is alive.`,
    );
  }
  const startedAt = lock.startedAt ? Date.parse(lock.startedAt) : NaN;
  const ageMs = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
  if (ageMs <= staleLockMs) {
    throw new AuditLockError(`Refusing to remove audit lock at ${lockPath}: it is not stale yet.`);
  }
  fs.unlinkSync(lockPath);
}

function releaseAuditLock(auditPath: string, token: string): void {
  const lockPath = `${auditPath}.lock`;
  if (!fs.existsSync(lockPath)) return;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as AuditLockRecord;
    if (lock.token !== token) {
      throw new AuditLockError(
        `Refusing to release audit lock at ${lockPath}: ownership no longer matches.`,
      );
    }
    fs.unlinkSync(lockPath);
  } catch (error) {
    if (error instanceof AuditLockError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new AuditLockError(
      `Unable to release audit lock: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
