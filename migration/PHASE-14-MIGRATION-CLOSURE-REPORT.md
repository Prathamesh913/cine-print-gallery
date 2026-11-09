# Phase 14 — Migration Closure Report

Date: 2026-11-09  
Worktree: `/tmp/opencode/wt-r2-image-storage`  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`  
Public image domain: `https://images.cineprint.click`  
Bucket: `cineprint-posters` (read-only GET/HEAD only)

## Executive summary

**Browser image delivery: READY.**  
**SEO/metadata delivery: NOT READY (separate, intentionally disabled).**  
**Overall production cutover: CONDITIONALLY READY** pending full prebuild validation and a real rollback drill.

What changed:

- The two unresolved catalogue identities now have an **intentional, accessible unavailable state** using a local neutral asset. They remain first-class catalogue entries; no Blob, no broken image, no fabricated poster, and no R2 upload.
- The real application now covers **all 63 catalogue identities**:
  - **61** mapped posters render from R2 optimized assets.
  - **2** unresolved posters render the local “Image unavailable” state.
- Home page: **0 Blob images, 0 broken images, 0 Blob requests, 0 console errors**.
- Actual Chromium route harness: **42/42 checks passed** across home, mapped detail/lightbox, both unavailable detail routes, zoom, back navigation, and category, at desktop and mobile.
- Phase 12C failure/preview harness: **47/47 checks passed**.
- Full suite: **989 passed, 4 skipped, 0 failed**.
- Safe build: `npx vite build` and `npm run build --ignore-scripts` pass; flags compile false; the unavailable SVG is packaged; tracked prebuild artifacts remain byte-identical.

Remaining non-browser gates:

- Full `npm run build` including prebuild remains **NOT TESTED** because prebuild performs external Notion/Firestore reads and writes tracked sitemap/palette files.
- A real deployment rollback drill remains **NOT TESTED** (not authorized).
- SEO/Open Graph/sitemap images for mapped posters still use Blob URLs that return 403; SEO delivery remains disabled.
- 800px optimized assets are upscaled on a 375px DPR-3 detail view; zoom uses originals. Larger variants are a future enhancement, not a browser-delivery blocker.

## Final 63-poster coverage and dispositions

| Category | Count |
|---|---:|
| Catalogue posters | 63 |
| R2 mapped posters | 61 |
| Intentionally unavailable posters | 2 |
| Broken images on home | **0** |
| Blob images on home | **0** |
| Blob requests on home | **0** |
| Unique poster links on home | **63** |

### `stranger-things-2` — intentional unavailable

- Raindrop ID: `1521167165`.
- Source: pbs `G9gZV6dWEAAOjjU`; live read returned **200**, `image/jpeg`, **2,728,405 bytes**, SHA-256 **matches** the recorded manifest hash.
- Local source cache: **absent** (cache contains only the 58 migrated posters).
- R2 legacy keys: **404** (`/cineprint/external/stranger-things-2.jpg`, optimized counterpart).
- Blob original/optimized: **403**.
- Identity confidence remains **medium** because the multi-image page association is not human-confirmed.
- Final disposition: **intentional unavailable state**. No upload, no substitution, no forced map entry.

### `the-substance-2` — intentional unavailable

- Raindrop ID: `1786264374`.
- Source: pbs `HMtwlGHXgAAYt0L`; live read returned **200**, `image/jpeg`, **77,278 bytes**, SHA-256 **matches** the recorded manifest hash.
- Local source cache: **absent**.
- R2 legacy keys: **404**.
- Blob original/optimized: **403**.
- Identity confidence remains **medium** because the multi-image page association is not human-confirmed.
- Final disposition: **intentional unavailable state**. No upload, no substitution, no forced map entry.

Both identities remain absent from the 61-entry runtime map and allowlist. Their catalogue metadata and IDs are preserved.

## Browser route and viewport results

**Evidence type: actual headless Chromium 155.0.8059.84 against the real application with the local preview-only R2 flag.**

