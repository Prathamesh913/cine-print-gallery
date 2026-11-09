# Phase 13 — Production Integration Readiness Report

Date: 2026-11-09  
Worktree: `/tmp/opencode/wt-r2-image-storage`  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`  
Public image domain: `https://images.cineprint.click`  
Bucket: `cineprint-posters` (read-only GET/HEAD only)

## 1. Executive summary

**Cutover recommendation: CONDITIONALLY READY for browser image delivery.**

Actual Chromium tests against the real application routes show the R2 integration works for every migrated identity:

- **61/61 mapped posters** resolve to R2 optimized URLs in real routes and decode with zero failures.
- **30/30 production-route browser checks passed** across home, poster detail/lightbox, zoom, back navigation, and a category route.
- **47/47 Phase 12C preview checks still pass** after the reliability changes.
- The safe production bundle builds successfully, includes the 61-entry map, and compiles browser/SEO/download flags **false**.
- The pre-existing Firebase isolation test now passes after a minimal dynamic-import fix; the full suite is **987 passed, 4 skipped, 0 failed**.

The application is **not unconditionally production-ready** because:

1. The catalogue contains **63 posters**, but only **61** are in the R2 map. `the-substance-2` and `stranger-things-2` still use Vercel Blob, which returns **403**, producing **4–5 broken images on the real home page**.
2. All legacy Blob URLs — including optimized Blob URLs for mapped posters — return **403**. R2 activation fixes 61/63 posters; it does not fix the two excluded identities.
3. A real deployment rollback has not been drilled.
4. SEO/Open Graph/sitemap images still point at Blob URLs (SEO activation is intentionally disabled), so social/search imagery remains broken independently of browser delivery.
5. The 800px optimized asset is upscaled on a 375px DPR-3 detail/lightbox view (≈1023 physical px required).

**Conditions for unconditional cutover:** map or hide the two excluded posters, complete a deployment rollback drill, and decide whether the separate SEO/OG Blob 403 issue must be resolved before enabling browser delivery.

## 2. Baseline repository state

| Item | Value |
|---|---|
| Branch | `feat/r2-image-storage` |
| HEAD | `ec5401ca82bb7d71f4679c60f2994cbc607177fe` |
| Worktree status | 49 existing modified/untracked entries before the Phase 13 report |
| Browser flag | `R2_BROWSER_IMAGES_ENABLED = false` |
| SEO flag | `R2_SEO_IMAGES_ENABLED = false` |
| Download flag | `R2_DOWNLOADS_ENABLED = false` outside explicit local/preview env |
| Runtime map | 61 entries, 122 unique object keys |
| Canaries | 3 preserved |
| Excluded identities | `stranger-things-2`, `the-substance-2` |

Historical state before Phase 13:

- Full suite: 986 passed, 4 skipped, 1 failed (`tests/security/public-firebase-isolation.test.ts:44`).
- TypeScript: one pre-existing error at `src/routes/__root.tsx:148`.
- ESLint: 0 errors, 2 pre-existing React hook warnings in the R2 preview scope.
- Production build: NOT TESTED in Phase 12C.

Phase 13 preserved the historical Phase 10A–10E, 11, 12A, 12B, and 12C reports and state files byte-for-byte. Existing worktree changes and untracked files were preserved.

## 3. Production-route inventory

| Route | Components / data path | R2 relevance | Phase 13 coverage |
|---|---|---|---|
| `/` | `index.tsx` loader → `fetchNotionPosters`; `PosterGrid`/`PosterCard`, `DailySpotlight`, `ArtistRail`, `CollectionCard` | Shared `PosterImage` + default resolver | Browser tested desktop + mobile |
| `/poster/$id` | `PosterArticle` + `Lightbox`; `PosterImage` detail; zoom switches to original | Shared resolver, detail and original purposes | Browser tested desktop + mobile |
| `/genres` | Taxonomy directory using shared poster cards and `getPosterSeoImageUrl` metadata | Shared `PosterImage` | Browser tested desktop + mobile |
| `/styles`, `/artists`, `/film/$slug`, `/genre/$slug`, `/style/$slug` | Same taxonomy/film components and shared poster card | Shared resolver | NOT individually exercised; `/genres` is the representative category route |
| `/c/$id` | Collection hero/grid; requires a collection ID, often auth-scoped | Shared `PosterImage` | NOT TESTED — no public collection link or fixture was available without auth |
| `/saved`, `/profile`, `/login`, `/submit` | Authenticated/user-specific | Some use shared poster cards | NOT TESTED — auth required |

