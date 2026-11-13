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
 * from (or to) the wrong table, so ambiguity is a configuration error.
 */

import { Client } from "@notionhq/client";
import { identityRecordsFromNotion, type IdentityRecord } from "../../scripts/poster-identity.js";
import type { Logger } from "./logger";

export const DEFAULT_NOTION_PAGE_SIZE = 100;
export const DEFAULT_NOTION_MAX_PAGES = 10;

/** Properties the poster catalogue data source must expose. */
export const REQUIRED_CATALOGUE_PROPERTIES = ["Status", "Image URL"] as const;

export type NotionConfigProblem =
  /** The variable is optional and was not supplied. */
  | "missing"
  /** The database exposes several data sources and none was named explicitly. */
  | "ambiguous"
  /** Notion cannot see the object, usually because it is not shared. */
  | "inaccessible"
  /** The ID is valid but points at a database or page rather than a data source. */
  | "wrong_object"
  /** The object exists but does not have the shape this workflow requires. */
  | "unexpected_shape";

/**
 * A configuration problem the operator can fix. Messages name the variable and
 * the offending ID, and never contain a credential value.
 */
export class NotionConfigurationError extends Error {
  constructor(
    message: string,
    readonly problem: NotionConfigProblem,
    readonly variable: string,
  ) {
    super(message);
    this.name = "NotionConfigurationError";
  }
}

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

interface DatabaseShape {
  id?: string;
  data_sources?: Array<{ id?: string; name?: string }>;
}

interface DataSourceShape {
  id?: string;
  properties?: Record<string, unknown>;
}

interface RequestContext {
  variable: string;
  objectId: string;
  purpose: string;
  objectKind: "database" | "data source";
}

