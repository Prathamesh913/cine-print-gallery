import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createR2StoreFromEnv } from "./r2";
import { MigrationOptimizer } from "./optimize";
import {
  DEFAULT_SOURCE_TIMEOUT_MS,
  SourceDownloader,
  redactSecrets,
  resolveSourceTimeoutMs,
} from "./source";
import { MigrationStateStore } from "./state";
import { MigrationEngine } from "./engine";
import { withGlobalMigrationLock } from "./lock";
import { RunObserver } from "./observer";
import { FileSink } from "./logger";
import { createCliObserver, runObservedBatch, withObserver } from "./command-runner";
import { MigrationObservabilityError } from "./failures";
import type { MigrationEventSink } from "./observer";
import type { RunSummary } from "./health";
import { buildCanaryPlan } from "./canary";
import { buildDryRunReport, renderDryRunMarkdown } from "./dry-run-report";
import {
  loadApprovals,
  loadFirestoreSnapshot,
  loadManifest,
  manifestHash,
  resolveApprovalsPath,
  resolveManifestPath,
  resolveSnapshotPath,
  resolveStatePath,
  validateAgainstSnapshot,
  validateManifest,
} from "./manifest";
import type { ManifestEntry, MigrationResult, PosterManifest } from "./types";

import {
  parseCommand,
  parseFlags,
  selectEntries,
  validateCommandFlags,
  type CliFlags,
  type Command,
} from "./cli-args";

