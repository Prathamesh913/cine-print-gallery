# Phase 18 — SEO Image Migration Report

Date: 2026-11-09  
Worktree: `/tmp/opencode/wt-r2-image-storage`  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`  
Production: `https://cineprint.click` (Phase 16 browser-only deployment; SEO not deployed)  
R2 CDN: `https://images.cineprint.click`

## 1. Executive summary

**Status: PASS WITH BLOCKERS — SEO implementation complete and locally validated; production SEO activation and Git merge remain separately authorized.**

- All active SEO image surfaces now resolve mapped posters to verified R2 optimized assets.
- The two unresolved identities use the local `/poster-unavailable.svg` placeholder.
- The regenerated sitemap contains **63 poster URLs**, **61 R2 image entries**, **2 placeholder entries**, and **0 Blob image URLs**.
- All **61/61** mapped SEO image URLs returned HTTP 200, `image/webp`, immutable cache headers; 5 GET samples matched expected SHA-256 and byte sizes.
- Rendered OG/Twitter/JSON-LD and sitemap output contain no Blob image URLs.
- Browser delivery remains enabled; downloads remain disabled.
- Production remains on the Phase 16 deployment with SEO **disabled**; no production SEO deployment or activation occurred.

Remaining blockers are procedural/release-related: no commit/push/merge authorization, production SEO not deployed, external social validators not tested, and pre-existing TypeScript/lint/CSRF/CLS issues.

## 2. SEO image inventory

| Source file / surface | Metadata surface | Before | After | Generated/runtime |
|---|---|---|---|---|
| `src/lib/seo.ts` — `pageHead` | OG/Twitter image, alt, canonical | Resolver-dependent | Mapped → R2 optimized; unavailable → local SVG | Runtime SSR |
| `src/lib/seo.ts` — `posterHeadMeta` | Poster OG/Twitter | Blob optimized | R2 optimized / local SVG | Runtime SSR |
| `src/lib/seo.ts` — `artistHeadMeta` | Artist OG/Twitter | Blob optimized | R2 optimized / local SVG | Runtime SSR |
| `src/lib/structured-data.ts` | JSON-LD `VisualArtwork`/artist images | Blob optimized | R2 optimized / local SVG | Runtime SSR |
| `src/lib/sitemap.ts` — `posterUrlEntries` | XML sitemap image entries | Blob optimized | R2 optimized / local SVG | Build-time generation |
| `scripts/generate-sitemap.ts` | Sitemap index/posters/robots | Blob optimized | R2 optimized / local SVG | Build-time generation |
| `public/sitemap-posters.xml` | Generated sitemap artifact | 63 Blob image URLs | 61 R2 + 2 placeholder; 0 Blob | Generated artifact |
| `src/routes/poster/$id.tsx` | Poster head metadata | Blob optimized | R2 optimized / local SVG | Runtime SSR |
| `src/routes/c/$id.tsx` | Collection OG image | Blob optimized | R2 optimized / local SVG | Runtime SSR |
| `src/routes/artists.tsx`, `artist/$slug.tsx` | Artist/taxonomy OG images | Blob optimized | R2 optimized / local SVG | Runtime SSR |
| `src/routes/genres.tsx`, `genre/$slug.tsx` | Genre OG images | Blob optimized | R2 optimized / local SVG | Runtime SSR |
| `src/routes/styles.tsx`, `style/$slug.tsx` | Style OG images | Blob optimized | R2 optimized / local SVG | Runtime SSR |
| `src/routes/film/$slug.tsx` | Film OG/JSON-LD images | Blob optimized | R2 optimized / local SVG | Runtime SSR |
| `src/routes/index.tsx` | Home OG/Twitter | Static `/og-image.png` | Unchanged | Runtime SSR |
| `src/lib/notion.ts` / `poster.image` | Serialized catalogue identity/hydration | Blob URL | Blob URL retained for resolver identity matching | Runtime data |
| `src/lib/poster-images.ts` — `blobOptimizedUrl` | Legacy fallback for unknown/unmapped IDs | Blob optimized | Blob optimized for unknown IDs only; not active for the 63 catalogue entries | Runtime resolver |
| `src/lib/image-data-url.ts` | Download image proxy | Public URL fetch | Unchanged; downloads disabled | Runtime server function |
| RSS/feed/social-preview route | — | None found | No change | Not applicable |

