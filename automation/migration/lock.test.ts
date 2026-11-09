import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultGlobalLockPath,
  MigrationGlobalLock,
  MigrationGlobalLockError,
  withGlobalMigrationLock,
} from "./lock";

let tempDir: string;
let lockPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cineprint-lock-test-"));
  lockPath = path.join(tempDir, "global.lock");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("F8 — migration-wide lock", () => {
  it("uses the same lock path for the same bucket regardless of state path", () => {
    expect(defaultGlobalLockPath("cineprint-posters")).toBe(
      defaultGlobalLockPath("cineprint-posters"),
    );
    expect(defaultGlobalLockPath("cineprint-posters")).not.toBe(
      defaultGlobalLockPath("another-bucket"),
    );
  });

  it("prevents two processes with different state paths from acquiring the same namespace lock", () => {
    const first = new MigrationGlobalLock({ lockPath });
    const second = new MigrationGlobalLock({ lockPath });
    first.acquire();
    try {
      expect(() => second.acquire()).toThrow(MigrationGlobalLockError);
    } finally {
      first.release();
    }
  });

  it("does not call the operation when lock acquisition fails", async () => {
    const holder = new MigrationGlobalLock({ lockPath });
    holder.acquire();
    let calls = 0;
    try {
      await expect(
        withGlobalMigrationLock({ bucket: "cineprint-posters", lockPath }, async () => {
          calls += 1;
        }),
      ).rejects.toBeInstanceOf(MigrationGlobalLockError);
    } finally {
      holder.release();
    }
    expect(calls).toBe(0);
  });

  it("handles a stale lock safely and requires explicit recovery", () => {
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        scope: "global",
        lockPath,
        pid: 999999,
        startedAt: old,
        hostname: os.hostname(),
      }),
      "utf8",
    );

    const lock = new MigrationGlobalLock({ lockPath });
    expect(() => lock.acquire()).toThrow(/stale/);
    // PID is unavailable, but the lock is not automatically removed.
    expect(fs.existsSync(lockPath)).toBe(true);

    lock.breakLock();
    expect(fs.existsSync(lockPath)).toBe(false);
    lock.acquire();
    lock.release();
  });

  it("does not remove a lock solely because its PID is unavailable", () => {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }),
      "utf8",
    );
    const lock = new MigrationGlobalLock({ lockPath });
    expect(() => lock.acquire()).toThrow(MigrationGlobalLockError);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("refuses to break a live lock", () => {
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        scope: "global",
        lockPath,
        pid: process.pid,
        startedAt: old,
        hostname: os.hostname(),
      }),
      "utf8",
    );
    const lock = new MigrationGlobalLock({ lockPath });
    expect(() => lock.breakLock()).toThrow(/still alive/);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("refuses to break a malformed lock", () => {
    fs.writeFileSync(lockPath, "not-json", "utf8");
    const lock = new MigrationGlobalLock({ lockPath });
    expect(() => lock.breakLock()).toThrow(/malformed/);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("refuses to break a lock scoped to another namespace", () => {
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        scope: "state",
        lockPath,
        pid: 999999,
        startedAt: old,
        hostname: os.hostname(),
      }),
      "utf8",
    );
    const lock = new MigrationGlobalLock({ lockPath });
    expect(() => lock.breakLock()).toThrow(/not scoped/);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("refuses to break a lock that is not stale yet", () => {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        scope: "global",
        lockPath,
        pid: 999999,
        startedAt: new Date().toISOString(),
        hostname: os.hostname(),
      }),
      "utf8",
    );
    const lock = new MigrationGlobalLock({ lockPath });
    expect(() => lock.breakLock()).toThrow(/not stale/);
    expect(fs.existsSync(lockPath)).toBe(true);
  });
});

describe("F16 — global lock ownership and settlement", () => {
  it("refuses to release a lock whose ownership token changed", () => {
    const lock = new MigrationGlobalLock({ lockPath });
    lock.acquire();
    const record = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    fs.writeFileSync(lockPath, JSON.stringify({ ...record, token: "other" }), "utf8");

    expect(() => lock.release()).toThrow(/ownership no longer matches/);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("keeps the lock held until the operation settles, then releases it", async () => {
    let settled = false;
    await withGlobalMigrationLock({ bucket: "cineprint-posters", lockPath }, async () => {
      expect(fs.existsSync(lockPath)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 25));
      settled = true;
    });
    expect(settled).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("releases the lock even when the operation throws", async () => {
    await expect(
      withGlobalMigrationLock({ bucket: "cineprint-posters", lockPath }, async () => {
        throw new Error("worker failed");
      }),
    ).rejects.toThrow("worker failed");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("rejects a competing worker without running its operation", async () => {
    const holder = new MigrationGlobalLock({ lockPath });
    holder.acquire();
    let ran = false;
    try {
      await expect(
        withGlobalMigrationLock({ bucket: "cineprint-posters", lockPath }, async () => {
          ran = true;
        }),
      ).rejects.toBeInstanceOf(MigrationGlobalLockError);
    } finally {
      holder.release();
    }
    expect(ran).toBe(false);
  });
});
