/**
 * Explicit Notion data-source resolution.
 *
 * A Notion database is a container; its tables are data sources. The CinePrint
 * Poster Library database holds two data sources (`Poster Library` and
 * `Poster Identities`), so `data_sources[0]` is not a safe choice and a database
 * ID is not interchangeable with a data source ID.
 *
 * Every pipeline resolves and validates its data sources here, before reading or
 * writing a record. Ambiguity and wrong-object IDs fail closed with an
 * actionable error instead of silently selecting another table.
 */

import type { Client } from "@notionhq/client";

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

/** Notion accepts dashed and undashed UUIDs; compare them in one form. */
export function normalizeNotionId(value: string): string {
  return value.trim().replace(/-/g, "").toLowerCase();
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

export interface NotionDataSourceResolverOptions {
  client: Client;
  /** Runs one API call with the caller's retry policy. */
  request: <T>(operation: () => Promise<T>, event: string) => Promise<T>;
  databaseId: string;
  /** Explicit Poster Library data source. */
  posterDataSourceId?: string | null;
  /** Optional Poster Identities data source. */
  identitiesDataSourceId?: string | null;
  /** Properties the poster data source must expose for this pipeline. */
  requiredPosterProperties?: readonly string[];
}

export interface NotionDataSourcePlan {
  posterDataSourceId: string;
  identitiesDataSourceId: string | null;
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

function listFormat(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

export class NotionDataSourceResolver {
  private poster: string | null = null;
  private identities: string | null | undefined;
  private plan: NotionDataSourcePlan | null = null;

  constructor(private readonly options: NotionDataSourceResolverOptions) {
    if (!options.databaseId) throw new Error("NOTION_DATABASE_ID is required");
  }

  /** Resolves and validates the poster and (when configured) identity sources. */
  async resolve(): Promise<NotionDataSourcePlan> {
    if (this.plan) return this.plan;
    const posterDataSourceId = await this.resolvePoster();
    const identitiesDataSourceId = await this.resolveIdentities(posterDataSourceId);
    this.plan = { posterDataSourceId, identitiesDataSourceId };
    return this.plan;
  }

  async resolvePoster(): Promise<string> {
    if (this.poster) return this.poster;

    const explicit = this.options.posterDataSourceId?.trim();
    if (explicit) {
      await this.assertPosterDataSource(explicit, "NOTION_POSTER_DATA_SOURCE_ID");
      this.poster = explicit;
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
    await this.assertPosterDataSource(candidate.id, "NOTION_DATABASE_ID");
    this.poster = candidate.id;
    return candidate.id;
  }

  async resolveIdentities(posterDataSourceId?: string): Promise<string | null> {
    const configured = this.options.identitiesDataSourceId?.trim();
    // Absent configuration is a supported degraded mode, not an error.
    if (!configured) {
      this.identities = null;
      return null;
    }
    if (this.identities !== undefined) return this.identities;

    const poster = posterDataSourceId ?? (await this.resolvePoster());
    if (normalizeNotionId(configured) === normalizeNotionId(poster)) {
      throw new NotionConfigurationError(
        `NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID (${configured}) is the same data source as the ` +
          "poster catalogue. Refusing to read identity rows from the catalogue; unset the " +
          "variable when there is no separate Poster Identities data source.",
        "wrong_object",
        "NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID",
      );
    }

    await this.assertDataSource(configured, {
      variable: "NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID",
      objectId: configured,
      purpose: "poster identity rows",
      objectKind: "data source",
    });
    this.identities = configured;
    return configured;
  }

  private async retrieveDatabase(): Promise<DatabaseShape> {
    try {
      return (await this.options.request(
        () => this.options.client.databases.retrieve({ database_id: this.options.databaseId }),
        "notion.database",
      )) as unknown as DatabaseShape;
    } catch (error) {
      throw this.describeFailure(error, {
        variable: "NOTION_DATABASE_ID",
        objectId: this.options.databaseId,
        purpose: "poster catalogue database",
        objectKind: "database",
      });
    }
  }

  private async assertPosterDataSource(dataSourceId: string, variable: string): Promise<void> {
    const dataSource = await this.assertDataSource(dataSourceId, {
      variable,
      objectId: dataSourceId,
      purpose: "poster catalogue",
      objectKind: "data source",
    });

    const required = this.options.requiredPosterProperties ?? [];
    const properties = dataSource.properties ?? {};
    const missing = required.filter((name) => !(name in properties));
    if (missing.length > 0) {
      throw new NotionConfigurationError(
        `Notion data source ${dataSourceId} is missing the ${listFormat(missing)} ` +
          `propert${missing.length === 1 ? "y" : "ies"}, so it is not the CinePrint Poster ` +
          `Library. ${variable} resolves to it. Refusing to use another table. ` +
          "No records were processed.",
        "unexpected_shape",
        variable,
      );
    }
  }

  private async assertDataSource(
    dataSourceId: string,
    context: RequestContext,
  ): Promise<DataSourceShape> {
    try {
      return (await this.options.request(
        () => this.options.client.dataSources.retrieve({ data_source_id: dataSourceId }),
        "notion.data_source",
      )) as unknown as DataSourceShape;
    } catch (error) {
      throw this.describeFailure(error, context);
    }
  }

  /**
   * Turns Notion failures into configuration errors that name the variable and
   * distinguish an inaccessible ID from a missing one. Unknown failures are
   * rethrown untouched so they are not mistaken for configuration problems.
   */
  private describeFailure(error: unknown, context: RequestContext): Error {
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
          `access to it. Share the ${context.purpose} with the integration. ` +
          "No records were processed.",
        "inaccessible",
        context.variable,
      );
    }

    return error instanceof Error ? error : new Error(String(error));
  }
}
