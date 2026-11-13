import { describe, expect, it, vi } from "vitest";
import type { Client } from "@notionhq/client";
import { NotionApiClient } from "./client";
import { NotionConfigurationError } from "./data-sources";

/** Live CinePrint identifiers. */
const DATABASE_ID = "38c890a5-f3e2-8007-83f8-da7b81a268e4";
const POSTER_DATA_SOURCE_ID = "38c890a5-f3e2-808b-a395-000b9b97e9db";
const IDENTITIES_DATA_SOURCE_ID = "412890a5-f3e2-81bb-a5fc-000b21b7ba8a";

const POSTER_PROPERTIES = {
  Status: { type: "select" },
  "Image URL": { type: "url" },
  "Raindrop ID": { type: "rich_text" },
};
const IDENTITY_PROPERTIES = { "Poster ID": { type: "title" } };

function notionError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}

function objectNotFound(id: string) {
  return notionError(
    404,
    "object_not_found",
    `Could not find data_source with ID: ${id}. Make sure the relevant pages and databases are shared with your integration "CinePrint".`,
  );
}

interface FakeOptions {
  dataSources?: Array<{ id: string; name: string }>;
  retrieve?: (dataSourceId: string) => unknown;
}

function fakeClient(options: FakeOptions = {}) {
  const dataSources = options.dataSources ?? [
    { id: POSTER_DATA_SOURCE_ID, name: "Poster Library" },
  ];

  return {
    databases: {
      retrieve: vi.fn(async () => ({ id: DATABASE_ID, data_sources: dataSources })),
    },
    dataSources: {
      retrieve: vi.fn(async ({ data_source_id }: { data_source_id: string }) => {
        if (options.retrieve) return options.retrieve(data_source_id);
        if (data_source_id === POSTER_DATA_SOURCE_ID) {
          return { id: data_source_id, properties: POSTER_PROPERTIES };
        }
        if (data_source_id === IDENTITIES_DATA_SOURCE_ID) {
          return { id: data_source_id, properties: IDENTITY_PROPERTIES };
        }
        throw objectNotFound(data_source_id);
      }),
      query: vi.fn(async () => ({ results: [], has_more: false })),
    },
    pages: {
      create: vi.fn(async (_args: { parent: unknown; properties: unknown }) => ({
        id: "page-new",
      })),
      update: vi.fn(async (_args: { page_id: string; properties: unknown }) => ({ id: "page-1" })),
    },
  };
}

function client(fake: ReturnType<typeof fakeClient>, posterDataSourceId?: string | null) {
  return new NotionApiClient({
    apiKey: "test-key",
    databaseId: DATABASE_ID,
    posterDataSourceId,
    client: fake as unknown as Client,
  });
}

