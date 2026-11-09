import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOB_HOST_SUFFIX,
  DEFAULT_R2_BROWSER_IMAGES_ENABLED,
  DEFAULT_R2_SEO_IMAGES_ENABLED,
  EXPECTED_R2_HOST,
  R2_PUBLIC_BASE_URL,
  buildRuntimeMapSource,
  validateAllowlist,
  validateR2ImageMap,
  type R2ImageMapFile,
  type R2ResolverAllowlist,
  type RuntimeActivationOptions,
} from "../automation/migration/runtime-map";

export {
  BLOB_HOST_SUFFIX,
  DEFAULT_R2_BROWSER_IMAGES_ENABLED,
  DEFAULT_R2_SEO_IMAGES_ENABLED,
  EXPECTED_R2_HOST,
  R2_PUBLIC_BASE_URL,
  buildRuntimeMapSource,
  validateAllowlist,
  validateR2ImageMap,
};
export type { R2ImageMapFile, R2ResolverAllowlist, RuntimeActivationOptions };

export interface GenerateOptions {
  inputPath: string;
  allowlistPath: string;
  outPath: string;
  check: boolean;
  browserEnabled?: boolean;
  seoEnabled?: boolean;
}

function readJson<T>(filePath: string, label: string): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    throw new Error(
      `Unable to read ${label} at ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function generateRuntimeMap(options: GenerateOptions): {
  source: string;
  map: R2ImageMapFile;
  allowlist: R2ResolverAllowlist;
} {
  const map = readJson<R2ImageMapFile>(options.inputPath, "R2 image map");
  const allowlistRaw = readJson<unknown>(options.allowlistPath, "R2 resolver allowlist");
  const allowlist = validateAllowlist(allowlistRaw);
  const source = buildRuntimeMapSource(map, allowlist, {
    browserEnabled: options.browserEnabled,
    seoEnabled: options.seoEnabled,
  });
  return { source, map, allowlist };
}

export function writeRuntimeMap(source: string, outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp`;
  fs.writeFileSync(tempPath, source, "utf8");
  fs.renameSync(tempPath, outPath);
}

export function checkRuntimeMap(source: string, outPath: string): { ok: boolean; reason: string } {
  if (!fs.existsSync(outPath)) {
    return { ok: false, reason: `Generated runtime map does not exist: ${outPath}` };
  }
  const existing = fs.readFileSync(outPath, "utf8");
  if (existing !== source) {
    return {
      ok: false,
      reason: `Generated runtime map is stale: ${outPath}. Run npm run r2:map:generate.`,
    };
  }
  return { ok: true, reason: "Generated runtime map is up to date" };
}

function parseArgs(argv: string[]): GenerateOptions {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let inputPath = path.join(root, "migration", "r2-image-map.json");
  let allowlistPath = path.join(root, "migration", "r2-resolver-allowlist.json");
  let outPath = path.join(root, "src", "lib", "r2-image-map.generated.ts");
  let check = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--input":
        inputPath = path.resolve(next());
        break;
      case "--allowlist":
        allowlistPath = path.resolve(next());
        break;
      case "--out":
        outPath = path.resolve(next());
        break;
      case "--check":
        check = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: tsx scripts/generate-r2-image-map.ts [--input PATH] [--allowlist PATH] [--out PATH] [--check]",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { inputPath, allowlistPath, outPath, check };
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { source, map, allowlist } = generateRuntimeMap(args);

    if (args.check) {
      const result = checkRuntimeMap(source, args.outPath);
      if (!result.ok) {
        console.error(result.reason);
        process.exit(1);
      }
      console.log(result.reason);
    } else {
      writeRuntimeMap(source, args.outPath);
      console.log(`R2 runtime map generated: ${Object.keys(map.entries).length} poster(s)`);
      console.log(`  allowlist: ${allowlist.posters.join(", ")}`);
      console.log(`  output: ${args.outPath}`);
    }
  } catch (error) {
    console.error(
      `R2 runtime map generation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
