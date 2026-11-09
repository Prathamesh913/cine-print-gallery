import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildVersionedRuntimeMap } from "../automation/migration/runtime-map";
import { loadArtifactManifest } from "../automation/migration/artifacts";
import type { MigrationState, PosterManifest } from "../automation/migration/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STATES = [
  "phase10a-batch1-state.json",
  "phase10b-batch2-state.json",
  "phase10c-batch3-state.json",
  "phase10d-batch4-state.json",
  "phase10e-batch5-state.json",
];

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

interface Args {
  manifestPath: string;
  artifactPath: string;
  statePaths: string[];
  canaryMapPath: string;
  outPath: string;
  allowlistOutPath: string;
  check: boolean;
}

function parseArgs(argv: string[]): Args {
  let manifestPath = path.join(ROOT, "migration", "poster-manifest.json");
  let artifactPath = path.join(ROOT, "migration", "optimized-artifacts.json");
  let statePaths = DEFAULT_STATES.map((file) => path.join(ROOT, "migration", "state", file));
  let canaryMapPath = path.join(ROOT, "migration", "r2-image-map.json");
  let outPath = path.join(ROOT, "migration", "r2-image-map.json");
  let allowlistOutPath = path.join(ROOT, "migration", "r2-resolver-allowlist.json");
  let check = false;
  let explicitStates = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--manifest":
        manifestPath = path.resolve(next());
        break;
      case "--artifacts":
        artifactPath = path.resolve(next());
        break;
      case "--state":
        if (!explicitStates) {
          statePaths = [];
          explicitStates = true;
        }
        statePaths.push(path.resolve(next()));
        break;
      case "--canary-map":
        canaryMapPath = path.resolve(next());
        break;
      case "--out":
        outPath = path.resolve(next());
        break;
      case "--allowlist-out":
        allowlistOutPath = path.resolve(next());
        break;
      case "--check":
        check = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: tsx scripts/export-versioned-r2-map.ts [--manifest PATH] [--artifacts PATH] [--state PATH]... [--canary-map PATH] [--out PATH] [--allowlist-out PATH] [--check]",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    manifestPath,
    artifactPath,
    statePaths,
    canaryMapPath,
    outPath,
    allowlistOutPath,
    check,
  };
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const manifest = readJson<PosterManifest>(args.manifestPath);
    const artifacts = loadArtifactManifest(args.artifactPath);
    const batchStates = args.statePaths.map((statePath) => ({
      label: path.basename(statePath),
      state: readJson<MigrationState>(statePath),
    }));
    const canaryMap = readJson(args.canaryMapPath);
    const result = buildVersionedRuntimeMap({
      manifest,
      artifacts,
      batchStates,
      canaryMap,
    });

    if (args.check) {
      const mapCurrent = fs.existsSync(args.outPath) ? fs.readFileSync(args.outPath, "utf8") : "";
      const allowlistCurrent = fs.existsSync(args.allowlistOutPath)
        ? fs.readFileSync(args.allowlistOutPath, "utf8")
        : "";
      if (mapCurrent !== result.mapContent || allowlistCurrent !== result.allowlistContent) {
        console.error("Versioned runtime map or allowlist is stale.");
        process.exit(1);
      }
      console.log(
        `Versioned runtime map is up to date: ${Object.keys(result.map.entries).length} entries`,
      );
    } else {
      writeAtomic(args.outPath, result.mapContent);
      writeAtomic(args.allowlistOutPath, result.allowlistContent);
      console.log(
        `Versioned runtime map exported: ${Object.keys(result.map.entries).length} entries`,
      );
      console.log(`  migrated: ${artifacts.counts.posters} posters`);
      console.log(`  allowlist: ${result.allowlist.posters.length} posters`);
      console.log(`  map: ${args.outPath}`);
      console.log(`  allowlist: ${args.allowlistOutPath}`);
    }
  } catch (error) {
    console.error(
      `Versioned runtime map export failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}
