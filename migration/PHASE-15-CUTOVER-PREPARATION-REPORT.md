# Phase 15 — Controlled Browser Delivery Cutover Preparation Report

Date: 2026-11-09  
Worktree: `/tmp/opencode/wt-r2-image-storage`  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`  
Production domain inspected read-only: `https://cineprint.click`  
R2 CDN: `https://images.cineprint.click`  
Bucket: `cineprint-posters` (read-only only)

## 1. Executive summary

**Operational decision: CONDITIONALLY READY for a controlled browser-only cutover.**

Prepared and verified:

- Local browser delivery is stable: **42/42 route checks**, **47/47 failure/preview checks**, **993 tests passed, 0 failed**.
- Vercel-target build passes locally with `NITRO_PRESET=vercel`: `.vercel/output` preset `vercel`, 61-entry map, unavailable SVG packaged, browser/SEO/download flags false.
- Offline prebuild simulation from the 63-record Firestore snapshot passes: 63 poster entries, 61 mapped Blob SEO images, 2 explicit unavailable SVG images.
- Rollback runbook and cutover runbook are written and provider-oriented; no deployment, promotion, activation, or rollback was performed.
- Production baseline is currently broken: all 161 home images are Blob, with 121 broken on desktop and 99 on mobile. R2 is healthy (200, immutable); Blob is 403.

Remaining gates before unconditional cutover:

1. Run the **real full `npm run build`** (including prebuild) in an authorized deployment environment. Local execution remains **NOT TESTED** because prebuild performs external Notion/Firestore reads and writes tracked sitemap/palette files.
2. Complete a **real deployment rollback drill**. The procedure is documented; actual rollback remains **NOT TESTED**.
3. Perform the reviewed **activation commit** that changes `DEFAULT_R2_BROWSER_IMAGES_ENABLED` to `true` and regenerates the map. Production activation is not an environment-only toggle in the current code.
4. Keep SEO and download delivery disabled; they remain separate and not ready.

## 2. Repository baseline and preservation evidence

| Item | Value |
|---|---|
| Branch | `feat/r2-image-storage` |
| HEAD | `ec5401ca82bb7d71f4679c60f2994cbc607177fe` |
| Worktree status | 51 existing modified/untracked entries |
| Runtime map | 61 entries |
| Allowlist | 61 identities |
| Unique R2 object references | 122 |
| Canaries | 3 present |
| Intentionally unavailable | `stranger-things-2`, `the-substance-2` |
| Browser flag | `false` |
| SEO flag | `false` |
| Download flag | `false` |

Historical Phase 10A–10E, 11, 12A, 12B, 12C, 13, and 14 reports/state files were preserved byte-for-byte. Tracked prebuild artifacts (`src/lib/poster-palettes.json`, `public/sitemap*.xml`, `public/robots.txt`) remained byte-identical across all build experiments.

## 3. Full build/prebuild safety assessment

### Lifecycle pipeline

`npm run build` runs:

1. `prebuild`: `node scripts/extract-palettes.js && tsx scripts/generate-sitemap.ts`
2. `build`: `vite build`

Prebuild side effects:

- `extract-palettes.js` reads Notion, downloads/reads poster images, and writes tracked `src/lib/poster-palettes.json` (or an empty placeholder on failure).
- `generate-sitemap.ts` reads Firestore and rewrites tracked:
  - `public/sitemap.xml`
  - `public/sitemap-static.xml`
  - `public/sitemap-posters.xml`
  - `public/sitemap-artists.xml`
  - `public/sitemap-films.xml`
  - `public/sitemap-genres.xml`
  - `public/sitemap-styles.xml`
  - `public/robots.txt`
- Both require external service access, which Phase 15 is not authorized to perform.

### Safe isolated validation

**Fixture-backed prebuild simulation: PASS.**

Using the existing local Firestore snapshot (`migration/firestore-identities.json`, 63 documents) and the pure sitemap builders:

- 63 poster entries generated.
- 61 mapped posters → existing Blob SEO image URLs (SEO delivery disabled).
- 2 unavailable posters → `https://cineprint.click/poster-unavailable.svg`.
- Sitemap limits and XML generation passed.
- Output written only to `/tmp/opencode/phase15-prebuild-sim/sitemap-posters.xml`.
- Existing tracked sitemap was **not** modified.

Comparison: existing `public/sitemap-posters.xml` still has 63 Blob image locations; the simulated regeneration would replace the two unavailable entries with the local SVG. The 61 mapped entries remain Blob while SEO is disabled.

### Build results

