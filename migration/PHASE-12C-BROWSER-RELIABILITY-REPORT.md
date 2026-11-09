# Phase 12C — Browser Reliability & Failure-State Hardening Report

Date: 2026-11-09  
Worktree: `/tmp/opencode/wt-r2-image-storage`  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`  
Public image domain: `https://images.cineprint.click`  
Bucket: `cineprint-posters` (read-only browser GETs only)

## 1. Executive summary

**Status: PASS for browser reliability; WARNING for production readiness.**

- Real headless Chromium rendered, loaded, and decoded **all 61 runtime identities** at four viewports.
- **61/61 images decoded** at 375, 430, 768, and 1440 CSS pixels, with natural dimensions of 800×1111 and zero broken images.
- **0 Blob requests**, **0 duplicate image requests**, **0 failed image requests**, **0 console errors**, and **0 unhandled rejections** in the 61-entry preview.
- Eight failure fixtures (missing mapping, invalid URL, 404, 403, 500, timeout, invalid bytes, decode failure) all reached the neutral placeholder; **8/8** showed accessible fallback text and **0** fell back to Blob.
- Unmounting the component while an image was pending produced **no errors or rejections**.
- A local rollback simulation passed: canary-only map → full 61-entry map → malformed map → canary-only map remained deterministic.
- Production browser, download, and SEO flags remain **false**. No R2 mutations or external writes occurred.

The main remaining gap is production readiness, not browser rendering: rollback is deployment-level, the grid-only 800px asset is insufficient for large full-screen/high-DPI detail views, and the pre-existing public Firebase isolation failure remains.

## 2. Browser tooling availability and setup

**Status: PASS**

Environment findings:

- `/usr/bin/chromium` — Chromium **155.0.8059.84** (used).
- `/usr/bin/google-chrome-stable` — Google Chrome **157.0.8103.38** (available, not used).
- No Playwright, Puppeteer, jsdom, happy-dom, or Testing Library installed.
- `esbuild` **0.28.1** and `vite` **8.1.0** already installed; no new dependency was added.
- Headless Chromium launched successfully and reached the public R2 CDN.

Because no browser driver was installed, Phase 12C added a dependency-free Chromium DevTools Protocol harness:

- `scripts/browser-r2-preview.mjs` — launches headless Chromium, serves local fixtures, drives the page over CDP using Node’s built-in `WebSocket`, captures screenshots, network, console, LCP, and CLS, and asserts results.
- `scripts/preview-r2-client.tsx` — bundles the real React app for the browser with esbuild.
- No global configuration, system package, or external service was modified.

Reproduce with:

```bash
npm run preview:r2:browser
```

The harness generates artifacts and exits non-zero if any check fails.

## 3. Actual browser rendering results

**Status: PASS**

Real browser results, not DOM mocks:

| Viewport | Frames | Loaded | Decoded | Errors | Pending |
|---|---:|---:|---:|---:|---:|
| 375×812, DPR 3 | 61 | 61 | 61 | 0 | 0 |
| 430×900, DPR 3 | 61 | 61 | 61 | 0 | 0 |
| 768×1024, DPR 2 | 61 | 61 | 61 | 0 | 0 |
| 1440×900, DPR 1 | 61 | 61 | 61 | 0 | 0 |

Each viewport run:

- Rendered 61 `[data-preview-id]` frames.
- Loaded and decoded every image.
- Reported non-zero `naturalWidth`/`naturalHeight`.
- Used only `https://images.cineprint.click/...` sources.
- Produced no duplicate image URLs, no Blob requests, and no failed image requests.
- Produced no console errors, page errors, exceptions, or unhandled rejections.

Harness summary: **47 checks, 47 passed, 0 failed**.

## 4. Screenshot artifact paths

**Status: PASS**

- Desktop, 1440×900, dark: `/tmp/opencode/phase12c/screenshots/desktop-1440.png`
- Mobile, 375×812, DPR 3: `/tmp/opencode/phase12c/screenshots/mobile-375.png`
- Mobile, 430×900, DPR 3: `/tmp/opencode/phase12c/screenshots/mobile-430.png`
- Tablet, 768×1024, DPR 2: `/tmp/opencode/phase12c/screenshots/tablet-768.png`
- Failure placeholders, dark: `/tmp/opencode/phase12c/screenshots/failures-dark.png`
- Failure placeholders, light: `/tmp/opencode/phase12c/screenshots/failures-light.png`
- Unmount fixture: `/tmp/opencode/phase12c/screenshots/unmount-desktop.png`

Supporting artifacts:

