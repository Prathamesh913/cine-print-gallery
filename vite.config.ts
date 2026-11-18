// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
// Augments Vite's UserConfig with `nitro?: NitroConfig` (traceDeps, etc.).
import "nitro/vite";

/**
 * Vercel builds run on Node with a deployed node_modules directory, so CJS
 * packages can stay external (required at runtime). The Cloudflare workers
 * preset has no node_modules at runtime, so these externalizations must only
 * apply to Vercel builds. Vercel sets VERCEL=1 during `vercel build`;
 * NITRO_PRESET=vercel covers local `NITRO_PRESET=vercel npm run build` repros.
 */
const isVercelBuild = process.env.VERCEL === "1" || process.env.NITRO_PRESET === "vercel";

/**
 * CJS-only packages that must not be bundled into the Rolldown server output
 * on Vercel. Rolldown emits them as cross-chunk `__commonJSMin` wrappers that
 * form an ESM cycle with the shared-helper chunk: the wrapper executes before
 * the helper initializes, so every dynamic SSR import throws
 * `TypeError: __commonJSMin is not a function` and every page 500s (static
 * assets are unaffected — they never touch the function). Keeping them
 * external (same mechanism as firebase-admin below) removes the wrappers
 * entirely; Node resolves each once from the function node_modules, so there
 * is still exactly one React instance. `*` = full package copy, so runtime
 * subpath requires (react/jsx-runtime, react-dom/server, scheduler,
 * firebase/*) resolve even when the tracer cannot see them statically.
 */
const vercelCjsExternals = isVercelBuild
  ? [
      "react*",
      "react-dom*",
      "scheduler*",
      "loose-envify*",
      "use-sync-external-store*",
      "@floating-ui/core*",
      "@floating-ui/dom*",
      "@floating-ui/react-dom*",
      "@floating-ui/utils*",
      "firebase*",
      "@firebase/app*",
      "@firebase/auth*",
      "@firebase/firestore*",
      "@firebase/webchannel-wrapper*",
      "@firebase/util*",
      "@firebase/component*",
      "@firebase/logger*",
      "@firebase/installations*",
    ]
  : [];

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Merged into the root Vite config; Nitro reads `userConfig.nitro` at build time.
  // firebase-admin is loaded via createRequire at runtime (keeps its CJS graph intact
  // and avoids the SDK_VERSION crash from bundling). Static side-effect imports in
  // src/lib/firebase.ts give the tracer an edge to follow; traceDeps marks the full
  // package for externalization + packaging into the Vercel function node_modules.
  vite: {
    nitro: {
      // `pkg*` = full package copy so app/auth/firestore subpaths and transitive
      // deps (google-auth-library, etc.) are present in the function output.
      traceDeps: ["firebase-admin*", ...vercelCjsExternals],
    },
  },
});