| Route / viewport | Poster links | Images | R2 | Blob | Broken | Unavailable | Decode failures | Console errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Home desktop | 63 | 161 | 155 | 0 | **0** | 6 nodes / 2 IDs | 0 | 0 |
| Home mobile | 63 | 161 | 155 | 0 | **0** | 6 nodes / 2 IDs | 0 | 0 |
| Mapped detail desktop | — | 7 | 7 | 0 | 0 | 0 | 0 | 0 |
| Mapped detail mobile | — | 10 | 10 | 0 | 0 | 0 | 0 | 0 |
| Unavailable detail `the-substance-2` desktop | — | 8 | 6 | 0 | **0** | 2 nodes / 1 ID | — | 0 |
| Unavailable detail `the-substance-2` mobile | — | 8 | 6 | 0 | **0** | 2 nodes / 1 ID | — | 0 |
| Unavailable detail `stranger-things-2` desktop | — | 6 | 4 | 0 | **0** | 1 node / 1 ID | — | 0 |
| Unavailable detail `stranger-things-2` mobile | — | 6 | 4 | 0 | **0** | 1 node / 1 ID | — | 0 |
| Category `/genres` desktop/mobile | — | 10 | 10 | 0 | 0 | 0 | 0 | 0 |

Additional browser results:

- **PASS** — Home rendered 63 unique poster links; every link is either one of the 61 R2 identities or one of the 2 unavailable identities.
- **PASS** — Both unavailable IDs render `/poster-unavailable.svg` with natural dimensions 800×1200.
- **PASS** — Linked unavailable cards expose descriptive alt text such as `Image unavailable: The Substance (2024) by Eileen Steinbach`; decorative hero-wall copies keep `alt=""` to avoid screen-reader noise.
- **PASS** — Mapped detail/lightbox images decode from R2 optimized URLs; zoom switches to the R2 original.
- **PASS** — Browser back navigation returns to `/`.
- **PASS** — No duplicate R2 image requests and no failed image requests.
- **PASS** — 42/42 route checks; 47/47 Phase 12C checks.

Home decoded 124 of 155 R2 images on desktop and 153 of 155 on mobile; the remainder were lazy below-the-fold images still pending, not broken. All completed R2 images decoded with zero failures.

## Screenshots and evidence paths

Essential screenshots:

- `/tmp/opencode/phase13/screenshots/routes-home-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-home-mobile.png`
- `/tmp/opencode/phase13/screenshots/routes-home-unavailable-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-home-unavailable-mobile.png`
- `/tmp/opencode/phase13/screenshots/routes-detail-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-detail-mobile.png`
- `/tmp/opencode/phase13/screenshots/routes-detail-zoom-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-detail-zoom-mobile.png`
- `/tmp/opencode/phase13/screenshots/routes-unavailable-detail-the-substance-2-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-unavailable-detail-the-substance-2-mobile.png`
- `/tmp/opencode/phase13/screenshots/routes-unavailable-detail-stranger-things-2-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-unavailable-detail-stranger-things-2-mobile.png`
- `/tmp/opencode/phase13/screenshots/routes-category-desktop.png`
- `/tmp/opencode/phase13/screenshots/routes-category-mobile.png`

Evidence files:

- `/tmp/opencode/phase13-routes-browser.json` — 42-check real-route evidence.
- `/tmp/opencode/phase12c-browser.json` — 47-check preview/failure evidence.
- `/tmp/opencode/phase14-build-final.log` — safe Vite build.
- `/tmp/opencode/phase14-npm-build-ignore-scripts.log` — npm build command without lifecycle prebuild.
- `/tmp/opencode/phase14-unavailable-detail.html` and `phase14-mapped-detail.html` — metadata samples.

## Image quality decision

**Status: PASS for browser cutover; WARNING for high-DPI detail quality; future enhancement, not a blocker.**

