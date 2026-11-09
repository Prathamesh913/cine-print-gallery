# Browser Delivery Cutover Runbook

Status: prepared locally; Phase 16 browser cutover executed and verified.  
Scope: browser image delivery plus the Phase 18 SEO implementation gate.  
Downloads remain out of scope and disabled.

## Phase 18 update (2026-11-09)

- Branch defaults now: **browser true, SEO true, downloads false**.
- Production `dpl_GfG6Z1YsQsx41kFHuqs481JzkcY5` remains **browser true, SEO false**.
- The Phase 18 SEO implementation is local/branch-only and has **not** been deployed.
- Deploying the current branch will activate SEO metadata and sitemap image changes. Do **not** use this runbook for a browser-only deployment from the current branch; a separate SEO activation authorization and deployment are required.

## 0. Non-negotiable guardrails

- Do not enable `R2_SEO_IMAGES_ENABLED`.
- Do not enable `R2_DOWNLOADS_ENABLED`.
- Do not use Vercel Blob as a fallback or rollback path; it returns 403.
- Do not mutate R2 objects during cutover.
- Keep the 2 intentionally unavailable identities (`stranger-things-2`, `the-substance-2`) on the local `/poster-unavailable.svg` state.
- A real deployment rollback drill has **NOT TESTED** status; complete one before or immediately after the first production activation.

## 1. Record the current production deployment

1. Open the Vercel project `cine-print-gallery` (team `Tq89ypSaRXjOzF1FhkK8Eaew`).
2. Record:
   - Production deployment ID / URL.
   - Git commit SHA currently serving production.
   - Production domain (`https://cineprint.click`).
   - Current environment values for `VITE_VERCEL_ENV`, `VITE_R2_BROWSER_IMAGES`, `VITE_R2_DOWNLOADS` **without printing secret values**.
3. Confirm the current production baseline:
   - Home loads but all images are Blob and most are broken (403).
   - This runbook is expected to improve that state for 61 mapped posters.

## 2. Identify the last known-good deployment

Choose the most recent production deployment that:

- Served `https://cineprint.click` successfully.
- Has a recorded commit SHA and build ID.
- Has a known runtime-map state (prefer a deployment with the 61-entry map and the unavailable SVG).
- Passed a basic home/detail smoke test.

Record its deployment ID/URL and commit SHA. This is the rollback target.

Verified caveat (2026-11-09): the immediately previous production deployment (`dpl_6NRuPPnZdbeXFFktUQpuB4B6Zafg`) lacked `/genres` and returned 404 there. It is not a fully route-compatible rollback target for the current application. The verified route-compatible pre-activation target is `dpl_GsLqJduvaWPtPy1zbkHzeUgYEqzC` (`cine-print-gallery-8p3a9dneg…`).

## 3. Pre-deployment gates

Required before any deployment:

| Gate | Requirement |
|---|---|
| Branch | `feat/r2-image-storage` |
| Code state | Reviewed commit containing the browser-delivery changes |
| Full suite | 993 passed, 0 failed (or current equivalent with no new failures) |
| `r2:map:check` | Pass |
| TypeScript | Only the known pre-existing `src/routes/__root.tsx:148` error |
| Scoped ESLint | No new errors |
| Browser route harness | 42/42 checks |
| Phase 12C harness | 47/47 checks |
| Vercel-target build | Pass (`NITRO_PRESET=vercel`), `.vercel/output` generated |
| Map in build | 61 entries |
| Unavailable SVG in build | `.vercel/output/static/poster-unavailable.svg` present |
| Flags in build | Browser activation as intended; SEO/download false |

Full `npm run build` with the real prebuild must be run in the authorized deployment environment. In the Phase 16 authorized run, prebuild completed successfully (56 Notion items, 63 sitemap posters, 0 palette updates); tracked sitemap and route-tree changes were inspected and restored before the deployable build.

## 4. Browser-only activation mechanics

Production activation is **not** an environment-only toggle in the current code:

