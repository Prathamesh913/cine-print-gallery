import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSha256Hex } from "./checksum";
import type { MigrationState, MigrationStateEntry, MigrationStateName } from "./types";

export class MigrationStateError extends Error {}
export class MigrationLockError extends Error {}

export interface MigrationStateStoreOptions {
  statePath: string;
  manifestHash: string;
  lockPath?: string;
  staleLockMs?: number;
  /** Explicit stale-lock recovery. Never enabled by default. */
  breakLock?: boolean;
}

interface StateLockRecord {
  scope?: string;
  statePath?: string;
  pid?: number;
  hostname?: string;
  startedAt?: string;
  token?: string;
}

const VALID_STATE_NAMES: ReadonlySet<string> = new Set([
  "PENDING",
  "SOURCE_DOWNLOADED",
  "SOURCE_VERIFIED",
  "OPTIMIZED",
  "READY_TO_UPLOAD",
  "ORIGINAL_UPLOADED",
  "OPTIMIZED_UPLOADED",
  "VERIFIED",
  "SOURCE_UNAVAILABLE",
  "SOURCE_CHANGED",
  "CONFLICT",
  "FAILED",
  "READY_WITH_REVIEW",
]);

/**
 * Structural validation run both on load and before an atomic replace. It is
 * intentionally narrower than `validateVerifiedStateEntry`: it proves the
 * document is safe to persist, not that a poster is ready to skip.
 */
export function validateStateDocument(state: MigrationState, manifestHash: string): string[] {
  const errors: string[] = [];
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return ["Migration state must be an object"];
  }
  if (state.schemaVersion !== 1) {
    errors.push(`Unsupported state schemaVersion: ${String(state.schemaVersion)}`);
  }
  if (state.manifestHash !== manifestHash) {
    errors.push(
      "Migration state was created for a different manifest; use a new state path or regenerate the state",
    );
  }
  if (!isValidIsoDate(state.createdAt)) errors.push("createdAt must be a valid ISO date");
  if (!isValidIsoDate(state.updatedAt)) errors.push("updatedAt must be a valid ISO date");
  if (!state.entries || typeof state.entries !== "object" || Array.isArray(state.entries)) {
    errors.push("Migration state entries must be an object keyed by poster ID");
    return errors;
  }
  for (const [posterId, entry] of Object.entries(state.entries)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`Entry ${posterId} is not an object`);
      continue;
    }
    if (entry.posterId !== posterId) {
      errors.push(`Entry ${posterId} has a mismatched posterId`);
    }
    if (typeof entry.state !== "string" || entry.state.length === 0) {
      errors.push(`Entry ${posterId} has no state`);
    } else if (!VALID_STATE_NAMES.has(entry.state)) {
      errors.push(`Entry ${posterId} has an unknown state: ${String(entry.state)}`);
    }
  }
  return errors;
}

function fsyncDirectory(directory: string): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(directory, "r");
    fs.fsyncSync(fd);
  } catch (error) {
    // Directory fsync is not portable: Windows and some filesystems reject
    // opening or syncing a directory. The file itself is still fsynced and the
    // rename remains atomic; the limitation is documented rather than hidden.
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EINVAL", "EPERM", "EBADF", "EISDIR", "ENOTSUP", "EACCES"].includes(code ?? "")) {
      throw error;
    }
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Closing a directory descriptor is best-effort.
      }
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface StateEntryPatch {
  state?: MigrationStateName;
  lastError?: string | null;
  sourceSha256?: string | null;
  originalSha256?: string | null;
  optimizedSha256?: string | null;
  originalKey?: string | null;
  optimizedKey?: string | null;
  originalSizeBytes?: number | null;
  optimizedSizeBytes?: number | null;
  originalDimensions?: { width: number; height: number } | null;
  optimizedDimensions?: { width: number; height: number } | null;
  originalUploaded?: boolean;
  optimizedUploaded?: boolean;
  verifiedAt?: string | null;
  incrementAttempts?: boolean;
}

