# CinePrint SEO — Production Readiness Report (M11)

Branch: `feat/seo-foundation` · Production: https://cineprint.click
Verified: 2026-11-05 · Method: live HTTP against production + local Vite SSR

## A. Executive status

**READY FOR DEPLOYMENT** (release candidate), production currently defective.

Read this precisely, because the two halves differ:

- **The branch is ready to deploy.** All local validation passes: 49 test files,
  495 tests, TypeScript clean, Prettier clean, production build succeeds, sitemap
  generation is deterministic, and every route type behaves correctly under local SSR.
- **Production is not ready for indexing.** The live site is serving pre-M0 behavior.
  It returns HTTP 200 for nonexistent posters, omits canonicals on every route except
  the homepage, emits no JSON-LD, lists the `noindex`-less `/saved` utility page in its
  sitemap, and 404s on every artist/film/genre/style discovery route.

Deployment is the remedy: every production defect below is already fixed on this branch.

Deployment readiness and post-deployment indexing readiness are different gates.
Deploying fixes the technical defects, but Google still has to crawl and process the
new sitemap. Only after deployment plus Search Console submission does the site become
candidate for _READY FOR SEARCH CONSOLE SUBMISSION_.

## B. Production verification

| Area             | Result              | Evidence                                                                                           |
| ---------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| DNS + apex       | Pass                | `https://cineprint.click/` → 200, Vercel                                                           |
| HTTPS            | Pass                | HTTP/2, valid TLS, no mixed content observed                                                       |
| `www` redirect   | Pass                | `https://www.cineprint.click/` → 307 → apex                                                        |
| HTTP→HTTPS       | Pass                | `http://cineprint.click/` → 308 → `https://`                                                       |
| Trailing slash   | Pass                | `/poster/x/` → 307 → `/poster/x`; `/artists/` → 307 → `/artists`                                   |
| robots.txt       | Pass                | `Allow: /`, references `https://cineprint.click/sitemap.xml`, no staging rules                     |
| Sitemap          | **Defect**          | Single `urlset`, 5 URLs, includes `/saved`                                                         |
| Canonicals       | **Defect**          | Present only on `/`; absent on about, submit, constellation, saved, login, profile, poster, artist |
| Robots meta      | **Defect**          | None on `/saved`, `/login`, `/profile`                                                             |
| Invalid poster   | **Critical defect** | `/poster/__nonexistent_seo_probe__` → HTTP **200**, title "Poster Not Found"                       |
| Poster H1        | **Defect**          | Zero `<h1>` on poster pages                                                                        |
| JSON-LD          | **Defect**          | Zero JSON-LD blocks on every sampled production page                                               |
| Discovery routes | **Defect**          | `/artists`, `/genres`, `/styles`, `/film/backrooms`, `/genre/horror`, `/style/minimalist` all 404  |
| Images           | Pass                | Public Blob host, HTTP 200, `image/webp`, no dev/localhost leakage                                 |
| Alt text         | Pass                | Homepage 122 images, 0 missing alt, 97 decorative empty alt                                        |
| Compression      | Pass                | Brotli (`br`)                                                                                      |
| Caching          | Observation         | `public, max-age=0, must-revalidate`, `X-Vercel-Cache: MISS`                                       |
| Performance      | Observation         | Homepage TTFB+body 614–1169 ms; poster 493–822 ms; compressed ~16 KB                               |

Production sitemap, verbatim structure: `/, /about, /submit, /saved, /constellation`,
with `changefreq` and `priority`, `lastmod` = build date.

## C. Local versus production

| Capability                                                                             | Mile | Production          | Status                            |
| -------------------------------------------------------------------------------------- | ---- | ------------------- | --------------------------------- |
| Genuine 404 for missing posters + noindex                                              | M0   | 200 soft-404        | LOCAL_ONLY / production defective |
| Utility pages `noindex, follow`                                                        | M1   | no robots meta      | LOCAL_ONLY                        |
| Utility pages excluded from sitemap                                                    | M1   | `/saved` included   | LOCAL_ONLY / production defective |
| Canonical + OG/Twitter on all public routes                                            | M2   | homepage only       | LOCAL_ONLY                        |
| Crawlable poster anchors                                                               | M3   | not deployed        | LOCAL_ONLY                        |
| SSR poster body + H1 + related links                                                   | M4   | no H1, thin body    | LOCAL_ONLY                        |
| Build-time multi-file sitemap, 112 URLs                                                | M5   | single file, 5 URLs | LOCAL_ONLY                        |
| JSON-LD (WebSite, Organization, VisualArtwork, Person, CollectionPage, BreadcrumbList) | M6   | none                | LOCAL_ONLY                        |
| Film/TV landing pages                                                                  | M7   | 404                 | LOCAL_ONLY                        |
| Artist directory                                                                       | M8   | 404                 | LOCAL_ONLY                        |
| Genre & style landing pages                                                            | M9   | 404                 | LOCAL_ONLY                        |
| Footer directory nav, breadcrumb parity, unknown-artist guard                          | M10  | absent              | LOCAL_ONLY                        |

Local sitemap: **112 unique URLs** across 6 children plus index
(7 static, 63 posters, 26 artists, 3 films, 10 genres, 3 styles), zero duplicates,
valid lastmod dates, 63 image entries. The mission brief quotes 110; the category
table in the brief sums to 112, and 112 is the measured value.