/** Notion accepts dashed and undashed UUIDs; compare them in one form. */
export function normalizeNotionId(value: string): string {
  return value.trim().replace(/-/g, "").toLowerCase();
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

function notionCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isObjectNotFound(error: unknown): boolean {
  return statusOf(error) === 404 || notionCode(error) === "object_not_found";
}

function isRestricted(error: unknown): boolean {
  return statusOf(error) === 403 || notionCode(error) === "restricted_resource";
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
  private dataSourceId: string | null = null;
  private resolvedIdentitiesDataSourceId: string | null | undefined;
  private preflighted = false;

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
  }

  /**
   * Resolves and validates the catalogue and identity data sources. Callers run
   * this before listing pages so a bad ID fails with an actionable message
   * instead of an opaque Notion error halfway through a run.
   */
  async preflight(): Promise<void> {
    if (this.preflighted) return;
    await this.resolveCatalogueDataSourceId();
    await this.resolveIdentitiesDataSourceId();
    this.preflighted = true;
  }

  async listPages(): Promise<NotionPageLike[]> {
    const dataSourceId = await this.resolveCatalogueDataSourceId();
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
    const dataSourceId = await this.resolveIdentitiesDataSourceId();
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

  private async resolveCatalogueDataSourceId(): Promise<string> {
    if (this.dataSourceId) return this.dataSourceId;

    const explicit = this.options.posterDataSourceId?.trim();
    if (explicit) {
      await this.loadCatalogueDataSource(explicit, "NOTION_POSTER_DATA_SOURCE_ID");
      this.dataSourceId = explicit;
      return explicit;
    }

    const database = await this.retrieveDatabase();
    const candidates = (database.data_sources ?? []).filter(
      (candidate): candidate is { id: string; name?: string } =>
        typeof candidate.id === "string" && candidate.id !== "",
    );

    if (candidates.length === 0) {
      throw new NotionConfigurationError(
        `NOTION_DATABASE_ID (${this.options.databaseId}) exposes no data sources. ` +
          "Point it at the CinePrint Poster Library database, or set " +
          "NOTION_POSTER_DATA_SOURCE_ID to the Poster Library data source ID.",
        "unexpected_shape",
        "NOTION_DATABASE_ID",
      );
    }

    if (candidates.length > 1) {
      const listed = candidates
        .map((candidate) => `${candidate.name || "(untitled)"} (${candidate.id})`)
        .join(", ");
      throw new NotionConfigurationError(
        `NOTION_DATABASE_ID (${this.options.databaseId}) exposes ${candidates.length} data ` +
          `sources: ${listed}. Refusing to guess which one is the poster catalogue; set ` +
          "NOTION_POSTER_DATA_SOURCE_ID to the Poster Library data source ID.",
        "ambiguous",
        "NOTION_POSTER_DATA_SOURCE_ID",
      );
    }

    const [candidate] = candidates;
    await this.loadCatalogueDataSource(candidate.id, "NOTION_DATABASE_ID");
    this.dataSourceId = candidate.id;
    return candidate.id;
  }

  private async resolveIdentitiesDataSourceId(): Promise<string | null> {
    const configured = this.options.identitiesDataSourceId?.trim();
    // Absent configuration is a supported degraded mode, not an error.
    if (!configured) {
      this.resolvedIdentitiesDataSourceId = null;
      return null;
    }
    if (this.resolvedIdentitiesDataSourceId !== undefined) {
      return this.resolvedIdentitiesDataSourceId;
    }

    const catalogueId = await this.resolveCatalogueDataSourceId();
    if (normalizeNotionId(configured) === normalizeNotionId(catalogueId)) {
      throw new NotionConfigurationError(
        `NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID (${configured}) is the same data source as the ` +
          "poster catalogue. Refusing to read identity rows from the catalogue; unset the " +
          "variable when there is no separate Poster Identities data source.",
        "wrong_object",
        "NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID",
      );
    }

    await this.loadDataSource(configured, {
      variable: "NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID",
      objectId: configured,
      purpose: "poster identity rows",
      objectKind: "data source",
    });
    this.resolvedIdentitiesDataSourceId = configured;
    return configured;
  }

  private async retrieveDatabase(): Promise<DatabaseShape> {
    try {
      return (await withNotionRetry(
        () => this.client.databases.retrieve({ database_id: this.options.databaseId }),
        {
          retries: this.retries,
          baseDelayMs: this.baseDelayMs,
          logger: this.options.logger,
          event: "notion.database",
        },
      )) as unknown as DatabaseShape;
    } catch (error) {
      throw this.describeNotionFailure(error, {
        variable: "NOTION_DATABASE_ID",
        objectId: this.options.databaseId,
        purpose: "poster catalogue database",
        objectKind: "database",
      });
    }
  }

  private async loadCatalogueDataSource(dataSourceId: string, variable: string): Promise<void> {
    const dataSource = await this.loadDataSource(dataSourceId, {
      variable,
      objectId: dataSourceId,
      purpose: "poster catalogue",
      objectKind: "data source",
    });

    const properties = dataSource.properties ?? {};
    const missing = REQUIRED_CATALOGUE_PROPERTIES.filter((name) => !(name in properties));
    if (missing.length > 0) {
      throw new NotionConfigurationError(
        `Notion data source ${dataSourceId} is missing the ${missing.join(" and ")} ` +
          `propert${missing.length === 1 ? "y" : "ies"}, so it is not the CinePrint Poster ` +
          `${variable} resolves to it. Refusing to query another table. ` +
          "No records were processed.",
        "unexpected_shape",
        variable,
      );
    }
  }

  private async loadDataSource(
    dataSourceId: string,
    context: RequestContext,
  ): Promise<DataSourceShape> {
    try {
      return (await withNotionRetry(
        () => this.client.dataSources.retrieve({ data_source_id: dataSourceId }),
        {
          retries: this.retries,
          baseDelayMs: this.baseDelayMs,
          logger: this.options.logger,
          event: "notion.data_source",
        },
      )) as unknown as DataSourceShape;
    } catch (error) {
      throw this.describeNotionFailure(error, context);
    }
  }

  /**
   * Turns Notion failures into configuration errors that name the variable and
   * distinguish an inaccessible ID from a missing one. Unknown failures are
   * rethrown untouched so they are not mistaken for configuration problems.
   */
  private describeNotionFailure(error: unknown, context: RequestContext): Error {
    if (statusOf(error) === 401) {
      return new NotionConfigurationError(
        `Notion rejected NOTION_KEY (401) while resolving the ${context.purpose}. ` +
          "Rotate the integration token; no records were processed.",
        "inaccessible",
        "NOTION_KEY",
      );
    }

    if (isObjectNotFound(error)) {
      const isDatabaseIdAsDataSource =
        context.objectKind === "data source" &&
        normalizeNotionId(context.objectId) === normalizeNotionId(this.options.databaseId);
      const guidance = isDatabaseIdAsDataSource
        ? `${context.variable} is set to the CinePrint Poster Library database ID. A Notion ` +
          "database is not a data source: set the variable to the data source ID instead."
        : "Verify the ID is correct and that the object is shared with the " +
          '"CinePrint" integration.';
      return new NotionConfigurationError(
        `${context.variable} (${context.objectId}) is not an accessible Notion ` +
          `${context.objectKind} for the ${context.purpose}. ${guidance} No records were processed.`,
        isDatabaseIdAsDataSource ? "wrong_object" : "inaccessible",
        context.variable,
      );
    }

    if (isRestricted(error)) {
      return new NotionConfigurationError(
        `${context.variable} (${context.objectId}) exists but the "CinePrint" integration has no ` +
          `read access to it. Share the ${context.purpose} with the integration. ` +
          "No records were processed.",
        "inaccessible",
        context.variable,
      );
    }

    return error instanceof Error ? error : new Error(String(error));
  }
}