Important distinction: the Blob URL in `poster.image` remains in the serialized catalogue/hydration payload because it is the exact pre-migration identity used by the resolver. It is **not** emitted in OG/Twitter/JSON-LD or sitemap image tags. The legacy `blobOptimizedUrl` fallback remains for unknown/unmapped identities, but the current 63-poster catalogue is fully accounted for by the 61 map entries and 2 unavailable identities.

## 3. Before/after URL strategy

| Consumer | Before | After |
|---|---|---|
| Browser mapped posters | R2 optimized (Phase 16) | Unchanged R2 optimized |
| Browser unavailable posters | Local SVG placeholder | Unchanged local SVG |
| OG/Twitter mapped posters | Blob optimized (403) | R2 optimized |
| OG/Twitter unavailable posters | Local SVG | Local SVG (absolute `https://cineprint.click/poster-unavailable.svg`) |
| JSON-LD mapped posters | Blob optimized | R2 optimized |
| JSON-LD unavailable posters | Local SVG | Local SVG |
| Sitemap mapped posters | Blob optimized | R2 optimized |
| Sitemap unavailable posters | Blob optimized | Local SVG |
| Downloads | Disabled; Blob fallback | Disabled; unchanged |

No URL is constructed from poster IDs; all mapped URLs come from the existing generated runtime map.

## 4. Files changed

**Implementation**
- `automation/migration/runtime-map.ts` — `DEFAULT_R2_SEO_IMAGES_ENABLED = true`.
- `src/lib/r2-image-map.generated.ts` — regenerated: browser true, SEO true.
- `public/sitemap-posters.xml` — regenerated 63 image URLs (61 R2 + 2 placeholder).
- `src/lib/seo.ts` — formatting only; no behavior change.

**Tests**
- `tests/seo-sitemap-optimized.test.tsx` — full 63-poster SEO/sitemap coverage.
- Flag assertions updated in `automation/migration/runtime-map.test.ts`, `automation/r2-image-map.test.ts`, `tests/runtime-preview.test.tsx`.

**Monitoring/merge readiness**
- `automation/monitoring/production-health.ts` — `EXPECT_SEO=blob|r2` and sitemap expectation support.
- `scripts/production-health-check.ts` — `HEALTH_BASE_URL`, `EXPECT_SEO`, sitemap fetch.
- `automation/monitoring/production-health.test.ts` — SEO-R2 expectation coverage.
- `.gitignore` — ignore `migration/cache/`; removed the over-broad `.env*` ignore.
- `migration/BROWSER-DELIVERY-CUTOVER-RUNBOOK.md` — Phase 18 flag/deployment note.
- Phase 18 reports.

## 5. Catalogue coverage

| Metric | Result |
|---|---:|
| Total catalogue identities | **63** |
| R2 mapped identities | **61** |
| Intentionally unavailable | **2** |
| Runtime map entries | **61** |
| Allowlist identities | **61** |
| Unique R2 object references | **122** |
| Canaries | **3** |
| Sitemap `<loc>` entries | **63 unique** |
| Sitemap R2 image entries | **61** |
| Sitemap placeholder entries | **2** |
| Sitemap Blob image entries | **0** |
| Duplicate sitemap URLs | **0** |

## 6. R2 verification

Read-only live checks:

| Check | Result |
|---|---|
| Mapped optimized URLs checked | **61** |
| HTTP 200 | **61/61** |
| Content-Type `image/webp` | **61/61** |
| Cache-Control immutable | **61/61** |
| GET sample byte/hash match | **5/5** |
| R2 mutations | **None** |

Evidence: `/tmp/opencode/phase18-seo-r2.json`.

Local placeholder: `public/poster-unavailable.svg` packaged at `.vercel/output/static/poster-unavailable.svg`; used for both unavailable identities.

## 7. Metadata and sitemap test results