Local preview mechanism used for route validation:

```bash
VITE_VERCEL_ENV=development VITE_R2_BROWSER_IMAGES=true npx vite dev --port 4317
```

This is a **local preview override**, not production activation. The generated production defaults and build output keep browser delivery disabled.

## 4. Route-by-route browser results

**Evidence type: actual headless Chromium 155.0.8059.84, real routes, live Firestore-backed catalogue.**

| Route / viewport | Images | R2 optimized | Blob | R2 broken | Blob broken | R2 decoded | Console errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| Home desktop 1440 | 161 | 155 | 6 | 0 | 5 | 124 (31 lazy pending) | 0 |
| Home mobile 375 | 161 | 155 | 6 | 0 | 4 | 153 (2 lazy pending) | 0 |
| Detail desktop | 7 | 7 | 0 | 0 | 0 | 7 | 0 |
| Detail mobile | 10 | 10 | 0 | 0 | 0 | 10 | 0 |
| Category `/genres` desktop | 10 | 10 | 0 | 0 | 0 | 10 | 0 |
| Category `/genres` mobile | 10 | 10 | 0 | 0 | 0 | 10 | 0 |

Additional results:

- **PASS** — Home rendered 63 unique poster links; 61 are R2-mapped, 2 are the excluded identities.
- **PASS** — Detail route rendered the lightbox overlay with a working close control.
- **PASS** — Clicking the detail image switched from the R2 optimized URL to the R2 **original** URL.
- **PASS** — Browser back navigation returned to `/`.
- **PASS** — Category route rendered 10 R2 images with zero broken images.
- **PASS** — No full-size R2 originals were used for home thumbnails after the lazy-timeout fix (`originalCount = 0`).
- **FAIL (scope)** — The two excluded posters are broken on home: 5 broken images on desktop, 4 on mobile, all Blob 403.
- **PASS** — Zero R2 broken images, zero R2 decode failures, zero console errors, zero uncaught exceptions.

Harness summary: **30 checks, 30 passed, 0 failed**.

The Blob failures are not caused by the R2 resolver; they are the two catalogue identities intentionally excluded from the migration. They are nevertheless visible on the real home page.

## 5. Screenshots and evidence artifact paths

Actual browser screenshots:

- `/tmp/opencode/phase13/screenshots/routes-home-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-home-mobile.png`
- `/tmp/opencode/phase13/screenshots/routes-detail-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-detail-mobile.png`
- `/tmp/opencode/phase13/screenshots/routes-detail-zoom-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-detail-zoom-mobile.png`
- `/tmp/opencode/phase13/screenshots/routes-back-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-back-mobile.png`
- `/tmp/opencode/phase13/screenshots/routes-category-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-category-mobile.png`

Evidence files:

- `/tmp/opencode/phase13-routes-browser.json` — route checks, image counts, network rows, CLS/LCP.
- `/tmp/opencode/phase12c-browser.json` — 47-check preview harness.
- `/tmp/opencode/phase12c/screenshots/` — preview and failure-state screenshots.
- `/tmp/opencode/phase13-build-final.log` — safe Vite build output.
- `/tmp/opencode/phase13-home.html` and `/tmp/opencode/phase13-detail.html` — SSR metadata samples.

## 6. Actual R2 image resolution and decode results

**Evidence type: actual browser + read-only HTTP HEAD.**

- **PASS** — All 61 mapped identities resolve to `https://images.cineprint.click/...` optimized URLs through the same resolver path used by production components.
- **PASS** — Mapped display candidates are `[optimized, original]`; no Blob candidate is offered for a mapped poster.
- **PASS** — Detail zoom resolves the R2 original, e.g. `backrooms-3` changed from `/versions/optimized/...` to `/versions/original/...`.
- **PASS** — R2 decode: 0 failures across all complete images; lazy below-the-fold images remained pending rather than broken.
- **PASS** — R2 HEAD sample returned `200`, correct `image/webp`/`image/png`, expected lengths, and `Cache-Control: public, max-age=31536000, immutable`.
- **FAIL (scope)** — Vercel Blob returns `403` for excluded posters and even for mapped posters' legacy optimized Blob URLs. The current pre-cutover delivery path is therefore broken for the whole catalogue.