| Build | Result |
|---|---|
| Local default `npx vite build` | **PASS** — but preset is `cloudflare-module`, not the production target |
| Vercel-target `NITRO_PRESET=vercel npx vite build` | **PASS** — `.vercel/output` preset `vercel`, Node 24 function runtime |
| `npm run build --ignore-scripts` | **PASS** — exact npm build command without lifecycle prebuild |
| Full `npm run build` including prebuild | **NOT TESTED** — external Notion/Firestore reads + tracked writes |
| Vercel output map | **61 entries** |
| Vercel output unavailable SVG | **present** (`.vercel/output/static/poster-unavailable.svg`) |
| Vercel output R2 domain | **present** |
| Vercel output flags | Browser/download env-gated; SEO literal `false`; no preview env values inlined |
| Tracked prebuild hashes | **unchanged** |

Important: local `vite build` defaults to Cloudflare because Nitro auto-detects the platform; production Vercel builds use the Vercel preset. The Vercel-target build was validated locally without deploying.

## 4. Deployment architecture findings

| Item | Finding |
|---|---|
| Provider | Vercel |
| Project | `cine-print-gallery` (`prj_5TMWuqFxnwxnDlrJuE7EaOtrmXn3`) |
| Team | `Tq89ypSaRXjOzF1FhkK8Eaew` |
| Local deployment config | `.vercel/repo.json`; no `vercel.json` |
| Build target | Nitro; production auto-detects Vercel. Local validation requires `NITRO_PRESET=vercel` |
| Vercel output | `.vercel/output` with `config.json`, static assets, and `functions/__server.func` |
| Function runtime | Node.js 24.x (from generated Vercel output) |
| Static asset caching | `/assets/(.*)` → `public, max-age=31536000, immutable` |
| HTML/server routes | Dynamic, handled by `__server` |
| Preview vs production | Provider environments; app activation uses `VITE_VERCEL_ENV` and `VITE_R2_*` |
| Aliases | Provider-managed; not configured in the repository |
| Rollback | Provider-supported previous-deployment promotion/rollback; restores the complete deployment bundle |

Not locally verifiable: Vercel dashboard state, exact alias history, deployment IDs, and provider rollback UI. No deployment, promotion, alias, or rollback command was invoked. The generated Nitro output advertises `npx vercel deploy --prebuilt`; actual production promotion remains provider-managed.

### Map/version consistency

- Client assets are content-hashed and immutable.
- A deployment's HTML/server output references its own hashed `poster-images-*.js` asset.
- Old deployments retain their hashed assets, so cached HTML pointing at an older asset still gets a complete, self-consistent map.
- There is no runtime map pointer; changing the map requires a new deployment.
- CDN caching can briefly serve older HTML, but cannot mix two map versions inside one hashed asset.

## 5. Rollback runbook

Full operational detail: `migration/BROWSER-DELIVERY-CUTOVER-RUNBOOK.md`.

Summary:

1. Record current production deployment ID, commit SHA, and domain.
2. Identify the last known-good deployment and its runtime-map version.
3. Restore it through Vercel’s provider-supported rollback/promote-previous-deployment flow.
4. Verify home, detail, lightbox/zoom, category, and both unavailable routes.
5. Verify R2 200 responses, zero Blob image requests, zero broken images, and clean console/network.
6. Confirm browser flag state; SEO and downloads must remain false.
7. If the activation commit itself is bad, revert the `DEFAULT_R2_BROWSER_IMAGES_ENABLED` change, regenerate the map, and redeploy.
8. Do not use Blob as a recovery path.

Classification:

- Local rollback simulation: **PASS** (canary → full → malformed → canary; 5 tests).
- Deployment rollback procedure: **DOCUMENTED / INSPECTED**.
- Actual deployment rollback: **NOT TESTED**.
- Real rollback drill: **NOT AUTHORIZED / NOT TESTED**.

## 6. Production baseline evidence

Read-only production inspection, no writes or deployments.

| Route | HTTP | Browser images | Image host | Broken images |
|---|---:|---:|---|---:|
| Home desktop 1440 | 200 | 161 | 100% Blob | **121** |
| Home mobile 375 | 200 | 161 | 100% Blob | **99** |
| Detail desktop (`backrooms-3`) | 200 | 7 | 100% Blob | **7** |
| Detail mobile | 200 | 10 | 100% Blob | **8** |
| Category `/genres` desktop | 200 | 10 | 100% Blob | **10** |
| Category `/genres` mobile | 200 | 10 | 100% Blob | **10** |

Additional baseline:

- SSR home HTML contains 122 `<img>` tags, all Blob.
- `/`, `/genres`, `/poster/backrooms-3`, and `/poster/the-substance-2` all return HTTP 200.
- Browser console errors: 0; uncaught exceptions: 0. Broken images are network 403 responses, not JS exceptions.
- CDN sample:
  - R2 migrated optimized/original and canary optimized: **200**, correct content types, `Cache-Control: public, max-age=31536000, immutable`.
  - Excluded Blob object: **403**.

