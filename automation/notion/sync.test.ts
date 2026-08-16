import { describe, expect, it, vi } from "vitest";
import type { NotionClient } from "./client";
import {
  ARTIST_PROPERTY,
  DRAFT_STATUS,
  GENRE_PROPERTY,
  IMAGE_URL_PROPERTY,
  RAINDROP_ID_PROPERTY,
  SLUG_PROPERTY,
  STATUS_PROPERTY,
  TITLE_PROPERTY,
} from "./mapper";
import { countOutcomes } from "./report";
import { NotionDraftSync } from "./sync";
import type { EnrichedDraft } from "../tmdb/types";

function makeClient() {
  const findByRaindropId = vi.fn<NotionClient["findByRaindropId"]>();
  const createPage = vi.fn<NotionClient["createPage"]>();
  const updatePage = vi.fn<NotionClient["updatePage"]>();
  const client: NotionClient = { findByRaindropId, createPage, updatePage };

  return { client, findByRaindropId, createPage, updatePage };
}

function baseDraft(overrides: Partial<EnrichedDraft> = {}): EnrichedDraft {
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
    ...overrides,
  };
}

function responseProp(type: string, value: unknown): unknown {
  switch (type) {
    case "title":
      return { type: "title", title: [{ plain_text: value }] };
    case "rich_text":
      return { type: "rich_text", rich_text: [{ plain_text: value }] };
    case "url":
      return { type: "url", url: value };
    case "number":
      return { type: "number", number: value };
    case "select":
      return { type: "select", select: { name: value } };
    case "multi_select":
      return {
        type: "multi_select",
        multi_select: (value as string[]).map((name) => ({ name })),
      };
    default:
      return null;
  }
}

function existingProps(draft: EnrichedDraft): Record<string, unknown> {
  if (!draft.tmdb) return {};
  return {
    [TITLE_PROPERTY]: responseProp("title", draft.title),
    Year: responseProp("number", draft.year),
    "Media Type": responseProp("select", draft.mediaType),
    [GENRE_PROPERTY]: responseProp("multi_select", draft.tmdb.genres),
    "IMDb ID": responseProp("rich_text", draft.tmdb.imdbId),
    "TMDB ID": responseProp("rich_text", String(draft.tmdb.id)),
    "Library Names": responseProp("multi_select", [draft.tmdb.libraryName]),
    [SLUG_PROPERTY]: responseProp("rich_text", draft.tmdb.slug),
    [ARTIST_PROPERTY]: responseProp("rich_text", draft.artists.join("|")),
    [IMAGE_URL_PROPERTY]: responseProp("url", draft.imageUrl),
    "Source URL": responseProp("url", draft.sourceUrl),
    [RAINDROP_ID_PROPERTY]: responseProp("rich_text", draft.raindropId),
    [STATUS_PROPERTY]: responseProp("select", DRAFT_STATUS),
  };
}

