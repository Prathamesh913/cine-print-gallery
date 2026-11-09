import fs from "node:fs";
import path from "node:path";
import {
  LEGACY_CANARY_KEYS,
  buildVersionedMigrationPlan,
  getOptimizerIdentity,
} from "../automation/migration/versioning";
import { renderPreflightSummary, runPreflight } from "../automation/migration/preflight";
import {
  loadArtifactManifest,
  optimizedArtifactIndex,
  validateArtifactManifest,
} from "../automation/migration/artifacts";
import type {
  LegacyCanaryMapEntry,
  VersionedMigrationPlan,
} from "../automation/migration/versioning";
import type { MigrationStateEntry, PosterManifest } from "../automation/migration/types";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const json = args.includes("--json");
const failOnBlock = args.includes("--fail-on-block");
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "migration", file), "utf8")) as T;
}

const manifest = readJson<PosterManifest>("poster-manifest.json");
const state = readJson<{ entries: Record<string, MigrationStateEntry> }>("migration-state.json");
const map = readJson<{
  publicBaseUrl: string;
  entries: Record<string, LegacyCanaryMapEntry>;
}>("r2-image-map.json");

const legacyKeys = new Set<string>();
for (const entry of Object.values(state.entries)) {
  if (entry.originalKey) legacyKeys.add(entry.originalKey);
  if (entry.optimizedKey) legacyKeys.add(entry.optimizedKey);
}
for (const entry of Object.values(map.entries)) {
  if (entry.original?.key) legacyKeys.add(entry.original.key);
  if (entry.optimized?.key) legacyKeys.add(entry.optimized.key);
}
for (const keys of Object.values(LEGACY_CANARY_KEYS)) {
  legacyKeys.add(keys.original);
  legacyKeys.add(keys.optimized);
}

const optimizer = getOptimizerIdentity();
const artifactManifest = loadArtifactManifest(
  path.join(ROOT, "migration", "optimized-artifacts.json"),
);
const artifactErrors = validateArtifactManifest(artifactManifest, manifest);
if (artifactErrors.length > 0) {
  throw new Error(`Optimized artifact manifest is invalid:\n- ${artifactErrors.join("\n- ")}`);
}
const plan: VersionedMigrationPlan = buildVersionedMigrationPlan(manifest, {
  optimizer,
  legacyKeys: [...legacyKeys],
  optimizedArtifacts: optimizedArtifactIndex(artifactManifest),
});

const report = await runPreflight({
  manifest,
  plan,
  optimizer,
  stateEntries: state.entries,
  mapEntries: map.entries,
  publicBaseUrl: map.publicBaseUrl,
  mode: "local",
});

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderPreflightSummary(report));
  console.log("");
  console.log("Local plan validation is not bucket evidence.");
  console.log("No R2 request, upload, overwrite or delete was performed.");
}

if (outPath) {
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdownPath = resolved.replace(/\.json$/i, ".md");
  fs.writeFileSync(markdownPath, `${renderPreflightSummary(report)}\n`, "utf8");
  console.log(`Report: ${resolved}`);
  console.log(`Summary: ${markdownPath}`);
}

if (failOnBlock && report.summary.blocksUpload) process.exitCode = 1;
