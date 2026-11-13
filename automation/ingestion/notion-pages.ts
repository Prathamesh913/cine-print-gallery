/**
 * Bounded Notion polling source for the publishing sync.
 *
 * Notion webhooks require a public HTTPS endpoint with a verification
 * handshake and durable delivery handling, which a GitHub Actions cron job
 * cannot provide. Polling the data source and skipping unchanged records is the
 * supported alternative.
 *
 * Data-source resolution is explicit and validated before any record is read:
 * a database is not a data source, and a database may contain several data
 * sources. Guessing which one is the poster catalogue would silently publish
 * from (or to) the wrong table, so ambiguity is a configuration error. The
 * resolution itself lives in `../notion/data-sources` and is shared with the
 * ingestion client.
 */

import { Client } from "@notionhq/client";
import { identityRecordsFromNotion, type IdentityRecord } from "../../scripts/poster-identity.js";
import {
  NotionConfigurationError,
  NotionDataSourceResolver,
  normalizeNotionId,
  type NotionConfigProblem,
} from "../notion/data-sources";
import type { Logger } from "./logger";

export { NotionConfigurationError, normalizeNotionId };
export type { NotionConfigProblem };

export const DEFAULT_NOTION_PAGE_SIZE = 100;
export const DEFAULT_NOTION_MAX_PAGES = 10;

/** Properties the poster catalogue data source must expose. */
export const REQUIRED_CATALOGUE_PROPERTIES = ["Status", "Image URL"] as const;

export interface NotionPageLike {
  id: string;
  last_edited_time?: string;
  properties: Record<string, unknown>;
}

export interface NotionPageSource {
  /** All non-archived catalogue pages, published or not. */
  listPages(): Promise<NotionPageLike[]>;
  listIdentityRecords(): Promise<IdentityRecord[]>;
  /** Validates every configured Notion object before any record is processed. */
  preflight?(): Promise<void>;
}

export interface NotionPollingSourceOptions {
  apiKey: string;
  databaseId: string;
  /**
   * Explicit Poster Library data source. Optional for a database with a single
   * data source; required to disambiguate a database that holds several.
   */
  posterDataSourceId?: string | null;
  identitiesDataSourceId?: string | null;
  pageSize?: number;
  maxPages?: number;
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  client?: Client;
  logger?: Logger;
}

export function statusName(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const value = prop as {
    type?: string;
    select?: { name?: string } | null;
    status?: { name?: string } | null;
  };
  if (value.type === "status") return value.status?.name ?? "";
  return value.select?.name ?? "";
}

export function isPublishedStatus(value: string): boolean {
  return value.trim().toLowerCase() === "published";
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withNotionRetry<T>(
  operation: () => Promise<T>,
  options: { retries: number; baseDelayMs: number; logger?: Logger; event: string },
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const status = statusOf(error);
      const retryable = status === 429 || (status !== undefined && status >= 500);
      if (!retryable || attempt >= options.retries) throw error;
      const delay = Math.min(options.baseDelayMs * 2 ** attempt, 30_000);
      attempt += 1;
      options.logger?.warn(`${options.event}.retry`, { attempt, delayMs: delay, status });
      await sleep(delay);
    }
  }
}

export class NotionPollingSource implements NotionPageSource {
  private readonly client: Client;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly retries: number;
  private readonly baseDelayMs: number;
  private readonly resolver: NotionDataSourceResolver;

  constructor(private readonly options: NotionPollingSourceOptions) {
    if (!options.apiKey) throw new Error("NOTION_KEY is required");
    if (!options.databaseId) throw new Error("NOTION_DATABASE_ID is required");
    this.client =
      options.client ??
      new Client({ auth: options.apiKey, timeoutMs: options.timeoutMs ?? 30_000 });
    this.pageSize = options.pageSize ?? DEFAULT_NOTION_PAGE_SIZE;
    this.maxPages = options.maxPages ?? DEFAULT_NOTION_MAX_PAGES;
    this.retries = options.retries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.resolver = new NotionDataSourceResolver({
      client: this.client,
      request: (operation, event) =>
        withNotionRetry(operation, {
          retries: this.retries,
          baseDelayMs: this.baseDelayMs,
          logger: this.options.logger,
          event,
        }),
      databaseId: options.databaseId,
      posterDataSourceId: options.posterDataSourceId,
      identitiesDataSourceId: options.identitiesDataSourceId,
      requiredPosterProperties: REQUIRED_CATALOGUE_PROPERTIES,
    });
  }

  /**
   * Resolves and validates the catalogue and identity data sources. Callers run
   * this before listing pages so a bad ID fails with an actionable message
   * instead of an opaque Notion error halfway through a run.
   */
  async preflight(): Promise<void> {
    await this.resolver.resolve();
  }

  async listPages(): Promise<NotionPageLike[]> {
    const dataSourceId = await this.resolver.resolvePoster();
    const pages: NotionPageLike[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < this.maxPages; page += 1) {
      const response = await withNotionRetry(
        () =>
          this.client.dataSources.query({
            data_source_id: dataSourceId,
            page_size: this.pageSize,
            start_cursor: cursor,
            sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
          }),
        {
          retries: this.retries,
          baseDelayMs: this.baseDelayMs,
          logger: this.options.logger,
          event: "notion.query",
        },
      );

      for (const result of response.results) {
        const candidate = result as unknown as NotionPageLike;
        if (!candidate?.id || !candidate.properties) continue;
        pages.push(candidate);
      }

      if (!response.has_more || !response.next_cursor) break;
      cursor = response.next_cursor;
    }

    return pages;
  }

  /**
   * Identity rows are optional. Without a configured data source this returns
   * an empty list and does not query the catalogue data source as a fallback;
   * the publishing sync then reports multi-image pages for review instead of
   * guessing an image-to-poster mapping.
   */
  async listIdentityRecords(): Promise<IdentityRecord[]> {
    const dataSourceId = await this.resolver.resolveIdentities();
    if (!dataSourceId) return [];

    const rows: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < this.maxPages; page += 1) {
      const response = await withNotionRetry(
        () =>
          this.client.dataSources.query({
            data_source_id: dataSourceId,
            page_size: this.pageSize,
            start_cursor: cursor,
          }),
        {
          retries: this.retries,
          baseDelayMs: this.baseDelayMs,
          logger: this.options.logger,
          event: "notion.identities",
        },
      );
      rows.push(...response.results);
      if (!response.has_more || !response.next_cursor) break;
      cursor = response.next_cursor;
    }

    return identityRecordsFromNotion(rows);
  }
}
