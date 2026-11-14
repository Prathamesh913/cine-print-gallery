import { describe, expect, it } from "vitest";
import type { Client } from "@notionhq/client";
import { NotionRepairClient } from "./notion";
import { REPAIR_TARGETS } from "./targets";

const TARGET = REPAIR_TARGETS["the-substance-2"];

function fakeClient() {
  const state: {
    created: { parent: unknown; properties: Record<string, unknown> } | null;
    responseProperties: Record<string, unknown>;
    updates: number;
  } = {
    created: null,
    responseProperties: {
      "Poster ID": { type: "title", title: [{ plain_text: TARGET.posterId }] },
      "Grouping Page": { type: "relation", relation: [{ id: TARGET.notionPageId }] },
      "Image URL": { type: "url", url: TARGET.existingImageUrl },
      "Raindrop ID": { type: "rich_text", rich_text: [{ plain_text: TARGET.raindropId }] },
      "Source Provider": { type: "select", select: { name: "pbs-twimg" } },
      "Source SHA-256": {
        type: "rich_text",
        rich_text: [{ plain_text: TARGET.expectedSha256 }],
      },
      "Source Revision": { type: "number", number: 1 },
      Status: { type: "select", select: { name: "active" } },
      "Verified At": { type: "date", date: { start: "2026-11-14T00:00:00.000Z" } },
    },
    updates: 0,
  };

  const client = {
    databases: {
      retrieve: async () => ({ id: "db", data_sources: [] }),
    },
    dataSources: {
      retrieve: async ({ data_source_id }: { data_source_id: string }) => ({
        id: data_source_id,
        properties: {},
      }),
      query: async () => ({ results: [], has_more: false, next_cursor: null }),
    },
    pages: {
      create: async (payload: { parent: unknown; properties: Record<string, unknown> }) => {
        state.created = payload;
        return { id: "identity-row-1" };
      },
      retrieve: async ({ page_id }: { page_id: string }) => ({
        id: page_id,
        properties: state.responseProperties,
      }),
      update: async () => {
        state.updates += 1;
        throw new Error("pages.update must not be called");
      },
    },
  } as unknown as Client;

  return { client, state };
}

describe("Notion repair identity adapter", () => {
  it("creates only the identity row and preserves poster status", async () => {
    const { client, state } = fakeClient();
    const repair = new NotionRepairClient({
      apiKey: "test",
      databaseId: "database",
      posterDataSourceId: "poster-source",
      identitiesDataSourceId: "identities-source",
      client,
    });

    const recordId = await repair.createIdentityRecord({
      target: TARGET,
      groupingPageId: TARGET.notionPageId,
      imageUrl: TARGET.existingImageUrl,
      verifiedAt: "2026-11-14T00:00:00.000Z",
    });

    expect(recordId).toBe("identity-row-1");
    expect(state.updates).toBe(0);
    expect(state.created).toMatchObject({
      parent: { type: "data_source_id", data_source_id: "identities-source" },
      properties: {
        "Poster ID": { title: [{ text: { content: TARGET.posterId } }] },
        "Grouping Page": { relation: [{ id: TARGET.notionPageId }] },
        "Image URL": { url: TARGET.existingImageUrl },
        "Raindrop ID": { rich_text: [{ text: { content: TARGET.raindropId } }] },
        "Source Provider": { select: { name: "pbs-twimg" } },
        "Source SHA-256": {
          rich_text: [{ text: { content: TARGET.expectedSha256 } }],
        },
        "Source Revision": { number: 1 },
        Status: { select: { name: "active" } },
        "Verified At": { date: { start: "2026-11-14T00:00:00.000Z" } },
      },
    });

    const record = await repair.getIdentityRecord(recordId);
    expect(record).toMatchObject({
      posterId: TARGET.posterId,
      groupingPageId: TARGET.notionPageId,
      imageUrl: TARGET.existingImageUrl,
      raindropId: TARGET.raindropId,
      provider: "pbs-twimg",
      sha256: TARGET.expectedSha256,
      status: "active",
    });
  });

  it("fails closed when the identities data source is not configured", async () => {
    const { client } = fakeClient();
    const repair = new NotionRepairClient({
      apiKey: "test",
      databaseId: "database",
      posterDataSourceId: "poster-source",
      identitiesDataSourceId: null,
      client,
    });

    await expect(repair.preflight()).rejects.toThrow(/POSTER_IDENTITIES_DATA_SOURCE_ID/);
  });
});
