import { describe, expect, it } from "vitest";
import { countOutcomes } from "./report";
import type { SyncOutcome } from "./sync";
import type { EnrichedDraft } from "../tmdb/types";

function draft(): EnrichedDraft {
  return {
    raindropId: "1812274995",
    title: "BlacKkKlansman",
    year: 2018,
    mediaType: "movie",
    artists: ["Eileen Steinbach"],
    imageUrl: "https://api.raindrop.io/v2/raindrop/1812274995/file?type=image/png",
    sourceUrl: "https://x.com/sg_posters/status/2074969264499392888?s=46",
    status: "enriched",
    tmdb: {
      id: 487558,
      imdbId: "tt7349662",
      genres: ["Biography", "Crime", "Drama"],
      slug: "blacckklansman-2018",
      libraryName: "Movies",
    },
  };
}

function createdOutcome(): SyncOutcome {
  return { kind: "created", draft: draft(), pageId: "page-1" };
}

function updatedOutcome(changed: boolean): SyncOutcome {
  return {
    kind: "updated",
    draft: draft(),
    pageId: "page-1",
    changed,
    changedFields: changed ? ["Slug"] : undefined,
  };
}

function skippedOutcome(): SyncOutcome {
  return {
    kind: "skipped",
    draft: draft(),
    reason: "needs_review",
  };
}

function failedOutcome(): SyncOutcome {
  return {
    kind: "failed",
    draft: draft(),
    error: "Notion API down",
  };
}

describe("countOutcomes", () => {
  it("counts an unchanged existing record as skipped", () => {
    const counts = countOutcomes([updatedOutcome(false)]);
    expect(counts).toEqual({ created: 0, updated: 0, skipped: 1, failed: 0 });
  });

  it("counts a changed existing record as updated", () => {
    const counts = countOutcomes([updatedOutcome(true)]);
    expect(counts).toEqual({ created: 0, updated: 1, skipped: 0, failed: 0 });
  });

  it("counts created records as created", () => {
    const counts = countOutcomes([createdOutcome()]);
    expect(counts).toEqual({ created: 1, updated: 0, skipped: 0, failed: 0 });
  });

  it("counts failed records as failed", () => {
    const counts = countOutcomes([failedOutcome()]);
    expect(counts).toEqual({ created: 0, updated: 0, skipped: 0, failed: 1 });
  });

  it("counts needs_review skips as skipped", () => {
    const counts = countOutcomes([skippedOutcome()]);
    expect(counts).toEqual({ created: 0, updated: 0, skipped: 1, failed: 0 });
  });

  it("combines all buckets in a mixed batch", () => {
    const counts = countOutcomes([
      createdOutcome(),
      updatedOutcome(true),
      updatedOutcome(false),
      skippedOutcome(),
      failedOutcome(),
    ]);
    expect(counts).toEqual({ created: 1, updated: 1, skipped: 2, failed: 1 });
  });
});