- `/tmp/opencode/phase12c-browser.json`
- `/tmp/opencode/phase12c-preview-inventory.json`
- `/tmp/opencode/phase12c/preview.html`
- `/tmp/opencode/phase12c/failures.html`
- `/tmp/opencode/phase12c/unmount.html`
- `/tmp/opencode/phase12c/preview-client.js`

## 5. Coverage for all 61 runtime identities

**Status: PASS**

| Metric | Result |
|---|---:|
| Runtime entries | 61 |
| Migrated posters | 58 |
| Canaries | 3 |
| Unique identities | 61 |
| Allowlist identities | 61 |
| Map/allowlist coverage | Exact match |
| Unique optimized URLs | 61 |
| Unique original URLs | 61 |
| Excluded identities present | 0 |

The browser preview uses the actual `R2_IMAGE_MAP` and the actual `createPosterImageResolver()` with explicit preview options. Every rendered identity matched its generated map entry; no unrelated or duplicate poster rendered.

## 6. Image load and decode results

**Status: PASS**

- `HTMLImageElement.complete` was true for every image after settling.
- `naturalWidth = 800`, `naturalHeight = 1111` for every optimized image.
- `img.decode()` resolved for **61/61** images at every viewport.
- Zero decode failures.
- Zero broken-image elements.
- Lazy-loaded below-the-fold images all loaded after the harness scrolled the page; no image was left pending.

The preview used `loading="lazy"` to exercise lazy loading. The reusable frame also supports `priority` (`loading="eager"` plus `fetchPriority="high"`) for above-the-fold use, but no production hero page was part of this phase.

## 7. Failure-state implementation

**Status: PASS**

`src/components/PosterImage.tsx` now:

- Tracks `loading`, `loaded`, and `error` status.
- Marks `loaded` only after `img.decode()` resolves, so a success state is not shown before decoding.
- Advances at most once per failed source; each candidate is attempted once.
- Applies a bounded load timeout (default 15s; configurable; `0` disables).
- Guards async decode and timeout work with a mounted ref.
- Clears the timeout on load, error, source change, and unmount.
- Emits `onTerminalError` once after the final candidate fails.
- Renders nothing when a mapped entry has no usable candidate, so an empty `<img src>` is never emitted.

`src/lib/poster-images.ts` now:

- Rejects malformed, non-HTTPS, or wrong-host R2 URLs.
- Distinguishes “no mapping” (legacy behavior) from “mapping exists but is malformed” (fail closed).
- Returns no display candidates for a malformed mapped entry; the component shows the neutral placeholder.
- Never offers a Blob URL as a fallback for a mapped poster. Mapped candidates are exactly `[optimized, original]`, both on R2.

`src/components/PosterImageFrame.tsx` now provides:

- Fixed `2 / 3` aspect-ratio reservation.
- Skeleton while loading, hidden from assistive technology.
- Neutral “Image unavailable” placeholder when every source fails.
- `role="img"` with a descriptive `aria-label`.
- Reduced-motion handling for skeleton animation and image fade.
- Light and dark neutral palettes.

Browser failure results:

| Fixture | Result |
|---|---|
| Missing mapping | Placeholder, accessible label |
| Invalid URL | Placeholder, accessible label |
| HTTP 404 | Placeholder, accessible label |
| HTTP 403 | Placeholder, accessible label |
| HTTP 500 | Placeholder, accessible label |
| Network timeout (1.2s fixture) | Placeholder, accessible label |
| Invalid image bytes | Placeholder, accessible label |
| Decode failure | Placeholder, accessible label |

**8/8** fixtures reached `error` status and rendered the fallback. Each failure URL was requested at most once; the timeout request was not retried. No Blob request occurred.

## 8. Placeholder design and accessibility

**Status: PASS**

- Placeholder uses a neutral surface, an `ImageOff` icon, and “Image unavailable” text.
- The icon is `aria-hidden`; the container exposes `role="img"` and an `aria-label` such as `Image unavailable: HTTP 404`.
- Layout space is preserved by the frame’s aspect ratio; the placeholder fills the same box.
- Light and dark screenshots confirm the placeholder remains legible in both contexts.
- Skeleton animation is disabled under `prefers-reduced-motion`.
- Image opacity transition is disabled under reduced motion.
- Primary card call sites already use descriptive alt text; decorative wall tiles use empty alt.
- Keyboard accessibility of production page controls was **NOT TESTED** because the preview is a static grid, not a production route.

## 9. Network request and console findings

**Status: PASS**

Per 61-entry viewport:

| Metric | Result |
|---|---:|
| Image requests | 61 |
| Unique image URLs | 61 |
| Duplicate image URLs | 0 |
| R2 requests | 61 |
| Blob requests | 0 |
| Other external hosts | 0 |
| Failed image requests | 0 |
| Console errors | 0 |
| Console warnings | 0 |
| Exceptions | 0 |
| Page errors | 0 |
| Unhandled rejections | 0 |

Failure page:

- Only local `127.0.0.1` fixture requests and the intentionally invalid `data:` URL were made.
- 404, 403, and 500 returned the expected status codes.
- The timeout endpoint stalled once and was not retried.
- Invalid bytes and decode fixtures returned HTTP 200 but failed image decoding as intended.
- Zero Blob requests.

The browser made read-only GETs to R2; no bucket listing, object mutation, or external write occurred.

## 10. Responsive measurements

**Status: PASS for grid layouts; WARNING for large full-screen/high-DPI use**

Measured CSS widths and required pixels (`CSS width × DPR`):

| Viewport | DPR | CSS width | Required px | Natural | 800px sufficient? |
|---|---:|---:|---:|---:|---|
| 375 | 3 | 155.5 | 467 | 800×1111 | Yes |
| 430 | 3 | 183.0 | 549 | 800×1111 | Yes |
| 768 | 2 | 131.2 | 263 | 800×1111 | Yes |
| 1440 | 1 | 124.8 | 125 | 800×1111 | Yes |

Findings:

- The 800px optimized WebP is sufficient for the tested grid sizes, including 3× mobile DPR.
- A full-screen detail or lightbox view can exceed 800 CSS pixels on desktop; at 2× DPR that needs roughly 1600–1800px. The current single 800px asset would be upscaled there.
- No speculative `srcset` was added because no larger variants exist.
- Recommended future migration: generate 1200/1600/2000px WebP variants, add a real `srcset`/`sizes` policy, and keep the 800px asset as the small-viewport candidate.

## 11. Performance observations

**Status: WARNING — preview-only measurements**

| Viewport | LCP | CLS | Image resources | Duplicate requests |
|---|---:|---:|---:|---:|
| 375 (cold first run) | 3548 ms | 0 | 61 | 0 |
| 430 (cached) | 856 ms | 0 | 61 | 0 |
| 768 (cached) | 700 ms | 0 | 61 | 0 |
| 1440 (cached) | 1412 ms | 0 | 61 | 0 |

Notes:

- LCP is the preview page’s largest image/text paint, not a production page claim. The 375 run was cold; later runs benefited from browser cache.
- CLS was **0** at every viewport, consistent with aspect-ratio reservation.
- Total transfer size and encoded body size reported **0** because R2 responses do not expose `Timing-Allow-Origin`; browser Resource Timing hides cross-origin sizes. Byte sizes remain covered by the Phase 12B/12C HTTP checks, not by this browser measurement.
- No duplicate image requests occurred.
- Re-render count was not instrumented; **NOT TESTED**.
- Above-the-fold priority on real production routes was **NOT TESTED**; the frame supports `priority`, but the preview used lazy loading for all cards.

## 12. Rollback architecture and simulation results

**Status: WARNING — local simulation PASS; deployment rollback NOT TESTED**

Current architecture:

- The runtime map is **bundled**: `src/lib/poster-images.ts` statically imports `R2_IMAGE_MAP` from `src/lib/r2-image-map.generated.ts`.
- There is no remote configuration service, runtime version pointer, or dynamic map fetch.
- Changing the active map requires regenerating the file and **redeploying**.
- The simplest safe rollback is a deployment rollback to a previous commit containing a known-good map.
- Disabling `R2_BROWSER_IMAGES_ENABLED` and redeploying returns to Blob URLs, which are not a reliable fallback (403). A rollback that depends on Blob is therefore **not** recommended.
- If the CDN fails after activation, the optimized and original R2 URLs fail together; the component then shows the neutral placeholder. It does not request Blob or an unrelated poster.

Local rollback simulation (`tests/rollback-simulation.test.ts`, 5 tests, all passing):

1. Load a canary-only map — canaries resolve to R2; migrated posters do not receive R2 URLs.
2. Switch to the full 61-entry map — all 61 resolve to `[optimized, original]` with no Blob candidate.
3. Load a malformed map — the affected mapped poster returns no candidates and fails closed.
4. Restore the canary map — results are identical to the first canary run.
5. Repeat map switching — resolution remains deterministic.

This validates the resolver/map behavior, not a deployed rollback. A real deployment rollback drill remains **NOT TESTED**.

