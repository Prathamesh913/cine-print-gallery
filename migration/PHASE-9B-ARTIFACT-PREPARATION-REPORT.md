# Phase 9B — Canonical Source Acquisition & Local Artifact Preparation Report

Date: 2026-11-08  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`

## Verdict

**COMPLETE for local artifact preparation.** All 58 eligible sources were acquired, hash-verified, optimized locally, and persisted with deterministic metadata and versioned keys.

No uploads or R2 operations were performed. A new read-only live pre-flight is still required because the optimized keys changed from source-hash keys to optimized-output-hash keys.

## Acquisition and verification

| Metric | Count |
|---|---:|
| Eligible high-confidence posters | 58 |
| Sources downloaded successfully | 58 |
| Source download failures | 0 |
| Source SHA-256 matches | 58/58 |
| Source files persisted | 58 |
| Optimized artifacts generated | 58 |
| Optimized SHA-256 values produced | 58/58 |
| Total artifacts | 116 |
| Unique final R2 keys | 116 |
| Artifact validation errors | 0 |
| Local file verification errors | 0 |

- Source providers: Raindrop and `pbs.twimg.com` only.
- Every source matched the manifest SHA-256 exactly.
- Every optimized output was generated with the existing `MigrationOptimizer` settings: WebP, width 800, quality 80, `withoutEnlargement`, EXIF rotation.
- Optimizer identity: `sharp 0.35.3`, `libvips 8.18.3`.
- Source files: `migration/cache/sources/<posterId>.<ext>`
- Optimized files: `migration/cache/optimized/<posterId>.webp`
- Cache size: approximately 148 MB.
- Source acquisition used the existing SSRF-safe downloader. DNS now prefers a validated public IPv4 address when IPv6 is returned first; all DNS answers are still validated.

## Artifact manifest

- Manifest: `migration/optimized-artifacts.json`
- First-batch plan: `migration/first-batch-plan.json`
- Manifest schema: version 1, 58 posters, 116 artifacts, 0 failures.
- Original keys use the full source SHA-256.
- Optimized keys use the full SHA-256 of the actual optimized output bytes.
- Every artifact includes poster ID, role, source SHA-256, artifact SHA-256, size, dimensions, MIME type, optimizer/transformation metadata where applicable, local path, and final R2 key.
- No canary or medium-confidence poster is included.

## Determinism

Re-optimizing all 58 locally stored sources with the same settings produced:

- 58/58 matching optimized SHA-256 values;
- 58/58 matching optimized byte sizes and dimensions;
- 58/58 matching optimized R2 keys;
- zero mismatches.

Focused tests also confirm that changed optimized bytes produce a different optimized key.

## Final key validation

- 58 original keys use the source SHA-256.
- 58 optimized keys use the optimized SHA-256.
- 0 optimized keys use the source hash.
- 116/116 keys are unique.
- No canary keys.
- No medium-confidence identities.
- All artifact files verify against their recorded hashes, sizes, dimensions and formats.

## First five-poster / ten-object batch plan

| Poster | Role | Expected SHA-256 | Size | R2 key |
|---|---|---|---:|---|
| art-of-a-hit-2024 | original | `ba2c8b80c4ca5eba8a2008b9c9391f1a59b5dc13c9f623cee1f6aab487fe995d` | 2,950,361 | `cineprint/versions/original/art-of-a-hit-2024/ba2c8b80c4ca5eba8a2008b9c9391f1a59b5dc13c9f623cee1f6aab487fe995d.png` |
| art-of-a-hit-2024 | optimized | `a0e5547368ecefca5a22bfcaa923920d88dd0e37458bcad2c5d8feda023c535e` | 116,278 | `cineprint/versions/optimized/art-of-a-hit-2024/a0e5547368ecefca5a22bfcaa923920d88dd0e37458bcad2c5d8feda023c535e-sharp-0.35.3-libvips-8.18.3-w800-q80.webp` |
| artwork-1812274995 | original | `d0e491e359636fc8f1b0d88ef4f43be32696830f1705307236c91c8eab516327` | 3,251,321 | `cineprint/versions/original/artwork-1812274995/d0e491e359636fc8f1b0d88ef4f43be32696830f1705307236c91c8eab516327.png` |
| artwork-1812274995 | optimized | `27d085597b93b9e964762e9a4c3f12d5516fd29dcae0be9b2e41c2ba7fe0d0ca` | 86,718 | `cineprint/versions/optimized/artwork-1812274995/27d085597b93b9e964762e9a4c3f12d5516fd29dcae0be9b2e41c2ba7fe0d0ca-sharp-0.35.3-libvips-8.18.3-w800-q80.webp` |
| artwork-1813721087 | original | `b7ee3bdf400d251fd23e25f7a195d9e5fa3b629769b09c11574f7de38b8304cc` | 225,616 | `cineprint/versions/original/artwork-1813721087/b7ee3bdf400d251fd23e25f7a195d9e5fa3b629769b09c11574f7de38b8304cc.jpg` |
| artwork-1813721087 | optimized | `a0ea2b38f7578268f3f9942a21a87c99fc4642843910b9d01e2a8b0fb60392d6` | 60,452 | `cineprint/versions/optimized/artwork-1813721087/a0ea2b38f7578268f3f9942a21a87c99fc4642843910b9d01e2a8b0fb60392d6-sharp-0.35.3-libvips-8.18.3-w800-q80.webp` |
| artwork-1824628665 | original | `c575086a2ddee8ab05a3096168a4750efbd0a88379a85797e692a23b5a8e9eeb` | 1,414,161 | `cineprint/versions/original/artwork-1824628665/c575086a2ddee8ab05a3096168a4750efbd0a88379a85797e692a23b5a8e9eeb.jpg` |
| artwork-1824628665 | optimized | `e2df9cedf9f604c927daefdce565c409ebef39b00138d679807a25ab2380259e` | 119,172 | `cineprint/versions/optimized/artwork-1824628665/e2df9cedf9f604c927daefdce565c409ebef39b00138d679807a25ab2380259e-sharp-0.35.3-libvips-8.18.3-w800-q80.webp` |
| artwork-1824637521 | original | `635fecc53a405f7280db859dac164bf5e7838e2e186a02bc1e435b3d5f8fe1af` | 1,905,871 | `cineprint/versions/original/artwork-1824637521/635fecc53a405f7280db859dac164bf5e7838e2e186a02bc1e435b3d5f8fe1af.jpg` |
| artwork-1824637521 | optimized | `1ee2d695fcc80ae87bbe1333a010fe533e6618e682f4e03b81ccaf4185f1fb58` | 279,194 | `cineprint/versions/optimized/artwork-1824637521/1ee2d695fcc80ae87bbe1333a010fe533e6618e682f4e03b81ccaf4185f1fb58-sharp-0.35.3-libvips-8.18.3-w800-q80.webp` |

Local paths are recorded in `migration/first-batch-plan.json`.

## Test and validation results

| Check | Result |
|---|---|
| Migration tests | **21 files, 311 tests passed** |
| Identity + migration tests | **26 files, 393 tests passed** |
| Full suite | **954 passed, 4 skipped, 1 failed** |
| Scoped ESLint | **clean** |
| `tsc --noEmit` | **1 pre-existing error**, `src/routes/__root.tsx:148` |
| `git diff --check` | **pass** |
| `npm run r2:map:check` | **pass** |

Pre-existing failure: `tests/security/public-firebase-isolation.test.ts:44`, caused by the static `getAdminDb` import in `src/lib/notion.ts:8`.

Focused artifact tests cover manifest validation, missing metadata, duplicate keys, source/optimized key separation, deterministic optimization, changed-output key changes, file verification, and the five-poster/ten-object plan.

## Blockers / next step

- **A new live read-only pre-flight is required.** Phase 9A checked the old optimized keys based on source hashes. The 58 optimized keys now use optimized-output hashes and have not been checked against R2.
- Original keys are unchanged and remain covered by the Phase 9A absence inventory.
- The local source/artifact cache is approximately 148 MB and must be retained until migration is complete.
- No upload or migration was executed.

## Files changed

Added:

- `automation/migration/artifacts.ts`
- `automation/migration/artifacts.test.ts`
- `migration/optimized-artifacts.json`
- `migration/first-batch-plan.json`
- `migration/cache/sources/*` (58 verified sources)
- `migration/cache/optimized/*` (58 WebP outputs)
- `migration/PHASE-9B-ARTIFACT-PREPARATION-REPORT.md`

Modified:

- `automation/migration/versioning.ts` — optimized keys/IDs use optimized SHA-256; planner requires artifact metadata.
- `automation/migration/versioning.test.ts` — artifact-aware planner fixtures.
- `automation/migration/preflight.ts` — optimized expectations use optimized hash/size.
- `automation/migration/preflight.test.ts` — optimized key expectations.
- `automation/migration/source.ts` — prefer validated public IPv4 when DNS returns IPv6 first.
- `automation/migration/source.test.ts` — IPv4 preference test.
- `scripts/plan-versioned-migration.ts` — load and validate artifact manifest.
- `scripts/preflight-versioned-migration.ts` — load and validate artifact manifest.
- `migration/README.md` — clarify source-hash vs optimized-output-hash key convention.

## Safety confirmation

- Only authorized HTTP GETs to the 58 canonical Raindrop/pbs sources occurred.
- No R2 HEAD/GET/PUT/delete, bucket listing, or upload.
- No Blob, Firestore, Notion, Vercel, Cloudflare, DNS change, deployment, or activation.
- No Raindrop mutation.
- No secrets were printed or inspected.
- No canonical identity, canary object, allowlist, generated runtime map, migration state, or production flag was changed.
- Branch/HEAD unchanged: `feat/r2-image-storage` / `ec5401ca82bb7d71f4679c60f2994cbc607177fe`.
- Git status remains 37 lines (19 modified, 18 untracked); existing work preserved.
- State/map/allowlist/generated-map hashes unchanged.
