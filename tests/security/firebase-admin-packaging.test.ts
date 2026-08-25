import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Production packaging regression for firebase-admin.
 *
 * The runtime path uses createRequire (not a static import) so Nitro cannot
 * statically discover firebase-admin. vite.config.ts therefore sets
 * `nitro.traceDeps: ["firebase-admin*"]`. These tests exercise the actual
 * module-resolution path used by the app, and — when a Vercel build output
 * is present — verify the package landed in the function's node_modules.
 *
 * Run `NITRO_PRESET=vercel npm run build` before relying on the packaging
 * assertions; without a build artifact they skip rather than false-pass.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function findVercelServerFunc(): string | null {
  const candidate = path.join(ROOT, ".vercel/output/functions/__server.func");
  if (fs.existsSync(candidate)) return candidate;
  // Nitro may nest the function under a different name; scan once.
  const functionsDir = path.join(ROOT, ".vercel/output/functions");
  if (!fs.existsSync(functionsDir)) return null;
  for (const entry of fs.readdirSync(functionsDir)) {
    const full = path.join(functionsDir, entry);
    if (entry.endsWith(".func") && fs.statSync(full).isDirectory()) return full;
  }
  return null;
}

describe("firebase-admin module resolution (app path)", () => {
  it("adminRequire resolves firebase-admin/app, auth, and firestore", async () => {
    // Import the real helper (no mocks) so we exercise the production require path.
    const { adminRequire } = await import("../../src/server/firebase/admin");

    const app = await adminRequire<{
      SDK_VERSION?: string;
      initializeApp: unknown;
      cert: unknown;
    }>("firebase-admin/app");
    expect(app.SDK_VERSION).toBeDefined();
    expect(typeof app.initializeApp).toBe("function");
    expect(typeof app.cert).toBe("function");

    const auth = await adminRequire<{ getAuth: unknown }>("firebase-admin/auth");
    expect(typeof auth.getAuth).toBe("function");

    const firestore = await adminRequire<{ getFirestore: unknown }>("firebase-admin/firestore");
    expect(typeof firestore.getFirestore).toBe("function");
  });
});

describe("firebase-admin Vercel packaging (build output)", () => {
  const serverFunc = findVercelServerFunc();

  it.skipIf(!serverFunc)(
    "firebase-admin is present under the Vercel function node_modules",
    () => {
      const nm = path.join(serverFunc!, "node_modules", "firebase-admin");
      expect(
        fs.existsSync(nm),
        `Expected ${nm} after NITRO_PRESET=vercel npm run build (traceDeps must package firebase-admin)`,
      ).toBe(true);

      const pkg = JSON.parse(fs.readFileSync(path.join(nm, "package.json"), "utf8")) as {
        name?: string;
      };
      expect(pkg.name).toBe("firebase-admin");
    },
  );

  it.skipIf(!serverFunc)(
    "createRequire from the function root resolves firebase-admin/app",
    () => {
      // Mirrors production: Vercel runs the function with node_modules beside
      // the server entry. createRequire from that directory must succeed.
      const requireFromFunc = createRequire(pathToFileURL(path.join(serverFunc!, "/")).href);
      const app = requireFromFunc("firebase-admin/app") as {
        SDK_VERSION?: string;
        initializeApp?: unknown;
      };
      expect(app.SDK_VERSION).toBeDefined();
      expect(typeof app.initializeApp).toBe("function");

      const auth = requireFromFunc("firebase-admin/auth") as { getAuth?: unknown };
      expect(typeof auth.getAuth).toBe("function");

      const firestore = requireFromFunc("firebase-admin/firestore") as {
        getFirestore?: unknown;
      };
      expect(typeof firestore.getFirestore).toBe("function");
    },
  );

  it.skipIf(!serverFunc)(
    "function package.json declares firebase-admin (traced dependency manifest)",
    () => {
      const pkgPath = path.join(serverFunc!, "package.json");
      expect(fs.existsSync(pkgPath)).toBe(true);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(pkg.dependencies).toBeDefined();
      expect(
        Object.keys(pkg.dependencies ?? {}).some(
          (k) => k === "firebase-admin" || k.startsWith("firebase-admin/"),
        ),
        `function package.json dependencies should include firebase-admin; got: ${JSON.stringify(pkg.dependencies)}`,
      ).toBe(true);
    },
  );

  it.skipIf(!serverFunc)(
    "C1 regression: all admin submodules load in a require(esm)-less Node runtime",
    () => {
      // firebase-admin@14 → jwks-rsa@4 → jose@6 (ESM-only) crashed Vercel's
      // CJS runtime with ERR_REQUIRE_ESM before any handler ran. The pin to
      // firebase-admin@13.x (jwks-rsa@3 → jose@4 with a real CJS entry) must
      // keep app/auth/firestore loadable when require(esm) is unavailable.
      // This spawns the closest local equivalent of the Vercel runtime.
      const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
      const probe = `
        const { createRequire } = require("node:module");
        const { pathToFileURL } = require("node:url");
        const req = createRequire(pathToFileURL(process.argv[1] + "/").href);
        const out = [];
        for (const id of ["firebase-admin/app", "firebase-admin/auth", "firebase-admin/firestore"]) {
          try { const m = req(id); out.push(id + "=OK"); }
          catch (e) { out.push(id + "=" + (e.code || "ERROR")); }
        }
        console.log(out.join("\\n"));
      `;
      const stdout = execFileSync(
        process.execPath,
        ["--no-experimental-require-module", "-e", probe, serverFunc!],
        { encoding: "utf8" },
      );
      for (const id of ["app", "auth", "firestore"]) {
        expect(stdout).toContain(`firebase-admin/${id}=OK`);
      }
    },
  );
});
