# Phase 16 — Controlled Production Cutover Report

Date: 2026-11-09  
Worktree: `/tmp/opencode/wt-r2-image-storage`  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`  
Production domain: `https://cineprint.click`  
R2 CDN: `https://images.cineprint.click`

## 1. Executive summary

**Browser-only production cutover: PASS.**

R2-backed browser poster delivery is live on `https://cineprint.click`:

- **61 mapped posters** render from R2 optimized assets.
- **2 intentionally unavailable posters** render the local accessible placeholder.
- **0 broken poster images**, **0 Blob image requests**, **0 duplicate image requests**, **0 failed image requests**, and **0 console errors** in production browser checks.
- Two production monitoring passes passed **42/42** checks at desktop and mobile.
- Browser flag is active; **SEO and download flags remain false**.
- A real rollback drill was executed before activation: current → previous → current, with routes verified after restoration.

Stage status:

| Stage | Status |
|---|---|
| Starting-state revalidation | **PASS** |
| Full prebuild | **PASS** (outputs inspected; tracked metadata restored) |
| Vercel-target build | **PASS** |
| Rollback drill | **PASS** (with route-compatibility caveat) |
| Activation change + map regeneration | **PASS** |
| Production deployment/promotion | **PASS** |
| Production browser verification | **PASS** |
| Monitoring | **PASS** (two passes, ~4 minutes) |
| SEO/download isolation | **PASS** (both disabled) |

Material caveat: the activation changes are **uncommitted** and the production deployment was created from a local prebuilt bundle. No Git commit or push was performed. A future Git-based deployment will not include the activation until those changes are committed under separate authorization.

## 2. Starting branch, HEAD, and worktree state

| Item | Value |
|---|---|
| Branch | `feat/r2-image-storage` |
| HEAD | `ec5401ca82bb7d71f4679c60f2994cbc607177fe` |
| Worktree | Existing modified/untracked files preserved |
| Runtime map before activation | 61 entries, 122 unique keys |
| Allowlist | 61 identities |
| Canaries | 3 present |
| Intentionally unavailable | `stranger-things-2`, `the-substance-2` |
| Browser flag before activation | `false` |
| SEO flag | `false` |
| Download flag | `false` |

Phase 10A–10E, 11, 12A, 12B, 12C, 13, 14, and 15 reports/state files were preserved byte-for-byte.

## 3. Full build result and production target

### Prebuild

The authorized prebuild was executed locally with the existing environment (values were not inspected or printed):

- Notion query: 56 published items / 56 individual images.
- Palette cache: 76 entries; **0 updates** (image reads returned Blob 403).
- Sitemap: 63 poster entries, 26 artists, 3 films, 10 genres, 3 styles.
- Prebuild exit: **0**.

Generated sitemap differences were inspected:

- `public/sitemap-posters.xml`: only the two unavailable image entries changed from Blob to `https://cineprint.click/poster-unavailable.svg`.
- `src/routeTree.gen.ts`: regenerated route-tree formatting/order.
- Palette file: unchanged.

Because this phase does **not** authorize sitemap/SEO changes, the generated tracked files were restored to their preserved versions before the deployable build. The prebuild was validated, but its sitemap metadata change was **not deployed**.

### Production-target build

| Build | Result |
|---|---|
| `NITRO_PRESET=vercel npx vite build` | **PASS** |
| Preset | `vercel` |
| Function runtime | Node.js 24.x |
| Map entries in client asset | **61** |
| R2 domain present | **PASS** |
| Unavailable SVG packaged | **PASS** — `.vercel/output/static/poster-unavailable.svg` |
| Browser flag in bundle | **true** |
| SEO flag in bundle | **false** |
| Download flag in bundle | **false** (env-gated, no preview value inlined) |

Tracked prebuild artifacts remained byte-identical after restoring them; no unintended tracked changes were deployed.

## 4. Rollback drill procedure and actual outcome

**Status: PASS, with an important route-compatibility caveat.**

Deployment metadata:

| Role | Deployment ID | URL | Created |
|---|---|---|---|
| Pre-activation production | `dpl_GsLqJduvaWPtPy1zbkHzeUgYEqzC` | `cine-print-gallery-8p3a9dneg…` | 2026-11-05T15:21:11Z |
| Previous production | `dpl_6NRuPPnZdbeXFFktUQpuB4B6Zafg` | `cine-print-gallery-if9c96ae7…` | 2026-11-03T16:24:28Z |
| Activated production | `dpl_GfG6Z1YsQsx41kFHuqs481JzkcY5` | `cine-print-gallery-3ewpytu75…` | 2026-11-09T13:20:27Z |