Representative HEAD results:

| Object | Status | Type | Cache-Control |
|---|---:|---|---|
| `2001-a-space-odyssey` optimized | 200 | `image/webp` | `public, max-age=31536000, immutable` |
| `2001-a-space-odyssey` original | 200 | `image/png` | `public, max-age=31536000, immutable` |
| `art-of-a-hit-2024` optimized | 200 | `image/webp` | `public, max-age=31536000, immutable` |
| `backrooms-3` optimized | 200 | `image/webp` | `public, max-age=31536000, immutable` |
| `the-substance-2` Blob | 403 | — | `public, max-age=0, must-revalidate` |

## 7. Production build safety assessment and result

**Evidence type: static inspection of build scripts + safe local build.**

The normal `npm run build` was **NOT TESTED** because its `prebuild` is not side-effect-free:

- `scripts/extract-palettes.js` reads Notion and writes the tracked `src/lib/poster-palettes.json` (and writes an empty placeholder on failure).
- `scripts/generate-sitemap.ts` reads Firestore and rewrites tracked files:
  - `public/sitemap.xml`
  - `public/sitemap-static.xml`
  - `public/sitemap-posters.xml`
  - `public/sitemap-artists.xml`
  - `public/sitemap-films.xml`
  - `public/sitemap-genres.xml`
  - `public/sitemap-styles.xml`
  - `public/robots.txt`
- Running it would modify tracked files and perform external reads, both outside the Phase 13 authorization.

Safe isolated build:

```bash
npx vite build
```

- **PASS** — Exit status 0, built in ~2.1–3.0s.
- **PASS** — `.output` generated (12 MB); `dist`/`.output`/`.wrangler` are gitignored.
- **PASS** — Tracked prebuild targets were byte-identical before and after (`sha256sum -c`).
- **PASS** — Built client asset contains the R2 domain and **61** `blobImageUrl` map entries.
- **PASS** — Built activation code remains gated: `W = H && previewFlag(VITE_R2_BROWSER_IMAGES)`, `K = H && previewFlag(VITE_R2_DOWNLOADS)`, `G = false`, with `H` false because no `VITE_VERCEL_ENV` value was inlined.
- **PASS** — No `VITE_R2_BROWSER_IMAGES=true`, `VITE_R2_DOWNLOADS=true`, or preview environment value was baked into the client asset.
- **PASS** — No R2 optimized URL appears in SEO metadata or the existing sitemap.

**Production build result: PASS for the application bundle via the safe path. Full `npm run build` including prebuild: NOT TESTED.**

## 8. Firebase isolation failure investigation

**Status: PASS after a minimal, explicitly documented fix.**

The test asserts that importing `src/lib/firebase.ts` and the public poster path never evaluates `src/server/firebase/admin.ts` or any `firebase-admin` module. This protects public SSR from eagerly loading `firebase-admin/auth → jwks-rsa → jose`, the cause of a prior `ERR_REQUIRE_ESM` outage.

Findings:

- The failure was caused by a **static import** at `src/lib/notion.ts:8`:
  `import { getAdminDb } from "../server/firebase/admin";`
- `src/server/firebase/admin.ts` statically imports `firebase-admin/app`, `firebase-admin/auth`, and `firebase-admin/firestore`.
- `git blame` dates the static import to commit `0b5fc1f` (2026-08-25), **before** the R2 migration work. It is not caused by R2.
- The test failure is deterministic, not flaky or environment-dependent.
- It is a module-isolation and deployment-risk issue, not direct public exposure of private Firestore data; Firestore security rules remain the data boundary.

Phase 13 fix:

```ts
const { getAdminDb } = await import("../server/firebase/admin");
```

inside the `submitPosterToNotion` handler only. The public poster route no longer statically evaluates the Admin module.

