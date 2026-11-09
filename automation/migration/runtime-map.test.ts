import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRuntimeMapSource,
  buildVersionedRuntimeMap,
  validateAllowlist,
  validateR2ImageMap,
  type R2ImageMapFile,
  type R2ResolverAllowlist,
} from "./runtime-map";
import type { ArtifactManifestFile } from "./artifacts";
import type { MigrationState, PosterManifest } from "./types";

const ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, "migration", "poster-manifest.json"), "utf8"),
) as PosterManifest;
const ARTIFACTS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "migration", "optimized-artifacts.json"), "utf8"),
) as ArtifactManifestFile;
const CANARY_MAP = JSON.parse(
  fs.readFileSync(path.join(ROOT, "migration", "r2-image-map.json"), "utf8"),
) as R2ImageMapFile;
const STATE_FILES = [
  "phase10a-batch1-state.json",
  "phase10b-batch2-state.json",
  "phase10c-batch3-state.json",
  "phase10d-batch4-state.json",
  "phase10e-batch5-state.json",
];
const STATES = STATE_FILES.map((file) => ({
  label: file,
  state: JSON.parse(
    fs.readFileSync(path.join(ROOT, "migration", "state", file), "utf8"),
  ) as MigrationState,
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function build(overrides: Partial<Parameters<typeof buildVersionedRuntimeMap>[0]> = {}) {
  return buildVersionedRuntimeMap({
    manifest: MANIFEST,
    artifacts: ARTIFACTS,
    batchStates: STATES,
    canaryMap: CANARY_MAP,
    ...overrides,
  });
}

describe("F27 — versioned runtime map exporter", () => {
  it("exports 58 migrated and 3 canary entries with 61 allowlisted IDs", () => {
    const result = build();
    expect(Object.keys(result.map.entries)).toHaveLength(61);
    expect(result.allowlist.posters).toHaveLength(61);
    expect(Object.keys(result.map.entries).sort()).toEqual(result.allowlist.posters);
    expect(result.map.entries["stranger-things-2"]).toBeUndefined();
    expect(result.map.entries["the-substance-2"]).toBeUndefined();
    for (const id of ["2001-a-space-odyssey", "bugonia", "artwork-1824607248"]) {
      expect(result.map.entries[id]).toEqual(CANARY_MAP.entries[id]);
    }
  });

  it("uses versioned original and optimized keys for all migrated posters", () => {
    const result = build();
    const migrated = Object.values(result.map.entries).filter(
      (entry) =>
        !["2001-a-space-odyssey", "bugonia", "artwork-1824607248"].includes(entry.posterId),
    );
    expect(migrated).toHaveLength(58);
    expect(
      migrated.every((entry) => entry.original.key.startsWith("cineprint/versions/original/")),
    ).toBe(true);
    expect(
      migrated.every((entry) => entry.optimized.key.startsWith("cineprint/versions/optimized/")),
    ).toBe(true);
    expect(
      migrated.every((entry) => entry.original.url.startsWith("https://images.cineprint.click/")),
    ).toBe(true);
  });

  it("is byte-deterministic across repeated builds", () => {
    const first = build();
    const second = build();
    expect(first.mapContent).toBe(second.mapContent);
    expect(first.allowlistContent).toBe(second.allowlistContent);
    expect(first.map.generatedAt).toBe(ARTIFACTS.generatedAt);
  });

  it("keeps browser and SEO flags disabled in generated source", () => {
    const result = build();
    const source = buildRuntimeMapSource(result.map, result.allowlist);
    expect(source).toContain("R2_BROWSER_IMAGES_ENABLED = true");
    expect(source).toContain("R2_SEO_IMAGES_ENABLED = true");
    expect(source).toContain('"stranger-things-1"');
    expect(source).not.toContain("stranger-things-2");
    expect(source).not.toContain("the-substance-2");
  });

  it("does not expose source URLs, local paths or credentials", () => {
    const result = build();
    expect(result.mapContent).not.toContain("sourceImageUrl");
    expect(result.mapContent).not.toContain("api.raindrop.io");
    expect(result.mapContent).not.toContain("pbs.twimg.com");
    expect(result.mapContent).not.toContain("migration/cache");
    expect(result.mapContent).not.toContain("Authorization");
    expect(result.mapContent).not.toContain("localPath");
  });

  it("rejects a missing batch state", () => {
    expect(() => build({ batchStates: STATES.slice(0, 4) })).toThrow(
      /Expected 58 batch state entries|Missing batch state/,
    );
  });

  it("rejects a non-VERIFIED object", () => {
    const states = clone(STATES);
    states[0].state.entries["art-of-a-hit-2024"].state = "FAILED";
    expect(() => build({ batchStates: states })).toThrow(/not VERIFIED/);
  });

  it("rejects duplicate poster identities across batches", () => {
    const states = clone(STATES);
    const first = Object.entries(states[0].state.entries)[0];
    states[1].state.entries[first[0]] = clone(first[1]);
    expect(() => build({ batchStates: states })).toThrow(/Duplicate poster state/);
  });

  it("rejects missing optimized artifacts", () => {
    const artifacts = clone(ARTIFACTS);
    artifacts.artifacts = artifacts.artifacts.filter(
      (artifact) => !(artifact.posterId === "art-of-a-hit-2024" && artifact.role === "optimized"),
    );
    expect(() => build({ artifacts })).toThrow(/invalid|Expected 116|artifacts/);
  });

  it("rejects hash and size mismatches", () => {
    const states = clone(STATES);
    const entry = states[0].state.entries["art-of-a-hit-2024"];
    entry.optimizedSha256 = "0".repeat(64);
    expect(() => build({ batchStates: states })).toThrow(/SHA-256/);

    const sizeStates = clone(STATES);
    sizeStates[0].state.entries["art-of-a-hit-2024"].optimizedSizeBytes = 1;
    expect(() => build({ batchStates: sizeStates })).toThrow(/size/);
  });

  it("rejects an excluded identity in the artifact manifest", () => {
    const artifacts = clone(ARTIFACTS);
    const template = artifacts.artifacts.find(
      (artifact) => artifact.posterId === "art-of-a-hit-2024" && artifact.role === "optimized",
    )!;
    artifacts.artifacts.push({
      ...template,
      posterId: "stranger-things-2",
    });
    expect(() => build({ artifacts })).toThrow(/excluded|Expected 116|invalid/);
  });

  it("accepts versioned keys but rejects unsupported or unsafe prefixes", () => {
    const result = build();
    expect(() => validateR2ImageMap(result.map)).not.toThrow();

    const unsupported = clone(result.map);
    unsupported.entries["art-of-a-hit-2024"].original.key = "cineprint/other/file.png";
    expect(() => validateR2ImageMap(unsupported)).toThrow(/prefix/);

    const unsafe = clone(result.map);
    unsafe.entries["art-of-a-hit-2024"].optimized.key = "cineprint/versions/optimized/../file.webp";
    expect(() => validateR2ImageMap(unsafe)).toThrow(/safe object key/);
  });

  it("requires map and allowlist coverage to match exactly", () => {
    const result = build();
    const allowlist = clone(result.allowlist) as R2ResolverAllowlist;
    allowlist.posters = allowlist.posters.filter((id) => id !== "art-of-a-hit-2024");
    expect(() => buildRuntimeMapSource(result.map, allowlist)).toThrow(
      /exactly match the resolver allowlist/,
    );
  });

  it("rejects an invalid allowlist", () => {
    expect(() => validateAllowlist({ schemaVersion: 1, posters: [] })).toThrow(/non-empty/);
    expect(() => validateAllowlist({ schemaVersion: 1, posters: ["a", "a"] })).toThrow(/duplicate/);
  });
});
