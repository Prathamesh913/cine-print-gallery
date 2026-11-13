import { describe, expect, it, vi } from "vitest";
import type { Client } from "@notionhq/client";
import { NotionConfigurationError, NotionPollingSource } from "./notion-pages";

/** Live CinePrint identifiers, reproduced from the failing dry-run. */
const DATABASE_ID = "38c890a5-f3e2-8007-83f8-da7b81a268e4";
const CATALOGUE_DATA_SOURCE_ID = "38c890a5-f3e2-808b-a395-000b9b97e9db";
const IDENTITIES_DATA_SOURCE_ID = "412890a5-f3e2-81bb-a5fc-000b21b7ba8a";

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

const CATALOGUE_PROPERTIES = { Status: { type: "select" }, "Image URL": { type: "url" } };
const IDENTITY_PROPERTIES = { "Poster ID": { type: "title" } };

interface FakeOptions {
  dataSources?: Array<{ id: string; name: string }>;
  retrieve?: (dataSourceId: string) => unknown;
  databaseError?: unknown;
}

function fakeClient(options: FakeOptions = {}) {
  const dataSources = options.dataSources ?? [
    { id: CATALOGUE_DATA_SOURCE_ID, name: "Poster Library" },
  ];

  return {
    databases: {
      retrieve: vi.fn(async () => {
        if (options.databaseError) throw options.databaseError;
        return { id: DATABASE_ID, data_sources: dataSources };
      }),
    },
    dataSources: {
      retrieve: vi.fn(async ({ data_source_id }: { data_source_id: string }) => {
        if (options.retrieve) return options.retrieve(data_source_id);
        if (data_source_id === CATALOGUE_DATA_SOURCE_ID) {
          return { id: data_source_id, properties: CATALOGUE_PROPERTIES };
        }
        if (data_source_id === IDENTITIES_DATA_SOURCE_ID) {
          return { id: data_source_id, properties: IDENTITY_PROPERTIES };
        }
        throw objectNotFound(data_source_id);
      }),
      query: vi.fn(async () => ({ results: [], has_more: false })),
    },
  };
}

function source(
  client: ReturnType<typeof fakeClient>,
  options: { identitiesDataSourceId?: string | null; posterDataSourceId?: string | null } = {},
) {
  return new NotionPollingSource({
    apiKey: "test-key",
    databaseId: DATABASE_ID,
    posterDataSourceId: options.posterDataSourceId,
    identitiesDataSourceId: options.identitiesDataSourceId,
    client: client as unknown as Client,
  });
}