## D. Search Console checklist

The production homepage carries a `google-site-verification` meta tag
(`uPz3YzMhSo1cbf5qS_wzNEUL2fEpV_AYp8nE-GB2gDE`), so HTML-tag verification is already
deployed. Property existence, sitemap submission status, coverage reports, manual
actions, and performance data are **NOT TESTED** — no authenticated access was used.

Operator actions, all requiring explicit authorization:

1. **Property**: `https://cineprint.click/` (URL-prefix property). Domain property optional.
2. **Sitemap**: submit `https://cineprint.click/sitemap.xml` **after** deploying M5.
3. **Verification**: confirm the existing meta tag is still present post-deploy.
4. **Inspect**: Coverage → Pages; Sitemaps → status; Settings → Crawl stats; Enhancements.
5. **Interpretation**: "Discovered – currently not indexed" is normal for a new catalogue;
   "Crawled – currently not indexed" on soft-404s indicates the M0 defect is still live;
   "Excluded by noindex" on `/saved`, `/login`, `/profile` is correct M1 behavior.
6. Request indexing for a small representative set only: `/`, `/artists`, one poster,
   one artist, one film, one genre, one style.

Do not submit the currently deployed 5-URL sitemap; it encodes the defect.

## E. Defect register

| #   | Sev      | Affected                             | Evidence                                                                  | Likely cause                       | Fix                                | Blocks deploy     |
| --- | -------- | ------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------- | ----------------- |
| 1   | Critical | `/poster/$id` invalid                | HTTP 200, "Poster Not Found"                                              | M0 not deployed                    | Deploy M0 (`notFound()` + noindex) | No (deploy fixes) |
| 2   | Critical | `/saved`                             | In production sitemap; no robots meta                                     | M1 not deployed                    | Deploy M1                          | No                |
| 3   | High     | All routes except `/`                | No canonical, no og:url, no og:image                                      | M2 not deployed                    | Deploy M2                          | No                |
| 4   | High     | All sampled routes                   | 0 JSON-LD blocks                                                          | M6 not deployed                    | Deploy M6                          | No                |
| 5   | High     | Poster pages                         | 0 `<h1>`, thin SSR body                                                   | M4 not deployed                    | Deploy M4                          | No                |
| 6   | High     | Discovery routes                     | `/artists`, `/genres`, `/styles`, `/film/*`, `/genre/*`, `/style/*` → 404 | M7–M9 not deployed                 | Deploy M7–M9                       | No                |
| 7   | Medium   | Poster grid                          | Poster cards not crawlable anchors                                        | M3 not deployed                    | Deploy M3                          | No                |
| 8   | Medium   | Sitemap                              | Single file, 5 URLs, build-date lastmod                                   | M5 not deployed                    | Deploy M5                          | No                |
| 9   | Low      | Query variants                       | `?utm_source=` returns 200 with no canonical to consolidate               | consequence of #3                  | Deploy M2                          | No                |
| 10  | Low      | 404 route `/artists/<extra>` (local) | 404 status but canonical + JSON-LD to `/artists`                          | Catch-all matching `/artists` head | Optional local follow-up           | No                |

No defect requires a code change to ship: all ten are resolved by deploying the branch,
except #10 which is cosmetic on a non-indexable status.

## F. Final deployment checklist

1. Review and commit the branch work (M0–M10) — not done in this milestone.
2. Deploy to production; confirm the build's `prebuild` sitemap step ran.
3. `GET /robots.txt` → still `Allow: /` + sitemap reference.
4. `GET /sitemap.xml` → must be a `sitemapindex` with 6 children, 112 URLs.
5. `GET /poster/__probe__` → **404** with `noindex`.
6. `GET /saved`, `/login`, `/profile` → 200 with `noindex, follow`.
7. `GET /artists`, `/genres`, `/styles` → 200 with canonical + JSON-LD.
8. Parse JSON-LD on `/`, one poster, one artist, one film, one genre, one style.
9. Confirm zero duplicate URLs across the 6 sitemap children.
10. Only then submit the sitemap in Search Console.

## G. Post-deployment monitoring

| Signal                  | Where             | Cadence            | Healthy expectation                                 |
| ----------------------- | ----------------- | ------------------ | --------------------------------------------------- |
| Sitemap processing      | GSC → Sitemaps    | Day 1, then weekly | "Success", 112 discovered                           |
| Indexed pages           | GSC → Pages       | Weekly             | Rises toward 112; utility pages stay excluded       |
| Discovered not indexed  | GSC → Pages       | Weekly             | Shrinks over weeks; not an error                    |
| Crawl errors            | GSC → Crawl stats | Weekly             | 404s only for genuinely invalid IDs                 |
| Soft 404s               | GSC → Pages       | Weekly             | Should be zero after M0 deploy                      |
| Impressions             | GSC → Performance | Weekly             | First measurable trend by week 2–4                  |
| Clicks / CTR / position | GSC → Performance | Monthly            | No baseline exists; treat first 28 days as baseline |

No performance baseline is invented here. Record the first 28-day window as the baseline.

## Evidence provenance

All production claims come from live HTTP requests made in this session.
All local claims come from the branch under test, local Vite SSR, and the test suite.
External schema validation and authenticated Search Console inspection were not performed.
