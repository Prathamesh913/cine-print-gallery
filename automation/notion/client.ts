import { Client } from "@notionhq/client";
import { NotionDataSourceResolver } from "./data-sources";

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
  /**
   * Explicit Poster Library data source. Required when the database contains
   * more than one data source; the client never falls back to `data_sources[0]`.
   */
  posterDataSourceId?: string | null;
  retries?: number;
  timeoutMs?: number;
  client?: Client;
}

const RAINDROP_ID_PROPERTY = "Raindrop ID";

/** Properties the ingestion pipeline writes and therefore depends on. */
const REQUIRED_POSTER_PROPERTIES = ["Status", "Image URL", RAINDROP_ID_PROPERTY] as const;

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

/** Preserve the HTTP status on typed errors so callers can classify them. */
function withStatus<T extends Error>(error: T, status: number): T {
  return Object.assign(error, { status });
}

export class NotionApiClient implements NotionClient {
  private readonly client: Client;
  private readonly retries: number;
  private readonly resolver: NotionDataSourceResolver;

  constructor(options: NotionApiClientOptions) {
    if (!options.apiKey) {
      throw new Error("NOTION_KEY is required");
    }
    if (!options.databaseId) {
      throw new Error("NOTION_DATABASE_ID is required");
    }
    this.client =
      options.client ??
      new Client({ auth: options.apiKey, timeoutMs: options.timeoutMs ?? 30_000 });
    this.retries = options.retries ?? 3;
    this.resolver = new NotionDataSourceResolver({
      client: this.client,
      request: (operation) => this.withRetry(operation),
      databaseId: options.databaseId,
      posterDataSourceId: options.posterDataSourceId,
      requiredPosterProperties: REQUIRED_POSTER_PROPERTIES,
    });
  }

  /**
   * Resolves and validates the Poster Library data source before a run reads or
   * writes any page, so a bad ID fails once with an actionable message.
   */
  async preflight(): Promise<void> {
    await this.resolver.resolve();
  }

  async findByRaindropId(raindropId: string): Promise<NotionPage | null> {
    const dataSourceId = await this.resolver.resolvePoster();
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
    const dataSourceId = await this.resolver.resolvePoster();
    const page = await this.withRetry(() =>
      this.client.pages.create({
        // Notion API 2025-09-03: a database with multiple data sources requires
        // a data_source_id parent. `database_id` fails in that case.
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties,
      }),
    );

    return page.id;
  }

  async updatePage(pageId: string, properties: Record<string, unknown>): Promise<void> {
    await this.withRetry(() => this.client.pages.update({ page_id: pageId, properties }));
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
          throw withStatus(new NotionAuthError("Notion authentication failed (401)"), 401);
        }

        if (status === 429) {
          if (attempt > this.retries) {
            throw withStatus(new NotionRateLimitError("Notion rate limit exceeded"), 429);
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
