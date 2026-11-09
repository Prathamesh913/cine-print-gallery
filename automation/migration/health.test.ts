import { describe, expect, it } from "vitest";
import { createEvent, type EventDraft, type MigrationEvent } from "./events";
import {
  BatchPauseController,
  BatchPausedError,
  BatchStoppedError,
  DEFAULT_THRESHOLDS,
  computeRunSummary,
  evaluateThresholds,
} from "./health";
import type { MigrationResult, MigrationStateEntry } from "./types";

const RUN = "run-health-test";
const BATCH = "batch-1";

function event(overrides: Partial<EventDraft> = {}): MigrationEvent {
  return createEvent({
    runId: RUN,
    batchId: BATCH,
    type: "source.download.started",
    outcome: "started",
    evidence: "mock",
    ...overrides,
  });
}

function result(posterId: string, state: MigrationResult["state"]): MigrationResult {
  return { posterId, state, message: state };
}

function stateEntry(posterId: string, overrides: Partial<MigrationStateEntry> = {}) {
  return {
    posterId,
    state: "PENDING" as const,
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
    ...overrides,
  };
}

describe("F23 — batch health summary", () => {
  it("counts posters and objects consistently with results and state", () => {
    const summary = computeRunSummary({
      runId: RUN,
      batchId: BATCH,
      evidence: "mock",
      plannedPosterIds: ["a", "b", "c"],
      results: [result("a", "VERIFIED"), result("b", "FAILED")],
      stateEntries: {
        a: stateEntry("a", {
          state: "VERIFIED",
          attempts: 1,
          originalUploaded: true,
          optimizedUploaded: true,
        }),
        b: stateEntry("b", { state: "FAILED", attempts: 1 }),
        c: stateEntry("c", { state: "PENDING", attempts: 0 }),
      },
      events: [
        event({ type: "source.download.completed", outcome: "completed", bytes: 1000 }),
        event({ type: "r2.upload.completed", outcome: "completed", bytes: 800 }),
        event({
          type: "poster.failed",
          outcome: "failed",
          failureCategory: "SOURCE_PERMANENT",
        }),
      ],
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      completedAt: new Date().toISOString(),
    });
    expect(summary.plannedPosters).toBe(3);
    expect(summary.startedPosters).toBe(2);
    expect(summary.verifiedPosters).toBe(1);
    expect(summary.failedPosters).toBe(1);
    expect(summary.pendingPosters).toBe(1);
    expect(summary.plannedObjects).toBe(6);
    expect(summary.verifiedObjects).toBe(2);
    expect(summary.sourceBytesRead).toBe(1000);
    expect(summary.uploadedBytes).toBe(800);
    expect(summary.retryCount).toBe(0);
    expect(summary.complete).toBe(false);
    expect(summary.liveSuccess).toBe(false);
    expect(summary.blockingReasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/failed/), expect.stringMatching(/pending/)]),
    );
  });

  it("never reports completion when a selected poster is skipped", () => {
    const summary = computeRunSummary({
      runId: RUN,
      evidence: "live_migration",
      plannedPosterIds: ["a", "b"],
      results: [result("a", "VERIFIED"), result("b", "SOURCE_UNAVAILABLE")],
      stateEntries: {
        a: stateEntry("a", {
          state: "VERIFIED",
          originalUploaded: true,
          optimizedUploaded: true,
        }),
      },
    });
    expect(summary.complete).toBe(false);
    expect(summary.partialSuccess).toBe(true);
    expect(summary.liveSuccess).toBe(false);
    expect(summary.blockingReasons.join(" ")).toMatch(/skipped/);
  });

  it("does not count an upload acknowledgement as verification", () => {
    const summary = computeRunSummary({
      runId: RUN,
      evidence: "live_migration",
      plannedPosterIds: ["a"],
      results: [result("a", "ORIGINAL_UPLOADED")],
      stateEntries: {
        a: stateEntry("a", {
          state: "ORIGINAL_UPLOADED",
          originalUploaded: true,
        }),
      },
      events: [
        event({
          type: "r2.upload.completed",
          outcome: "completed",
          posterId: "a",
          variant: "original",
          metadata: { key: "object-a-original" },
        }),
      ],
    });
    expect(summary.uploadedObjects).toBe(1);
    expect(summary.verifiedObjects).toBe(0);
    expect(summary.complete).toBe(false);
    expect(summary.liveSuccess).toBe(false);
  });

  it("counts a repeated object key only once", () => {
    const summary = computeRunSummary({
      runId: RUN,
      evidence: "live_migration",
      plannedPosterIds: ["a"],
      events: [
        event({
          type: "r2.upload.completed",
          outcome: "completed",
          posterId: "a",
          variant: "original",
          metadata: { key: "object-a-original" },
        }),
        event({
          type: "r2.upload.completed",
          outcome: "completed",
          posterId: "a",
          variant: "original",
          metadata: { key: "object-a-original" },
        }),
      ],
    });
    expect(summary.uploadedObjects).toBe(1);
    expect(summary.attemptedObjects).toBe(0);
  });

  it("never reports a local plan or mock run as live success", () => {
    for (const evidence of ["local_plan", "mock", "live_preflight"] as const) {
      const summary = computeRunSummary({
        runId: RUN,
        evidence,
        plannedPosterIds: ["a"],
        results: [result("a", "VERIFIED")],
        stateEntries: {
          a: stateEntry("a", {
            state: "VERIFIED",
            originalUploaded: true,
            optimizedUploaded: true,
          }),
        },
      });
      expect(summary.complete).toBe(true);
      expect(summary.liveSuccess).toBe(false);
    }
  });

  it("reports live success only for a complete live migration with no blockers", () => {
    const summary = computeRunSummary({
      runId: RUN,
      evidence: "live_migration",
      plannedPosterIds: ["a"],
      results: [result("a", "VERIFIED")],
      stateEntries: {
        a: stateEntry("a", {
          state: "VERIFIED",
          originalUploaded: true,
          optimizedUploaded: true,
        }),
      },
    });
    expect(summary.complete).toBe(true);
    expect(summary.liveSuccess).toBe(true);
    expect(summary.resumeSafe).toBe(true);
  });

  it("allows resume of a healthy partial run but not completion", () => {
    const summary = computeRunSummary({
      runId: RUN,
      evidence: "live_migration",
      plannedPosterIds: ["a", "b"],
      results: [result("a", "VERIFIED")],
      stateEntries: {
        a: stateEntry("a", {
          state: "VERIFIED",
          originalUploaded: true,
          optimizedUploaded: true,
        }),
      },
    });
    expect(summary.resumeSafe).toBe(true);
    expect(summary.complete).toBe(false);
    expect(summary.liveSuccess).toBe(false);
    expect(summary.blockingReasons.join(" ")).toMatch(/pending/);
  });

  it("surfaces hard-stop failures and audit issues as blocking reasons", () => {
    const summary = computeRunSummary({
      runId: RUN,
      evidence: "live_migration",
      plannedPosterIds: ["a"],
      results: [result("a", "CONFLICT")],
      events: [
        event({
          type: "r2.upload.conflicted",
          outcome: "conflicted",
          failureCategory: "R2_CONFLICT",
        }),
      ],
      auditHealthy: false,
      auditIssues: 2,
    });
    expect(summary.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/R2_CONFLICT/),
        expect.stringMatching(/Audit history is unhealthy/),
      ]),
    );
    expect(summary.resumeSafe).toBe(false);
    expect(summary.liveSuccess).toBe(false);
  });
});

