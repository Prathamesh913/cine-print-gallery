# Phase 11 — R2 Production Cutover Readiness Audit

Date: 2026-11-09  
Worktree: `/tmp/opencode/wt-r2-image-storage`  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`  
Bucket: `cineprint-posters`  
Public domain: `https://images.cineprint.click`

## 1. Executive summary

**Overall recommendation: NOT READY FOR CUTOVER.**

The storage migration itself is complete and healthy: all 58 high-confidence posters and all 116 versioned objects are present, metadata-correct, and publicly accessible. Historical batch audits show 116/116 origin and 116/116 public byte verifications with zero mismatches. Live checks confirmed 116/116 R2 HEAD metadata matches, 116/116 CDN HEAD matches, a 10-object live GET sample passed, and all six canary objects are present.

The blocker is **runtime integration**. The generated runtime image map and allowlist still contain only the three canary posters. None of the 58 newly migrated posters is mapped for browser, download, or SEO delivery. The map generator also rejects the new `cineprint/versions/original/` key prefix, and the legacy exporter is tied to the old `migration-state.json`/legacy key model. Production flags remain disabled, and the Vercel Blob fallback is not a reliable safety net because the store has been blocked.

## 2. Reconciled migration inventory

| Category | Expected | Actual | Status |
|---|---:|---:|---|
| High-confidence posters | 58 | 58 | PASS |
| Original objects | 58 | 58 | PASS |
| Optimized objects | 58 | 58 | PASS |
| Migrated objects | 116 | 116 | PASS |
| Canary posters | 3 | 3 | PASS |
| Canary objects | 6 | 6 | PASS |
| Total expected objects | 122 | 122 | PASS |
| Failed migration objects | 0 | 0 | PASS |
| Conflicted migration objects | 0 | 0 | PASS |
| Unknown migration objects | 0 | 0 | PASS |

- `migration/optimized-artifacts.json`: complete, 58 posters / 116 artifacts / 0 failures.
- Batch state totals: 5 + 15 + 15 + 15 + 8 = 58 posters.
- Batch key totals: 10 + 30 + 30 + 30 + 16 = 116 objects.
- 116 unique state keys; zero overlap across batches.
- All 116 state keys exactly match the artifact manifest.
- No canary or medium-confidence identity appears in the artifact manifest.
- `stranger-things-2` and `the-substance-2` remain excluded from artifacts, map, and allowlist.

## 3. Batch-by-batch evidence reconciliation

| Batch | Posters | Objects | State | Report agreement |
|---|---:|---:|---|---|
| 10A / Batch 1 | 5 | 10 | All VERIFIED | PASS |
| 10B / Batch 2 | 15 | 30 | All VERIFIED | PASS |
| 10C / Batch 3 | 15 | 30 | All VERIFIED | PASS |
| 10D / Batch 4 | 15 | 30 | All VERIFIED | PASS |
| 10E / Batch 5 | 8 | 16 | All VERIFIED | PASS |

Batch report/state hashes were unchanged during this audit:

```
Batch 1 report  88cb2f46…e81e42
Batch 1 state   5203ef78…f0ccd
Batch 2 report  98ba3d63…93756
Batch 2 state   80094b3a…a4af4b
Batch 3 report  76adfd53…3467fc
Batch 3 state   cbbffc23…d9f0
Batch 4 report  b4b9128e…69cda
Batch 4 state   0f1c548f…97b4
Batch 5 report  599910c6…919f
Batch 5 state   f168eaa7…3973
```

## 4. R2 and public CDN verification

### Historical evidence

All five batch audit logs were reconciled against the artifact manifest:

| Batch | Keys | Origin SHA verified | Public SHA verified | Mismatches |
|---|---:|---:|---:|---:|
| 1 | 10 | 10 | 10 | 0 |
| 2 | 30 | 30 | 30 | 0 |
| 3 | 30 | 30 | 30 | 0 |
| 4 | 30 | 30 | 30 | 0 |
| 5 | 16 | 16 | 16 | 0 |
| **Total** | **116** | **116** | **116** | **0** |