function defaultEntry(posterId: string): MigrationStateEntry {
  return {
    posterId,
    state: "PENDING",
    attempts: 0,
    lastError: null,
    updatedAt: new Date().toISOString(),
    sourceSha256: null,
    originalSha256: null,
    optimizedSha256: null,
    originalKey: null,
    optimizedKey: null,
    originalSizeBytes: null,
    optimizedSizeBytes: null,
    originalDimensions: null,
    optimizedDimensions: null,
    originalUploaded: false,
    optimizedUploaded: false,
    verifiedAt: null,
  };
}

export interface VerifiedStateExpectation {
  posterId: string;
  sourceSha256: string | null;
  originalKey: string | null;
  optimizedKey: string | null;
  sourceSizeBytes: number | null;
  sourceDimensions: { width: number; height: number } | null;
}

function isValidIsoDate(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function isPositiveDimensions(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const dimensions = value as { width?: unknown; height?: unknown };
  return (
    typeof dimensions.width === "number" &&
    dimensions.width > 0 &&
    typeof dimensions.height === "number" &&
    dimensions.height > 0
  );
}

export function validateVerifiedStateEntry(
  entry: MigrationStateEntry | undefined,
  expected: VerifiedStateExpectation,
): string[] {
  const errors: string[] = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return ["State entry is missing or not an object"];
  }

  if (entry.posterId !== expected.posterId) {
    errors.push(`posterId mismatch: expected ${expected.posterId}, found ${entry.posterId}`);
  }
  if (entry.state !== "VERIFIED") {
    errors.push(`state is ${entry.state}, not VERIFIED`);
  }
  if (!Number.isInteger(entry.attempts) || entry.attempts < 0) {
    errors.push("attempts must be a non-negative integer");
  }
  if (entry.lastError !== null) {
    errors.push("lastError must be null for a VERIFIED entry");
  }
  if (!isValidIsoDate(entry.updatedAt)) {
    errors.push("updatedAt must be a valid ISO date");
  }
  if (!isValidIsoDate(entry.verifiedAt)) {
    errors.push("verifiedAt must be a valid ISO date");
  }
  if (!isSha256Hex(entry.sourceSha256)) {
    errors.push("sourceSha256 must be a 64-character hex SHA-256");
  }
  if (!isSha256Hex(entry.originalSha256)) {
    errors.push("originalSha256 must be a 64-character hex SHA-256");
  }
  if (!isSha256Hex(entry.optimizedSha256)) {
    errors.push("optimizedSha256 must be a 64-character hex SHA-256");
  }
  if (expected.sourceSha256 && entry.originalSha256 !== expected.sourceSha256) {
    errors.push("originalSha256 does not match the manifest source SHA-256");
  }
  if (expected.sourceSha256 && entry.sourceSha256 !== expected.sourceSha256) {
    errors.push("sourceSha256 does not match the manifest source SHA-256");
  }
  if (entry.originalKey !== expected.originalKey) {
    errors.push("originalKey does not match the manifest original R2 key");
  }
  if (entry.optimizedKey !== expected.optimizedKey) {
    errors.push("optimizedKey does not match the manifest optimized R2 key");
  }
  if (
    expected.sourceSizeBytes !== null &&
    (typeof entry.originalSizeBytes !== "number" ||
      entry.originalSizeBytes !== expected.sourceSizeBytes)
  ) {
    errors.push("originalSizeBytes does not match the manifest source size");
  }
  if (typeof entry.optimizedSizeBytes !== "number" || entry.optimizedSizeBytes <= 0) {
    errors.push("optimizedSizeBytes must be a positive number");
  }
  if (
    expected.sourceDimensions &&
    (!entry.originalDimensions ||
      entry.originalDimensions.width !== expected.sourceDimensions.width ||
      entry.originalDimensions.height !== expected.sourceDimensions.height)
  ) {
    errors.push("originalDimensions does not match the manifest source dimensions");
  }
  if (!isPositiveDimensions(entry.optimizedDimensions)) {
    errors.push("optimizedDimensions must contain positive width and height");
  }
  if (entry.originalUploaded !== true) {
    errors.push("originalUploaded must be true");
  }
  if (entry.optimizedUploaded !== true) {
    errors.push("optimizedUploaded must be true");
  }

  return errors;
}

export class MigrationStateStore {
  private readonly statePath: string;
  private readonly lockPath: string;
  private readonly manifestHash: string;
  private readonly staleLockMs: number;
  private readonly breakLockOnAcquire: boolean;
  private state: MigrationState | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private locked = false;
  private lockToken: string | null = null;

