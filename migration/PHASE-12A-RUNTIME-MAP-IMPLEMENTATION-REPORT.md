# Phase 12A — Runtime Map Exporter & Generator Compatibility Report

Date: 2026-11-09  
Worktree: `/tmp/opencode/wt-r2-image-storage`  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`

## 1. Existing implementation findings

- The Phase 11 runtime map contained only the three canary entries.
- The allowlist contained only those three canaries.
- `scripts/generate-r2-image-map.ts` accepted only legacy original prefixes (`cineprint/raindrop/`, `cineprint/external/`) and rejected `cineprint/versions/original/`.
- The legacy exporter (`scripts/export-r2-verified-mappings.ts`) is coupled to `migration/migration-state.json` and legacy manifest keys; it could not emit the 58 versioned mappings.
- The five batch state files and `migration/optimized-artifacts.json` contained the complete verified evidence for 58 posters / 116 objects.

## 2. Files changed

**Added**

- `automation/migration/runtime-map.ts` — shared runtime map/allowlist types, validation, versioned exporter, generator source builder.
- `automation/migration/runtime-map.test.ts` — 14 focused tests.
- `scripts/export-versioned-r2-map.ts` — versioned exporter CLI.
- `migration/PHASE-12A-RUNTIME-MAP-IMPLEMENTATION-REPORT.md` — this report.

**Modified**

- `scripts/generate-r2-image-map.ts` — now uses the shared runtime-map validation/source layer and accepts versioned key prefixes.
- `package.json` — `r2:map:export` now runs the versioned exporter; legacy exporter retained as `r2:map:export:legacy`.
- `migration/r2-image-map.json` — regenerated with 61 entries.
- `migration/r2-resolver-allowlist.json` — regenerated with 61 identities.
- `src/lib/r2-image-map.generated.ts` — regenerated with 61 entries and browser/SEO flags still false.
- `automation/r2-image-map.test.ts` — legacy exporter tests use a canary-only allowlist fixture so they remain focused on canary compatibility.
- `automation/identity/manifest-compat.test.ts` — canary compatibility assertions updated for the expanded 61-entry map while retaining exact canary checks.
- `automation/migration/versioning.test.ts` — legacy canary map assertion updated for the expanded map while retaining exact canary key checks.

## 3. Exporter architecture and input reconciliation

The shared exporter consumes:

- `migration/poster-manifest.json` — canonical identity and Blob image identity.
- `migration/optimized-artifacts.json` — authoritative 58/116 artifact records, hashes, sizes, MIME types, versioned keys.
- All five batch state files — verified poster state, keys, hashes, sizes, timestamps.
- Existing `migration/r2-image-map.json` — used only to preserve the three canary entries.

Validation is fail-closed:

- Artifact manifest must be complete with zero failures and valid 58/116 inventory.
- Every batch state must have schema version 1 and the correct manifest hash.
- Every migrated poster must have exactly one `VERIFIED` state entry.
- Both objects must be uploaded.
- State keys, hashes, and sizes must match the artifact manifest.
- Exactly 58 migrated posters and 3 canaries are required.
- Duplicate posters, missing states, missing artifacts, non-verified states, hash/size mismatches, and excluded identities are rejected.
- Existing canary entries are preserved exactly; migrated entries are rebuilt from batch evidence.

The exporter writes deterministic output using the artifact manifest’s `generatedAt`, sorted map entries, and sorted allowlist identities.

## 4. Generated map and allowlist inventory

| Metric | Count |
|---|---:|
| Migrated posters | 58 |
| Canary posters | 3 |
| Total runtime map entries | 61 |
| Migrated original references | 58 |
| Migrated optimized references | 58 |
| Canary object references | 6 |
| Total object references | 122 |
| Allowlist identities | 61 |
| Medium-confidence identities | 0 |
| Duplicate identities | 0 |
| Duplicate keys | 0 |

- Map and allowlist coverage match exactly.
- Versioned original references: 58.
- Versioned optimized references: 58.
- `migration/r2-image-map.json`, `migration/r2-resolver-allowlist.json`, and `src/lib/r2-image-map.generated.ts` are internally consistent.

## 5. Canary preservation and exclusions

The three canary entries remain exact:

```
2001-a-space-odyssey
  original: cineprint/raindrop/1528361110.png
  optimized: cineprint/optimized/legacy/2001-a-space-odyssey.webp