This is a factual baseline, not an invented historical benchmark. It confirms the current production browser image path is already broken for all catalogue images.

## 7. Monitoring and rollback thresholds

Monitor for at least **60 minutes** post-cutover, checking every 5 minutes; continue lightweight checks for 24 hours.

| Signal | Threshold / action |
|---|---|
| Home/detail/category HTTP | Two consecutive 5xx/timeouts → rollback |
| R2 image 4xx/5xx | >5% over 5 minutes → rollback |
| Broken image elements | >0 on two consecutive home checks → rollback |
| Decode failures | >1% of checked images → rollback |
| Unexpected Blob image requests | Any on home/detail → rollback |
| Unapproved image hosts | Any → rollback |
| Console errors / uncaught exceptions | New rendering-affecting error → investigate; widespread → rollback |
| Unavailable identities | Must remain intentional placeholders, not broken/Blob |
| SEO/download flags | Must remain false; any activation → rollback |

Monitoring checklist:

- R2 CDN 403/404/5xx responses.
- Failed image requests and browser decode failures.
- Broken `<img>` elements and layout gaps.
- Unexpected Blob requests or unapproved hosts.
- Home/detail/lightbox/category rendering.
- Console errors and uncaught exceptions.
- Both unavailable poster routes.

## 8. Browser-only cutover sequence

Full sequence: `migration/BROWSER-DELIVERY-CUTOVER-RUNBOOK.md`.

### Pre-deployment

- Source: `feat/r2-image-storage`, reviewed commit containing browser-delivery changes.
- Required tests: full suite (current: 993 passed, 0 failed), route harness 42/42, Phase 12C 47/47, `r2:map:check` pass, no new TypeScript/ESLint errors.
- Required build: real `npm run build` in authorized environment; locally validated with `NITRO_PRESET=vercel`.
- Keep the last known-good deployment ID.
- Flags before activation: browser false; SEO false; downloads false.
- Activation commit: set `DEFAULT_R2_BROWSER_IMAGES_ENABLED = true` in `scripts/generate-r2-image-map.ts`, run `npm run r2:map:generate`, verify generated flag true, keep SEO/download false.

### Deployment

- Build and verify `.vercel/output` preset `vercel`, map 61, unavailable SVG, flags.
- Deploy a preview if separately authorized; run the same smoke checks.
- Promote to production through Vercel’s provider flow.
- Confirm the previous deployment remains available for rollback.
- Do not change SEO, download, DNS, Cloudflare, R2, Firebase, Firestore, Notion, Raindrop, or Blob.

### Post-deployment

- Home: 63 links, 61 R2 + 2 unavailable, 0 broken, 0 Blob, 0 console errors.
- Detail/lightbox/zoom: R2 optimized + R2 original.
- Both unavailable detail routes: local SVG placeholder, 0 Blob, 0 broken.
- Category: R2 images, 0 broken.
- CDN/network/console checks.
- Monitor 60 minutes / 24 hours against the thresholds above.

No canary mechanism was verified. Use a Vercel preview deployment only if provider support and authorization are confirmed; otherwise perform a single controlled production promotion with immediate monitoring and a recorded rollback target.

## 9. Feature-flag isolation

| Flag | Current | Production activation mechanism |
|---|---|---|
| `R2_BROWSER_IMAGES_ENABLED` | **false** | Requires reviewed code change to `DEFAULT_R2_BROWSER_IMAGES_ENABLED=true` + map regeneration; env override only works for `VITE_VERCEL_ENV=preview/development` |
| `R2_SEO_IMAGES_ENABLED` | **false** | Requires separate code change + regeneration; no env override |
| `R2_DOWNLOADS_ENABLED` | **false** | Env override only for preview/development; production requires separate reviewed change |

Important: setting `VITE_R2_BROWSER_IMAGES=true` alone in production does **not** activate browser delivery because production `VITE_VERCEL_ENV` is not `preview` or `development`. Do not use `VITE_VERCEL_ENV=preview` in production as a shortcut.

The Vercel-target build contains no inlined `VITE_R2_*` or preview environment values; SEO compiles literal `false`.

## 10. SEO/download separation

**Browser success does not imply SEO or download readiness.**

- SEO/OG/Twitter/JSON-LD for mapped posters still resolve to Blob URLs, which return 403.
- Existing sitemap has 63 Blob image locations; the offline prebuild simulation would replace only the two unavailable entries with the local SVG, leaving 61 mapped Blob entries while SEO is disabled.
- `R2_SEO_IMAGES_ENABLED` remains false; no R2 optimized URLs are used in metadata.
- Download delivery remains false. Unavailable posters return no download URL; mapped downloads would still use Blob while disabled.
- No SEO assets, metadata, sitemap, or download behavior was changed or activated.

