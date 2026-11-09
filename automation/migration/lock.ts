import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class MigrationGlobalLockError extends Error {}

export interface GlobalLockOptions {
  lockPath: string;
  staleLockMs?: number;
}

export function defaultGlobalLockPath(
  bucket: string,
  namespace = "cineprint-r2-migration",
): string {
  const safeBucket = bucket.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(os.tmpdir(), `${namespace}-${safeBucket}.lock`);
}

interface GlobalLockRecord {
  scope?: string;
  lockPath?: string;
  pid?: number;
  hostname?: string;
  startedAt?: string;
  token?: string;
}

/**
 * Locking abstraction. The current implementation is host-local and relies on
 * atomic `open(..., "wx")` plus a random ownership token. A future execution
 * environment can implement the same interface with an R2 conditional object or
 * another quorum-safe primitive without changing engine call sites.
 */
export interface MigrationLockBackend {
  acquire(): void;
  release(): void;
  breakLock(): void;
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

export class MigrationGlobalLock implements MigrationLockBackend {
  private readonly lockPath: string;
  private readonly staleLockMs: number;
  private locked = false;
  private lockToken: string | null = null;

  constructor(options: GlobalLockOptions) {
    this.lockPath = options.lockPath;
    this.staleLockMs = options.staleLockMs ?? 6 * 60 * 60 * 1000;
  }

  acquire(): void {
    if (this.locked) return;
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });

    try {
      const token = crypto.randomUUID();
      const fd = fs.openSync(this.lockPath, "wx");
      fs.writeFileSync(
        fd,
        `${JSON.stringify(
          {
            scope: "global",
            pid: process.pid,
            hostname: os.hostname(),
            startedAt: new Date().toISOString(),
            lockPath: this.lockPath,
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
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new MigrationGlobalLockError(
          `Unable to acquire global migration lock: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    let ageMs = 0;
    try {
      const lock = JSON.parse(fs.readFileSync(this.lockPath, "utf8")) as {
        startedAt?: string;
      };
      const startedAt = lock.startedAt ? Date.parse(lock.startedAt) : NaN;
      if (Number.isFinite(startedAt)) ageMs = Date.now() - startedAt;
    } catch {
      ageMs = 0;
    }

    throw new MigrationGlobalLockError(
      `Global migration lock already exists at ${this.lockPath}` +
        (ageMs > this.staleLockMs
          ? `. The lock appears stale (${Math.round(ageMs / 1000)}s old). Do not remove it based on PID alone; use the explicit --break-lock flag only after confirming no migration is running.`
          : ". Another migration may be running."),
    );
  }

  release(): void {
    if (!this.locked) return;
    try {
      const lock = JSON.parse(fs.readFileSync(this.lockPath, "utf8")) as GlobalLockRecord;
      if (
        this.lockToken === null ||
        lock.token !== this.lockToken ||
        lock.pid !== process.pid ||
        lock.hostname !== os.hostname()
      ) {
        throw new MigrationGlobalLockError(
          `Refusing to release global migration lock at ${this.lockPath}: ownership no longer matches this process. Inspect the lock manually.`,
        );
      }
      fs.unlinkSync(this.lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      if (error instanceof MigrationGlobalLockError) throw error;
      throw new MigrationGlobalLockError(
        `Unable to release global migration lock: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.locked = false;
      this.lockToken = null;
    }
  }

  breakLock(): void {
    if (!fs.existsSync(this.lockPath)) return;

    let lock: GlobalLockRecord;
    try {
      lock = JSON.parse(fs.readFileSync(this.lockPath, "utf8")) as GlobalLockRecord;
    } catch {
      throw new MigrationGlobalLockError(
        `Refusing to remove malformed global migration lock at ${this.lockPath}. Inspect it and remove it manually only after confirming no migration is running: rm "${this.lockPath}"`,
      );
    }

    if (lock.scope !== "global" || lock.lockPath !== this.lockPath) {
      throw new MigrationGlobalLockError(
        `Refusing to remove lock at ${this.lockPath}: it is not scoped to this migration namespace. Inspect it manually before removal.`,
      );
    }
    if (lock.hostname !== os.hostname()) {
      throw new MigrationGlobalLockError(
        `Refusing to remove lock at ${this.lockPath}: it was created on host ${lock.hostname ?? "unknown"}. Confirm no migration is running there, then remove it manually: rm "${this.lockPath}"`,
      );
    }
    if (typeof lock.pid !== "number" || !Number.isInteger(lock.pid) || lock.pid <= 0) {
      throw new MigrationGlobalLockError(
        `Refusing to remove lock at ${this.lockPath}: it has no valid PID. Confirm no migration is running, then remove it manually: rm "${this.lockPath}"`,
      );
    }
    if (isProcessAlive(lock.pid)) {
      throw new MigrationGlobalLockError(
        `Refusing to remove lock at ${this.lockPath}: process ${lock.pid} is still alive.`,
      );
    }

    const startedAt = lock.startedAt ? Date.parse(lock.startedAt) : NaN;
    const ageMs = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
    if (ageMs <= this.staleLockMs) {
      throw new MigrationGlobalLockError(
        `Refusing to remove lock at ${this.lockPath}: it is not stale yet (${Math.round(ageMs / 1000)}s old).`,
      );
    }

    fs.unlinkSync(this.lockPath);
  }
}

export async function withGlobalMigrationLock<T>(
  options: {
    bucket: string;
    namespace?: string;
    lockPath?: string;
    breakLock?: boolean;
    staleLockMs?: number;
  },
  operation: () => Promise<T>,
): Promise<T> {
  const lock = new MigrationGlobalLock({
    lockPath: options.lockPath ?? defaultGlobalLockPath(options.bucket, options.namespace),
    staleLockMs: options.staleLockMs,
  });

  if (options.breakLock) lock.breakLock();
  lock.acquire();
  try {
    return await operation();
  } finally {
    lock.release();
  }
}