Focused SEO tests: **12/12 passed**.

Covered:

- Mapped poster OG and Twitter image URLs.
- Mapped poster JSON-LD image references.
- Unavailable poster OG/Twitter/JSON-LD placeholder.
- Sitemap poster image URLs and completeness.
- 61 mapped + 2 unavailable = 63 total identities.
- Absolute HTTPS URLs.
- No Blob, localhost, or preview-deployment URLs.
- No duplicate `<loc>` entries.
- Download delivery remains disabled.
- Correct identity-to-R2 mapping via the generated map.

Sitemap checks:

- 63 unique `<loc>` entries.
- 61 R2 image URLs + 2 placeholder URLs.
- 0 Blob image URLs.
- Valid XML.
- Deterministic across two generation runs.

## 8. Browser regression and local metadata checks

- Local route harness: **42/42 passed**.
- Phase 12C reliability/failure harness: **47/47 passed**.
- Local rendered metadata:
  - `/poster/backrooms-3`: OG/Twitter → R2 optimized.
  - `/poster/the-substance-2` and `/poster/stranger-things-2`: OG/Twitter → local SVG.
  - `/genres`, `/artists`: OG/Twitter → R2 optimized.
- No Blob image tags in rendered SEO metadata; Blob remains only in serialized catalogue identity data.

Production health check (current Phase 16 deployment, `EXPECT_SEO=blob`): **73/73 passed**, browser delivery unchanged, production SEO still disabled, production sitemap still Blob. No production deployment or SEO activation occurred.

Built-preview `EXPECT_SEO=r2` browser check: **NOT TESTED** — the generated `srvx` preview server did not serve the static asset root correctly. The `EXPECT_SEO=r2` evaluation logic is covered by focused unit tests.

## 9. Build and test results

| Check | Result |
|---|---|
| Full suite | **1003 passed, 0 failed** |
| Focused SEO tests | **12 passed** |
| `r2:map:check` | **pass** |
| TypeScript | 1 pre-existing error at `src/routes/__root.tsx:148` |
| Scoped ESLint | 0 errors, 2 pre-existing hook warnings |
| `git diff --check` | **pass** |
| Full Vercel-target build (`NITRO_PRESET=vercel npm run build`) | **pass** |
| Build flags | browser **true**, SEO **true**, downloads **false** |
| Build map | 61 entries |
| Build sitemap | 61 R2 + 2 placeholder, 0 Blob |
| Build unavailable SVG | present |

## 10. Production activation requirements

The branch now enables SEO, but production remains Phase 16 browser-only.

To activate SEO in production (separate authorization required):

1. Commit and merge the Phase 18 branch changes.
2. Deploy with the generated SEO flag true.
3. Confirm the production sitemap is regenerated and deployed.
4. Verify OG/Twitter/JSON-LD/sitemap use R2 and no Blob.
5. Run `EXPECT_SEO=r2 npm run health:production`.
6. Confirm downloads remain disabled.

Do not deploy the current branch as a browser-only release; it enables SEO.

## 11. Remaining limitations

1. **Production SEO is not deployed.** Production sitemap still has 63 Blob image URLs; production asset SEO flag is false.
2. **Blob identity remains in serialized hydration data.** `poster.image` stays Blob for resolver identity matching; it is not an SEO image tag.
3. **Legacy Blob fallback remains for unknown/unmapped IDs.** Current 63-poster catalogue does not use it, but future unmapped posters could.
4. **External social validators were not tested.** No authenticated Facebook/Twitter validator checks were performed.
5. **800px detail assets** are still upscaled on high-DPI detail views.
6. **Pre-existing TypeScript, ESLint, CSRF, and CLS issues** remain.
7. **Built-preview SEO health check** was not completed due preview-server static-root behavior; local dev and unit tests cover the logic.
8. **No commit/push/merge** occurred.

## 12. Final status

**PASS WITH BLOCKERS.** SEO implementation is complete and locally validated. The blockers are production SEO deployment/activation, Git commit/merge authorization, external social-validator testing, and pre-existing unrelated issues. No production SEO activation is claimed.