## 11. Test and build results

| Check | Result |
|---|---|
| Full suite | **993 passed, 0 failed** (83 files) |
| Local route harness | **42/42 passed** |
| Phase 12C harness | **47/47 passed** |
| `npm run r2:map:check` | **pass** |
| Scoped ESLint — R2 files | **0 errors, 2 pre-existing hook warnings** |
| `tsc --noEmit` | **1 pre-existing error**, `src/routes/__root.tsx:148` |
| `git diff --check` | **pass** |
| Local default `vite build` | **pass** (Cloudflare preset, not production target) |
| Vercel-target `NITRO_PRESET=vercel vite build` | **pass** (`.vercel/output`, preset `vercel`) |
| `npm run build --ignore-scripts` | **pass** |
| Full `npm run build` with prebuild | **NOT TESTED** |
| Offline prebuild simulation | **pass** (63 entries; 61 Blob + 2 unavailable SVG) |

Reassessed historical issues:

- TypeScript `src/routes/__root.tsx:148` — **still present**, pre-existing.
- R2 hook dependency warnings — **still present**, pre-existing.
- TanStack Start CSRF middleware warning — **still present**, pre-existing; not R2-related.
- Actual-route CLS — **still present** from font/footer reflow (Phase 14: home ≈0.357 desktop, ≈0.158 mobile); not R2-image-caused.
- Collection/auth route coverage — **still not browser-tested**.

## 12. Remaining risks

1. **Full prebuild remains unvalidated locally.** External Notion/Firestore reads and tracked writes are prohibited here. The real deployment must run it.
2. **Actual rollback is not drilled.** Procedure is documented; provider behavior and timing are unverified.
3. **Production activation requires a code change**, not an env toggle. The activation commit must be reviewed, regenerate the map, and keep SEO/download false.
4. **SEO/OG/sitemap Blob 403 remains.** Browser cutover will not fix social/search images.
5. **800px detail assets are upscaled 1.28× on 375px DPR-3.** Zoom uses originals; future variants are a quality enhancement.
6. **Current production baseline is already broken** (121/99 broken home images). Cutover is expected to improve it, but there is no canary mechanism or automated production monitoring configured.
7. **Pre-existing TypeScript, lint, CSRF, and CLS issues** remain; none are introduced by R2.
8. **Collection/auth routes** remain outside browser coverage.
9. **Provider alias/promotion/rollback specifics** are not locally verifiable.

## 13. Explicit operational readiness decision

**CONDITIONALLY READY for a controlled browser-only cutover.**

The browser delivery implementation and local evidence are ready:

- 63/63 catalogue identities have intentional outcomes.
- 61 mapped posters render/decode from R2; 2 unresolved posters show an accessible local unavailable state.
- Zero broken images and zero Blob image requests in local real-route tests.
- Vercel-target build includes the correct map and unavailable SVG with flags false.
- Test and browser harness results are clean.

Do not promote to production until these gates are complete:

1. Run the real full `npm run build` including prebuild in the authorized deployment environment.
2. Execute and record a real Vercel rollback drill.
3. Create the reviewed activation commit (`DEFAULT_R2_BROWSER_IMAGES_ENABLED=true`) and regenerate the map, keeping SEO/download false.
4. Confirm the last known-good deployment and monitoring owner.

SEO and download delivery remain **NOT READY** and must stay disabled. This phase performed **no production deployment, promotion, activation, rollback, R2 mutation, external write, commit, or push**.

## Evidence artifacts

- Production baseline: `/tmp/opencode/phase15-production-baseline.json`
- Production screenshots: `/tmp/opencode/phase15-baseline/`
  - `baseline-home-desktop.png`, `baseline-home-mobile.png`
  - `baseline-detail-desktop.png`, `baseline-detail-mobile.png`
  - `baseline-category-desktop.png`, `baseline-category-mobile.png`
- CDN sample: `/tmp/opencode/phase15-cdn-sample.json`
- Offline prebuild simulation: `/tmp/opencode/phase15-prebuild-sim/sitemap-posters.xml`
- Vercel-target build log: `/tmp/opencode/phase15-vercel-build.log`
- npm build log: `/tmp/opencode/phase15-npm-build-ignore-scripts.log`
- Local route evidence: `/tmp/opencode/phase13-routes-browser.json`
- Phase 12C evidence: `/tmp/opencode/phase12c-browser.json`
- Cutover runbook: `migration/BROWSER-DELIVERY-CUTOVER-RUNBOOK.md`