function usage(): string {
  return `CinePrint R2 migration engine

Usage:
  npm run migration:dry-run -- [options]
  npm run migration:canary -- [options]
  npm run migration:run -- [options]
  npm run migration:verify -- [options]

Commands:
  dry-run   Read-only report. Never writes to R2.
  canary    Plan by default. Requires --execute to download/upload a selected set.
  run       Requires --execute and exactly one of --all or --posters.
  verify    Read-only verification of uploaded objects. Never modifies objects.

Options:
  --execute                 Required for canary/run writes.
  --all                     Explicitly select all 63 posters for run.
  --break-lock              Explicitly recover a stale global or per-state lock before an execute run.
  --posters id1,id2         Canary or run selection. Canary defaults to one Raindrop, one pbs, one artwork.
  --concurrency N           Worker count, 1-8. Default 3.
  --manifest PATH           Default migration/poster-manifest.json.
  --snapshot PATH           Default migration/firestore-identities.json.
  --approvals PATH          Default migration/medium-confidence-approvals.json.
  --state PATH              Default migration/migration-state.json.
  --report PATH             Default migration/dry-run-report.md.
  --retry-conflicts         Retry entries previously marked CONFLICT.
  --retry-source-changed    Retry entries previously marked SOURCE_CHANGED.
  --audit PATH              Append-only audit JSONL. Defaults to migration/audit/<run-id>.jsonl.
  --run-id ID               Stable run ID. Reuse it to resume the same audit history.
  --batch-id ID             Stable batch ID. Defaults to a deterministic selection hash.
  --log-file PATH           Optional structured JSON-lines log sink.

Safety:
  dry-run and verify never write to R2.
  run requires --execute plus exactly one of --all or --posters.
  canary requires --execute for writes and never accepts --all.
  canary accepts only high-confidence posters; medium/low-confidence entries are excluded.
  --break-lock never removes a live, malformed, foreign-host or out-of-scope lock.
  run/canary/verify initialize the audit observer before work; initialization failure aborts.
`;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function loadContext(flags: CliFlags): {
  manifest: PosterManifest;
  approvals: ReturnType<typeof loadApprovals>;
  manifestHashValue: string;
} {
  const manifest = loadManifest(flags.manifestPath);
  const validation = validateManifest(manifest);
  for (const warning of validation.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  const snapshot = loadFirestoreSnapshot(flags.snapshotPath);
  const snapshotValidation = validateAgainstSnapshot(manifest, snapshot);
  if (!snapshotValidation.ok) {
    throw new Error(
      `Firestore snapshot validation failed:\n- ${snapshotValidation.errors.join("\n- ")}`,
    );
  }

  const approvals = loadApprovals(flags.approvalsPath, manifest);
  return { manifest, approvals, manifestHashValue: manifestHash(manifest) };
}

function noopDownloader() {
  return {
    async download(): Promise<never> {
      throw new Error("Downloader is not available in this read-only command");
    },
  };
}

function noopOptimizer() {
  return {
    async optimize(): Promise<never> {
      throw new Error("Optimizer is not available in this read-only command");
    },
  };
}

function sourceTimeoutFromEnv(): number {
  const raw = process.env.MIGRATION_SOURCE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_SOURCE_TIMEOUT_MS;
  return resolveSourceTimeoutMs(Number(raw));
}

function printRunSummary(summary: RunSummary, observer: RunObserver): void {
  console.log("");
  console.log("Audit-backed run summary:");
  console.log(`  run: ${summary.runId}${summary.batchId ? ` batch=${summary.batchId}` : ""}`);
  console.log(`  evidence: ${summary.evidence}`);
  console.log(`  audit: ${observer.audit.path}`);
  console.log(
    `  posters: planned=${summary.plannedPosters} verified=${summary.verifiedPosters} skipped=${summary.skippedPosters} failed=${summary.failedPosters} pending=${summary.pendingPosters}`,
  );
  console.log(
    `  objects: planned=${summary.plannedObjects} verified=${summary.verifiedObjects} conflicted=${summary.conflictedObjects} failed=${summary.failedObjects} unknown=${summary.unknownObjects}`,
  );
  console.log(
    `  complete=${summary.complete ? "yes" : "no"} partial=${summary.partialSuccess ? "yes" : "no"} liveSuccess=${summary.liveSuccess ? "yes" : "no"} resumeSafe=${summary.resumeSafe ? "yes" : "no"}`,
  );
  if (summary.blockingReasons.length > 0) {
    console.log("  blocking reasons:");
    for (const reason of summary.blockingReasons) console.log(`    - ${reason}`);
  }
}

function createEngine(input: {
  manifest: PosterManifest;
  approvals: ReturnType<typeof loadApprovals>;
  manifestHashValue: string;
  flags: CliFlags;
  execute: boolean;
  readOnlyState?: boolean;
  eventSink?: MigrationEventSink;
}): MigrationEngine {
  const r2 = createR2StoreFromEnv();
  const statePath = input.readOnlyState
    ? path.join(os.tmpdir(), `cineprint-migration-readonly-${process.pid}.json`)
    : input.flags.statePath;
  const stateStore = new MigrationStateStore({
    statePath,
    manifestHash: input.manifestHashValue,
    breakLock: input.flags.breakLock,
  });

  return new MigrationEngine({
    manifest: input.manifest,
    stateStore,
    downloader: input.execute
      ? new SourceDownloader({
          raindropToken: requireEnv("RAINDROP_ACCESS_TOKEN"),
          timeoutMs: sourceTimeoutFromEnv(),
        })
      : noopDownloader(),
    optimizer: input.execute ? new MigrationOptimizer() : noopOptimizer(),
    r2,
    approvals: input.approvals,
    concurrency: input.flags.concurrency,
    execute: input.execute,
    retryConflicts: input.flags.retryConflicts,
    retrySourceChanged: input.flags.retrySourceChanged,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL?.trim() || "https://images.cineprint.click",
    logger: (message) => console.log(message),
    eventSink: input.eventSink,
  });
}

function printResults(results: MigrationResult[]): void {
  if (results.length === 0) {
    console.log("No migration results (non-execute mode).");
    return;
  }
  const counts: Record<string, number> = {};
  for (const result of results) {
    counts[result.state] = (counts[result.state] ?? 0) + 1;
    console.log(`${result.posterId}: ${result.state} — ${result.message}`);
    if (result.source) {
      console.log(
        `  source: ${result.source.mimeType} ${result.source.sizeBytes} bytes ${result.source.dimensions.width}x${result.source.dimensions.height} sha256=${result.source.sha256}`,
      );
    }
    if (result.optimized) {
      console.log(
        `  optimized: image/webp ${result.optimized.sizeBytes} bytes ${result.optimized.dimensions.width}x${result.optimized.dimensions.height} sha256=${result.optimized.sha256}`,
      );
    }
    if (result.publicUrls) {
      console.log(`  original: ${result.publicUrls.original}`);
      console.log(`  optimized: ${result.publicUrls.optimized}`);
    }
  }
  console.log("");
  console.log("Summary:");
  for (const [state, count] of Object.entries(counts).sort()) {
    console.log(`  ${state}: ${count}`);
  }
}

async function writeDryRunReport(input: {
  manifest: PosterManifest;
  approvals: ReturnType<typeof loadApprovals>;
  flags: CliFlags;
}): Promise<void> {
  const r2 = createR2StoreFromEnv();
  const report = await buildDryRunReport({
    manifest: input.manifest,
    r2,
    approvals: input.approvals,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL?.trim() || "https://images.cineprint.click",
  });

  fs.mkdirSync(path.dirname(input.flags.reportPath), { recursive: true });
  fs.writeFileSync(input.flags.reportPath, renderDryRunMarkdown(report), "utf8");
  const jsonPath = input.flags.reportPath.replace(/\.md$/i, ".json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("Dry-run complete. No R2 writes performed.");
  console.log(`  posters: ${report.totals.posters}`);
  console.log(`  source images: ${report.totals.sourceImages}`);
  console.log(`  expected R2 objects: ${report.totals.expectedR2Objects}`);
  console.log(`  missing objects: ${report.totals.missingObjects}`);
  console.log(`  conflicting objects: ${report.totals.conflictingObjects}`);
  console.log(`  blocked medium-confidence: ${report.blocked.length}`);
  console.log(`  optimized to regenerate: ${report.regeneration.length}`);
  console.log(
    `  estimated total upload: ${(report.totals.estimatedTotalUploadBytes / 1024 / 1024).toFixed(2)} MB`,
  );
  console.log(`  report: ${input.flags.reportPath}`);
  console.log(`  json:   ${jsonPath}`);
}

async function runCanary(flags: CliFlags): Promise<void> {
  const { manifest, approvals, manifestHashValue } = loadContext(flags);
  const selection = validateCommandFlags("canary", flags, manifest);
  const selectedPosterIds = selection.selectedPosterIds ?? undefined;
  const plan = buildCanaryPlan(manifest, approvals, {
    requestedPosterIds: selectedPosterIds,
  });

  console.log("Canary plan:");
  for (const item of plan) {
    console.log(
      `  ${item.posterId}: ${item.provider} confidence=${item.identityConfidence} blob-optimized=${item.optimizedAction} blocked=${item.blocked ? "yes" : "no"}`,
    );
    if (item.blockedReason) console.log(`    reason: ${item.blockedReason}`);
  }

  if (!flags.execute) {
    console.log("");
    console.log("No downloads or uploads performed. Pass --execute to run the canary.");
    return;
  }

  const bucket = process.env.R2_BUCKET_NAME?.trim() || "cineprint-posters";
  const selected = plan.map((item) => item.posterId);
  const observer = createCliObserver({
    flags,
    plannedPosterIds: selected,
    evidence: "live_migration",
  });
  await withObserver(observer, async () => {
    const result = await runObservedBatch({
      observer,
      withLock: (operation) =>
        withGlobalMigrationLock({ bucket, breakLock: flags.breakLock }, operation),
      execute: async () => {
        const engine = createEngine({
          manifest,
          approvals,
          manifestHashValue,
          flags,
          execute: true,
          eventSink: observer,
        });
        return engine.canary(selected);
      },
    });
    printResults(result.results);
    printRunSummary(observer.summary({ results: result.results }), observer);
  });
}

async function runFull(flags: CliFlags): Promise<void> {
  const { manifest, approvals, manifestHashValue } = loadContext(flags);
  const selection = validateCommandFlags("run", flags, manifest);
  const selectedPosterIds = selection.selectedPosterIds ?? [];
  const entries = selectEntries(manifest, selectedPosterIds);

  console.log(`Selected posters (${entries.length}): ${selectedPosterIds.join(", ")}`);

  const bucket = process.env.R2_BUCKET_NAME?.trim() || "cineprint-posters";
  const observer = createCliObserver({
    flags,
    plannedPosterIds: selectedPosterIds,
    evidence: "live_migration",
  });
  await withObserver(observer, async () => {
    const results = await runObservedBatch({
      observer,
      withLock: (operation) =>
        withGlobalMigrationLock({ bucket, breakLock: flags.breakLock }, operation),
      execute: async () => {
        const engine = createEngine({
          manifest,
          approvals,
          manifestHashValue,
          flags,
          execute: true,
          eventSink: observer,
        });
        return engine.run(entries);
      },
    });
    printResults(results);
    printRunSummary(observer.summary({ results }), observer);
  });
}

async function runVerify(flags: CliFlags): Promise<void> {
  const { manifest, approvals, manifestHashValue } = loadContext(flags);
  validateCommandFlags("verify", flags, manifest);
  const observer = createCliObserver({
    flags,
    plannedPosterIds: manifest.entries.map((entry) => entry.cineprintPosterId),
    evidence: "live_preflight",
  });
  const results = await withObserver(observer, async () => {
    observer.record({
      type: "run.started",
      outcome: "started",
      operation: "verify",
      metadata: { verification: "read_only" },
    });
    observer.record({
      type: "batch.started",
      outcome: "started",
      operation: "verify",
      metadata: { posters: manifest.entries.length },
    });
    const engine = createEngine({
      manifest,
      approvals,
      manifestHashValue,
      flags,
      execute: false,
      readOnlyState: false,
      eventSink: observer,
    });
    const verificationResults = await engine.verifyAll();
    let verified = 0;
    for (const result of verificationResults) {
      const ok =
        result.original.metadataVerified &&
        result.original.originChecksumVerified &&
        result.original.publicChecksumVerified &&
        result.optimized.metadataVerified &&
        result.optimized.originChecksumVerified &&
        result.optimized.publicChecksumVerified;
      if (ok) verified++;
      observer.record({
        type: ok ? "poster.verified" : "poster.failed",
        outcome: ok ? "verified" : "failed",
        posterId: result.posterId,
        operation: "verify",
        ...(ok
          ? {}
          : {
              failureCategory: result.original.originChecksumVerified
                ? ("CDN_VERIFICATION_FAILED" as const)
                : ("ORIGIN_VERIFICATION_FAILED" as const),
              retryable: false,
            }),
        message: ok
          ? "Original and optimized objects verified"
          : (result.original.reason ?? result.optimized.reason ?? "Verification failed"),
      });
    }
    observer.record({
      type: "run.completed",
      outcome: verified === verificationResults.length ? "completed" : "failed",
      operation: "verify",
      metadata: {
        verification: "read_only",
        posters: verificationResults.length,
        verified,
      },
    });
    return verificationResults;
  });
  console.log(`Audit: ${observer.audit.path}`);
  const verificationComplete = results.every(
    (result) =>
      result.original.metadataVerified &&
      result.original.originChecksumVerified &&
      result.original.publicChecksumVerified &&
      result.optimized.metadataVerified &&
      result.optimized.originChecksumVerified &&
      result.optimized.publicChecksumVerified,
  );
  if (!verificationComplete) process.exitCode = 1;

  let originalExists = 0;
  let originalMetadata = 0;
  let originalExpected = 0;
  let originalOrigin = 0;
  let originalPublicResponds = 0;
  let originalPublicChecksum = 0;
  let optimizedExists = 0;
  let optimizedMetadata = 0;
  let optimizedExpected = 0;
  let optimizedOrigin = 0;
  let optimizedPublicResponds = 0;
  let optimizedPublicChecksum = 0;

  for (const result of results) {
    if (result.original.exists) originalExists++;
    if (result.original.metadataVerified) originalMetadata++;
    if (result.original.expectedChecksumAvailable) originalExpected++;
    if (result.original.originChecksumVerified) originalOrigin++;
    if (result.original.publicResponds) originalPublicResponds++;
    if (result.original.publicChecksumVerified) originalPublicChecksum++;

    if (result.optimized.exists) optimizedExists++;
    if (result.optimized.metadataVerified) optimizedMetadata++;
    if (result.optimized.expectedChecksumAvailable) optimizedExpected++;
    if (result.optimized.originChecksumVerified) optimizedOrigin++;
    if (result.optimized.publicResponds) optimizedPublicResponds++;
    if (result.optimized.publicChecksumVerified) optimizedPublicChecksum++;

    const incomplete =
      !result.original.metadataVerified ||
      !result.original.originChecksumVerified ||
      !result.original.publicChecksumVerified ||
      !result.optimized.metadataVerified ||
      !result.optimized.originChecksumVerified ||
      !result.optimized.publicChecksumVerified;

    if (incomplete) {
      console.log(
        `${result.posterId}: ` +
          `original[exists=${result.original.exists ? "yes" : "no"} metadata=${result.original.metadataVerified ? "ok" : "no"} expectedChecksum=${result.original.expectedChecksumAvailable ? "yes" : "no"} originChecksum=${result.original.originChecksumVerified ? "ok" : "UNVERIFIED"} publicResponds=${result.original.publicResponds ? "yes" : "no"} publicChecksum=${result.original.publicChecksumVerified ? "ok" : "UNVERIFIED"}] ` +
          `optimized[exists=${result.optimized.exists ? "yes" : "no"} metadata=${result.optimized.metadataVerified ? "ok" : "no"} expectedChecksum=${result.optimized.expectedChecksumAvailable ? "yes" : "no"} originChecksum=${result.optimized.originChecksumVerified ? "ok" : "UNVERIFIED"} publicResponds=${result.optimized.publicResponds ? "yes" : "no"} publicChecksum=${result.optimized.publicChecksumVerified ? "ok" : "UNVERIFIED"}]` +
          (result.original.reason ? ` originalReason=${result.original.reason}` : "") +
          (result.optimized.reason ? ` optimizedReason=${result.optimized.reason}` : ""),
      );
    }
  }

  console.log("");
  console.log("Verification summary (read-only):");
  console.log(`  original present: ${originalExists}/${results.length}`);
  console.log(`  original metadata verified: ${originalMetadata}/${results.length}`);
  console.log(`  original expected checksum available: ${originalExpected}/${results.length}`);
  console.log(`  original origin checksum verified: ${originalOrigin}/${results.length}`);
  console.log(`  original public responds: ${originalPublicResponds}/${results.length}`);
  console.log(`  original public checksum verified: ${originalPublicChecksum}/${results.length}`);
  console.log(`  optimized present: ${optimizedExists}/${results.length}`);
  console.log(`  optimized metadata verified: ${optimizedMetadata}/${results.length}`);
  console.log(`  optimized expected checksum available: ${optimizedExpected}/${results.length}`);
  console.log(`  optimized origin checksum verified: ${optimizedOrigin}/${results.length}`);
  console.log(`  optimized public responds: ${optimizedPublicResponds}/${results.length}`);
  console.log(`  optimized public checksum verified: ${optimizedPublicChecksum}/${results.length}`);
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  if (command === "help") {
    console.log(usage());
    return;
  }

  const parsed = parseFlags(process.argv.slice(3));
  const flags: CliFlags = {
    ...parsed,
    manifestPath: parsed.manifestPath ? path.resolve(parsed.manifestPath) : resolveManifestPath(),
    snapshotPath: parsed.snapshotPath ? path.resolve(parsed.snapshotPath) : resolveSnapshotPath(),
    approvalsPath: parsed.approvalsPath
      ? path.resolve(parsed.approvalsPath)
      : resolveApprovalsPath(),
    statePath: parsed.statePath ? path.resolve(parsed.statePath) : resolveStatePath(),
    reportPath: parsed.reportPath
      ? path.resolve(parsed.reportPath)
      : path.resolve(process.cwd(), "migration", "dry-run-report.md"),
  };

  switch (command) {
    case "dry-run": {
      const { manifest, approvals } = loadContext(flags);
      validateCommandFlags("dry-run", flags, manifest);
      await writeDryRunReport({ manifest, approvals, flags });
      return;
    }
    case "canary":
      await runCanary(flags);
      return;
    case "run":
      await runFull(flags);
      return;
    case "verify":
      await runVerify(flags);
      return;
  }
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    if (error instanceof MigrationObservabilityError) {
      console.error(
        `Migration command failed: ${redactSecrets(
          error.originalError instanceof Error
            ? error.originalError.message
            : String(error.originalError),
        )}`,
      );
      console.error(
        `Observability failure: ${redactSecrets(
          error.observabilityError instanceof Error
            ? error.observabilityError.message
            : String(error.observabilityError),
        )}`,
      );
    } else {
      console.error(
        `Migration command failed: ${redactSecrets(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    }
    process.exit(1);
  });
}