  constructor(options: MigrationStateStoreOptions) {
    this.statePath = options.statePath;
    this.lockPath = options.lockPath ?? `${options.statePath}.lock`;
    this.manifestHash = options.manifestHash;
    this.staleLockMs = options.staleLockMs ?? 6 * 60 * 60 * 1000;
    this.breakLockOnAcquire = options.breakLock ?? false;
  }

  load(): MigrationState {
    if (this.state) return this.state;

    if (!fs.existsSync(this.statePath)) {
      const now = new Date().toISOString();
      this.state = {
        schemaVersion: 1,
        manifestHash: this.manifestHash,
        createdAt: now,
        updatedAt: now,
        entries: {},
      };
      return this.state;
    }

    let parsed: MigrationState;
    try {
      parsed = JSON.parse(fs.readFileSync(this.statePath, "utf8")) as MigrationState;
    } catch (error) {
      throw new MigrationStateError(
        `Unable to parse migration state at ${this.statePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const errors = validateStateDocument(parsed, this.manifestHash);
    if (errors.length > 0) {
      throw new MigrationStateError(
        `Migration state at ${this.statePath} failed validation:\n- ${errors.join("\n- ")}`,
      );
    }

    this.state = parsed;
    return parsed;
  }

  get(posterId: string): MigrationStateEntry | undefined {
    return this.load().entries[posterId];
  }

  ensureEntry(posterId: string): MigrationStateEntry {
    const state = this.load();
    if (!state.entries[posterId]) {
      state.entries[posterId] = defaultEntry(posterId);
    }
    return state.entries[posterId];
  }

  update(posterId: string, patch: StateEntryPatch): MigrationStateEntry {
    const state = this.load();
    const existing = state.entries[posterId];
    const current =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? existing
        : defaultEntry(posterId);
    const next: MigrationStateEntry = {
      ...current,
      ...patch,
      posterId,
      attempts: patch.incrementAttempts ? current.attempts + 1 : current.attempts,
      updatedAt: new Date().toISOString(),
    };
    state.entries[posterId] = next;
    state.updatedAt = next.updatedAt;
    return next;
  }

  async save(): Promise<void> {
    const write = this.saveChain.then(() => this.write());
    // Keep the queue usable after a failed write: the caller still receives the
    // rejection from `write`, while later saves can run once this one settles.
    this.saveChain = write.catch(() => undefined);
    await write;
  }

  private write(): void {
    const state = this.load();
    const payload = `${JSON.stringify(state, null, 2)}\n`;

    // Validate the exact bytes that will replace the live file. A corrupt
    // in-memory document must never destroy the last valid on-disk state.
    let parsed: MigrationState;
    try {
      parsed = JSON.parse(payload) as MigrationState;
    } catch (error) {
      throw new MigrationStateError(
        `Refusing to persist invalid migration state: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const errors = validateStateDocument(parsed, this.manifestHash);
    if (errors.length > 0) {
      throw new MigrationStateError(
        `Refusing to persist invalid migration state:\n- ${errors.join("\n- ")}`,
      );
    }

    const directory = path.dirname(this.statePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = `${this.statePath}.tmp`;
    let fd: number | null = null;
    try {
      fd = fs.openSync(tempPath, "w", 0o600);
      fs.writeFileSync(fd, payload, "utf8");
      // Flush file contents before the rename so a crash cannot leave a
      // renamed but empty/partial state file.
      fs.fsyncSync(fd);
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // The write error, if any, is the meaningful failure.
        }
      }
    }
    fs.renameSync(tempPath, this.statePath);
    // Best-effort directory fsync; platform limitations are documented in
    // migration/README.md and ignored only for unsupported error codes.
    fsyncDirectory(directory);
  }

  acquireLock(): void {
    if (this.locked) return;
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });

    if (this.breakLockOnAcquire && fs.existsSync(this.lockPath)) {
      // Throws unless the lock is provably stale, owned by this host and scoped
      // to this exact state path. A live or unverifiable lock is never removed.
      this.breakLock();
    }

