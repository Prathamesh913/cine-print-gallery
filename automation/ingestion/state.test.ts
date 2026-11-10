import { describe, expect, it, vi } from "vitest";
import {
  FirestoreJobStore,
  advanceJob,
  createJob,
  failJob,
  isRetryableNow,
  parseIngestionJob,
  type FirestoreLike,
} from "./state";

function job() {
  return createJob({
    posterId: "artwork-123",
    raindropId: "123",
    sourceKey: "raindrop:123",
    raindropUpdatedAt: "2026-11-01T00:00:00.000Z",
    title: "Test",
    year: 2020,
    mediaType: "movie",
    artists: ["A"],
    sourceUrl: "https://example.com",
    sourceImageUrl: "https://api.raindrop.io/v2/raindrop/123/file",
    now: new Date("2026-11-01T00:00:00.000Z"),
  });
}

describe("pipeline state", () => {
  it("creates a discovered job with no image references", () => {
    const created = job();
    expect(created.stage).toBe("discovered");
    expect(created.images).toBeNull();
    expect(created.attempts).toBe(0);
  });

  it("schedules a retry and stops after the attempt budget", () => {
    const now = new Date("2026-11-10T12:00:00.000Z");
    const first = failJob(
      job(),
      { message: "temporary", retryable: true },
      { now, maxAttempts: 3, retryDelayMs: 60_000 },
    );
    expect(first.retryable).toBe(true);
    expect(first.nextAttemptAt).toBe("2026-11-10T12:01:00.000Z");
    expect(isRetryableNow(first, now)).toBe(false);
    expect(isRetryableNow(first, new Date("2026-11-10T12:02:00.000Z"))).toBe(true);

    const exhausted = failJob(
      { ...first, attempts: 2 },
      { message: "temporary", retryable: true },
      { now, maxAttempts: 3, retryDelayMs: 60_000 },
    );
    expect(exhausted.retryable).toBe(false);
    expect(exhausted.nextAttemptAt).toBeNull();
  });

  it("does not schedule a retry for a permanent failure", () => {
    const failed = failJob(
      job(),
      { message: "invalid image", retryable: false },
      { now: new Date("2026-11-10T12:00:00.000Z"), maxAttempts: 3, retryDelayMs: 60_000 },
    );
    expect(failed.retryable).toBe(false);
    expect(failed.nextAttemptAt).toBeNull();
    expect(isRetryableNow(failed, new Date("2026-11-10T13:00:00.000Z"))).toBe(false);
  });

  it("advances a stage without losing the identity", () => {
    const advanced = advanceJob(
      job(),
      "enriching",
      { tmdbId: 1 },
      new Date("2026-11-02T00:00:00.000Z"),
    );
    expect(advanced.posterId).toBe("artwork-123");
    expect(advanced.stage).toBe("enriching");
    expect(advanced.updatedAt).toBe("2026-11-02T00:00:00.000Z");
  });

  it("rejects an untrusted job document before it enters the pipeline", () => {
    expect(parseIngestionJob({})).toBeNull();
    expect(parseIngestionJob({ ...job(), stage: "unknown" })).toBeNull();
    expect(parseIngestionJob({ ...job(), posterId: "" })).toBeNull();
    expect(parseIngestionJob(job())).toMatchObject({ posterId: "artwork-123" });
  });

  it("round-trips through a Firestore-like store", async () => {
    const documents = new Map<string, Record<string, unknown>>();
    const db: FirestoreLike = {
      collection: () => ({
        doc: (id: string) => ({
          get: async () => ({
            exists: documents.has(id),
            data: () => documents.get(id),
          }),
          set: async (data: Record<string, unknown>) => {
            documents.set(id, data);
          },
        }),
        limit: () => ({
          get: async () => ({
            docs: [...documents.entries()].map(([id, data]) => ({
              id,
              data: () => data,
            })),
          }),
        }),
      }),
    };

    const store = new FirestoreJobStore(db);
    await store.save(job());
    expect(await store.get("artwork-123")).toMatchObject({ stage: "discovered" });
    expect(await store.list()).toHaveLength(1);
  });

  it("ignores and logs invalid stored documents", async () => {
    const warn = vi.fn();
    const db: FirestoreLike = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => ({ nonsense: true }) }),
          set: async () => undefined,
        }),
        limit: () => ({ get: async () => ({ docs: [] }) }),
      }),
    };
    const store = new FirestoreJobStore(db, "jobs", {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
      child() {
        return this;
      },
    } as never);

    expect(await store.get("x")).toBeNull();
    expect(warn).toHaveBeenCalledWith("state.invalid_job_document", { posterId: "x" });
  });
});