- Phase 16 production browser activation is already live.
- Current branch defaults: browser `true`, SEO `true`, downloads `false`.
- Production `dpl_GfG6…` is browser `true`, SEO `false`; the Phase 18 SEO change is not deployed.
- The env override applies only when `VITE_VERCEL_ENV` is `preview` or `development`.
- Production `VITE_VERCEL_ENV` is normally `production`, so setting `VITE_R2_BROWSER_IMAGES=true` alone does not activate delivery.
- SEO has no preview env override; deploying the current branch activates the SEO implementation.

The authorized activation change must be a reviewed code change:

1. In `automation/migration/runtime-map.ts`, set:
   `DEFAULT_R2_BROWSER_IMAGES_ENABLED = true`.
   (`scripts/generate-r2-image-map.ts` imports/re-exports this constant; editing the wrapper alone does nothing.)
2. Leave `DEFAULT_R2_SEO_IMAGES_ENABLED = false`.
3. Run `npm run r2:map:generate`.
4. Verify `src/lib/r2-image-map.generated.ts` contains:
   - `R2_BROWSER_IMAGES_ENABLED = true`
   - `R2_SEO_IMAGES_ENABLED = false`
5. Verify downloads remain false.
6. Re-run tests and the Vercel-target build.

Do not use `VITE_VERCEL_ENV=preview` in production as an activation shortcut.

## 5. Build and preview verification

1. Build with the production target:
   ```bash
   NITRO_PRESET=vercel npm run build
   ```
   The prebuild must complete in the authorized environment.
2. Verify `.vercel/output/nitro.json` reports `"preset": "vercel"`.
3. Verify `.vercel/output/static/poster-unavailable.svg` exists.
4. Verify the client `poster-images-*.js` asset contains:
   - 61 map entries
   - `https://images.cineprint.click`
   - `/poster-unavailable.svg`
5. Verify activation code compiles as intended and SEO/download remain false.
6. Deploy a Vercel preview only if separately authorized; verify the preview with the same smoke checks before production promotion.

## 6. Production promotion

Verified Vercel CLI sequence (no Git push required):

```bash
npx vercel@65.12.1 deploy --prebuilt --prod --yes --scope <TEAM>
npx vercel@65.12.1 promote <NEW_DEPLOYMENT_URL> --yes --scope <TEAM>
```

`deploy --prebuilt --prod` created the deployment but did **not** move the `cineprint.click` alias in the verified run; `promote` moved it. Always verify the alias after promotion.

1. Promote the verified deployment through Vercel.
2. Confirm `vercel alias ls` shows `cineprint.click` pointing at the new deployment.
3. Confirm the previous deployment ID remains available for rollback.
4. Do not change SEO, download, Cloudflare, DNS, R2, Firebase, Firestore, Notion, Raindrop, or Blob settings.

## 7. Post-deployment smoke checks

Run within 5 minutes of promotion:

### Home
- HTTP 200.
- 63 poster links.
- 61 R2-mapped posters + 2 intentional unavailable posters.
- 0 Blob image requests.
- 0 broken image elements.
- 0 unexpected console errors.
- R2 image responses 200.

### Detail and lightbox
- Open a mapped poster (e.g. `/poster/backrooms-3`).
- Detail image loads from R2.
- Zoom switches to the R2 original.
- Close/back navigation works.
- No Blob requests.

### Unavailable identities
- `/poster/the-substance-2` and `/poster/stranger-things-2` return HTTP 200.
- Show the local unavailable state with accessible alt text.
- 0 Blob requests, 0 broken images.

### Category
- `/genres` returns HTTP 200.
- Category images load from R2; no Blob.

### Network and console
- No image requests to unapproved hosts.
- No unexpected Blob requests.
- No uncaught exceptions.
- No decode failures above threshold.

## 8. Monitoring period and rollback thresholds

Monitor for at least **60 minutes**, checking every 5 minutes; continue lightweight checks for 24 hours.

Immediate rollback triggers:

- Home/detail/category returns 5xx or times out twice consecutively.
- More than **5%** of R2 image requests fail (4xx/5xx) over a 5-minute window.
- Any unexpected Blob image request on home/detail.
- Any image request to an unapproved host.
- Broken image count > 0 on two consecutive home checks.
- Widespread decode failures (>1% of checked images).
- New uncaught browser exception or console error affecting rendering.

Investigate before rollback if a single image fails transiently; do not roll back for one isolated 404 unless it indicates a map/object regression.

## 9. Rollback procedure

1. Identify the last known-good deployment recorded in step 2.
2. Use Vercel’s provider-supported rollback:
   `npx vercel@65.12.1 rollback <DEPLOYMENT_URL> --yes --scope <TEAM>`
3. Confirm `vercel alias ls` shows `cineprint.click` pointing at the restored deployment.
4. Verify the restored deployment:
   - Home 200 and expected map version.
   - 61 mapped + 2 unavailable (or the prior known-good state).
   - R2 200, 0 Blob, 0 broken.
   - Detail/lightbox/zoom and category.
   - Browser console/network clean.
5. Confirm flags on the restored deployment: browser as expected for that version; SEO false; downloads false.
6. Record the rollback timestamp, deployment IDs, screenshots, and network summary.

If the issue is the activation commit itself, revert the `DEFAULT_R2_BROWSER_IMAGES_ENABLED` change, regenerate the map, and redeploy the reverted commit.

Do **not** roll back to a Blob-based image path.

## 10. Success and failure criteria

Success:

- 61 mapped posters render/decode from R2 on home/detail/category.
- 2 unavailable posters show the intentional accessible state.
- 0 broken images, 0 Blob image requests, 0 unapproved hosts.
- No new console errors or uncaught exceptions.
- Flags: browser active as intended; SEO false; downloads false.
- Monitoring window shows no rollback trigger.

Failure:

- Any immediate rollback trigger above.
- Map/asset mismatch or missing unavailable SVG.
- Unexpected SEO or download activation.
- Inability to restore the previous deployment during a rollback attempt.

## 11. Current evidence status

| Item | Status |
|---|---|
| Local browser route harness | **PASS** — 42/42 |
| Phase 12C failure/preview harness | **PASS** — 47/47 |
| Vercel-target local build | **PASS** — preset `vercel`, 61-entry map, unavailable SVG, flags false |
| Full `npm run build` with real prebuild | **PASS** — Phase 18 full build completed |
| Local rollback simulation | **PASS** — canary → full → malformed → canary |
| Deployment rollback procedure | **VERIFIED** |
| Actual deployment rollback drill | **PASS** — current → previous → current, routes verified |
| Production browser cutover | **PASS** — `dpl_GfG6Z1YsQsx41kFHuqs481JzkcY5` |
| Phase 18 SEO implementation | **PASS locally** — R2 metadata/sitemap; not deployed |
| Production SEO activation | **NOT ACTIVATED** — requires separate authorization/deployment |

## 12. Verified operational findings (2026-11-09)

- Current pre-activation deployment: `dpl_GsLqJduvaWPtPy1zbkHzeUgYEqzC` (`cine-print-gallery-8p3a9dneg…`), created 2026-11-05T15:21:11Z.
- Previous production deployment tested for rollback: `dpl_6NRuPPnZdbeXFFktUQpuB4B6Zafg` (`cine-print-gallery-if9c96ae7…`), created 2026-11-03T16:24:28Z.
- Rollback drill: `cineprint.click` → `dpl_6NRu…` at 13:11:33Z; home/detail/unavailable returned 200, but `/genres` returned **404**; restored `dpl_GsLq…` at 13:12:38Z and verified all routes 200 at 13:12:53Z.
- Activated deployment: `dpl_GfG6Z1YsQsx41kFHuqs481JzkcY5` (`cine-print-gallery-3ewpytu75…`), created 2026-11-09T13:20:27Z; promoted to `cineprint.click`.
- Production activation flags: browser true, SEO false, downloads false.
- Production browser verification: 42/42 checks, two monitoring passes; 63 links, 155 R2 images, 0 Blob, 0 broken, 0 console errors.