    try {
      const token = crypto.randomUUID();
      const fd = fs.openSync(this.lockPath, "wx");
      fs.writeFileSync(
        fd,
        `${JSON.stringify(
          {
            scope: "state",
            statePath: this.statePath,
            pid: process.pid,
            hostname: os.hostname(),
            startedAt: new Date().toISOString(),
            token,
          },
          null,
          2,
        )}\n`,
      );
      fs.closeSync(fd);
      this.lockToken = token;
      this.locked = true;
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw new MigrationLockError(
          `Unable to acquire migration lock: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    let ageMs = 0;
    try {
      const lock = JSON.parse(fs.readFileSync(this.lockPath, "utf8")) as StateLockRecord;
      const startedAt = lock.startedAt ? Date.parse(lock.startedAt) : NaN;
      if (Number.isFinite(startedAt)) ageMs = Date.now() - startedAt;
    } catch {
      ageMs = 0;
    }

    throw new MigrationLockError(
      `Migration lock already exists at ${this.lockPath}` +
        (ageMs > this.staleLockMs
          ? `. The lock appears stale (${Math.round(ageMs / 1000)}s old). Re-run with --break-lock to recover it after confirming no migration is running, or inspect and remove it manually: rm "${this.lockPath}"`
          : ". Another migration may be running. Do not remove the lock while a migration may be active."),
    );
  }

  /**
   * Explicit, validated recovery for a stale per-state lock. Refuses to remove
   * a live lock, a malformed lock, a lock from another host, or a lock scoped to
   * a different state path.
   */
  breakLock(): void {
    if (!fs.existsSync(this.lockPath)) return;

    let lock: StateLockRecord;
    try {
      lock = JSON.parse(fs.readFileSync(this.lockPath, "utf8")) as StateLockRecord;
    } catch {
      throw new MigrationLockError(
        `Refusing to remove malformed migration lock at ${this.lockPath}. Inspect it and remove it manually only after confirming no migration is running: rm "${this.lockPath}"`,
      );
    }

    if (lock.scope !== "state" || lock.statePath !== this.statePath) {
      throw new MigrationLockError(
        `Refusing to remove lock at ${this.lockPath}: it is not scoped to this state path. Inspect it manually before removal.`,
      );
    }
    if (lock.hostname !== os.hostname()) {
      throw new MigrationLockError(
        `Refusing to remove lock at ${this.lockPath}: it was created on host ${lock.hostname ?? "unknown"}. Confirm no migration is running there, then remove it manually: rm "${this.lockPath}"`,
      );
    }
    if (typeof lock.pid !== "number" || !Number.isInteger(lock.pid) || lock.pid <= 0) {
      throw new MigrationLockError(
        `Refusing to remove lock at ${this.lockPath}: it has no valid PID. Confirm no migration is running, then remove it manually: rm "${this.lockPath}"`,
      );
    }
    if (isProcessAlive(lock.pid)) {
      throw new MigrationLockError(
        `Refusing to remove lock at ${this.lockPath}: process ${lock.pid} is still alive.`,
      );
    }

    const startedAt = lock.startedAt ? Date.parse(lock.startedAt) : NaN;
    const ageMs = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
    if (ageMs <= this.staleLockMs) {
      throw new MigrationLockError(
        `Refusing to remove lock at ${this.lockPath}: it is not stale yet (${Math.round(ageMs / 1000)}s old).`,
      );
    }

    fs.unlinkSync(this.lockPath);
  }

  releaseLock(): void {
    if (!this.locked) return;
    try {
      const lock = JSON.parse(fs.readFileSync(this.lockPath, "utf8")) as StateLockRecord;
      if (
        this.lockToken === null ||
        lock.token !== this.lockToken ||
        lock.pid !== process.pid ||
        lock.hostname !== os.hostname()
      ) {
        throw new MigrationLockError(
          `Refusing to release migration lock at ${this.lockPath}: ownership no longer matches this process. Inspect the lock manually.`,
        );
      }
      fs.unlinkSync(this.lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      if (error instanceof MigrationLockError) throw error;
      throw new MigrationLockError(
        `Unable to release migration lock: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.locked = false;
      this.lockToken = null;
    }
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    this.acquireLock();
    try {
      return await operation();
    } finally {
      this.releaseLock();
    }
  }
}