describe("F23 — thresholds and pause policy", () => {
  function startedOnly(attempts: number, failures: number): MigrationEvent[] {
    return [
      ...Array.from({ length: attempts }, (_, index) =>
        event({ type: "source.download.started", outcome: "started", posterId: `p-${index}` }),
      ),
      ...Array.from({ length: failures }, (_, index) =>
        event({
          type: "source.download.failed",
          outcome: "failed",
          posterId: `f-${index}`,
          failureCategory: "SOURCE_TRANSIENT",
        }),
      ),
    ];
  }

  function sourceOutcomes(
    successes: number,
    failures: number,
    failureCategory: "SOURCE_TRANSIENT" | "SOURCE_PERMANENT" = "SOURCE_TRANSIENT",
  ): MigrationEvent[] {
    return [
      ...Array.from({ length: successes }, (_, index) =>
        event({
          type: "source.download.completed",
          outcome: "completed",
          posterId: `ok-${index}`,
          httpStatus: 200,
        }),
      ),
      ...Array.from({ length: failures }, (_, index) =>
        event({
          type: "source.download.failed",
          outcome: "failed",
          posterId: `bad-${index}`,
          failureCategory,
        }),
      ),
    ];
  }

  it("does not count started-but-unfinished operations in the denominator", () => {
    const decision = evaluateThresholds(startedOnly(100, 6));
    expect(decision.metrics.sourceAttempts).toBe(6);
    expect(decision.insufficientSamples.join(" ")).toMatch(/below the 20 minimum/);
    expect(decision.decision).toBe("continue");
  });

  it("pauses when the source failure rate exceeds 5% with enough completed samples", () => {
    const decision = evaluateThresholds(sourceOutcomes(100, 6));
    expect(decision.decision).toBe("pause");
    expect(decision.metrics.sourceAttempts).toBe(106);
    expect(decision.metrics.sourceFailureRate).toBeCloseTo(6 / 106);
    expect(decision.reasons.join(" ")).toMatch(/source failure rate/);
  });

  it("does not pause on unstable percentages for a small sample", () => {
    const decision = evaluateThresholds(sourceOutcomes(10, 2));
    expect(decision.decision).toBe("continue");
    expect(decision.insufficientSamples.join(" ")).toMatch(/below the 20 minimum/);
  });

  it("pauses on the R2 upload and CDN thresholds using completed outcomes", () => {
    const uploads = [
      ...Array.from({ length: 100 }, (_, index) =>
        event({
          type: "r2.upload.completed",
          outcome: "completed",
          posterId: `p-${index}`,
          variant: "original",
        }),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        event({
          type: "r2.upload.conflicted",
          outcome: "conflicted",
          posterId: `f-${index}`,
          variant: "original",
        }),
      ),
    ];
    expect(evaluateThresholds(uploads).decision).toBe("pause");

    const cdn = [
      ...Array.from({ length: 100 }, (_, index) =>
        event({
          type: "cdn.verification.completed",
          outcome: "completed",
          posterId: `p-${index}`,
          variant: "optimized",
        }),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        event({
          type: "cdn.verification.completed",
          outcome: "failed",
          posterId: `f-${index}`,
          variant: "optimized",
          failureCategory: "CDN_VERIFICATION_FAILED",
        }),
      ),
    ];
    expect(evaluateThresholds(cdn).decision).toBe("pause");
  });

  it("keeps upload and CDN outcomes separate for the same object key", () => {
    const decision = evaluateThresholds([
      event({
        type: "r2.upload.completed",
        outcome: "completed",
        posterId: "a",
        variant: "original",
        metadata: { key: "shared-key" },
      }),
      event({
        type: "cdn.verification.completed",
        outcome: "completed",
        posterId: "a",
        variant: "original",
        metadata: { key: "shared-key" },
      }),
    ]);
    expect(decision.metrics.uploadAttempts).toBe(1);
    expect(decision.metrics.cdnAttempts).toBe(1);
  });

  it("pauses on a high source 429 rate and recommends reducing concurrency", () => {
    const events = [
      ...Array.from({ length: 100 }, (_, index) =>
        event({
          type: "source.download.completed",
          outcome: "completed",
          posterId: `ok-${index}`,
          httpStatus: 200,
        }),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        event({
          type: "source.download.completed",
          outcome: "completed",
          posterId: `limited-${index}`,
          httpStatus: 429,
        }),
      ),
    ];
    const decision = evaluateThresholds(events);
    expect(decision.decision).toBe("pause");
    expect(decision.metrics.http429).toBe(6);
    expect(decision.reasons.join(" ")).toMatch(/reduce concurrency/);
  });

  it("warns when p95 latency exceeds 30 seconds", () => {
    const decision = evaluateThresholds([
      event({
        type: "r2.upload.completed",
        outcome: "completed",
        posterId: "p-1",
        variant: "original",
        durationMs: 31_000,
      }),
    ]);
    expect(decision.decision).toBe("warning");
    expect(decision.metrics.p95LatencyMs).toBe(31_000);
  });

  it("gives hard stops precedence over every threshold", () => {
    const events = [
      ...sourceOutcomes(100, 0),
      event({
        type: "r2.upload.conflicted",
        outcome: "conflicted",
        failureCategory: "R2_CONFLICT",
      }),
    ];
    const decision = evaluateThresholds(events, {
      ...DEFAULT_THRESHOLDS,
      sourceFailureRatePause: 0.01,
      r2UploadFailureRatePause: 0.01,
    });
    expect(decision.decision).toBe("stop");
    expect(decision.hardStops).toEqual(["R2_CONFLICT"]);
  });
});

