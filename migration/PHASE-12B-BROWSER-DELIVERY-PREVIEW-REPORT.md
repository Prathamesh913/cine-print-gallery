# Phase 12B — Browser Delivery Preview & Runtime Integration Report

Date: 2026-11-09  
Worktree: `/tmp/opencode/wt-r2-image-storage`  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`  
Public image domain: `https://images.cineprint.click`  
Bucket: `cineprint-posters` (read-only HEAD/GET only)

## 1. Executive summary

**Status: WARNING — integration and live HTTP delivery verified; actual browser rendering NOT TESTED.**

- The Phase 12A runtime map contains **61 identities**: 58 migrated posters plus 3 canaries.
- The real resolver resolved all **61** identities to their correct R2 optimized and original URLs.
- The real `PosterImage` component rendered **61 real `<img>` tags** in a server-rendered preview, all with `https://images.cineprint.click/...` sources and zero Blob sources.
- Live CDN checks passed: **122/122 HEAD matches** (status, content type, length, cache control), **61/61 optimized GET byte verifications**, and **5/5 sampled original GET verifications**.
- Browser automation was unavailable (`No desktop browser is connected to this session`), and the test environment has no DOM, so visual rendering, decoding, layout stability, and runtime load/error events are **NOT TESTED**.
- Production browser, download, and SEO flags remain **false**. No external writes or R2 mutations occurred.

## 2. Resolver integration changes

**Status: PASS**

`src/lib/poster-images.ts`:

- Added `isTrustedR2Url()` so a mapping is usable only when both `originalUrl` and `optimizedUrl` are absolute HTTPS URLs on `images.cineprint.click`.
- `r2EntryFor()` now rejects malformed or unsupported mappings instead of returning an empty or unrelated source.
- Existing behavior is unchanged:
  - Exact poster-ID lookup only; no URL/key inference from poster identity.
  - The poster must still point at the exact verified `blobImageUrl`.
  - Browser, SEO, and download activation remain independently gated.
  - Unknown identities fall through to the existing Blob/legacy behavior, never to an unrelated poster.

`src/components/PosterImage.tsx`:

- Added an optional `resolver` prop (type-narrowed to `getPosterImageCandidates`) so local preview/test harnesses can exercise the real component with an explicit preview resolver.
- Production callers pass no resolver, so the default production resolver and flags are untouched.

The preview resolver is constructed explicitly in local-only tooling:

```ts
createPosterImageResolver(R2_IMAGE_MAP, {
  browserEnabled: true,
  seoEnabled: false,
  downloadsEnabled: false,
});
```

This is a preview-only injection, not production activation.

## 3. Browser component changes

**Status: PASS (server-rendered markup); browser rendering NOT TESTED**

- No architectural rewrite of `PosterImage`.
- Existing behavior retained:
  - Ordered, finite, deduplicated candidates.
  - Native plus React error handling with one attempt per candidate.
  - Terminal error callback after all candidates fail.
  - `decoding="async"` default.
  - Caller-supplied `alt`, `loading`, `className`, `onLoad`, and `onError`.
- Existing call sites already provide:
  - Fixed `2 / 3` aspect-ratio containers or `aspect-[2/3]` wrappers.
  - `loading="lazy"` for gallery/grid content.
  - Descriptive alt text in primary cards and empty alt for decorative wall tiles.
  - A loading pulse/fade in `PosterCard` and an explicit error state in `Lightbox`.
- No new dependencies were added.

## 4. 61-entry preview inventory results

**Status: PASS**

Preview harness: `scripts/preview-r2-runtime.tsx` (`npm run preview:r2`). It uses the actual generated runtime map, the actual resolver, and the actual `PosterImage` component.

Artifacts (outside the repository):

- `/tmp/opencode/phase12b-preview.html`
- `/tmp/opencode/phase12b-preview-inventory.json`

| Metric | Result |
|---|---:|
| Preview entries | 61 |
| Migrated posters | 58 |
| Canary posters | 3 |
| Unique identities | 61 |
| Allowlist identities | 61 |
| Map/allowlist coverage match | Yes |
| Unique optimized URLs | 61 |
| Unique original URLs | 61 |
| Unique optimized keys | 61 |
| Unique original keys | 61 |
| Excluded identities present | 0 |
| Structural problems | 0 |

Per-entry validation confirmed:

- Identity lookup returns the same poster ID.
- `galleryUrl` equals the optimized URL.
- `originalPurposeUrl` equals the original URL.
- Every URL is HTTPS on `images.cineprint.click`.
- Every URL path matches its versioned/legacy key.
- All 58 migrated posters use `cineprint/versions/original/` and `cineprint/versions/optimized/`.
- All 3 canaries retain their legacy keys and were not rewritten to the versioned convention.
- No duplicate identities or keys.
- `stranger-things-2` and `the-substance-2` are absent.

Preview HTML audit:

- 61 `<img data-preview-id>` tags.
- 61 unique IDs.
- 61 unique `src` values, all R2.
- 0 Blob URLs in `src`.
- 0 `[object Object]` artifacts.

## 5. CDN live HTTP verification results

**Status: PASS**

New live checks performed with bounded concurrency (4):

| Check | Result |
|---|---|
| HEAD requests | 122 |
| HEAD status/type/length/cache-control matches | **122/122** |
| Optimized GET byte verifications (SHA-256 + size + type) | **61/61** |
| Original GET sample verifications (smallest 5) | **5/5** |

No bucket listing and no object mutations were performed. Only GET/HEAD against URLs already present in the verified runtime map.

Evidence file: `/tmp/opencode/phase12b-cdn.json`.

This confirms CDN delivery and byte identity. It does **not** confirm visual rendering, decoding, or layout.

## 6. Actual browser rendering results

**Status: NOT TESTED**

- Browser tooling reported: `[browser.disconnected] No desktop browser is connected to this session.`
- The Vitest environment is `node`; no jsdom/happy-dom/testing-library is installed, so DOM load/error events and computed layout cannot be exercised locally.
- No claim of visual validation is made. The preview page was generated and structurally validated, but it was not opened in a browser.

Unperformed checks:

- Image decode and paint.
- Natural dimensions and aspect-ratio stability.
- Responsive breakpoints.
- Above-the-fold priority behavior.
- Runtime load/error/retry transitions.
- Screen-reader output.

## 7. Responsive and accessibility findings

**Status: WARNING / NOT TESTED**

- **PASS (static review):** primary cards use `2 / 3` aspect-ratio containers, so layout space is reserved before load. Alt text is descriptive in primary cards; decorative wall tiles use empty alt.
- **WARNING:** `PosterImage` and call sites do not provide `srcset`/`sizes`. Delivery uses a single optimized 800px-wide WebP. This is functional but not fully responsive for high-DPI or wide layouts.
- **WARNING:** no explicit `fetchPriority="high"` for above-the-fold heroes; priority relies on browser defaults and call-site `loading` values.
- **NOT TESTED:** actual rendered contrast, focus behavior, zoom behavior, and assistive-technology output in a browser.

## 8. Loading, error, and fallback behavior

**Status: PASS (resolver/SSR behavior); NOT TESTED (browser event behavior)**

Tested behavior:

| Case | Behavior |
|---|---|
| Missing optimized URL | Mapping rejected; gallery falls back to the poster's existing image |
| Missing original URL | Mapping rejected; original purpose falls back to the poster's existing image |
| Malformed / non-HTTPS / wrong-host URL | Mapping rejected |
| Unknown poster identity | No R2 URL constructed; existing fallback path used |
| Changed Blob identity | Mapping not reused |
| Map/allowlist mismatch | Generator/export validation fails closed |
| All candidates exhausted | `onTerminalError` fires once; `Lightbox` renders its error state |

Fallback caveats:

- The final fallback is the poster's existing Blob image. That Blob store previously returned 403, so this is **not** a reliable delivery fallback.
- Most call sites do not render a dedicated neutral placeholder; a terminal failure surfaces as a broken image plus alt text. `Lightbox` is the exception and shows an explicit error state.
- If the R2 CDN fails, both optimized and original R2 candidates fail together because they share the same host.

## 9. Download/SEO isolation evidence

**Status: PASS**

- `R2_BROWSER_IMAGES_ENABLED = false`
- `R2_SEO_IMAGES_ENABLED = false`
- `R2_DOWNLOADS_ENABLED = false` (unless an explicit local/preview env override is set)
- `R2_SEO_IMAGES_ENABLED` has no preview override.
- Tests confirm that the preview resolver's SEO and download URLs do not use versioned R2 URLs while those flags are disabled.
- The preview harness passes `seoEnabled: false` and `downloadsEnabled: false` explicitly.
- Open Graph, Twitter/X, JSON-LD, and sitemap resolution were not switched to R2.

