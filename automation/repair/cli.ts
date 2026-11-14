#!/usr/bin/env tsx
/**
 * Scoped poster image repair CLI.
 *
 * Default mode is a read-only plan. External writes require --execute.
 *
 * Usage:
 *   npm run repair:posters -- --posters the-substance-2,stranger-things-2
 *   npm run repair:posters -- --posters the-substance-2,stranger-things-2 --execute
 */

import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { downloadSourceImage } from "../ingestion/download";
import { prepareImage } from "../ingestion/image";
import { R2ImagePublisher } from "../ingestion/r2-images";
import { createR2StoreFromEnv } from "../migration/r2";
import { getOptimizerIdentity } from "../migration/versioning";
import {
  buildRepairPlan,
  executeRepairPlan,
  type RepairAudit,
  type RepairDependencies,
  type RepairPlan,
} from "./repair";
import { createFirestoreRepairStore } from "./firestore";
import { NotionRepairClient } from "./notion";
import { selectRepairTargets, REPAIR_TARGETS } from "./targets";

export interface RepairCliOptions {
  posterIds: string[];
  execute: boolean;
  auditPath: string | null;
}

export function parseRepairArgs(argv: string[]): RepairCliOptions {
  let posters: string | null = null;
  let execute = false;
  let auditPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };

    switch (arg) {
      case "--posters":
        posters = next();
        break;
      case "--execute":
        execute = true;
        break;
      case "--audit":
        auditPath = next();
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!posters) throw new Error("--posters is required");
  const posterIds = posters
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return { posterIds, execute, auditPath };
}

function usage(): string {
  return `CinePrint scoped poster image repair

Usage:
  npm run repair:posters -- --posters <id1,id2> [--execute] [--audit PATH]

Supported poster IDs:
  ${Object.keys(REPAIR_TARGETS).join("\n  ")}

Safety:
  - Defaults to a read-only plan. --execute is required for any write.
  - The --posters list is an exact allowlist. Unknown, duplicate and unsupported
    IDs are rejected before any network or storage operation.
  - R2 objects are created once and never overwritten.
  - Firestore is update-only on existing published documents.
  - Notion poster status is never changed; only a missing identity row is added.
  - Audit output defaults outside the repository in the OS temp directory.
`;
}

class JsonlAudit implements RepairAudit {
  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  record(event: Record<string, unknown>): void {
    fs.appendFileSync(
      this.filePath,
      `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`,
      "utf8",
    );
  }
}

function defaultAuditPath(): string {
  const runId = `repair-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  return path.join(os.tmpdir(), "cineprint-poster-repair", `${runId}.jsonl`);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function buildDependencies(auditPath: string): RepairDependencies {
  const r2 = createR2StoreFromEnv();
  const optimizer = getOptimizerIdentity();
  const publisher = new R2ImagePublisher({
    store: r2,
    optimizer,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL?.trim() || "https://images.cineprint.click",
  });
  const firestore = createFirestoreRepairStore(requireEnv("FIREBASE_SERVICE_ACCOUNT_JSON"));
  const notion = new NotionRepairClient({
    apiKey: requireEnv("NOTION_KEY"),
    databaseId: requireEnv("NOTION_DATABASE_ID"),
    posterDataSourceId: process.env.NOTION_POSTER_DATA_SOURCE_ID?.trim() || null,
    identitiesDataSourceId: requireEnv("NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID"),
  });

  return {
    download: (url) => downloadSourceImage(url),
    prepare: (downloaded) => prepareImage(downloaded, { optimizer }),
    optimizer,
    r2,
    publisher,
    firestore,
    notion,
    now: () => new Date(),
    audit: new JsonlAudit(auditPath),
  };
}

function printPlan(plan: RepairPlan, mode: "DRY RUN" | "EXECUTE"): void {
  const { target, downloaded, prepared, keys } = plan;
  console.log(`\n=== ${mode}: ${target.posterId} ===`);
  console.log(`Artist: ${target.artist}`);
  console.log(`Source: ${target.sourceUrl}`);
  console.log(`Final source: ${downloaded.finalUrl}`);
  console.log(
    `Source bytes: ${downloaded.contentType}, ${downloaded.sizeBytes} bytes, ${prepared.original.width}x${prepared.original.height}, sha256=${downloaded.sha256}`,
  );
  console.log(`Original key: ${keys.originalKey} (${plan.r2.original})`);
  console.log(
    `Optimized key: ${keys.optimizedKey} (${plan.r2.optimized}; ${prepared.optimized.width}x${prepared.optimized.height}, ${prepared.optimized.sizeBytes} bytes)`,
  );
  console.log(
    `Firestore: posters/${target.posterId} — r2Image ${plan.firestore.action === "already" ? "already present" : "would update"}`,
  );
  console.log(
    `Notion: page ${target.notionPageId} status=${plan.notion.pageStatus} — identity row ${
      plan.notion.action === "already" ? "already present" : "would create"
    }`,
  );
  console.log(`Mode: ${mode}`);
}

async function main(): Promise<void> {
  const options = parseRepairArgs(process.argv.slice(2));
  const targets = selectRepairTargets(options.posterIds);
  const mode = options.execute ? "EXECUTE" : "DRY RUN";
  const auditPath = options.auditPath ? path.resolve(options.auditPath) : defaultAuditPath();
  const deps = buildDependencies(auditPath);

  console.log(`Poster repair (${mode})`);
  console.log(`Audit: ${auditPath}`);
  console.log(`Targets: ${targets.map((target) => target.posterId).join(", ")}`);

  // Build and validate every selected plan before any external write. A bad
  // second target must not allow the first target to be half-applied.
  const plans: RepairPlan[] = [];
  for (const target of targets) {
    plans.push(await buildRepairPlan(target, deps));
  }

  for (const plan of plans) {
    printPlan(plan, mode);
    deps.audit.record({ event: "repair.plan.built", posterId: plan.target.posterId });
  }

  if (!options.execute) {
    console.log("\nNo R2, Firestore or Notion writes performed (dry run).");
    return;
  }

  for (const plan of plans) {
    const result = await executeRepairPlan(plan, deps);
    console.log(
      `Result: ${plan.target.posterId} — R2 original=${result.r2.original}, optimized=${result.r2.optimized}; ` +
        `Notion=${result.notionAction}; Firestore=${result.firestoreAction}`,
    );
  }
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(
      `Poster repair failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