describe("Notion data-source configuration", () => {
  it("queries pages from the database's only data source", async () => {
    const client = fakeClient();
    await source(client).listPages();

    expect(client.databases.retrieve).toHaveBeenCalledWith({ database_id: DATABASE_ID });
    expect(client.dataSources.retrieve).toHaveBeenCalledWith({
      data_source_id: CATALOGUE_DATA_SOURCE_ID,
    });
    expect(client.dataSources.query).toHaveBeenCalledWith(
      expect.objectContaining({ data_source_id: CATALOGUE_DATA_SOURCE_ID }),
    );
  });

  it("uses an explicit poster data source without guessing from the database", async () => {
    const client = fakeClient();
    await source(client, { posterDataSourceId: CATALOGUE_DATA_SOURCE_ID }).listPages();

    expect(client.databases.retrieve).not.toHaveBeenCalled();
    expect(client.dataSources.query).toHaveBeenCalledWith(
      expect.objectContaining({ data_source_id: CATALOGUE_DATA_SOURCE_ID }),
    );
  });

  it("refuses to guess when the database exposes several data sources", async () => {
    const client = fakeClient({
      dataSources: [
        { id: CATALOGUE_DATA_SOURCE_ID, name: "Poster Library" },
        { id: IDENTITIES_DATA_SOURCE_ID, name: "Poster Identities" },
      ],
    });

    await expect(source(client).listPages()).rejects.toMatchObject({
      name: "NotionConfigurationError",
      problem: "ambiguous",
      variable: "NOTION_POSTER_DATA_SOURCE_ID",
    });
    await expect(source(client).listPages()).rejects.toThrow(/Poster Library/);
    await expect(source(client).listPages()).rejects.toThrow(/Poster Identities/);
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });

  it("rejects a catalogue data source that lacks the poster properties", async () => {
    const client = fakeClient({
      retrieve: () => ({ id: IDENTITIES_DATA_SOURCE_ID, properties: IDENTITY_PROPERTIES }),
    });

    await expect(
      source(client, { posterDataSourceId: IDENTITIES_DATA_SOURCE_ID }).listPages(),
    ).rejects.toThrow(/missing the Status and Image URL properties/);
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });

  it("treats the poster identities data source as optional", async () => {
    const client = fakeClient();
    const records = await source(client, {
      identitiesDataSourceId: undefined,
    }).listIdentityRecords();

    expect(records).toEqual([]);
    expect(client.dataSources.query).not.toHaveBeenCalled();
    expect(client.dataSources.retrieve).not.toHaveBeenCalledWith({
      data_source_id: IDENTITIES_DATA_SOURCE_ID,
    });
  });

  it("does not invent a fallback data source for identities", async () => {
    const client = fakeClient();
    await source(client, { identitiesDataSourceId: "   " }).listIdentityRecords();
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });

  it("queries the configured identities data source when provided", async () => {
    const client = fakeClient();
    const records = await source(client, {
      identitiesDataSourceId: IDENTITIES_DATA_SOURCE_ID,
    }).listIdentityRecords();

    expect(records).toEqual([]);
    expect(client.dataSources.retrieve).toHaveBeenCalledWith({
      data_source_id: IDENTITIES_DATA_SOURCE_ID,
    });
    expect(client.dataSources.query).toHaveBeenCalledTimes(1);
    expect(client.dataSources.query).toHaveBeenCalledWith(
      expect.objectContaining({ data_source_id: IDENTITIES_DATA_SOURCE_ID }),
    );
  });

  it("regression: names the database ID when it is configured as a data source", async () => {
    // This is the exact value the GitHub variable held during the failing run:
    // the Poster Library database ID, not the Poster Identities data source.
    const client = fakeClient({
      retrieve: (dataSourceId) => {
        if (dataSourceId === DATABASE_ID) throw objectNotFound(DATABASE_ID);
        return { id: dataSourceId, properties: CATALOGUE_PROPERTIES };
      },
    });

    const error = await source(client, { identitiesDataSourceId: DATABASE_ID })
      .listIdentityRecords()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({
      problem: "wrong_object",
      variable: "NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID",
    });
    expect(String(error)).toContain(DATABASE_ID);
    expect(String(error)).toContain("database ID");
    expect(String(error)).toContain("not a data source");
    expect(String(error)).toContain("No records were processed");
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });

  it("distinguishes an inaccessible ID from missing configuration", async () => {
    const inaccessible = "412890a5-f3e2-81bb-a5fc-000000000000";
    const client = fakeClient();

    const error = await source(client, { identitiesDataSourceId: inaccessible })
      .listIdentityRecords()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({ problem: "inaccessible" });
    expect(String(error)).toContain(inaccessible);
    expect(String(error)).toContain("shared with the");
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });

  it("refuses to read identity rows from the catalogue data source", async () => {
    const client = fakeClient();
    const error = await source(client, { identitiesDataSourceId: CATALOGUE_DATA_SOURCE_ID })
      .listIdentityRecords()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({ problem: "wrong_object" });
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });

  it("reports a rejected Notion key as a configuration error", async () => {
    const client = fakeClient({ databaseError: notionError(401, "unauthorized", "unauthorized") });
    const error = await source(client)
      .listPages()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({ variable: "NOTION_KEY" });
  });

  it("validates every configured data source before listing pages", async () => {
    const client = fakeClient({
      retrieve: (dataSourceId) => {
        if (dataSourceId === DATABASE_ID) throw objectNotFound(DATABASE_ID);
        return { id: dataSourceId, properties: CATALOGUE_PROPERTIES };
      },
    });

    await expect(
      source(client, { identitiesDataSourceId: DATABASE_ID }).preflight(),
    ).rejects.toBeInstanceOf(NotionConfigurationError);
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });
});