Drill sequence:

1. `cineprint.click` was confirmed on `dpl_GsLq…`.
2. Rolled back to previous `dpl_6NRu…` at **13:11:33Z** via Vercel CLI.
3. Verified alias moved to `dpl_6NRu…`.
4. Routes: `/`, `/poster/backrooms-3`, `/poster/the-substance-2` returned 200; **`/genres` returned 404** on that older deployment.
5. Restored `dpl_GsLq…` at **13:12:38Z**.
6. Verified alias moved back and all routes (`/`, `/genres`, detail, unavailable detail) returned 200 at **13:12:53Z**.

Conclusion: provider-level rollback works and restores the complete deployment. The immediately previous deployment is **not** a fully route-compatible rollback target for the current application because it lacks `/genres`. The valid pre-activation rollback target is `dpl_GsLq…`. Blob was never used as a rollback mechanism.

## 5. Activation code changes and generated map validation

Minimal browser-only activation:

- `automation/migration/runtime-map.ts`:
  `DEFAULT_R2_BROWSER_IMAGES_ENABLED` changed from `false` to `true`.
  (`scripts/generate-r2-image-map.ts` imports/re-exports this constant; editing the wrapper alone would not work.)
- `npm run r2:map:generate` regenerated `src/lib/r2-image-map.generated.ts`.
- Tests that encoded the old browser-disabled default were updated to assert browser delivery enabled while SEO/download remain disabled.

Generated map validation:

| Check | Result |
|---|---|
| Map entries | **61** |
| Allowlist | **61** |
| Coverage | Exact match |
| Unique object references | **122** |
| Versioned originals / optimized | 58 / 58 |
| Canaries | 3 preserved |
| Unavailable identities in map | **0** (both remain intentional placeholders) |
| Duplicate identities/keys | **0** |
| Blob fallback for mapped posters | **None** |
| Browser flag | **true** |
| SEO flag | **false** |
| Download flag | **false** |

## 6. Deployment identifiers and timestamps

| Event | Timestamp (UTC) | Result |
|---|---|---|
| Prebuild start/finish | 2026-11-09 ~13:05–13:10 | PASS |
| Pre-activation Vercel build | 2026-11-09 ~13:11 | PASS |
| Rollback to previous | 13:11:33Z | PASS |
| Previous-route verification | 13:12:17Z | `/genres` 404 |
| Restore current | 13:12:38Z | PASS |
| Restore verification | 13:12:53Z | All routes 200 |
| Activation build | 2026-11-09 ~13:18–13:20 | PASS |
| Production deploy | 13:20:04Z start; ready 13:20:27Z | `dpl_GfG6Z1…` |
| Production promotion | ~13:20–13:21Z | `cineprint.click` moved to new deployment |
| Initial production browser pass | ~13:22Z | 42/42 |
| Monitoring pass 2 | 13:25:39Z–13:27:23Z | 42/42 |

Deployment mechanism: Vercel CLI prebuilt deployment, no Git push. `deploy --prebuilt --prod` created the deployment; `promote` moved the production alias. No DNS or domain configuration was changed.

## 7. Production browser test results

**Evidence type: actual headless Chromium against `https://cineprint.click`, not local preview.**

| Route / viewport | Poster links | Images | R2 | Blob | Broken | Unavailable | Decode failures | Console errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Home desktop | 63 | 161 | 155 | 0 | **0** | 6 nodes / 2 IDs | 0 | 0 |
| Home mobile | 63 | 161 | 155 | 0 | **0** | 6 nodes / 2 IDs | 0 | 0 |
| Mapped detail desktop | — | 7 | 7 | 0 | 0 | 0 | 0 | 0 |
| Mapped detail mobile | — | 7 | 7 | 0 | 0 | 0 | 0 | 0 |
| Unavailable detail `the-substance-2` desktop | — | 8 | 6 | 0 | **0** | 2 nodes / 1 ID | — | 0 |
| Unavailable detail `the-substance-2` mobile | — | 8 | 6 | 0 | **0** | 2 nodes / 1 ID | — | 0 |
| Unavailable detail `stranger-things-2` desktop | — | 6 | 4 | 0 | **0** | 1 node / 1 ID | — | 0 |
| Unavailable detail `stranger-things-2` mobile | — | 6 | 4 | 0 | **0** | 1 node / 1 ID | — | 0 |
| Genres desktop/mobile | — | 10 | 10 | 0 | 0 | 0 | 0 | 0 |

