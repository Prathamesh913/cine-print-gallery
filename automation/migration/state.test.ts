import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationLockError, MigrationStateStore, validateStateDocument } from "./state";

let tempDir: string;
let statePath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cineprint-state-test-"));
  statePath = path.join(tempDir, "migration-state.json");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeStore(overrides: { breakLock?: boolean } = {}): MigrationStateStore {
  return new MigrationStateStore({
    statePath,
    manifestHash: "test-manifest-hash",
    breakLock: overrides.breakLock,
  });
}

function lockPath(): string {
  return `${statePath}.lock`;
}

function writeLock(record: Record<string, unknown>): void {
  fs.writeFileSync(lockPath(), JSON.stringify(record, null, 2), "utf8");
}

describe("F13 — recoverable state-save queue", () => {
  it("rejects the failed caller and allows a later save to succeed", async () => {
    const store = makeStore();
    store.update("poster-1", { state: "SOURCE_VERIFIED" });

    // A directory at the temp path forces the atomic write to fail.
    fs.mkdirSync(`${statePath}.tmp`);

    await expect(store.save()).rejects.toThrow();
    expect(fs.existsSync(statePath)).toBe(false);

    store.update("poster-1", { state: "VERIFIED" });
    fs.rmdirSync(`${statePath}.tmp`);

    await expect(store.save()).resolves.toBeUndefined();
  });

  it("writes the latest state after recovering from a failed save", async () => {
    const store = makeStore();
    store.update("poster-1", { state: "SOURCE_VERIFIED" });
    fs.mkdirSync(`${statePath}.tmp`);

    await expect(store.save()).rejects.toThrow();

    store.update("poster-1", { state: "VERIFIED", optimizedSha256: "a".repeat(64) });
    fs.rmdirSync(`${statePath}.tmp`);
    await store.save();

    const reloaded = new MigrationStateStore({
      statePath,
      manifestHash: "test-manifest-hash",
    });
    const entry = reloaded.get("poster-1");
    expect(entry?.state).toBe("VERIFIED");
    expect(entry?.optimizedSha256).toBe("a".repeat(64));
  });

  it("serializes concurrent saves in call order", async () => {
    const store = makeStore();
    const order: number[] = [];
    let counter = 0;

    // Replace the private write step with an order recorder.
    (store as unknown as { write: () => void }).write = () => {
      counter += 1;
      order.push(counter);
    };

    await Promise.all([store.save(), store.save(), store.save()]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("does not permanently poison the queue after a rejection", async () => {
    const store = makeStore();
    store.update("poster-1", { state: "SOURCE_VERIFIED" });
    fs.mkdirSync(`${statePath}.tmp`);

    await expect(store.save()).rejects.toThrow();

    // Without removing the failure cause, the next save must still be attempted
    // and must reject on its own rather than short-circuiting.
    await expect(store.save()).rejects.toThrow();

    fs.rmdirSync(`${statePath}.tmp`);
    await expect(store.save()).resolves.toBeUndefined();
  });
});

describe("F12 — per-state lock recovery", () => {
  it("blocks a second store while the lock is held", () => {
    const first = makeStore();
    const second = makeStore();
    first.acquireLock();
    try {
      expect(() => second.acquireLock()).toThrow(MigrationLockError);
      expect(fs.existsSync(lockPath())).toBe(true);
    } finally {
      first.releaseLock();
    }
  });

  it("refuses to break a live lock", () => {
    const holder = makeStore();
    holder.acquireLock();
    try {
      const recovery = makeStore({ breakLock: true });
      expect(() => recovery.acquireLock()).toThrow(/still alive/);
      expect(fs.existsSync(lockPath())).toBe(true);
    } finally {
      holder.releaseLock();
    }
  });

  it("recovers a stale lock with a dead PID when explicitly requested", () => {
    writeLock({
      scope: "state",
      statePath,
      pid: 999999,
      hostname: os.hostname(),
      startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const store = makeStore({ breakLock: true });
    store.acquireLock();
    expect(fs.existsSync(lockPath())).toBe(true);
    store.releaseLock();
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it("does not remove a stale lock without explicit recovery", () => {
    writeLock({
      scope: "state",
      statePath,
      pid: 999999,
      hostname: os.hostname(),
      startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const store = makeStore();
    expect(() => store.acquireLock()).toThrow(/--break-lock/);
    expect(fs.existsSync(lockPath())).toBe(true);
  });

  it("refuses to break a lock with no PID", () => {
    writeLock({
      scope: "state",
      statePath,
      hostname: os.hostname(),
      startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const store = makeStore({ breakLock: true });
    expect(() => store.acquireLock()).toThrow(/no valid PID/);
    expect(fs.existsSync(lockPath())).toBe(true);
  });

  it("refuses to break a malformed lock", () => {
    fs.writeFileSync(lockPath(), "not-json", "utf8");

    const store = makeStore({ breakLock: true });
    expect(() => store.acquireLock()).toThrow(/malformed/);
    expect(fs.existsSync(lockPath())).toBe(true);
  });

  it("refuses to break a lock scoped to a different state path", () => {
    writeLock({
      scope: "state",
      statePath: path.join(tempDir, "other-state.json"),
      pid: 999999,
      hostname: os.hostname(),
      startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const store = makeStore({ breakLock: true });
    expect(() => store.acquireLock()).toThrow(/not scoped/);
    expect(fs.existsSync(lockPath())).toBe(true);
  });
});

describe("F16 — durable state persistence", () => {
  it("writes a validated state file with restrictive permissions and no temp file", async () => {
    const store = makeStore();
    store.update("poster-1", { state: "SOURCE_VERIFIED" });
    await store.save();

    expect(fs.existsSync(`${statePath}.tmp`)).toBe(false);
    const mode = fs.statSync(statePath).mode & 0o777;
    expect(mode).toBe(0o600);
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(parsed.entries["poster-1"].state).toBe("SOURCE_VERIFIED");
  });

  it("ignores a leftover temp file from an interrupted write", async () => {
    const store = makeStore();
    store.update("poster-1", { state: "VERIFIED", optimizedSha256: "a".repeat(64) });
    await store.save();

    fs.writeFileSync(`${statePath}.tmp`, "{ this is a partial write", "utf8");

    const reloaded = new MigrationStateStore({
      statePath,
      manifestHash: "test-manifest-hash",
    });
    expect(reloaded.get("poster-1")?.state).toBe("VERIFIED");

    store.update("poster-1", { state: "FAILED" });
    await expect(store.save()).resolves.toBeUndefined();
    expect(fs.existsSync(`${statePath}.tmp`)).toBe(false);
  });

  it("refuses to replace the last valid state with an invalid document", async () => {
    const store = makeStore();
    store.update("poster-1", { state: "VERIFIED" });
    await store.save();
    const before = fs.readFileSync(statePath, "utf8");

    const state = store.load();
    (state as unknown as { schemaVersion: number }).schemaVersion = 2;

    await expect(store.save()).rejects.toThrow(/Refusing to persist invalid migration state/);
    expect(fs.readFileSync(statePath, "utf8")).toBe(before);
  });

  it("validates a state document before it can be persisted", () => {
    const valid = {
      schemaVersion: 1,
      manifestHash: "test-manifest-hash",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      entries: {},
    };
    expect(validateStateDocument(valid, "test-manifest-hash")).toEqual([]);
    expect(
      validateStateDocument({ ...valid, schemaVersion: 2 }, "test-manifest-hash"),
    ).toHaveLength(1);
    expect(validateStateDocument(valid, "other-manifest")).toEqual([
      expect.stringMatching(/different manifest/),
    ]);
    expect(
      validateStateDocument(
        {
          ...valid,
          entries: {
            "poster-1": {
              posterId: "poster-1",
              state: "NOT_A_STATE",
              attempts: 0,
              lastError: null,
              updatedAt: new Date().toISOString(),
            },
          },
        },
        "test-manifest-hash",
      ),
    ).toEqual([expect.stringMatching(/unknown state/)]);
  });
});

describe("F16 — lock ownership", () => {
  it("refuses to release a lock whose token was replaced", () => {
    const store = makeStore();
    store.acquireLock();
    const record = JSON.parse(fs.readFileSync(lockPath(), "utf8"));
    fs.writeFileSync(lockPath(), JSON.stringify({ ...record, token: "someone-else" }), "utf8");

    expect(() => store.releaseLock()).toThrow(/ownership no longer matches/);
    expect(fs.existsSync(lockPath())).toBe(true);
  });
});