- Home/category grid CSS widths are 109–262px; the 800px optimized asset is sufficient even at DPR 3 (max required ≈549px).
- Mapped detail desktop: 441×663 CSS at DPR 1 → 441px required; 800px sufficient.
- Mapped detail mobile: 341×512 CSS at DPR 3 → **≈1023px required**; the 800px asset is upscaled **1.28×**.
- Zoom uses the R2 original, so close inspection remains sharp.
- Decision: **800px optimized assets are acceptable for cutover**; 1200/1600px variants and `srcset`/`sizes` are a future quality enhancement, not a browser-delivery blocker. No variants were generated or uploaded.

## SEO and metadata disposition

**Status: WARNING — browser delivery is separate from SEO readiness.**

| Consumer | Current state | Used? | Recommendation |
|---|---|---|---|
| Browser `<img>` for 61 mapped posters | R2 optimized | Yes | **Ready** |
| Browser `<img>` for 2 unresolved posters | Local `/poster-unavailable.svg` | Yes | **Intentional unavailable** |
| Open Graph/Twitter for mapped posters | Blob optimized (403) | Yes, when SEO enabled | Switch to R2 optimized when SEO is authorized |
| Open Graph/Twitter for unresolved posters | `https://cineprint.click/poster-unavailable.svg` | Yes | Explicit unavailable |
| JSON-LD structured data | Same resolver as SEO | Yes | R2 optimized after SEO activation |
| Existing sitemap image entries | 63 Blob image locations (stale) | Crawlers | Regenerate with R2 optimized + unavailable SVG after SEO authorization |
| Home OG image | `https://cineprint.click/og-image.png` | Yes | No change |
| Download | Blob for mapped while downloads disabled; unresolved returns no URL | Only when enabled | Use R2 originals when downloads are authorized; never Blob |
| Server image proxy (`getBase64Image`) | Accepts public HTTP(S) image URLs, rejects private/loopback hosts and non-image types | Download path | Pre-existing behavior; not R2-specific |

No SEO delivery was enabled and no sitemap or production metadata was regenerated. Existing sitemap files remain unchanged and still reference Blob; this is an SEO-readiness issue, not a browser-delivery issue.

## Full build validation and side-effect assessment

**Status: PASS for safe build stages; full prebuild NOT TESTED.**

`npm run build` prebuild side effects:

- `scripts/extract-palettes.js` reads Notion and writes tracked `src/lib/poster-palettes.json` (and may write an empty placeholder on failure).
- `scripts/generate-sitemap.ts` reads Firestore and rewrites tracked `public/sitemap*.xml` and `public/robots.txt`.
- Both require external reads and tracked-file writes, which are outside Phase 14 authorization.

Safe validation performed:

| Command | Result |
|---|---|
| `npx vite build` | **PASS** — exit 0, `.output` generated |
| `npm run build --ignore-scripts` | **PASS** — exact npm build command without lifecycle prebuild |
| `npm run r2:map:check` | **PASS** |
| Tracked prebuild targets before/after | **byte-identical** (`sha256sum -c`) |
| `.output/public/poster-unavailable.svg` | **present** (872 bytes) |
| Built client map entries | **61** |
| Built R2 domain | **present** |
| Built unavailable URL | **present** |
| Built activation | Browser/download env-gated; SEO literal `false`; no preview env values inlined |

**Full `npm run build` including prebuild: NOT TESTED.** This is the main remaining build-evidence gap. It does not affect the browser bundle validation, but it must be exercised in a deployment-like environment with authorized external reads before production cutover.

## Security and feature-flag results

