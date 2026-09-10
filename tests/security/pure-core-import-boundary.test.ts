import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression tripwire for the e61c180 import-protection failure.
 *
 * What happened: collections.ts VALUE-re-exported assertOwner from
 * collections-core, pinning it into every client chunk that imports the
 * collections server fns. collections-core still had a runtime import of
 * ./firestore-db, which statically imported src/server/firebase/admin —
 * so Firebase Admin entered the CLIENT graph and TanStack Start's
 * import protection denied /c/$id at dev time.
 *
 * Invariant under test:
 *
 *   src/lib/firestore-shared.ts   client-safe contracts (types, tsToIso)
 *   src/lib/*-core.ts             PURE injected business logic — may depend
 *                                 only on firestore-shared and other client-
 *                                 safe modules. NEVER on firestore-db,
 *                                 src/server/**, or firebase-admin.
 *   src/lib/firestore-db.ts       Admin acquisition / adapter — reachable
 *                                 only from createServerFn handler modules.
 *
 * Why a source scan instead of a graph tool: if every *-core module stays
 * infrastructure-free, ANY export surface built on top of them is safe to
 * bundle for the client, no matter how future code re-exports it. One
 * violated edge downstream breaks the whole guarantee, so we check both
 * direct AND indirect edges (core → helper → firestore-db counts).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Bare specifiers that are server-only infrastructure by name. */
const BARE_FORBIDDEN = /^firebase-admin(\/|$)/;

function isForbiddenResolved(absPath: string): boolean {
  // Path-prefix agnostic so unit fixtures can use a virtual project root.
  const norm = absPath.split(path.sep).join("/");
  const idx = norm.lastIndexOf("/src/");
  if (idx === -1) return false;
  const rel = norm.slice(idx + 5);
  return (
    rel.startsWith("server/") ||
    rel === "lib/firestore-db" ||
    rel === "lib/firestore-db.ts" ||
    rel === "lib/firestore-db/index.ts"
  );
}

/** Every static/dynamic/type/re-export specifier in a TS source string. */
function collectImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+[^;'()]*?\bfrom\s*["']([^"']+)["']/g, // import … from "…"
    /\bexport\s+[^;'()]*?\bfrom\s*["']([^"']+)["']/g, // export … from "…" (re-export)
    /\bimport\s*["']([^"']+)["']/g, // side-effect import "…"
    /\bimport\s*\(\s*["']([^"']+)["']/g, // dynamic import("…")
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]);
  }
  return specs;
}

type FileReader = (file: string) => string | null;

function readSourceFile(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Resolve a specifier found in `fromFile` to a candidate absolute module
 * path, applying "@/…"-alias and relative forms plus extension guessing.
 * Existence is probed with the supplied reader so unit fixtures can use a
 * virtual filesystem. Returns null for bare packages (checked separately).
 */
function resolveModulePath(
  fromFile: string,
  specifier: string,
  readFile: FileReader,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(ROOT, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  return candidates.find((candidate) => readFile(candidate) !== null) ?? null;
}

interface BoundaryViolation {
  chain: string[];
  specifier: string;
}

/**
 * Walk the static import graph breadth-first from `entry` (an absolute path)
 * using the supplied file reader. Returns every path that reaches a forbidden
 * dependency edge, with the chain of files that leads there.
 */
function findForbiddenEdges(entry: string, readFile: FileReader): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const visited = new Set<string>([entry]);
  const queue: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    const source = readFile(file);
    if (source === null) continue;

    for (const specifier of collectImportSpecifiers(source)) {
      const offender = BARE_FORBIDDEN.test(specifier) || specifier.includes("firebase-admin");
      const resolved = resolveModulePath(file, specifier, readFile);

      if (offender || (resolved !== null && isForbiddenResolved(resolved))) {
        violations.push({ chain: [...chain, `${specifier}`], specifier });
        continue; // don't descend into forbidden territory
      }
      if (resolved && !visited.has(resolved)) {
        visited.add(resolved);
        queue.push({ file: resolved, chain: [...chain, path.basename(resolved)] });
      }
    }
  }
  return violations;
}

function srcLibCoreModules(): string[] {
  return fs
    .readdirSync(path.join(ROOT, "src/lib"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith("-core.ts"))
    .map((entry) => path.join(ROOT, "src/lib", entry.name))
    .sort();
}

describe("pure core import-boundary detector (synthetic graphs)", () => {
  // Guard the guard: each forbidden pattern class must actually trip the
  // scanner — including the INDIRECT edge that caused the real regression
  // (core → helper → firestore-db → server/firebase/admin).
  const fakeFs: FileReader = (file) =>
    (
      ({
        "/proj/src/lib/fake-core.ts": 'import { helper } from "./fake-helper";',
        "/proj/src/lib/fake-helper.ts": 'import { getDb } from "./firestore-db";',
        "/proj/src/lib/firestore-db.ts": 'import { getAdminDb } from "../server/firebase/admin";',
        "/proj/src/server/firebase/admin.ts": "export const getAdminDb = () => {};",
        "/proj/src/server/errors/app-error.ts": "export const unauthorized = () => {};",
      }) as Record<string, string>
    )[file] ?? null;

  function runFake(coreSource: string): BoundaryViolation[] {
    const fsWithFakeCore: FileReader = (file) =>
      file === "/proj/src/lib/fake-core.ts" ? coreSource : fakeFs(file);
    return findForbiddenEdges("/proj/src/lib/fake-core.ts", fsWithFakeCore);
  }

  it("flags a direct firestore-db edge", () => {
    const v = runFake('import { tsToIso } from "./firestore-db";');
    expect(v).toHaveLength(1);
    expect(v[0].specifier).toBe("./firestore-db");
  });

  it("flags a type-only firestore-db edge", () => {
    const v = runFake('import type { FirestoreApi } from "./firestore-db";');
    expect(v).toHaveLength(1);
  });

  it("flags an indirect edge through a local helper", () => {
    const v = runFake('export { something } from "./fake-helper";');
    expect(v).toHaveLength(1);
    expect(v[0].specifier).toBe("./firestore-db");
    expect(v[0].chain).toContain("fake-helper.ts");
  });

  it("flags src/server/** and bare firebase-admin imports", () => {
    expect(runFake('import { x } from "../server/errors/app-error";')).not.toHaveLength(0);
    expect(runFake('import { cert } from "firebase-admin/app";')).not.toHaveLength(0);
    expect(runFake('const admin = await import("firebase-admin/auth");')).not.toHaveLength(0);
  });

  it("accepts clean dependencies (firestore-shared, other client-safe libs)", () => {
    expect(
      runFake(
        [
          'import { tsToIso } from "./firestore-shared";',
          'import type { FirestoreApi } from "./firestore-shared";',
          'import { format } from "date-fns";',
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });
});

describe("pure core module boundaries (real sources)", () => {
  it("covers the expected set of *-core modules", () => {
    const names = srcLibCoreModules().map((file) => path.basename(file));
    for (const required of ["account-core.ts", "collections-core.ts", "user-likes-core.ts"]) {
      expect(names).toContain(required);
    }
  });

  it.each(srcLibCoreModules().map((file) => [path.basename(file), file] as const))(
    "%s never reaches server-only infrastructure",
    (_name, coreModule) => {
      const violations = findForbiddenEdges(coreModule, readSourceFile);
      expect(violations).toHaveLength(0); // message prints chains on failure
    },
  );
});