Results:

- `tests/security/public-firebase-isolation.test.ts`: **3/3 passed**.
- Full suite: **987 passed, 4 skipped, 0 failed**.
- Remaining test-hygiene warnings about `vi.mock` hoisting are pre-existing and do not affect the assertion.

`firebase-admin` still appears in the server build because authenticated server paths legitimately use it; it is no longer on the public poster path.

## 9. SEO and download isolation

**Status: PASS for isolation; WARNING for existing SEO/OG image URLs.**

| Control | Result |
|---|---|
| Browser flag independent | **PASS** — env-gated, production default false |
| SEO flag independent | **PASS** — `R2_SEO_IMAGES_ENABLED = false`, no preview override |
| Download flag independent | **PASS** — `R2_DOWNLOADS_ENABLED = false` outside explicit preview env |
| Built client flags | **PASS** — compiled false; no preview env values inlined |
| Open Graph / Twitter image | **WARNING** — remains legacy Blob optimized (`csfzm0oz.../cineprint/optimized/legacy/backrooms-3.webp`), which returns 403 |
| JSON-LD / sitemap images | **WARNING** — sitemap contains 63 image locations, all Blob host; no R2 optimized URLs |
| Download path | **PASS for R2 isolation** — with downloads disabled, `getPosterDownloadUrl` uses legacy `posterImageUrl || image`; no R2 original is activated |
| Download endpoint | **NOT APPLICABLE** — download is client-side fetch/data-URL, not a server endpoint |

The SEO/OG Blob 403 issue is pre-existing and outside browser delivery. It is not fixed or activated in this phase.

## 10. Runtime and security audit

| Property | Result | Evidence |
|---|---|---|
| Runtime map schema | **PASS** | 61 entries; public fields only |
| Map/allowlist coverage | **PASS** | 61/61 exact match |
| Object references | **PASS** | 122 unique keys; 58 versioned originals + 58 versioned optimized + 6 canary |
| Origin restriction | **PASS** | Resolver accepts only HTTPS `images.cineprint.click` |
| Exact identity binding | **PASS** | Mapping requires exact `blobImageUrl` match |
| Unknown identity | **PASS** | No R2 URL constructed; legacy path only |
| Malformed mapped entry | **PASS** | Empty candidates → neutral placeholder; no Blob fallback |
| Missing optimized/original | **PASS** | Fails closed |
| Blob fallback for mapped poster | **PASS** | Candidates are R2-only |
| Arbitrary URL injection | **PASS** | No URL/key construction from poster ID |
| Private migration metadata | **PASS** | No source URLs, local paths, hashes beyond public artifact metadata |
| Cache headers | **PASS** | `public, max-age=31536000, immutable` |
| Public accessibility | **PASS** | R2 200 on sampled optimized/original objects |
| Browser network hosts | **PASS** | Only localhost, R2, Blob (excluded), Google Fonts, Vercel Analytics |
| Duplicate R2 requests | **PASS** | No duplicate R2 image URLs; duplicates limited to repeated Blob excluded posters |
| Console/exceptions | **PASS** | 0 console errors, 0 exceptions, 0 unhandled rejections on final route run |
| CSRF middleware for server functions | **WARNING** | `src/start.ts` registers only the error middleware; TanStack Start warns that server functions are not protected by CSRF middleware. Pre-existing, not R2-related; not changed in this phase. |

The runtime map intentionally includes the public Blob identity URL (`blobImageUrl`) used to verify exact poster identity; it is not private migration metadata.

## 11. Performance and image-quality findings

**Evidence type: actual browser measurements on real routes; preview-only, not production performance claims.**

Responsive sizes:

| Route / viewport | CSS size | DPR | Required px | 800px source |
|---|---:|---:|---:|---|
| Home grid desktop | 109–166 wide | 1 | ≤166 | Sufficient |
| Home grid mobile | 109 wide | 3 | 327 | Sufficient |
| Category cards | 161–262 wide | 1–2 | ≤524 | Sufficient |
| Detail desktop | 441×663 | 1 | 441 | Sufficient |
| Detail mobile | 341×512 | 3 | **1023** | **Upscaled 1.28×** |
| Detail zoom | Original asset | any | Original | Sharp |