### Live checks performed in this audit

- R2 HEAD for all 116 migrated keys: **116 MATCH**, 0 mismatch, 0 absent, 0 unknown.
- Public CDN HEAD for all 116 URLs: **116 MATCH**, 0 mismatch, 0 unknown.
- Live bounded GET + public GET sample: **10/10 VERIFIED** (one original and one optimized from each batch).
- Canary HEAD: **6/6 PRESENT** with expected content type and immutable Cache-Control.
- Content type, content length, immutable `Cache-Control`, and available SHA-256 metadata matched.

**Status: PASS** for storage availability and integrity. Live byte verification was sampled; full byte verification remains historical batch evidence.

## 5. Runtime resolver findings

**Status: FAIL.**

- `src/lib/r2-image-map.generated.ts` contains only the three canary entries: `2001-a-space-odyssey`, `artwork-1824607248`, `bugonia`.
- `migration/r2-image-map.json` contains the same three entries.
- `migration/r2-resolver-allowlist.json` contains only those three canaries.
- Therefore none of the 58 migrated posters resolves to its new R2 original/optimized URL.
- For unmapped posters, `src/lib/poster-images.ts` falls back to the legacy Blob optimized URL or the original Blob image. That is not a functional production fallback while the Blob store is blocked.
- `scripts/generate-r2-image-map.ts` restricts original keys to `cineprint/raindrop/` or `cineprint/external/`; it will reject the new `cineprint/versions/original/` keys.
- `scripts/export-r2-verified-mappings.ts` is tied to `migration/migration-state.json` and legacy manifest keys; it cannot emit the 58 versioned mappings from the batch states/artifact manifest as-is.
- `npm run r2:map:check` passes, but only proves the generated file matches the three-entry source map. It does not prove migration coverage.

## 6. Browser rendering findings

**Status: WARNING.**

- `PosterImage` implements finite candidate fallback, native error handling, lazy loading in cards, skeleton/placeholder states, and terminal error callbacks.
- `PosterCard` uses a 2:3 aspect-ratio container; `Lightbox` uses an aspect-ratio container and loading/error states, limiting layout shift.
- No explicit `width`/`height` attributes or `fetchPriority` are set on the `<img>`; layout stability depends on CSS containers.
- ESLint reports two existing `react-hooks/exhaustive-deps` warnings in `PosterImage.tsx`.
- Browser rendering cannot be end-to-end validated for the 58 migrated posters until the runtime map is expanded.
- **Production browser/SEO end-to-end validation: NOT TESTED** (no deployment or activation was authorized).

## 7. Performance and caching findings

**Status: WARNING.**

- Uploaded objects have `Cache-Control: public, max-age=31536000, immutable`.
- Optimized objects are WebP; originals preserve source format.
- Versioned keys use content hashes, so cache invalidation is explicit via key change.
- Public CDN HEAD checks returned expected content length/type/cache-control.
- No duplicate-request or preload behavior was introduced by this audit.
- Runtime performance cannot improve for the 58 posters until their map entries are active.

## 8. SEO readiness findings

**Status: FAIL.**

- `R2_SEO_IMAGES_ENABLED` is `false`.
- `getPosterSeoImageUrl()` uses the same three-entry map and otherwise falls back to Blob-derived URLs.
- Open Graph, Twitter/X card, JSON-LD, and sitemap image references therefore remain on Blob for the 58 migrated posters.
- The Blob store is blocked, so those image references can point to unavailable assets.
- Canonical URL generation itself is correct (`https://cineprint.click`).
- SEO activation must remain separate and must not be enabled until the versioned map and fallback behavior are validated.

## 9. Security findings

**Status: WARNING.**

