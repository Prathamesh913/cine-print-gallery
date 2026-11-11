/**
 * Environment configuration for the automation runner.
 *
 * Errors name the missing variable and never include its value. R2 credentials
 * are only required for apply runs; dry runs must be startable without write
 * credentials so they can be validated safely.
 */

export interface RaindropConfig {
  accessToken: string;
  collectionId: string;
  pageSize: number;
  maxPages: number;
  timeoutMs: number;
  retries: number;
}

export interface TmdbConfig {
  apiKey: string;
  timeoutMs: number;
}

export interface NotionConfig {
  apiKey: string;
  databaseId: string;
  /**
   * Optional `Poster Identities` data source. When absent, identity records are
   * not fetched and multi-image pages are reported for review instead of being
   * resolved from a guessed mapping.
   */
  identitiesDataSourceId: string | null;
  timeoutMs: number;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicBaseUrl: string;
}

export interface PipelineConfig {
  raindrop: RaindropConfig;
  tmdb: TmdbConfig;
  notion: NotionConfig;
  r2: R2Config | null;
  firebaseServiceAccountJson: string | null;
  concurrency: number;
  batchLimit: number;
  maxAttempts: number;
  retryDelayMs: number;
  downloadTimeoutMs: number;
  downloadMaxBytes: number;
  jobCollection: string;
  runCollection: string;
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`Missing required environment variable: ${name}`);
  return value;
}

function optional(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer`);
  }
  return value;
}

export function loadPipelineConfig(
  env: Env = process.env,
  options: { requireR2: boolean; requireIngestionSources?: boolean },
): PipelineConfig {
  const requireIngestionSources = options.requireIngestionSources ?? true;
  const hasAnyR2 = Boolean(
    env.R2_ACCOUNT_ID ||
    env.R2_ACCESS_KEY_ID ||
    env.R2_SECRET_ACCESS_KEY ||
    env.R2_BUCKET_NAME ||
    env.R2_PUBLIC_BASE_URL,
  );
  let r2: R2Config | null = null;
  if (options.requireR2 || hasAnyR2) {
    // Validate the full credential set whenever any R2 value is present, so a
    // half-configured environment fails here instead of mid-upload.
    r2 = {
      accountId: required(env, "R2_ACCOUNT_ID"),
      accessKeyId: required(env, "R2_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "R2_SECRET_ACCESS_KEY"),
      bucketName: required(env, "R2_BUCKET_NAME"),
      publicBaseUrl: required(env, "R2_PUBLIC_BASE_URL"),
    };
  }

  return {
    raindrop: {
      accessToken: requireIngestionSources
        ? required(env, "RAINDROP_ACCESS_TOKEN")
        : (optional(env, "RAINDROP_ACCESS_TOKEN") ?? ""),
      collectionId: requireIngestionSources
        ? required(env, "RAINDROP_COLLECTION_ID")
        : (optional(env, "RAINDROP_COLLECTION_ID") ?? ""),
      pageSize: positiveInt(env, "INGESTION_PAGE_SIZE", 50),
      maxPages: positiveInt(env, "INGESTION_MAX_PAGES", 4),
      timeoutMs: positiveInt(env, "INGESTION_HTTP_TIMEOUT_MS", 20_000),
      retries: positiveInt(env, "INGESTION_HTTP_RETRIES", 3),
    },
    tmdb: {
      apiKey: requireIngestionSources
        ? required(env, "TMDB_API_KEY")
        : (optional(env, "TMDB_API_KEY") ?? ""),
      timeoutMs: positiveInt(env, "TMDB_TIMEOUT_MS", 15_000),
    },
    notion: {
      apiKey: required(env, "NOTION_KEY"),
      databaseId: required(env, "NOTION_DATABASE_ID"),
      identitiesDataSourceId: optional(env, "NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID"),
      timeoutMs: positiveInt(env, "NOTION_TIMEOUT_MS", 30_000),
    },
    r2,
    firebaseServiceAccountJson: optional(env, "FIREBASE_SERVICE_ACCOUNT_JSON"),
    concurrency: positiveInt(env, "INGESTION_CONCURRENCY", 2),
    batchLimit: positiveInt(env, "INGESTION_BATCH_LIMIT", 25),
    maxAttempts: positiveInt(env, "INGESTION_MAX_ATTEMPTS", 3),
    retryDelayMs: positiveInt(env, "INGESTION_RETRY_DELAY_MS", 60_000),
    downloadTimeoutMs: positiveInt(env, "INGESTION_DOWNLOAD_TIMEOUT_MS", 60_000),
    downloadMaxBytes: positiveInt(env, "INGESTION_DOWNLOAD_MAX_BYTES", 30 * 1024 * 1024),
    jobCollection: optional(env, "INGESTION_JOB_COLLECTION") ?? "automationIngestionJobs",
    runCollection: optional(env, "INGESTION_RUN_COLLECTION") ?? "automationIngestionRuns",
  };
}