describe("F23 — pause and resume controller", () => {
  const selection = {
    runId: RUN,
    batchId: BATCH,
    posterIds: ["a", "b", "c"],
  };

  it("prevents new poster work while paused", () => {
    const controller = new BatchPauseController(selection);
    controller.pause("operator review");
    expect(() => controller.beginPoster("a")).toThrow(BatchPausedError);
    expect(controller.runningWorkers).toBe(0);
  });

  it("lets already-running workers settle before release", async () => {
    const controller = new BatchPauseController(selection);
    controller.beginPoster("a");
    controller.pause("threshold");
    let settled = false;
    const wait = controller.settle().then(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    controller.endPoster();
    await wait;
    expect(settled).toBe(true);
    expect(controller.runningWorkers).toBe(0);
  });

  it("requires validated state and the same explicit batch to resume", () => {
    const controller = new BatchPauseController(selection);
    controller.pause("review");
    expect(() => controller.resume({ ...selection, validatedState: false })).toThrow(
      BatchPausedError,
    );
    expect(() =>
      controller.resume({
        ...selection,
        posterIds: ["a", "b"],
        validatedState: true,
      }),
    ).toThrow(/same run, batch and explicit poster selection/);
    controller.resume({ ...selection, validatedState: true });
    expect(controller.state).toBe("running");
    controller.beginPoster("a");
    controller.endPoster();
  });

  it("never auto-resumes after a hard stop", () => {
    const controller = new BatchPauseController(selection);
    controller.abort("checksum mismatch");
    expect(() => controller.beginPoster("a")).toThrow(BatchStoppedError);
    expect(() => controller.resume({ ...selection, validatedState: true })).toThrow(
      BatchStoppedError,
    );
  });

  it("records a hard-stop event as a permanent stop, not a pause", () => {
    const controller = new BatchPauseController(selection);
    const decision = controller.record(
      event({
        type: "source.checksum.changed",
        outcome: "changed",
        failureCategory: "CHECKSUM_MISMATCH",
      }),
    );
    expect(decision.decision).toBe("stop");
    expect(controller.state).toBe("stopped");
    expect(() => controller.beginPoster("a")).toThrow(BatchStoppedError);
  });

  it("records threshold breaches as a pause", () => {
    const controller = new BatchPauseController(selection);
    for (let index = 0; index < 100; index++) {
      controller.record(
        event({
          type: "source.download.completed",
          outcome: "completed",
          posterId: `ok-${index}`,
        }),
      );
    }
    for (let index = 0; index < 6; index++) {
      controller.record(
        event({
          type: "source.download.failed",
          outcome: "failed",
          posterId: `bad-${index}`,
          failureCategory: "SOURCE_TRANSIENT",
        }),
      );
    }
    expect(controller.state).toBe("paused");
    expect(() => controller.beginPoster("a")).toThrow(BatchPausedError);
  });
});