## 13. Tests, lint, type-check, and build results

**Status: PASS with known pre-existing issues**

| Check | Result |
|---|---|
| Browser harness | **47/47 checks passed** |
| `tests/runtime-preview.test.tsx` | **13 passed** |
| `tests/rollback-simulation.test.ts` | **5 passed** |
| Focused resolver/map/canary suite | **70 passed** |
| Full suite | **986 passed, 4 skipped, 1 failed** |
| `npm run r2:map:check` | **pass** |
| Scoped ESLint | **0 errors, 2 pre-existing hook warnings** |
| `tsc --noEmit` | **1 pre-existing error**, `src/routes/__root.tsx:148` |
| `git diff --check` | **pass** |
| Production build | **NOT TESTED** (not run to avoid prebuild writes) |

Known pre-existing failure remains: `tests/security/public-firebase-isolation.test.ts:44`.

The two `react-hooks/exhaustive-deps` warnings in `PosterImage.tsx` are pre-existing from Phase 12B and remain unchanged.

## 14. Remaining blockers

**Status: WARNING**

- Rollback requires a deployment; no deploy-independent map switch exists.
- No full-screen/high-DPI image variants; 800px assets are grid-appropriate only.
- No production-route browser smoke test (home, detail, lightbox, collections).
- Above-the-fold priority and keyboard interaction were not exercised on production routes.
- Cross-origin transfer sizes are unavailable in browser Resource Timing.
- Blob remains unusable as a fallback (403).
- Pre-existing public Firebase isolation failure remains.
- No CI job runs the Chromium harness yet.

## 15. Recommended next phase

1. Add a production-route browser smoke test for gallery, detail, and lightbox at mobile and desktop sizes.
2. Generate larger WebP variants and implement `srcset`/`sizes` for full-screen/high-DPI detail views.
3. Drill a real deployment rollback to a previous known-good map and record recovery time.
4. Add the Chromium harness to CI with a pinned local Chromium.
5. Resolve the public Firebase isolation failure before production activation.
6. Consider integrating `PosterImageFrame` into production card/lightbox call sites where the shared placeholder is not already handled.

## Files changed

**Added**

- `src/components/PosterImageFrame.tsx` — aspect-stable frame, skeleton, neutral fallback.
- `scripts/preview-r2-app.tsx` — real-component preview, failure, and unmount fixtures.
- `scripts/preview-r2-client.tsx` — browser entry bundled with esbuild.
- `scripts/browser-r2-preview.mjs` — dependency-free Chromium CDP harness.
- `tests/rollback-simulation.test.ts` — 5 local rollback tests.
- `migration/PHASE-12C-BROWSER-RELIABILITY-REPORT.md` — this report.

**Modified**

- `src/components/PosterImage.tsx` — decode-aware status, bounded timeout, unmount guards, fail-closed empty candidates.
- `src/lib/poster-images.ts` — malformed-mapping rejection and no Blob fallback for mapped posters.
- `scripts/preview-r2-runtime.tsx` — browser preview pages and 61-entry inventory.
- `automation/r2-image-map.test.ts` — candidate contract updated to `[optimized, original]` with no Blob.
- `tests/runtime-preview.test.tsx` — fail-closed mapping and empty-render coverage.
- `package.json` — added `preview:r2:browser`.

**Unchanged**

- `migration/r2-image-map.json` — 61 entries, 122 unique object keys.
- `migration/r2-resolver-allowlist.json` — 61 identities.
- `src/lib/r2-image-map.generated.ts` — flags false.
- Phase 10A–10E reports and state files.
- Phase 11, Phase 12A, and Phase 12B reports.
- Canary objects and evidence.

## Preservation confirmation

- Branch remains `feat/r2-image-storage`.
- HEAD remains `ec5401ca82bb7d71f4679c60f2994cbc607177fe`.
- Phase 10A/10E report and state hashes, `migration/migration-state.json`, and the Phase 11/12A/12B report hashes match the pre-Phase-12C values exactly.
- Migration map remains 61 entries with 122 unique keys, 58 versioned originals, 58 versioned optimized objects, and no excluded identities.
- Existing unrelated worktree changes remain intact.
- No R2 uploads, overwrites, deletions, or copies.
- No Cloudflare, DNS, Vercel, Firebase, Firestore, Notion, Raindrop, or Blob configuration changes.
- No commits, pushes, merges, rebases, or deployments.
- No secrets, credentials, tokens, or environment-file contents were inspected or printed.
- Production browser, download, and SEO flags remain **false**.

**Phase 12C is complete. Production activation and deployment remain unauthorized.**