Findings:

- **PASS** — 800px optimized assets are sufficient for all tested grid/category layouts, including DPR 3 mobile.
- **WARNING** — The non-zoomed detail/lightbox on a 375px DPR-3 viewport requires ≈1023 physical px from an 800px asset. Zoom uses the full original, so close inspection remains sharp.
- **Future enhancement, not a blocker** — 1200/1600/2000px variants plus `srcset`/`sizes` would improve detail/lightbox quality. No variants were generated or uploaded.
- **WARNING** — Actual-route CLS was **0.092** on home desktop and **0.158** on home mobile. Captured shift sources were font/nav text reflow and footer layout, not R2 images. Category route CLS was 0.
- **NOT A PRODUCTION CLAIM** — LCP varied run-to-run on the dev server (≈2.6s desktop, ≈4.0s mobile in the final run). These are local preview measurements.
- **PASS** — No duplicate R2 image requests; lazy loading kept below-the-fold images pending rather than broken.
- **PASS** — `decoding="async"` and aspect-ratio reservation remain in place.

## 12. Rollback architecture and rehearsal

**Status: WARNING — local simulation PASS; deployment rollback NOT TESTED.**

Architecture:

- The runtime map is **bundled**, not dynamically loaded. It is imported statically by `src/lib/poster-images.ts` and appears in both the client asset (`poster-images-*.js`) and server SSR chunk.
- There is no remote configuration service, runtime version pointer, or dynamic map fetch.
- The deployment target is Vercel project `cine-print-gallery` (`.vercel/repo.json`).

Rollback options:

1. **Vercel deployment rollback / promote a previous deployment** — requires no new code, but changes the active deployment. Not executed.
2. **Redeploy a previous commit** containing a known-good map — requires a new deployment.
3. **Disable browser delivery** (`R2_BROWSER_IMAGES_ENABLED=false`) and redeploy — returns to Blob, which returns 403. **Not viable** as a recovery path.
4. **Restore a previous full map** — keeps 61 posters on R2 and does not depend on Blob. This is the preferred code-level rollback.

Caching and compatibility:

- Built assets are hashed and immutable; old hashed assets remain available in previous deployments.
- Cached HTML may briefly reference an older hashed JS asset; that asset still contains a complete map, so there is no mixed-map page.
- A map version change requires a deployment; CDN cache does not provide an independent switch.

Failure behavior:

- **Malformed map at build time** — `r2:map:check` / generator validation fails closed.
- **Malformed mapped entry at runtime** — resolver returns no candidates; component shows the neutral placeholder.
- **R2 unavailable** — optimized and original R2 candidates fail; placeholder appears; no Blob fallback.
- **Blob unavailable** — already the current state (403); not a usable rollback.

Local rehearsal (`tests/rollback-simulation.test.ts`, 5 tests, passing):

canary-only map → full 61-entry map → malformed map → canary-only map; resolution remained deterministic and malformed entries failed closed.

**Actual deployment rollback: NOT TESTED.** Recommended drill: promote the previous Vercel deployment, verify home/detail images are R2 200, confirm zero Blob requests, and verify console/network are clean.

## 13. Test, lint, type-check, and build results

| Check | Result |
|---|---|
| Production-route browser harness | **30/30 passed** |
| Phase 12C preview/failure harness | **47/47 passed** |
| Full suite | **987 passed, 4 skipped, 0 failed** |
| Firebase isolation test | **3/3 passed** |
| `npm run r2:map:check` | **pass** |
| Scoped ESLint — R2 files | **0 errors, 2 pre-existing hook warnings** |
| ESLint — `notion.ts` | 2 pre-existing `no-explicit-any` errors |
| ESLint — `saved.ts` / `user-profile.ts` | 2 pre-existing hook warnings |
| `tsc --noEmit` | **1 pre-existing error**, `src/routes/__root.tsx:148` |
| `git diff --check` | **pass** |
| Safe `npx vite build` | **pass**, flags false, map included |
| Full `npm run build` | **NOT TESTED** (prebuild writes tracked files) |

The `notion.ts` `any` errors are on unchanged lines and predate Phase 13. They were not silently fixed.