- The generated client map contains only public Blob/R2 URLs and keys; no source URLs, credentials, tokens, or server-only logic were found in the map.
- The resolver requires an exact poster ID and exact Blob URL match; unknown identities do not receive inferred R2 URLs.
- No medium-confidence identity is present in the map or allowlist.
- The known pre-existing security test failure still exists: `tests/security/public-firebase-isolation.test.ts:44` reports that a public path evaluates `src/server/firebase/admin` via the static import in `src/lib/notion.ts:8`. This is unrelated to the R2 migration but remains a production-readiness risk.

## 10. Failure handling and rollback assessment

**Status: FAIL for cutover rollback readiness.**

- If an optimized R2 object is missing, the resolver can fall back to the mapped R2 original (when a map entry exists).
- If an R2 original/CDN is unavailable, the final fallback is Blob, which is currently blocked and cannot be relied on.
- The runtime map has no historical-version pointer or rollback selector. The versioning/artifact history exists locally, but it is not wired into production resolution.
- A rollback to a previous R2 version would require a new map/version-pointer implementation and a separate authorized operation.
- Do not claim a functional rollback path today.

## 11. Validation results

**Status: WARNING** — focused checks pass; pre-existing lint, typecheck, and full-suite failures remain.

| Check | Result |
|---|---|
| Focused migration tests | **21 files, 311 tests passed** |
| Resolver / image / SEO focused tests | **9 files, 137 tests passed** |
| Full suite | **954 passed, 4 skipped, 1 failed** |
| Scoped ESLint | **8 pre-existing Prettier errors + 2 React hook warnings** in runtime files; no new migration code changes |
| `tsc --noEmit` | **1 pre-existing error**, `src/routes/__root.tsx:148` |
| `npm run r2:map:check` | **pass** (three-entry map is internally consistent) |
| `git diff --check` | **pass** |

Pre-existing full-suite failure: `tests/security/public-firebase-isolation.test.ts:44` (static `getAdminDb` import in `src/lib/notion.ts:8`).

## 12. Existing limitations and unresolved risks

- Runtime map/allowlist do not include the 58 migrated posters.
- Map generator/exporter cannot emit the new versioned key format without code changes.
- Browser, download, and SEO activation flags remain disabled.
- Blob fallback is not operationally reliable.
- No production rollback/version-pointer integration.
- Live byte verification was sampled; full byte integrity relies on historical batch audit evidence.
- Two medium-confidence identities remain unresolved and excluded.
- No browser/SEO end-to-end production validation was performed.
- Pre-existing public Firebase isolation test failure remains.

## 13. Recommended production cutover sequence

1. **Implement a versioned runtime map exporter** from `migration/optimized-artifacts.json` and the five batch states.
2. **Extend `scripts/generate-r2-image-map.ts`** to accept `cineprint/versions/original/` and `cineprint/versions/optimized/` keys.
3. **Expand the allowlist** to the 58 high-confidence posters while keeping canaries pinned and both medium identities excluded.
4. **Regenerate `src/lib/r2-image-map.generated.ts`** with browser/download/SEO flags still false; verify 58 entries, 116 keys, no medium identities, and canary preservation.
5. **Run resolver, image, SEO, and map-check tests** against the expanded map.
6. **Preview browser activation only** and validate all 58 posters, fallback behavior, layout, and CDN delivery. Do not rely on Blob.
7. **Resolve the public Firebase isolation failure** before production activation.
8. **Activate SEO separately** after browser validation and after confirming no image metadata points to unavailable Blob assets.
9. **Define and test rollback** using R2 originals/version pointers; do not rely on Blob.
10. Only then consider a controlled production cutover.

## Preservation confirmation

- Branch remains `feat/r2-image-storage`.
- HEAD remains `ec5401ca82bb7d71f4679c60f2994cbc607177fe`.
- Five batch reports and state files remain unchanged.
- Canary objects remain unchanged and present.
- Production browser/download/SEO flags remain disabled.
- No external writes, uploads, deletions, bucket listings, or configuration changes occurred.
- No application code, manifest, allowlist, runtime map, or migration state was modified by this audit.
- Only this report was created.
