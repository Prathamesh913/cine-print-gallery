import { describe, expect, it, vi } from "vitest";
import type { Client } from "@notionhq/client";
import {
  NotionConfigurationError,
  NotionDataSourceResolver,
  normalizeNotionId,
  type NotionDataSourceResolverOptions,
} from "./data-sources";

const DATABASE_ID = "38c890a5-f3e2-8007-83f8-da7b81a268e4";
const POSTER_DATA_SOURCE_ID = "38c890a5-f3e2-808b-a395-000b9b97e9db";
const IDENTITIES_DATA_SOURCE_ID = "412890a5-f3e2-81bb-a5fc-000b21b7ba8a";

const POSTER_PROPERTIES = {
  Status: { type: "select" },
  "Image URL": { type: "url" },
};
const IDENTITY_PROPERTIES = { "Poster ID": { type: "title" } };

function notionError(status: number, code: string) {
  return Object.assign(new Error(`Notion ${code}`), { status, code });
}

function objectNotFound(id: string) {
  return notionError(404, "object_not_found");
}

function fakeClient(options: { dataSources?: Array<{ id: string; name: string }> } = {}) {
  const dataSources = options.dataSources ?? [
    { id: POSTER_DATA_SOURCE_ID, name: "Poster Library" },
  ];

  return {
    databases: {
      retrieve: vi.fn(async () => ({ id: DATABASE_ID, data_sources: dataSources })),
    },
    dataSources: {
      retrieve: vi.fn(async ({ data_source_id }: { data_source_id: string }) => {
        if (data_source_id === POSTER_DATA_SOURCE_ID) {
          return { id: data_source_id, properties: POSTER_PROPERTIES };
        }
        if (data_source_id === IDENTITIES_DATA_SOURCE_ID) {
          return { id: data_source_id, properties: IDENTITY_PROPERTIES };
        }
        throw objectNotFound(data_source_id);
      }),
    },
  };
}

function resolver(
  fake: ReturnType<typeof fakeClient>,
  overrides: Partial<NotionDataSourceResolverOptions> = {},
) {
  return new NotionDataSourceResolver({
    client: fake as unknown as Client,
    request: (operation) => operation(),
    databaseId: DATABASE_ID,
    requiredPosterProperties: ["Status", "Image URL"],
    ...overrides,
  });
}

describe("shared Notion data-source resolver", () => {
  it("resolves explicit poster and identity data sources", async () => {
    const fake = fakeClient();

    const plan = await resolver(fake, {
      posterDataSourceId: POSTER_DATA_SOURCE_ID,
      identitiesDataSourceId: IDENTITIES_DATA_SOURCE_ID,
    }).resolve();

    expect(plan).toEqual({
      posterDataSourceId: POSTER_DATA_SOURCE_ID,
      identitiesDataSourceId: IDENTITIES_DATA_SOURCE_ID,
    });
    expect(fake.databases.retrieve).not.toHaveBeenCalled();
    expect(fake.dataSources.retrieve).toHaveBeenCalledWith({
      data_source_id: POSTER_DATA_SOURCE_ID,
    });
    expect(fake.dataSources.retrieve).toHaveBeenCalledWith({
      data_source_id: IDENTITIES_DATA_SOURCE_ID,
    });
  });

  it("keeps the identity data source optional", async () => {
    const fake = fakeClient();

    const plan = await resolver(fake, {
      posterDataSourceId: POSTER_DATA_SOURCE_ID,
    }).resolve();

    expect(plan.identitiesDataSourceId).toBeNull();
    expect(fake.dataSources.retrieve).toHaveBeenCalledTimes(1);
  });

  it("rejects an identity ID that is the poster catalogue", async () => {
    const fake = fakeClient();

    const error = await resolver(fake, {
      posterDataSourceId: POSTER_DATA_SOURCE_ID,
      identitiesDataSourceId: POSTER_DATA_SOURCE_ID,
    })
      .resolve()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({
      problem: "wrong_object",
      variable: "NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID",
    });
  });

  it("rejects a database ID configured as the identity data source", async () => {
    const fake = fakeClient();

    const error = await resolver(fake, {
      posterDataSourceId: POSTER_DATA_SOURCE_ID,
      identitiesDataSourceId: DATABASE_ID,
    })
      .resolve()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({
      problem: "wrong_object",
      variable: "NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID",
    });
    expect(String(error)).toContain("database ID");
    expect(String(error)).toContain("not a data source");
  });

  it("fails closed when the database exposes several data sources", async () => {
    const fake = fakeClient({
      dataSources: [
        { id: POSTER_DATA_SOURCE_ID, name: "Poster Library" },
        { id: IDENTITIES_DATA_SOURCE_ID, name: "Poster Identities" },
      ],
    });

    const error = await resolver(fake)
      .resolve()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({ problem: "ambiguous" });
    expect(fake.dataSources.retrieve).not.toHaveBeenCalled();
  });

  it("rejects a poster data source missing the required properties", async () => {
    const fake = fakeClient({
      dataSources: [{ id: IDENTITIES_DATA_SOURCE_ID, name: "Poster Identities" }],
    });

    const error = await resolver(fake, {
      posterDataSourceId: IDENTITIES_DATA_SOURCE_ID,
    })
      .resolve()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotionConfigurationError);
    expect(error).toMatchObject({ problem: "unexpected_shape" });
    expect(String(error)).toContain("missing the Status and Image URL properties");
  });

  it("memoizes resolution across calls", async () => {
    const fake = fakeClient();
    const instance = resolver(fake, {
      posterDataSourceId: POSTER_DATA_SOURCE_ID,
      identitiesDataSourceId: IDENTITIES_DATA_SOURCE_ID,
    });

    await instance.resolve();
    await instance.resolve();

    expect(fake.dataSources.retrieve).toHaveBeenCalledTimes(2);
  });

  it("normalizes dashed and undashed Notion IDs", () => {
    expect(normalizeNotionId("38C890A5-F3E2-8007-83F8-DA7B81A268E4")).toBe(
      "38c890a5f3e2800783f8da7b81a268e4",
    );
  });
});
