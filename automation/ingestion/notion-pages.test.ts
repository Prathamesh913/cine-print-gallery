import { describe, expect, it, vi } from "vitest";
import type { Client } from "@notionhq/client";
import { NotionPollingSource } from "./notion-pages";

function fakeClient() {
  return {
    databases: {
      retrieve: vi.fn(async () => ({ data_sources: [{ id: "ds-catalogue" }] })),
    },
    dataSources: {
      query: vi.fn(async () => ({ results: [], has_more: false })),
    },
  };
}

function source(client: ReturnType<typeof fakeClient>, identitiesDataSourceId?: string | null) {
  return new NotionPollingSource({
    apiKey: "test-key",
    databaseId: "db",
    identitiesDataSourceId,
    client: client as unknown as Client,
  });
}

describe("Notion data-source configuration", () => {
  it("queries pages from the database's first data source", async () => {
    const client = fakeClient();
    await source(client).listPages();

    expect(client.databases.retrieve).toHaveBeenCalledWith({ database_id: "db" });
    expect(client.dataSources.query).toHaveBeenCalledWith(
      expect.objectContaining({ data_source_id: "ds-catalogue" }),
    );
  });

  it("treats the poster identities data source as optional", async () => {
    const client = fakeClient();
    const records = await source(client, undefined).listIdentityRecords();

    expect(records).toEqual([]);
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });

  it("does not invent a fallback data source for identities", async () => {
    const client = fakeClient();
    await source(client, "   ").listIdentityRecords();
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });

  it("queries the configured identities data source when provided", async () => {
    const client = fakeClient();
    const records = await source(client, "ds-identities").listIdentityRecords();

    expect(records).toEqual([]);
    expect(client.dataSources.query).toHaveBeenCalledTimes(1);
    expect(client.dataSources.query).toHaveBeenCalledWith(
      expect.objectContaining({ data_source_id: "ds-identities" }),
    );
  });
});