## 14. Remaining blockers

**Material cutover blockers**

1. **Two excluded posters are broken on the real home page.** `the-substance-2` and `stranger-things-2` remain Blob 403. The home page showed 5 broken images (desktop) / 4 (mobile). Map them or hide/remove them before enabling browser delivery.
2. **Actual deployment rollback has not been drilled.** The local map rehearsal passes, but provider-level recovery is unproven.

**Non-blocking warnings**

3. SEO/Open Graph/sitemap image URLs still use Blob and return 403; SEO activation remains disabled. Resolve separately if social/search imagery matters.
4. The 800px optimized asset is upscaled on a 375px DPR-3 detail/lightbox (≈1023 px required); zoom uses the original. Larger variants are a quality enhancement.
5. Actual-route CLS is 0.092 desktop / 0.158 mobile from font/footer reflow, not R2.
6. Full `npm run build` with prebuild remains untested because it writes tracked sitemap/palette files and performs external reads.
7. Pre-existing TypeScript error at `src/routes/__root.tsx:148`.
8. Collection/auth routes were not browser-tested.
9. The route harness is local-only and not yet in CI.
10. Pre-existing TanStack Start warning: server functions are not protected by CSRF middleware (`src/start.ts` has only error middleware). Not R2-related and not changed in this phase.

## 15. Explicit cutover recommendation

**CONDITIONALLY READY** for browser R2 image delivery.

The evidence supports enabling browser delivery for the 61 mapped identities:

- 61/61 mapped posters rendered and decoded in the real app.
- 30/30 route checks and 47/47 preview checks passed.
- The safe bundle builds with flags false and the 61-entry map included.
- No R2 mutations, external writes, deployments, commits, or flag changes occurred.

Do **not** enable production browser delivery until the following conditions are met:

1. **Resolve the two excluded posters** — complete identity verification and add them to the map, or remove/hide them from the catalogue. Re-run the home route and require zero broken images.
2. **Complete a real Vercel rollback drill** — promote the previous deployment, verify R2 delivery and clean console/network, then restore the current deployment.
3. **Decide the SEO/OG Blob 403 disposition** — it is independent of browser delivery but currently breaks social/search images.
4. Optionally add larger image variants for detail/lightbox quality.

Until conditions 1 and 2 are satisfied, the correct classification is **CONDITIONALLY READY**, not production-ready.

## Files changed in Phase 13

**Added**

- `scripts/browser-r2-routes.mjs` — dependency-free Chromium CDP harness for real application routes.
- `migration/PHASE-13-PRODUCTION-INTEGRATION-READINESS-REPORT.md` — this report.

**Modified**

- `src/components/PosterImage.tsx` — lazy-image timeout scoping; explicit timeout support for fixtures; `onLoad` after decode.
- `src/lib/notion.ts` — Admin module loaded dynamically inside the submission handler, restoring public-path isolation.
- `src/lib/saved.ts` — stable server snapshot for `useSyncExternalStore`.
- `src/lib/user-profile.ts` — stable server snapshot for `useSyncExternalStore`.

The last three changes are explicitly documented as pre-existing, non-R2 fixes required to obtain clean readiness evidence.

## Preservation confirmation

- Branch remains `feat/r2-image-storage`.
- HEAD remains `ec5401ca82bb7d71f4679c60f2994cbc607177fe`.
- Phase 10A–10E, Phase 11, Phase 12A, Phase 12B, and Phase 12C report hashes match their pre-Phase-13 values exactly.
- Migration map remains 61 entries / 122 unique keys; 58 versioned originals + 58 versioned optimized + 6 canary references.
- All three canaries remain present and unchanged.
- Both medium-confidence identities remain excluded.
- Production browser, download, and SEO flags remain **false**.
- No R2 uploads, deletes, copies, or mutations.
- No DNS, Cloudflare, Vercel, Firebase, Firestore, Notion, Raindrop, or Blob configuration changes.
- No commits, pushes, merges, rebases, deployments, or branch switching.
- No secrets, credentials, tokens, or environment-file contents were inspected or printed.

**Phase 13 is complete. Browser delivery is conditionally ready; production activation and deployment remain unauthorized.**