| Property | Result | Evidence |
|---|---|---|
| Runtime map entries | **PASS** | 61 |
| Allowlist coverage | **PASS** | 61/61 exact |
| Object references | **PASS** | 122 unique keys |
| Canaries | **PASS** | 3 preserved |
| Unresolved identities in map | **PASS** | Both absent |
| Approved R2 hostname only | **PASS** | HTTPS `images.cineprint.click` |
| Unknown identity | **PASS** | No R2 URL constructed |
| Malformed map entry | **PASS** | Neutral unavailable asset, no Blob |
| Missing optimized/original | **PASS** | Fails closed |
| Blob fallback for mapped poster | **PASS** | None |
| Public/private Firebase isolation | **PASS** | Security test 3/3 |
| SEO isolation | **PASS** | Flag false, no R2 optimized in metadata |
| Download isolation | **PASS** | Flag false; unresolved has no download URL |
| Browser flag | **PASS** | `false` |
| SEO flag | **PASS** | `false` |
| Download flag | **PASS** | `false` outside explicit preview env |
| CSRF middleware | **WARNING** | Pre-existing TanStack warning; `src/start.ts` has only error middleware. Not R2-related. |
| Browser network hosts | **PASS** | Localhost, R2, Google Fonts, Vercel Analytics; no Blob |

## Test, lint, TypeScript, and build results

| Check | Result |
|---|---|
| Full suite | **989 passed, 4 skipped, 0 failed** |
| Route browser harness | **42/42 passed** |
| Phase 12C preview/failure harness | **47/47 passed** |
| `runtime-preview` tests | **15 passed** |
| Rollback simulation | **5 passed** |
| `npm run r2:map:check` | **pass** |
| Scoped ESLint — R2 files | **0 errors, 2 pre-existing hook warnings** |
| ESLint — `notion.ts` | 2 pre-existing `no-explicit-any` errors |
| ESLint — `saved.ts` / `user-profile.ts` | 2 pre-existing hook warnings |
| `tsc --noEmit` | **1 pre-existing error**, `src/routes/__root.tsx:148` |
| `git diff --check` | **pass** |
| `npx vite build` | **pass** |
| `npm run build --ignore-scripts` | **pass** |
| Full `npm run build` | **NOT TESTED** (prebuild external reads/tracked writes) |

## Rollback runbook

**Status: documented; actual deployment rollback NOT TESTED.**

1. **Identify the last known-good deployment.**
   - Vercel project: `cine-print-gallery` (`.vercel/repo.json`).
   - Choose the most recent production deployment whose client asset contains the expected map and whose smoke test passed.
   - Record its deployment URL and commit SHA.

2. **Restore through the provider.**
   - Use Vercel’s deployment rollback / “Promote to Production” for that deployment, or redeploy the known-good commit.
   - No R2 mutation is required; the map is bundled in the deployment assets.

3. **Verify the restored map and image URLs.**
   - Fetch the deployed home HTML and the hashed `poster-images-*.js` asset.
   - Confirm the map contains 61 entries and the local `poster-unavailable.svg`.
   - Confirm browser requests go to `https://images.cineprint.click/...` and no `public.blob.vercel-storage.com` image requests occur.

4. **Verify home, detail, and lightbox.**
   - Home: 63 poster links, 61 R2 posters, 2 unavailable placeholders, 0 broken, 0 Blob.
   - Mapped detail: R2 optimized image; zoom switches to R2 original.
   - Unavailable detail (`the-substance-2`, `stranger-things-2`): intentional placeholder, 0 Blob.
   - Browser console/network: 0 console errors, 0 failed image requests.

5. **Confirm flags.**
   - Browser flag: expected value for the deployment (false by default; true only for an authorized activation).
   - SEO flag: **false**.
   - Download flag: **false**.
   - Confirm no `VITE_R2_*` or preview environment values were accidentally inlined.

6. **If the R2 CDN becomes unavailable.**
   - Do not switch to Blob; Blob returns 403.
   - Roll back to the last known-good deployment if the failure correlates with a deployment.
   - If the CDN itself is down, mapped images will fail; the app has no Blob recovery path. Communicate the outage and restore CDN service. Lightbox shows its error state; grid call sites may show broken images rather than the neutral placeholder because terminal-error placeholders are not yet wired into every production card.

7. **Rollback verification record.**
   - Capture the restored deployment URL, commit SHA, map asset hash, home/detail screenshots, and network/console summary.
   - A real drill remains **NOT TESTED** in this phase.

## Remaining blockers

**Browser-delivery blockers: none.**

**Operational / non-browser blockers and warnings**

