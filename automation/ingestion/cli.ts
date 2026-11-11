#!/usr/bin/env tsx
/**
 * Automation entry point.
 *
 * Safety default: dry-run. Writes require all three of `--apply`,
 * `--confirm-apply` and an explicit `--limit`, and only the `apply` branch ever
 * constructs write-capable adapters. The confirmation flag exists so a local
 * shell history entry, npm script or copy-pasted command cannot silently write
 * to production.
 *
 * Exit codes: 0 success (including dry-run findings), 1 fatal or apply failures,
 * 2 rejected invocation (no work performed).
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NotionApiClient } from "../notion/client";
import { NotionDraftSync } from "../notion/sync";
import { createLogger, type Logger } from "./logger";
import { loadPipelineConfig, type PipelineConfig } from "./config";
import { fetchRaindropBookmarks } from "./raindrop";
import { runIngestion, type IngestionRunnerDeps } from "./runner";
import { runPublishingSync } from "./publish";
import { NotionPollingSource } from "./notion-pages";
import { downloadSourceImage } from "./download";
import { prepareImage } from "./image";
import { R2ImagePublisher } from "./r2-images";
import { R2StoreImpl } from "../migration/r2";
import { getOptimizerIdentity } from "../migration/versioning";
import {
  FirestoreJobStore,
  FirestoreRunStore,
  InMemoryJobStore,
  InMemoryRunStore,
  type FirestoreLike,
  type JobStore,
} from "./state";
import { InMemoryPosterCatalog, type PosterCatalog } from "./poster-catalog";
import { FirestorePosterCatalog, initFirestore } from "./firestore-adapters";
import { TMDBEnrichmentService } from "../tmdb/service";
import type { ExecutionSummary, RunRecord } from "./types";

type Mode = "ingest" | "publish" | "all";

interface CliOptions {
  mode: Mode;
  apply: boolean;
  confirmApply: boolean;
  limit: number | null;
  maxPages: number | null;
  runId: string;
  summaryOut: string | null;
}

const USAGE = `Usage: tsx automation/ingestion/cli.ts [options]

  --mode <ingest|publish|all>   Work to run (default: ingest)
  --apply                       Perform external writes (default: dry-run)
  --confirm-apply               Required with --apply; explicit local confirmation
  --limit <n>                   Maximum posters processed this run (required with --apply)
  --max-pages <n>               Maximum Raindrop pages fetched
  --run-id <id>                 Stable run identifier for logs
  --summary-out <path>          Also write the JSON summary to a file
  --help                        Show this help

Dry-run reads are allowed; no R2, Notion, or Firestore writes occur.
Apply requires --confirm-apply and an explicit --limit.`;

export function parseCliArgs(argv: string[]): CliOptions {
  let mode: Mode = "ingest";
  let apply = false;
  let confirmApply = false;
  let limit: number | null = null;
  let maxPages: number | null = null;
  let runId = `run-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  let summaryOut: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };

    switch (arg) {
      case "--mode": {
        const value = next();
        if (value !== "ingest" && value !== "publish" && value !== "all") {
          throw new Error("--mode must be one of ingest, publish, all");
        }
        mode = value;
        break;
      }
      case "--apply":
        apply = true;
        break;
      case "--confirm-apply":
        confirmApply = true;
        break;
      case "--limit": {
        const value = Number(next());
        if (!Number.isInteger(value) || value <= 0) throw new Error("--limit must be positive");
        limit = value;
        break;
      }
      case "--max-pages": {
        const value = Number(next());
        if (!Number.isInteger(value) || value <= 0) throw new Error("--max-pages must be positive");
        maxPages = value;
        break;
      }
      case "--run-id":
        runId = next();
        break;
      case "--summary-out":
        summaryOut = next();
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (confirmApply && !apply) {
    throw new Error("--confirm-apply is only valid together with --apply");
  }
  if (apply && !confirmApply) {
    throw new Error(
      "--apply requires --confirm-apply. Re-run with --apply --confirm-apply --limit 1 after reviewing a dry-run.",
    );
  }
  if (apply && limit === null) {
    throw new Error("--apply requires an explicit --limit (use --limit 1 for a controlled test)");
  }

  return { mode, apply, confirmApply, limit, maxPages, runId, summaryOut };
}

interface Runtime {
  jobStore: JobStore;
  runStore: { save(record: RunRecord): Promise<void> };
  catalog: PosterCatalog;
  logger: Logger;
  firestoreAvailable: boolean;
}

function buildRuntime(config: PipelineConfig, options: CliOptions, logger: Logger): Runtime {
  if (!options.apply) {
    // Dry runs may read existing state when Admin credentials are available so
    // skip detection and planned updates match production. No write path is
    // reachable while dryRun is true.
    if (config.firebaseServiceAccountJson) {
      try {
        const db = initFirestore(config.firebaseServiceAccountJson) as unknown as FirestoreLike;
        return {
          jobStore: new FirestoreJobStore(db, config.jobCollection, logger),
          runStore: new InMemoryRunStore(),
          catalog: new FirestorePosterCatalog(db),
          logger,
          firestoreAvailable: true,
        };
      } catch (error) {
        logger.warn("automation.dry_run_firestore_unavailable", {
          note: "Falling back to empty in-memory state for this dry run.",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    logger.warn("automation.dry_run_without_firestore", {
      note: "Existing state is not read; job and catalogue checks use empty in-memory stores.",
    });
    return {
      jobStore: new InMemoryJobStore(),
      runStore: new InMemoryRunStore(),
      catalog: new InMemoryPosterCatalog(),
      logger,
      firestoreAvailable: false,
    };
  }

  if (!config.firebaseServiceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is required for apply runs");
  }
  const db = initFirestore(config.firebaseServiceAccountJson) as unknown as FirestoreLike;
  return {
    jobStore: new FirestoreJobStore(db, config.jobCollection, logger),
    runStore: new FirestoreRunStore(db, config.runCollection),
    catalog: new FirestorePosterCatalog(db),
    logger,
    firestoreAvailable: true,
  };
}

function tmdbLogger(logger: Logger) {
  return {
    log: (...args: unknown[]) => logger.debug("tmdb.log", { message: args.join(" ") }),
    error: (...args: unknown[]) => logger.error("tmdb.error", { message: args.join(" ") }),
  };
}

async function runIngest(
  config: PipelineConfig,
  runtime: Runtime,
  options: CliOptions,
  logger: Logger,
): Promise<ExecutionSummary> {
  const fetched = await fetchRaindropBookmarks({
    accessToken: config.raindrop.accessToken,
    collectionId: config.raindrop.collectionId,
    pageSize: config.raindrop.pageSize,
    maxPages: options.maxPages ?? config.raindrop.maxPages,
    timeoutMs: config.raindrop.timeoutMs,
    retries: config.raindrop.retries,
    logger,
  });

  logger.info("raindrop.fetched", {
    pages: fetched.pagesFetched,
    bookmarks: fetched.bookmarks.length,
    totalCount: fetched.totalCount,
    truncated: fetched.truncated,
  });

  const optimizer = getOptimizerIdentity();
  const tmdb = new TMDBEnrichmentService({
    apiKey: config.tmdb.apiKey,
    timeoutMs: config.tmdb.timeoutMs,
    logger: tmdbLogger(logger),
  });
  const drafts = new NotionDraftSync(
    new NotionApiClient({
      apiKey: config.notion.apiKey,
      databaseId: config.notion.databaseId,
      timeoutMs: config.notion.timeoutMs,
    }),
  );

  const needsR2 = options.apply && config.r2;
  const r2 = needsR2
    ? new R2ImagePublisher({
        store: new R2StoreImpl({
          accountId: config.r2!.accountId,
          accessKeyId: config.r2!.accessKeyId,
          secretAccessKey: config.r2!.secretAccessKey,
          bucket: config.r2!.bucketName,
          publicBaseUrl: config.r2!.publicBaseUrl,
        }),
        publicBaseUrl: config.r2!.publicBaseUrl,
        optimizer,
        logger,
      })
    : null;

  const deps: IngestionRunnerDeps = {
    jobStore: runtime.jobStore,
    enrich: async (draft, job) =>
      job?.tmdbId ? tmdb.enrichDraftWithTmdbId(draft, job.tmdbId) : tmdb.enrichDraft(draft),
    download: (url) =>
      downloadSourceImage(url, {
        authToken: config.raindrop.accessToken,
        timeoutMs: config.downloadTimeoutMs,
        maxBytes: config.downloadMaxBytes,
      }),
    prepare: (downloaded) => prepareImage(downloaded, { optimizer }),
    r2,
    optimizer,
    drafts,
    logger,
    concurrency: config.concurrency,
    maxAttempts: config.maxAttempts,
    retryDelayMs: config.retryDelayMs,
    batchLimit: options.limit ?? config.batchLimit,
    publicBaseUrl: config.r2?.publicBaseUrl,
  };

  return runIngestion(deps, {
    bookmarks: fetched.bookmarks,
    dryRun: !options.apply,
    runId: options.runId,
  });
}

async function runPublish(
  config: PipelineConfig,
  runtime: Runtime,
  options: CliOptions,
  logger: Logger,
): Promise<ExecutionSummary> {
  const source = new NotionPollingSource({
    apiKey: config.notion.apiKey,
    databaseId: config.notion.databaseId,
    identitiesDataSourceId: config.notion.identitiesDataSourceId,
    timeoutMs: config.notion.timeoutMs,
    logger,
  });

  return runPublishingSync(
    {
      source,
      catalog: runtime.catalog,
      jobs: runtime.jobStore,
      logger,
      batchLimit: options.limit ?? 100,
    },
    { runId: options.runId, dryRun: !options.apply },
  );
}

function writeSummary(output: unknown, summaryOut: string | null) {
  const text = `${JSON.stringify(output, null, 2)}\n`;
  if (summaryOut) {
    fs.mkdirSync(path.dirname(summaryOut) || ".", { recursive: true });
    fs.writeFileSync(summaryOut, text, "utf8");
  }
  // stdout carries exactly one machine-readable document.
  process.stdout.write(text);
}

function failureCount(summary: ExecutionSummary): number {
  return summary.counts.failed;
}

function fatalSummary(options: CliOptions, startedAt: Date, message: string): ExecutionSummary {
  const now = new Date().toISOString();
  const failure = {
    posterId: null,
    raindropId: null,
    stage: "failed" as const,
    reason: message,
    retryable: true,
  };

  if (options.mode === "publish") {
    return {
      mode: "publish",
      schemaVersion: 1,
      runId: options.runId,
      dryRun: !options.apply,
      startedAt: startedAt.toISOString(),
      finishedAt: now,
      counts: {
        publishedRecordsDiscovered: 0,
        firestoreRecordsCreated: 0,
        firestoreRecordsUpdated: 0,
        alreadySynchronized: 0,
        needsReview: 0,
        failed: 1,
      },
      failures: [failure],
    };
  }

  return {
    mode: "ingest",
    schemaVersion: 1,
    runId: options.runId,
    dryRun: !options.apply,
    startedAt: startedAt.toISOString(),
    finishedAt: now,
    counts: {
      bookmarksDiscovered: 0,
      alreadyProcessed: 0,
      newCandidates: 0,
      tmdbMatches: 0,
      needsReview: 0,
      uploadsVerified: 0,
      notionDraftsCreated: 0,
      notionDraftsUpdated: 0,
      failed: 1,
    },
    failures: [failure],
  };
}

async function main() {
  let options: CliOptions;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Automation invocation rejected: ${message}`);
    process.exitCode = 2;
    return;
  }

  const startedAt = new Date();
  const logger = createLogger({
    runId: options.runId,
    mode: options.mode,
    dryRun: !options.apply,
  });

  logger.info("automation.started", { apply: options.apply, mode: options.mode });

  try {
    const config = loadPipelineConfig(process.env, {
      requireR2: options.apply && (options.mode === "ingest" || options.mode === "all"),
      requireIngestionSources: options.mode !== "publish",
    });
    const runtime = buildRuntime(config, options, logger);

    if (!options.apply) {
      logger.warn("automation.dry_run", {
        note: "No R2, Notion, or Firestore writes will be performed.",
      });
    }

    let failed = 0;
    let ingestion: ExecutionSummary | null = null;
    let publishing: ExecutionSummary | null = null;

    if (options.mode === "ingest" || options.mode === "all") {
      ingestion = await runIngest(config, runtime, options, logger);
      failed += failureCount(ingestion);
      if (options.apply) {
        await runtime.runStore.save({ ...ingestion, jobCollection: config.jobCollection });
      }
    }

    if (options.mode === "publish" || options.mode === "all") {
      publishing = await runPublish(config, runtime, options, logger);
      failed += failureCount(publishing);
      if (options.apply) {
        await runtime.runStore.save({ ...publishing, jobCollection: config.jobCollection });
      }
    }

    const output =
      options.mode === "all"
        ? { ingestion, publishing }
        : options.mode === "ingest"
          ? ingestion
          : publishing;

    writeSummary(output, options.summaryOut);
    logger.info("automation.finished", { failed });
    process.exitCode = options.apply && failed > 0 ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("automation.fatal", { reason: message });
    writeSummary(fatalSummary(options, startedAt, message), options.summaryOut);
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("automation/ingestion/cli.ts") ||
    process.argv[1].endsWith("automation/ingestion/cli.js"));

if (isMain) {
  void main();
}