Additional production checks:

- **PASS** — 63 unique poster links on home.
- **PASS** — Mapped detail uses R2 optimized; zoom switches to R2 original.
- **PASS** — Both unavailable detail routes return 200 and show the local accessible placeholder.
- **PASS** — Back navigation returns to `/`.
- **PASS** — No Blob image requests.
- **PASS** — No duplicate image requests (network rows: home 63 unique image URLs; detail 64 unique; no duplicates).
- **PASS** — No failed image requests, no console errors, no uncaught exceptions.
- **PASS** — Other image host is `cineprint.click` only for the local unavailable SVG.

Image/decode statistics:

- Home desktop: 155 R2 images; 124 decoded, 31 lazy below-the-fold pending, 0 decode failures.
- Home mobile: 155 R2 images; 155 decoded, 0 pending, 0 failures.
- Mapped detail: 7/7 decoded.
- Category: 10/10 decoded.
- Unavailable placeholders: natural 800×1200.

## 8. Feature-flag states after deployment

Verified from the production `poster-images-*.js` asset:

- `R2_BROWSER_IMAGES_ENABLED` → **true** (`se=!0`).
- `R2_SEO_IMAGES_ENABLED` → **false** (`G=!1`).
- `R2_DOWNLOADS_ENABLED` → **false** (env-gated; no preview/download value inlined).

Production OG image remains the static `https://cineprint.click/og-image.png`; no SEO image activation occurred. The deployed sitemap remains the preserved version (63 Blob image locations); the prebuild-generated sitemap change was not deployed.

## 9. Monitoring results and rollback performed

Monitoring:

- Initial production pass: **42/42**, 0 broken, 0 Blob, 0 failed requests, 0 console errors.
- Second pass after 60 seconds: **42/42**, all routes HTTP 200, no regressions.
- No rollback trigger occurred after activation; no post-activation rollback was needed.

Rollback performed: only the pre-activation drill (current → previous → current). The final production deployment remains the activated R2 build.

## 10. Remaining limitations and risks

1. **Uncommitted activation.** The production deployment was created from a local prebuilt bundle with uncommitted activation/test changes. No Git commit or push was performed. Future Git-based deployments will not include this activation until those changes are committed under separate authorization.
2. **Previous deployment is not route-compatible.** `dpl_6NRu…` lacks `/genres` (404); use `dpl_GsLq…` or a later known-good deployment for rollback.
3. **SEO remains not ready.** OG/Twitter/JSON-LD/sitemap for mapped posters still use Blob URLs (403). SEO delivery remains disabled.
4. **Download remains disabled.** No R2 download delivery was activated.
5. **Full prebuild generated a sitemap change that was intentionally not deployed.** The deployed sitemap remains the preserved Blob-based version.
6. **Monitoring window was short.** Two passes over ~4 minutes; long-term 60-minute/24-hour monitoring is still recommended.
7. **800px detail assets** are upscaled 1.28× on 375px DPR-3; zoom uses originals.
8. **Pre-existing TypeScript, lint, CSRF, and CLS issues** remain.
9. **No Git commit/push**, so deployment provenance is local prebuilt output, not a remote commit.
10. Vercel CLI `link` refreshed the local `.env.local` OIDC token; contents were not inspected or printed.

## 11. Final status by stage

| Stage | Status |
|---|---|
| Starting state | **PASS** |
| Full prebuild | **PASS** |
| Vercel-target build | **PASS** |
| Rollback drill | **PASS** |
| Activation change | **PASS** |
| Map regeneration | **PASS** |
| Production deployment | **PASS** |
| Production promotion | **PASS** |
| Production browser verification | **PASS** |
| Monitoring | **PASS** |
| SEO activation | **NOT APPLICABLE / DISABLED** |
| Download activation | **NOT APPLICABLE / DISABLED** |
| Git commit/push | **NOT AUTHORIZED / NOT PERFORMED** |

## 12. Explicit final statement

**Browser-only R2 production cutover succeeded and was verified.** Production serves 61 R2-backed posters plus 2 intentional unavailable placeholders, with zero broken images, zero Blob requests, and clean console/network results.

SEO and download delivery remain disabled. No R2 object mutations, DNS changes, or external CMS/database writes occurred. No Git commit or push occurred.

Production deployment and browser activation **were performed** under this phase’s authorization. A post-activation rollback was **not required**; the rollback drill was completed and verified before activation.
