import { describe, expect, it, vi } from "vitest";
import { NotionDraftSync } from "./sync";
import { NotionNetworkError, type NotionClient } from "./client";
import { CANONICAL_POSTER_ID_PROPERTY, STATUS_PROPERTY } from "./mapper";
import type { EnrichedDraft } from "../tmdb/types";

function draft(): EnrichedDraft {
  return {
    raindropId: "123",
    posterId: "artwork-123",
    title: "BlacKkKlansman",
    year: 2018,
    mediaType: "movie",
    artists: ["Eileen Steinbach"],
    imageUrl: "https://images.cineprint.click/cineprint/versions/original/artwork-123/a.png",
    sourceUrl: "https://example.com/source",
    status: "enriched",
    tmdb: {
      id: 487558,
      imdbId: "tt7349662",
      genres: ["Crime"],
      slug: "blackkklansman-2018",
      libraryName: "Movies",
    },
  };
}

function client(overrides: Partial<NotionClient> = {}): NotionClient {
  return {
    findByRaindropId: vi.fn(async () => null),
    createPage: vi.fn(async () => "page-new"),
    updatePage: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("ingestion Notion drafts", () => {
  it("creates one Draft with the canonical identity", async () => {
    const notion = client();
    const outcome = await new NotionDraftSync(notion).syncOne(draft());

    expect(outcome.kind).toBe("created");
    expect(notion.createPage).toHaveBeenCalledTimes(1);
    const properties = (notion.createPage as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(properties[STATUS_PROPERTY]).toEqual({ select: { name: "Draft" } });
    expect(properties[CANONICAL_POSTER_ID_PROPERTY]).toBeTruthy();
  });

  it("updates an existing page without creating a duplicate", async () => {
    const notion = client({
      findByRaindropId: vi.fn(async () => ({
        id: "page-existing",
        properties: {},
      })),
    });

    const outcome = await new NotionDraftSync(notion).syncOne(draft());
    expect(outcome.kind).toBe("updated");
    expect(notion.createPage).not.toHaveBeenCalled();
    expect(notion.updatePage).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite a page whose fields already match", async () => {
    const properties = {
      Name: { type: "title", title: [{ plain_text: "BlacKkKlansman" }] },
      Year: { type: "number", number: 2018 },
      "Media Type": { type: "select", select: { name: "movie" } },
      Genre: { type: "multi_select", multi_select: [{ name: "Crime" }] },
      "IMDb ID": { type: "rich_text", rich_text: [{ plain_text: "tt7349662" }] },
      "TMDB ID": { type: "rich_text", rich_text: [{ plain_text: "487558" }] },
      "Library Names": { type: "multi_select", multi_select: [{ name: "Movies" }] },
      Slug: { type: "rich_text", rich_text: [{ plain_text: "blackkklansman-2018" }] },
      Artist: { type: "rich_text", rich_text: [{ plain_text: "Eileen Steinbach" }] },
      "Image URL": {
        type: "url",
        url: "https://images.cineprint.click/cineprint/versions/original/artwork-123/a.png",
      },
      "Source URL": { type: "url", url: "https://example.com/source" },
      "Raindrop ID": { type: "rich_text", rich_text: [{ plain_text: "123" }] },
      [CANONICAL_POSTER_ID_PROPERTY]: {
        type: "rich_text",
        rich_text: [{ plain_text: "artwork-123" }],
      },
    };

    const notion = client({
      findByRaindropId: vi.fn(async () => ({ id: "page-existing", properties })),
    });

    const outcome = await new NotionDraftSync(notion).syncOne(draft());
    expect(outcome).toMatchObject({ kind: "updated", changed: false });
    expect(notion.updatePage).not.toHaveBeenCalled();
  });

  it("never includes Status in an update payload", async () => {
    const notion = client({
      findByRaindropId: vi.fn(async () => ({ id: "page-existing", properties: {} })),
    });

    await new NotionDraftSync(notion).syncOne(draft());
    const properties = (notion.updatePage as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(properties[STATUS_PROPERTY]).toBeUndefined();
  });

  it("returns a failed outcome when the Notion client fails", async () => {
    const notion = client({
      findByRaindropId: vi.fn(async () => {
        throw new NotionNetworkError("network down");
      }),
    });

    const outcome = await new NotionDraftSync(notion).syncOne(draft());
    expect(outcome).toMatchObject({ kind: "failed" });
    expect(notion.createPage).not.toHaveBeenCalled();
  });

  it("reports a planned create in dry-run without writing", async () => {
    const notion = client();
    const outcome = await new NotionDraftSync(notion).syncOne(draft(), { dryRun: true });

    expect(outcome.kind).toBe("created");
    expect(notion.createPage).not.toHaveBeenCalled();
  });
});
