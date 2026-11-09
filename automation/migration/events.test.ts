import { describe, expect, it } from "vitest";
import {
  EVENT_SCHEMA_VERSION,
  EventValidationError,
  createEvent,
  eventIdFor,
  validateEvent,
} from "./events";

const RUN = "run-2026-11-08-abc";
const SHA = "a".repeat(64);

function draft(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN,
    type: "poster.verified" as const,
    outcome: "verified" as const,
    evidence: "live_migration" as const,
    posterId: "bugonia",
    ...overrides,
  };
}

describe("F19 — event schema", () => {
  it("creates a versioned event with a deterministic ID from its sequence", () => {
    const event = createEvent({ ...draft(), sequence: 7 });
    expect(event.schemaVersion).toBe(EVENT_SCHEMA_VERSION);
    expect(event.sequence).toBe(7);
    expect(event.eventId).toBe(eventIdFor(RUN, 7));
    expect(validateEvent(event)).toEqual([]);
  });

  it("produces stable IDs for identical run/sequence inputs", () => {
    const first = createEvent({ ...draft(), sequence: 3 });
    const second = createEvent({ ...draft(), sequence: 3 });
    expect(first.eventId).toBe(second.eventId);
    expect(first.eventId).toBe("evt-run-2026-11-08-abc-00000003");
  });

  it("rejects unknown fields, enums, hashes and poster IDs", () => {
    const base = createEvent({ ...draft(), sequence: 1 });
    expect(validateEvent({ ...base, extra: true })).toEqual([
      expect.stringMatching(/Unknown event field/),
    ]);
    expect(validateEvent({ ...base, type: "not.an.event" })).toEqual([
      expect.stringMatching(/Unknown event type/),
    ]);
    expect(validateEvent({ ...base, outcome: "maybe" })).toEqual([
      expect.stringMatching(/Unknown event outcome/),
    ]);
    expect(validateEvent({ ...base, expectedSha256: "abc" })).toEqual([
      expect.stringMatching(/expectedSha256/),
    ]);
    expect(validateEvent({ ...base, posterId: "Bad_ID" })).toEqual([
      expect.stringMatching(/posterId/),
    ]);
    expect(validateEvent({ ...base, httpStatus: 99 })).toEqual([
      expect.stringMatching(/httpStatus/),
    ]);
  });

  it("rejects binary or non-primitive metadata", () => {
    expect(() =>
      createEvent({ ...draft(), sequence: 1, metadata: { bytes: Buffer.from("x") } }),
    ).toThrow(EventValidationError);
  });

  it("redacts sensitive URL parameters and authorization values at creation", () => {
    const event = createEvent({
      ...draft(),
      sequence: 1,
      message:
        "fetch https://pbs.twimg.com/media/x?token=super-secret&sig=abc and Authorization: Bearer abc.def",
      metadata: {
        url: "https://api.raindrop.io/rest/v1/file?access_token=secret",
      },
    });
    expect(event.message).not.toContain("super-secret");
    expect(event.message).not.toContain("abc.def");
    expect(event.message).toContain("[REDACTED]");
    expect(event.metadata?.url).not.toContain("secret");
  });

  it("never carries base64 image content", () => {
    const payload = `data:image/png;base64,${"A".repeat(400)}`;
    const event = createEvent({
      ...draft(),
      sequence: 1,
      message: payload,
      metadata: { preview: payload },
    });
    expect(JSON.stringify(event)).not.toContain("base64,");
    expect(event.message).toContain("[BINARY_REDACTED]");
  });

  it("accepts only the declared evidence modes", () => {
    const event = createEvent({ ...draft(), sequence: 1 });
    expect(validateEvent({ ...event, evidence: "production" })).toEqual([
      expect.stringMatching(/Unknown evidence mode/),
    ]);
    for (const evidence of ["local_plan", "mock", "live_preflight", "live_migration"]) {
      expect(validateEvent({ ...event, evidence })).toEqual([]);
    }
  });

  it("records failure category, retryability and checksum evidence", () => {
    const event = createEvent({
      ...draft({
        type: "r2.upload.conflicted",
        outcome: "conflicted",
        failureCategory: "R2_CONFLICT",
        retryable: false,
        expectedSha256: SHA,
        observedSha256: SHA,
        bytes: 1234,
        attempt: 2,
        durationMs: 45,
        httpStatus: 412,
      }),
      sequence: 1,
    });
    expect(validateEvent(event)).toEqual([]);
    expect(event.failureCategory).toBe("R2_CONFLICT");
  });
});