describe("NotionDraftSync", () => {
  it("creates a new record when no existing Raindrop ID is found", async () => {
    const { client, findByRaindropId, createPage, updatePage } = makeClient();
    findByRaindropId.mockResolvedValue(null);
    createPage.mockResolvedValue("page-1");
    const sync = new NotionDraftSync(client);
    const draft = baseDraft();

    const outcome = await sync.syncOne(draft);

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect(createPage).toHaveBeenCalledTimes(1);
    expect(updatePage).not.toHaveBeenCalled();
    const properties = createPage.mock.calls[0][0];
    expect(properties).toMatchObject({
      Name: { title: [{ text: { content: "BlacKkKlansman" } }] },
      "Raindrop ID": { rich_text: [{ text: { content: "1812274995" } }] },
      Status: { select: { name: "Draft" } },
    });
    expect(outcome.pageId).toBe("page-1");
  });

  it("updates the existing record when the Raindrop ID is already present", async () => {
    const { client, findByRaindropId, createPage, updatePage } = makeClient();
    const draft = baseDraft();
    findByRaindropId.mockResolvedValue({
      id: "page-1",
      properties: {
        ...existingProps(draft),
        [SLUG_PROPERTY]: responseProp("rich_text", "old-slug"),
      },
    });
    updatePage.mockResolvedValue(undefined);
    const sync = new NotionDraftSync(client);

    const outcome = await sync.syncOne(draft);

    expect(outcome.kind).toBe("updated");
    if (outcome.kind !== "updated") return;
    expect(createPage).not.toHaveBeenCalled();
    expect(updatePage).toHaveBeenCalledTimes(1);
    const [pageId, properties] = updatePage.mock.calls[0];
    expect(pageId).toBe("page-1");
    expect(Object.keys(properties)).toEqual([SLUG_PROPERTY]);
    expect(properties).toMatchObject({
      Slug: { rich_text: [{ text: { content: "blacckklansman-2018" } }] },
    });
    expect(outcome.changed).toBe(true);
  });

  it("does not write when the existing record already matches", async () => {
    const { client, findByRaindropId, createPage, updatePage } = makeClient();
    const draft = baseDraft();
    findByRaindropId.mockResolvedValue({
      id: "page-1",
      properties: existingProps(draft),
    });
    const sync = new NotionDraftSync(client);

    const outcome = await sync.syncOne(draft);

    expect(outcome.kind).toBe("updated");
    if (outcome.kind !== "updated") return;
    expect(outcome.changed).toBe(false);
    expect(createPage).not.toHaveBeenCalled();
    expect(updatePage).not.toHaveBeenCalled();
  });

  it("reports an unchanged existing record as Skipped", async () => {
    const { client, findByRaindropId, createPage, updatePage } = makeClient();
    const draft = baseDraft();
    findByRaindropId.mockResolvedValue({
      id: "page-1",
      properties: existingProps(draft),
    });
    const sync = new NotionDraftSync(client);

    const outcomes = await sync.syncMany([draft]);

    expect(countOutcomes(outcomes)).toEqual({
      created: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    expect(createPage).not.toHaveBeenCalled();
    expect(updatePage).not.toHaveBeenCalled();
  });

  it("creates separate records for the same movie with different Raindrop IDs", async () => {
    const { client, findByRaindropId, createPage } = makeClient();
    findByRaindropId.mockResolvedValue(null);
    createPage.mockResolvedValue("page-1");
    const sync = new NotionDraftSync(client);

    const first = baseDraft({ raindropId: "111", title: "Inception", year: 2010 });
    const second = baseDraft({ raindropId: "222", title: "Inception", year: 2010 });
    const outcomes = await sync.syncMany([first, second]);

    expect(outcomes.map((o) => o.kind)).toEqual(["created", "created"]);
    expect(createPage).toHaveBeenCalledTimes(2);
    const raindropValues = createPage.mock.calls.map(
      (call) =>
        (call[0]["Raindrop ID"] as { rich_text: Array<{ text: { content: string } }> }).rich_text[0]
          .text.content,
    );
    expect(raindropValues).toEqual(["111", "222"]);
  });

  it("never creates a duplicate for an existing Raindrop ID", async () => {
    const { client, findByRaindropId, createPage, updatePage } = makeClient();
    const draft = baseDraft();
    findByRaindropId.mockResolvedValue({ id: "page-1", properties: existingProps(draft) });
    updatePage.mockResolvedValue(undefined);
    const sync = new NotionDraftSync(client);

    const outcomes = await sync.syncMany([draft, draft]);

    expect(outcomes.map((o) => o.kind)).toEqual(["updated", "updated"]);
    expect(createPage).not.toHaveBeenCalled();
    expect(updatePage).not.toHaveBeenCalled();
  });

  it("performs zero Notion writes in dry-run mode", async () => {
    const { client, findByRaindropId, createPage, updatePage } = makeClient();
    findByRaindropId.mockResolvedValue(null);
    const sync = new NotionDraftSync(client);

    const outcome = await sync.syncOne(baseDraft(), { dryRun: true });

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect(outcome.properties).toBeDefined();
    expect(createPage).not.toHaveBeenCalled();
    expect(updatePage).not.toHaveBeenCalled();
  });

  it("skips drafts marked needs_review", async () => {
    const { client, findByRaindropId, createPage, updatePage } = makeClient();
    const sync = new NotionDraftSync(client);

    const outcome = await sync.syncOne(
      baseDraft({ status: "needs_review", reason: "Ambiguous TMDB match", tmdb: undefined }),
    );

    expect(outcome.kind).toBe("skipped");
    if (outcome.kind !== "skipped") return;
    expect(outcome.reason).toBe("Ambiguous TMDB match");
    expect(findByRaindropId).not.toHaveBeenCalled();
    expect(createPage).not.toHaveBeenCalled();
    expect(updatePage).not.toHaveBeenCalled();
  });

  it("skips drafts that failed TMDB enrichment without stopping the batch", async () => {
    const { client, findByRaindropId, createPage } = makeClient();
    findByRaindropId.mockResolvedValue(null);
    createPage.mockResolvedValue("page-1");
    const sync = new NotionDraftSync(client);

    const failed = baseDraft({ status: "failed", reason: "TMDB API error", tmdb: undefined });
    const good = baseDraft();
    const outcomes = await sync.syncMany([failed, good]);

    expect(outcomes[0].kind).toBe("skipped");
    expect(outcomes[1].kind).toBe("created");
    expect(createPage).toHaveBeenCalledTimes(1);
  });

  it("continues processing when Notion fails for a single record", async () => {
    const { client, findByRaindropId, createPage } = makeClient();
    findByRaindropId.mockRejectedValueOnce(new Error("Notion API down"));
    findByRaindropId.mockResolvedValueOnce(null);
    createPage.mockResolvedValue("page-2");
    const sync = new NotionDraftSync(client);

    const first = baseDraft({ raindropId: "111" });
    const second = baseDraft({ raindropId: "222" });
    const outcomes = await sync.syncMany([first, second]);

    expect(outcomes[0].kind).toBe("failed");
    expect(outcomes[1].kind).toBe("created");
    if (outcomes[0].kind !== "failed") return;
    expect(outcomes[0].error).toContain("Notion API down");
    expect(createPage).toHaveBeenCalledTimes(1);
  });

  it("preserves multiple artists joined with the existing pipe convention", async () => {
    const { client, findByRaindropId, createPage } = makeClient();
    findByRaindropId.mockResolvedValue(null);
    createPage.mockResolvedValue("page-1");
    const sync = new NotionDraftSync(client);

    const outcome = await sync.syncOne(baseDraft({ artists: ["Eileen Steinbach", "Annie Wu"] }));

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    const properties = createPage.mock.calls[0][0];
    expect(properties).toMatchObject({
      Artist: { rich_text: [{ text: { content: "Eileen Steinbach|Annie Wu" } }] },
    });
  });

  it("preserves all genres in the multi_select property", async () => {
    const { client, findByRaindropId, createPage } = makeClient();
    findByRaindropId.mockResolvedValue(null);
    createPage.mockResolvedValue("page-1");
    const sync = new NotionDraftSync(client);

    const outcome = await sync.syncOne(baseDraft());

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    const properties = createPage.mock.calls[0][0];
    expect(properties).toMatchObject({
      Genre: {
        multi_select: [{ name: "Biography" }, { name: "Crime" }, { name: "Drama" }],
      },
    });
  });
});