1. Full `npm run build` including prebuild is **NOT TESTED** locally; prebuild requires external Notion/Firestore reads and tracked-file writes.
2. A real deployment rollback drill is **NOT TESTED** (not authorized).
3. SEO/Open Graph/sitemap images for mapped posters still use Blob URLs that return 403; SEO delivery remains disabled and requires a separate activation phase.
4. 800px assets are upscaled 1.28× on 375px DPR-3 detail; zoom uses originals. Larger variants are a future enhancement.
5. Actual-route CLS remains a pre-existing font/footer issue (home ≈0.357 desktop, ≈0.158 mobile in the final dev run; unavailable/category routes 0). It is not caused by R2 images.
6. Pre-existing TypeScript error at `src/routes/__root.tsx:148`.
7. Pre-existing lint issues (`notion.ts` explicit `any`, hook dependency warnings).
8. Pre-existing TanStack Start CSRF middleware warning.
9. Collection/auth routes were not browser-tested; `/genres` represents the category views.
10. The two unresolved identities remain unavailable until human identity confirmation and an authorized R2 upload.

## Explicit final cutover recommendation

**Browser image delivery: READY.**

- All 63 catalogue identities have an intentional outcome: 61 R2 optimized + 2 accessible local unavailable states.
- Home has **zero broken images and zero Blob requests**.
- Mapped detail/lightbox/zoom, unavailable detail, category, desktop/mobile, and back navigation all pass in actual Chromium.
- The safe bundle builds with flags false and the 61-entry map plus unavailable SVG packaged.
- No R2 mutations, external writes, deployments, commits, or flag changes occurred.

**SEO/metadata delivery: NOT READY.** Mapped OG/Twitter/JSON-LD/sitemap images still reference Blob URLs that return 403. This is intentionally separate and must be handled in an SEO activation phase.

**Overall production cutover: CONDITIONALLY READY.** Before production deployment, complete two operational gates:

1. Run the full `npm run build` in a deployment-like environment with authorized external reads and confirm tracked artifacts are generated intentionally.
2. Execute and record a real Vercel rollback drill.

Do not enable SEO or download delivery in the browser-delivery cutover. Do not use Blob as a recovery path.

## Files changed in Phase 14

**Added**

- `src/lib/poster-availability.ts` — explicit unavailable identity set and reason.
- `public/poster-unavailable.svg` — local neutral unavailable asset.
- `migration/PHASE-14-MIGRATION-CLOSURE-REPORT.md` — this report.

**Modified**

- `src/lib/poster-images.ts` — unavailable identity handling for browser, SEO, download, and fallback URLs.
- `src/components/PosterImage.tsx` — local unavailable asset and accessible alt handling for identities with no verified source.
- `scripts/browser-r2-routes.mjs` — 63-identity coverage, unavailable home/detail checks, zero Blob/broken assertions.
- `tests/runtime-preview.test.tsx` — unavailable identity and malformed-entry placeholder coverage.

## Preservation confirmation

- Branch remains `feat/r2-image-storage`.
- HEAD remains `ec5401ca82bb7d71f4679c60f2994cbc607177fe`.
- Historical Phase 10A–10E, 11, 12A, 12B, 12C, and 13 reports/state files remain unchanged.
- Runtime map remains 61 entries / 122 unique keys; 58 versioned originals + 58 versioned optimized + 6 canary references.
- All three canaries remain present and unchanged.
- Both uncertain identities remain absent from the map/allowlist and are handled by the explicit unavailable set.
- Production browser, SEO, and download flags remain **false**.
- No R2 uploads, deletes, copies, or mutations.
- No DNS, Cloudflare, Vercel, Firebase, Firestore, Notion, Raindrop, or Blob configuration changes.
- No commits, pushes, merges, rebases, deployments, or branch switching.
- No secrets, credentials, tokens, or environment-file contents were inspected or printed.

**Phase 14 is complete. Browser delivery is ready; SEO remains separate; overall production cutover is conditionally ready pending prebuild and rollback gates.**