## 10. Rollback assessment

**Status: WARNING — rollback path exists but is NOT TESTED**

- The runtime map is **bundled**, not dynamically loaded: `src/lib/poster-images.ts` imports `R2_IMAGE_MAP` from `src/lib/r2-image-map.generated.ts`.
- Restoring a previous map therefore requires regenerating the file and **redeploying**.
- There is no runtime version pointer or independent map switch.
- Rollback options:
  1. Set the browser flag back to `false` and redeploy — returns to Blob URLs, which are not reliably available (403).
  2. Restore a previous generated map and redeploy — works without Blob, but still requires a deployment.
- A rollback cannot be exercised locally against production because no deployment or version switch is authorized in this phase.
- Next implementation step: add a reviewed, deploy-independent map selection mechanism (for example a versioned map pointer) and a documented rollback drill.

## 11. Test and build results

| Check | Result |
|---|---|
| `tests/runtime-preview.test.tsx` | **12 passed** |
| Focused resolver/map/canary suite | **64 passed** |
| Full suite | **980 passed, 4 skipped, 1 failed** |
| `npm run r2:map:check` | **pass** |
| Scoped ESLint (`PosterImage`, preview test, preview script) | **0 errors, 2 pre-existing hook warnings** |
| `tsc --noEmit` | **1 pre-existing error**, `src/routes/__root.tsx:148` |
| `git diff --check` | **pass** |
| Production build | **NOT TESTED** (not run to avoid generated build artifacts) |

Known pre-existing failure remains: `tests/security/public-firebase-isolation.test.ts:44`.

The two React hook warnings in `PosterImage` (`exhaustive-deps` on `candidates`) pre-date this phase.

## 12. Remaining blockers

**Status: WARNING**

- No connected browser, so visual and interaction validation is outstanding.
- No DOM-capable test environment, so runtime image load/error transitions are not covered by automated tests.
- No responsive `srcset`/`sizes`; single 800px WebP per poster.
- No neutral placeholder in most call sites for terminal image failure.
- Blob fallback is unreliable (403).
- Rollback requires a deployment and has not been drilled.
- Pre-existing public Firebase isolation failure remains a production-readiness risk.

## 13. Recommended next phase

1. Connect a browser and run the generated 61-entry preview page: capture decode success, natural dimensions, layout stability, and console/network results.
2. Add a DOM-capable test (jsdom or browser runner) for load/error/retry transitions.
3. Add `srcset`/`sizes` or document a deliberate single-size decision.
4. Add an explicit neutral unavailable-image state for terminal failures.
5. Design and drill a deploy-independent map rollback before production activation.
6. Re-run the public Firebase isolation check and resolve the pre-existing failure.

## Files changed

**Added**

- `scripts/preview-r2-runtime.tsx` — local 61-entry preview harness.
- `tests/runtime-preview.test.tsx` — 12 preview/resolver/component tests.
- `migration/PHASE-12B-BROWSER-DELIVERY-PREVIEW-REPORT.md` — this report.

**Modified**

- `src/components/PosterImage.tsx` — optional preview/test `resolver` prop.
- `src/lib/poster-images.ts` — reject malformed/unsupported R2 mappings.
- `package.json` — added `preview:r2`.

**Unchanged**

- `migration/r2-image-map.json`, `migration/r2-resolver-allowlist.json`, `src/lib/r2-image-map.generated.ts` (still 61 entries, flags false).
- Phase 10A–10E reports and state files.
- Phase 11 and Phase 12A reports.
- Canary objects and evidence.

## Preservation confirmation

- Branch remains `feat/r2-image-storage`.
- HEAD remains `ec5401ca82bb7d71f4679c60f2994cbc607177fe`.
- Phase 10A/10E report and state hashes match the Phase 12A baseline exactly; `migration/migration-state.json` also matches.
- Existing unrelated worktree changes remain intact.
- No R2 uploads, overwrites, deletions, or copies.
- No Cloudflare, DNS, Vercel, Firebase, Firestore, Notion, Raindrop, or Blob changes.
- No commits, pushes, merges, rebases, or deployments.
- No secrets, credentials, tokens, or environment-file contents were inspected or printed.
- Production browser, download, and SEO flags remain **false**.

**Phase 12B is complete. Production activation and deployment remain unauthorized.**
