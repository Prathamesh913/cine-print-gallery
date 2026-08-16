import { Client } from "@notionhq/client";

export interface NotionPage {
  id: string;
  properties: Record<string, unknown>;
}

export interface NotionClient {
  findByRaindropId(raindropId: string): Promise<NotionPage | null>;
  createPage(properties: Record<string, unknown>): Promise<string>;
  updatePage(pageId: string, properties: Record<string, unknown>): Promise<void>;
}

export class NotionAuthError extends Error {}
export class NotionRateLimitError extends Error {}
export class NotionApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export class NotionNetworkError extends Error {}

export interface NotionApiClientOptions {
  apiKey: string;
  databaseId: string;
  retries?: number;
}

const RAINDROP_ID_PROPERTY = "Raindrop ID";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function retryAfterMs(error: unknown): number | undefined {
  const headers = (error as { headers?: Record<string, string | undefined> }).headers;
  const value = headers?.["retry-after"];

  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.min(seconds, 60) * 1000;
  }

  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.min(date - Date.now(), 60_000);
  }

  return undefined;
}

export class NotionApiClient implements NotionClient {
  private readonly client: Client;
  private readonly databaseId: string;
  private readonly retries: number;
  private dataSourceId: string | null | undefined;

  constructor(options: NotionApiClientOptions) {
    if (!options.apiKey) {
      throw new Error("NOTION_KEY is required");
    }
    if (!options.databaseId) {
      throw new Error("NOTION_DATABASE_ID is required");
    }
    this.client = new Client({ auth: options.apiKey });
    this.databaseId = options.databaseId;
    this.retries = options.retries ?? 3;
  }

  async findByRaindropId(raindropId: string): Promise<NotionPage | null> {
    const dataSourceId = await this.getDataSourceId();
    const response = await this.withRetry(() =>
      this.client.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 1,
        filter: {
          property: RAINDROP_ID_PROPERTY,
          rich_text: { equals: raindropId },
        },
      }),
    );
    const page = response.results[0];

    return page ? { id: page.id, properties: page.properties } : null;
  }

  async createPage(properties: Record<string, unknown>): Promise<string> {
    const page = await this.withRetry(() =>
      this.client.pages.create({
        parent: { database_id: this.databaseId },
        properties,
      }),
    );

    return page.id;
  }

  async updatePage(pageId: string, properties: Record<string, unknown>): Promise<void> {
    await this.withRetry(() => this.client.pages.update({ page_id: pageId, properties }));
  }

  private async getDataSourceId(): Promise<string> {
    if (this.dataSourceId !== undefined) {
      return this.dataSourceId ?? "";
    }

    const database = await this.withRetry(() =>
      this.client.databases.retrieve({ database_id: this.databaseId }),
    );
    this.dataSourceId = database.data_sources?.[0]?.id ?? null;

    if (!this.dataSourceId) {
      throw new NotionApiError(400, "Notion database is not a data source; cannot query pages");
    }

    return this.dataSourceId;
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        attempt += 1;
        const status = statusOf(error);

        if (status === 401) {
          throw new NotionAuthError("Notion authentication failed (401)");
        }

        if (status === 429) {
          if (attempt > this.retries) {
            throw new NotionRateLimitError("Notion rate limit exceeded");
          }
          await sleep(retryAfterMs(error) ?? attempt * 2000);
          continue;
        }

        if (status !== undefined) {
          throw new NotionApiError(status, error instanceof Error ? error.message : String(error));
        }

        throw new NotionNetworkError(error instanceof Error ? error.message : String(error));
      }
    }
  }
}