describe("ingestion Notion data-source selection", () => {
  it("deduplicates against the explicit poster data source", async () => {
    const fake = fakeClient();

    const page = await client(fake, POSTER_DATA_SOURCE_ID).findByRaindropId("1812274995");

    expect(page).toBeNull();
    expect(fake.databases.retrieve).not.toHaveBeenCalled();
    expect(fake.dataSources.retrieve).toHaveBeenCalledWith({
      data_source_id: POSTER_DATA_SOURCE_ID,
    });
    expect(fake.dataSources.query).toHaveBeenCalledWith({
      data_source_id: POSTER_DATA_SOURCE_ID,
      page_size: 1,
      filter: { property: "Raindrop ID", rich_text: { equals: "1812274995" } },
    });
  });

  it("creates drafts under the poster data source, not the database", async () => {
    const fake = fakeClient();
    const properties = { Name: { title: [{ text: { content: "BlacKkKlansman" } }] } };

    const pageId = await client(fake, POSTER_DATA_SOURCE_ID).createPage(properties);

    expect(pageId).toBe("page-new");
    expect(fake.pages.create).toHaveBeenCalledTimes(1);
    const args = fake.pages.create.mock.calls[0][0] as unknown as {
      parent: Record<string, unknown>;
      properties: unknown;
    };
    expect(args.parent).toEqual({
      type: "data_source_id",
      data_source_id: POSTER_DATA_SOURCE_ID,
    });
    expect(args.parent).not.toHaveProperty("database_id");
    expect(args.properties).toEqual(properties);
  });

  it("keeps single-data-source databases working without extra configuration", async () => {
    const fake = fakeClient();

    await client(fake).findByRaindropId("42");
    await client(fake).createPage({ Name: { title: [] } });

    expect(fake.dataSources.query).toHaveBeenCalledWith(
      expect.objectContaining({ data_source_id: POSTER_DATA_SOURCE_ID }),
    );
    expect(fake.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { type: "data_source_id", data_source_id: POSTER_DATA_SOURCE_ID },
      }),
    );
  });

  it("refuses to guess when the database has two data sources", async () => {
    const fake = fakeClient({
      dataSources: [
        { id: POSTER_DATA_SOURCE_ID, name: "Poster Library" },
        { id: IDENTITIES_DATA_SOURCE_ID, name: "Poster Identities" },
      ],
    });

    const error = await client(fake)
      .findByRaindropId("42")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({
      problem: "ambiguous",
      variable: "NOTION_POSTER_DATA_SOURCE_ID",
    });
    expect(String(error)).toContain("Poster Library");
    expect(String(error)).toContain("Poster Identities");
    expect(fake.dataSources.query).not.toHaveBeenCalled();
    expect(fake.pages.create).not.toHaveBeenCalled();
  });

  it("never falls back to the first data source", async () => {
    const fake = fakeClient({
      dataSources: [
        { id: IDENTITIES_DATA_SOURCE_ID, name: "Poster Identities" },
        { id: POSTER_DATA_SOURCE_ID, name: "Poster Library" },
      ],
    });

    await expect(client(fake).preflight()).rejects.toBeInstanceOf(NotionConfigurationError);
    expect(fake.dataSources.query).not.toHaveBeenCalled();
    expect(fake.dataSources.retrieve).not.toHaveBeenCalled();
  });

  it("rejects the database ID used as the poster data source", async () => {
    const fake = fakeClient({
      retrieve: (dataSourceId) => {
        if (dataSourceId === DATABASE_ID) throw objectNotFound(DATABASE_ID);
        return { id: dataSourceId, properties: POSTER_PROPERTIES };
      },
    });

    const error = await client(fake, DATABASE_ID)
      .createPage({ Name: { title: [] } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({
      problem: "wrong_object",
      variable: "NOTION_POSTER_DATA_SOURCE_ID",
    });
    expect(String(error)).toContain(DATABASE_ID);
    expect(String(error)).toContain("database ID");
    expect(String(error)).toContain("not a data source");
    expect(fake.pages.create).not.toHaveBeenCalled();
  });

  it("rejects a data source that is not the poster catalogue", async () => {
    const fake = fakeClient({
      retrieve: () => ({ id: IDENTITIES_DATA_SOURCE_ID, properties: IDENTITY_PROPERTIES }),
    });

    const error = await client(fake, IDENTITIES_DATA_SOURCE_ID)
      .findByRaindropId("42")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({
      problem: "unexpected_shape",
      variable: "NOTION_POSTER_DATA_SOURCE_ID",
    });
    expect(String(error)).toContain("Status, Image URL and Raindrop ID");
    expect(fake.dataSources.query).not.toHaveBeenCalled();
  });

  it("reports an inaccessible data source instead of a generic failure", async () => {
    const inaccessible = "412890a5-f3e2-81bb-a5fc-000000000000";
    const fake = fakeClient();

    const error = await client(fake, inaccessible)
      .preflight()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({ problem: "inaccessible" });
    expect(String(error)).toContain(inaccessible);
    expect(String(error)).toContain("shared with the");
    expect(fake.dataSources.query).not.toHaveBeenCalled();
  });

  it("validates the data source before any dedupe query", async () => {
    const fake = fakeClient({
      dataSources: [
        { id: POSTER_DATA_SOURCE_ID, name: "Poster Library" },
        { id: IDENTITIES_DATA_SOURCE_ID, name: "Poster Identities" },
      ],
    });

    await expect(client(fake).preflight()).rejects.toBeInstanceOf(NotionConfigurationError);
    expect(fake.dataSources.query).not.toHaveBeenCalled();
    expect(fake.pages.create).not.toHaveBeenCalled();
  });

  it("updates an existing page by page ID", async () => {
    const fake = fakeClient();
    const properties = { Status: { select: { name: "Published" } } };

    await client(fake, POSTER_DATA_SOURCE_ID).updatePage("page-1", properties);

    expect(fake.pages.update).toHaveBeenCalledWith({ page_id: "page-1", properties });
    expect(fake.dataSources.query).not.toHaveBeenCalled();
  });
});
