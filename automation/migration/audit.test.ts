import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuditCorruptionError,
  AuditLockError,
  AuditLog,
  AuditSequenceError,
  AuditWriteError,
} from "./audit";
import { createEvent, type EventDraft } from "./events";

let tempDir: string;
let auditPath: string;
const RUN = "run-audit-test-1";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cineprint-audit-"));
  auditPath = path.join(tempDir, "run.jsonl");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function draft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    runId: RUN,
    type: "poster.started",
    outcome: "started",
    evidence: "mock",
    posterId: "bugonia",
    ...overrides,
  };
}

function appendLine(file: string, line: string): void {
  fs.appendFileSync(file, `${line}\n`, "utf8");
}

describe("F21 — append-only audit trail", () => {
  it("appends monotonic sequence numbers and reads them back", () => {
    const log = AuditLog.open({ path: auditPath, runId: RUN });
    const first = log.append(draft());
    const second = log.append(draft({ type: "poster.verified", outcome: "verified" }));
    log.close();

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    const reopened = AuditLog.open({ path: auditPath, runId: RUN });
    const result = reopened.readAll();
    expect(result.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(result.issues).toEqual([]);
    reopened.close();
  });

  it("never rewrites earlier bytes", () => {
    const log = AuditLog.open({ path: auditPath, runId: RUN });
    log.append(draft());
    const prefix = fs.readFileSync(auditPath);
    log.append(draft({ type: "poster.verified", outcome: "verified" }));
    log.close();
    const after = fs.readFileSync(auditPath);
    expect(after.subarray(0, prefix.length)).toEqual(prefix);
  });

  it("retains the run ID and sequence across a resume", () => {
    const first = AuditLog.open({ path: auditPath, runId: RUN });
    first.append(draft());
    first.close();

    const resumed = AuditLog.open({ path: auditPath, runId: RUN });
    expect(resumed.nextSequence).toBe(2);
    const second = resumed.append(draft({ type: "operator.resume", outcome: "resumed" }));
    expect(second.sequence).toBe(2);
    expect(second.runId).toBe(RUN);
    resumed.close();
  });

  it("rejects a different run ID on resume", () => {
    const first = AuditLog.open({ path: auditPath, runId: RUN });
    first.append(draft());
    first.close();
    expect(() => AuditLog.open({ path: auditPath, runId: "another-run" })).toThrow(
      AuditCorruptionError,
    );
  });

  it("recovers a partial final line without discarding it", () => {
    const valid = createEvent({ ...draft(), sequence: 1 });
    appendLine(auditPath, JSON.stringify(valid));
    fs.appendFileSync(auditPath, '{"schemaVersion":1,', "utf8");

    const log = AuditLog.open({ path: auditPath, runId: RUN });
    expect(log.recovery.partialFinalLine).toBe(true);
    expect(log.recovery.issues.some((issue) => issue.kind === "partial_final_line")).toBe(true);
    expect(log.nextSequence).toBe(2);
    log.append(draft({ type: "operator.resume", outcome: "resumed" }));
    log.close();

    const reopened = AuditLog.open({ path: auditPath, runId: RUN });
    const result = reopened.readAll();
    expect(result.events).toHaveLength(2);
    expect(result.partialFinalLine).toBe(true);
    expect(result.issues.some((issue) => issue.kind === "partial_final_line")).toBe(true);
    reopened.close();
  });

  it("fails closed on a malformed complete line", () => {
    fs.writeFileSync(auditPath, "not-json\n", "utf8");
    expect(() => AuditLog.open({ path: auditPath, runId: RUN })).toThrow(AuditCorruptionError);
  });

  it("fails closed on duplicate and out-of-order sequences", () => {
    const first = createEvent({ ...draft(), sequence: 1 });
    appendLine(auditPath, JSON.stringify(first));
    appendLine(auditPath, JSON.stringify(first));
    expect(() => AuditLog.open({ path: auditPath, runId: RUN })).toThrow(AuditCorruptionError);

    fs.writeFileSync(auditPath, "", "utf8");
    const second = createEvent({ ...draft(), sequence: 2 });
    const one = createEvent({ ...draft(), sequence: 1 });
    appendLine(auditPath, JSON.stringify(second));
    appendLine(auditPath, JSON.stringify(one));
    expect(() => AuditLog.open({ path: auditPath, runId: RUN })).toThrow(AuditCorruptionError);
  });

  it("rejects a caller-supplied non-deterministic event ID", () => {
    const log = AuditLog.open({ path: auditPath, runId: RUN });
    expect(() => log.append(draft({ eventId: "evt-fixed-id" }))).toThrow(AuditSequenceError);
    log.close();
  });

  it("rejects duplicate event IDs during recovery", () => {
    const first = createEvent({ ...draft(), sequence: 1, eventId: "evt-duplicate" });
    const second = createEvent({ ...draft(), sequence: 2, eventId: "evt-duplicate" });
    appendLine(auditPath, JSON.stringify(first));
    appendLine(auditPath, JSON.stringify(second));
    expect(() => AuditLog.open({ path: auditPath, runId: RUN })).toThrow(AuditCorruptionError);
  });

  it("rejects an append with the wrong explicit sequence", () => {
    const log = AuditLog.open({ path: auditPath, runId: RUN });
    expect(() => log.append(draft({ sequence: 2 }))).toThrow(AuditSequenceError);
    log.close();
  });

  it("does not advance the sequence when an invalid event is rejected", () => {
    const log = AuditLog.open({ path: auditPath, runId: RUN });
    expect(() => log.append(draft({ metadata: { bad: Buffer.from("x") } }))).toThrow();
    expect(log.nextSequence).toBe(1);
    const event = log.append(draft());
    expect(event.sequence).toBe(1);
    log.close();
  });

  it("prevents concurrent append via an ownership lock", () => {
    const first = AuditLog.open({ path: auditPath, runId: RUN });
    expect(() => AuditLog.open({ path: auditPath, runId: RUN })).toThrow(AuditLockError);
    first.close();
    const second = AuditLog.open({ path: auditPath, runId: RUN });
    second.close();
  });

  it("recovers a provably stale audit lock only with explicit breakLock", () => {
    fs.writeFileSync(
      `${auditPath}.lock`,
      JSON.stringify({
        scope: "audit",
        path: auditPath,
        pid: 999999,
        hostname: os.hostname(),
        startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        runId: RUN,
        token: "stale",
      }),
      "utf8",
    );
    expect(() => AuditLog.open({ path: auditPath, runId: RUN })).toThrow(AuditLockError);
    const log = AuditLog.open({ path: auditPath, runId: RUN, breakLock: true });
    log.close();
  });

  it("fsyncs at checkpoints", () => {
    const spy = vi.spyOn(fs, "fsyncSync");
    const log = AuditLog.open({ path: auditPath, runId: RUN });
    log.append(draft());
    log.checkpoint();
    expect(spy).toHaveBeenCalled();
    log.close();
  });

  it("propagates write failures instead of silently dropping evidence", () => {
    const log = AuditLog.open({ path: auditPath, runId: RUN });
    vi.spyOn(fs, "writeSync").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => log.append(draft())).toThrow(AuditWriteError);
    expect(log.nextSequence).toBe(1);
    log.close();
  });

  it("keeps audit records free of secrets and binary payloads", () => {
    const log = AuditLog.open({ path: auditPath, runId: RUN });
    log.append(
      draft({
        message: "Authorization: Bearer secret-token",
        metadata: { url: "https://example.com/x?token=secret" },
      }),
    );
    log.close();
    const content = fs.readFileSync(auditPath, "utf8");
    expect(content).not.toContain("secret-token");
    expect(content).not.toContain("token=secret");
  });
});
