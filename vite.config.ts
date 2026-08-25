// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
// Augments Vite's UserConfig with `nitro?: NitroConfig` (traceDeps, etc.).
import "nitro/vite";

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
      traceDeps: ["firebase-admin*"],
    },
  },
});
