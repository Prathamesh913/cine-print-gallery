import { describe, expect, it } from "vitest";
import type { EnrichedDraft } from "../tmdb/types";
import {
  CANONICAL_POSTER_ID_PROPERTY,
  DRAFT_STATUS,
  STATUS_PROPERTY,
  buildCreateProperties,
  buildUpdateProperties,
  changedFields,
} from "./mapper";

function draft(overrides: Partial<EnrichedDraft> = {}): EnrichedDraft {
  return {
    raindropId: "1812274995",
    title: "BlacKkKlansman",
    year: 2018,
    mediaType: "movie",
    artists: ["Eileen Steinbach"],
    imageUrl: "https://images.cineprint.click/cineprint/versions/original/artwork-1812274995/a.png",
    sourceUrl: "https://example.com/source",
    status: "enriched",
    tmdb: {
      id: 487558,
      imdbId: "tt7349662",
      genres: ["Crime", "Drama"],
      slug: "blackkklansman-2018",
      libraryName: "Movies",
    },
    ...overrides,
  };
}

describe("Notion draft mapping", () => {
  it("creates a Draft and no canonical property for legacy imports", () => {
    const properties = buildCreateProperties(draft());
    expect(properties[STATUS_PROPERTY]).toEqual({ select: { name: DRAFT_STATUS } });
    expect(properties[CANONICAL_POSTER_ID_PROPERTY]).toBeUndefined();
  });

  it("writes the canonical poster ID when the draft carries one", () => {
    const properties = buildCreateProperties(draft({ posterId: "artwork-1812274995" }));
    expect(properties[CANONICAL_POSTER_ID_PROPERTY]).toEqual({
      rich_text: [{ text: { content: "artwork-1812274995" } }],
    });
  });

  it("never overwrites Status on update", () => {
    const properties = buildUpdateProperties(draft({ posterId: "artwork-1812274995" }));
    expect(properties[STATUS_PROPERTY]).toBeUndefined();
  });

  it("detects a missing canonical identity on an existing page", () => {
    const subject = draft({ posterId: "artwork-1812274995" });
    const fields = changedFields(subject, {
      [CANONICAL_POSTER_ID_PROPERTY]: {
        type: "rich_text",
        rich_text: [{ plain_text: "artwork-1812274995" }],
      },
    });
    expect(fields).not.toContain(CANONICAL_POSTER_ID_PROPERTY);
  });

  it("detects a changed canonical identity", () => {
    const fields = changedFields(draft({ posterId: "artwork-1812274995" }), {
      [CANONICAL_POSTER_ID_PROPERTY]: {
        type: "rich_text",
        rich_text: [{ plain_text: "artwork-999" }],
      },
    });
    expect(fields).toContain(CANONICAL_POSTER_ID_PROPERTY);
  });
});
