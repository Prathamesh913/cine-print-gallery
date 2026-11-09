import fs from "node:fs";
import path from "node:path";
import {
  LEGACY_CANARY_KEYS,
  buildVersionedMigrationPlan,
  getOptimizerIdentity,
} from "../automation/migration/versioning";
import {
  loadArtifactManifest,
  optimizedArtifactIndex,
  validateArtifactManifest,
} from "../automation/migration/artifacts";

const ROOT = process.cwd();
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "migration", "poster-manifest.json"), "utf8"),
);
const state = JSON.parse(
  fs.readFileSync(path.join(ROOT, "migration", "migration-state.json"), "utf8"),
) as {
  entries?: Record<string, { originalKey?: string | null; optimizedKey?: string | null }>;
};
const map = JSON.parse(
  fs.readFileSync(path.join(ROOT, "migration", "r2-image-map.json"), "utf8"),
) as {
  entries?: Record<
    string,
    {
      original?: { key?: string };
      optimized?: { key?: string };
    }
  >;
};

const legacyKeys = new Set<string>();
for (const entry of Object.values(state.entries || {})) {
  if (entry.originalKey) legacyKeys.add(entry.originalKey);
  if (entry.optimizedKey) legacyKeys.add(entry.optimizedKey);
}
for (const entry of Object.values(map.entries || {})) {
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
const plan = buildVersionedMigrationPlan(manifest, {
  optimizer,
  legacyKeys: [...legacyKeys],
  optimizedArtifacts: optimizedArtifactIndex(artifactManifest),
});

const json = process.argv.includes("--json");
if (json) {
  console.log(
    JSON.stringify(
      {
        optimizer,
        optimizerIdentityComplete:
          optimizer.version !== "unknown" && optimizer.libvipsVersion !== null,
        summary: plan.summary,
        exclusions: plan.excluded,
        items: plan.items,
      },
      null,
      2,
    ),
  );
} else {
  console.log("Versioned migration key plan (read-only)");
  console.log(
    JSON.stringify(
      {
        optimizer,
        optimizerIdentityComplete:
          optimizer.version !== "unknown" && optimizer.libvipsVersion !== null,
        summary: plan.summary,
      },
      null,
      2,
    ),
  );
  console.log("Exclusions:");
  for (const exclusion of plan.excluded) {
    console.log(`- ${exclusion.posterId}: ${exclusion.reason}`);
  }
  console.log("First 5 eligible items:");
  for (const item of plan.items.slice(0, 5)) {
    console.log(
      `- ${item.posterId}: ${item.originalKey} | ${item.optimizedKey} | risk=${item.existingR2ConflictRisk}`,
    );
  }
  console.log("Last 5 eligible items:");
  for (const item of plan.items.slice(-5)) {
    console.log(
      `- ${item.posterId}: ${item.originalKey} | ${item.optimizedKey} | risk=${item.existingR2ConflictRisk}`,
    );
  }
  console.log("No Blob reads, R2 reads, uploads, or repository artifacts were written.");
}
