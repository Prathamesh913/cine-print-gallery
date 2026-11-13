import { describe, expect, it } from "vitest";
import { InMemoryPosterCatalog } from "./poster-catalog";
import {
  DryRunWriteError,
  readOnlyJobStore,
  readOnlyPosterCatalog,
  readOnlyRunStore,
} from "./read-only";
import { InMemoryJobStore, createJob } from "./state";

function job() {
  return createJob({
    posterId: "artwork-123",
    raindropId: "123",
    sourceKey: "raindrop:123",
    raindropUpdatedAt: null,
    title: "BlacKkKlansman",
    year: 2018,
    mediaType: "movie",
    artists: ["Eileen Steinbach"],
    sourceUrl: "https://example.com/source",
    sourceImageUrl: null,
    now: new Date("2026-11-01T00:00:00.000Z"),
  });
}

describe("dry-run read-only adapters", () => {
  it("reads existing catalogue state", async () => {
    const catalog = readOnlyPosterCatalog(
      new InMemoryPosterCatalog([{ id: "artwork-123", data: { status: "published" } }]),
    );

    expect((await catalog.get("artwork-123"))?.data.status).toBe("published");
    expect(await catalog.listAll()).toHaveLength(1);
    expect(await catalog.listByNotionPageId("page-1")).toEqual([]);
  });

  it("reads existing job state", async () => {
    const store = readOnlyJobStore(new InMemoryJobStore([job()]));

    expect((await store.get("artwork-123"))?.posterId).toBe("artwork-123");
    expect(await store.list()).toHaveLength(1);
  });

  it("refuses every catalogue write", async () => {
    const catalog = readOnlyPosterCatalog(new InMemoryPosterCatalog());

    await expect(catalog.create("artwork-123", {})).rejects.toBeInstanceOf(DryRunWriteError);
    await expect(catalog.update("artwork-123", {})).rejects.toBeInstanceOf(DryRunWriteError);
  });

  it("refuses job and run writes", async () => {
    const store = readOnlyJobStore(new InMemoryJobStore());

    await expect(store.save(job())).rejects.toBeInstanceOf(DryRunWriteError);
    await expect(readOnlyRunStore().save({} as never)).rejects.toBeInstanceOf(DryRunWriteError);
  });
});