bugonia
  original: cineprint/external/bugonia.jpg
  optimized: cineprint/optimized/external/bugonia.webp

artwork-1824607248
  original: cineprint/raindrop/1824607248.jpg
  optimized: cineprint/optimized/1824607248.webp
```

- Canary keys and `verifiedAt` values match `migration/migration-state.json`.
- The six canary object references remain present.
- `stranger-things-2` and `the-substance-2` are absent from the artifact manifest, runtime map, and allowlist.
- No canary entry was rewritten into the versioned convention.

## 6. Versioned key compatibility

- Generator accepts `cineprint/versions/original/` and `cineprint/versions/optimized/`.
- Legacy canary prefixes (`cineprint/raindrop/`, `cineprint/external/`, `cineprint/optimized/`) remain accepted.
- Unsupported prefixes, unsafe keys, malformed URLs, invalid SHA-256 values, invalid sizes, and missing metadata fail closed.
- Blob URL validation now permits a versioned original key to retain the pre-migration Blob image path, while legacy canary keys still require the exact Blob path match.
- The shared validation layer is used by both the exporter and generator.

## 7. Tests added and results

| Check | Result |
|---|---|
| New runtime-map tests | **14 passed** |
| Resolver/SEO/canary focused tests | **78 passed** |
| Migration tests | **22 files, 325 passed** |
| Full suite | **968 passed, 4 skipped, 1 failed** |

New coverage includes inventory reconciliation, missing batch state, non-verified state, duplicate poster, missing optimized artifact, hash/size mismatch, excluded identity, versioned key acceptance, unsafe/unsupported key rejection, map/allowlist coverage, deterministic output, canary preservation, no secrets/source URLs/local paths, and disabled activation flags.

Pre-existing full-suite failure remains: `tests/security/public-firebase-isolation.test.ts:44` (static `getAdminDb` import in `src/lib/notion.ts:8`).

## 8. Lint, type-check, and map-check results

| Check | Result |
|---|---|
| Scoped ESLint on new implementation files | **clean** |
| Scoped ESLint on modified legacy tests | 5 pre-existing `no-explicit-any` errors in `automation/r2-image-map.test.ts` |
| `tsc --noEmit` | **1 pre-existing error**, `src/routes/__root.tsx:148` |
| `npm run r2:map:check` | **pass** |
| `git diff --check` | **pass** |

The pre-existing Prettier and React hook warnings reported in Phase 11 remain unchanged.

## 9. Determinism verification

- Two consecutive `npm run r2:map:export` runs produced byte-identical `migration/r2-image-map.json` and `migration/r2-resolver-allowlist.json`.
- Two consecutive `npm run r2:map:generate` runs produced a byte-identical `src/lib/r2-image-map.generated.ts`.
- Hash checks before/after the second export/generate pass succeeded.
- Map `generatedAt` is derived from the artifact manifest, not the wall clock.

## 10. Remaining blockers and limitations

- Browser, download, and SEO production flags remain disabled.
- No preview or production browser/SEO end-to-end validation was performed.
- Runtime rollback/version-pointer switching is still not implemented.
- Vercel Blob remains an unreliable fallback while the store is blocked.
- The legacy exporter remains available only as a canary regression utility (`r2:map:export:legacy`); the production export path is versioned.
- The pre-existing public Firebase isolation test failure remains a production-readiness risk.
- No R2 uploads, deletions, overwrites, or external configuration changes were performed.

## 11. Production flag confirmation

- `R2_BROWSER_IMAGES_ENABLED = false`
- `R2_SEO_IMAGES_ENABLED = false`
- `R2_DOWNLOADS_ENABLED` remains disabled outside explicit preview/local conditions.
- No production activation, deployment, DNS, Cloudflare, Vercel, Firestore, Notion, Raindrop, or Blob change occurred.

## Preservation

- Branch remains `feat/r2-image-storage`.
- HEAD remains `ec5401ca82bb7d71f4679c60f2994cbc607177fe`.
- All five batch reports and state files remain unchanged.
- Canary objects and their evidence remain unchanged.
- Existing unrelated worktree changes remain intact.
- No secrets, credentials, or environment-file contents were inspected or printed.

**Phase 12A is complete. Production activation and deployment remain unauthorized.**
