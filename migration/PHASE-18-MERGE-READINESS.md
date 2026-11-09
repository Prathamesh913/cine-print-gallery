# Phase 18 — Merge Readiness

Date: 2026-11-09  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`  
Target: `main` (no merge performed)

## 1. Status

**PASS WITH BLOCKERS — implementation is merge-ready for review; commit/push/merge and production SEO activation require separate authorization.**

The branch now contains a coherent R2 implementation:

- R2 storage migration tooling and evidence.
- Browser R2 delivery (Phase 16 activation preserved).
- SEO/OG/Twitter/JSON-LD/sitemap R2 delivery (Phase 18).
- Local unavailable placeholder for the 2 unresolved identities.
- Monitoring, browser harnesses, health checks, and reports.
- Downloads remain disabled.

## 2. Branch inventory

| Item | Value |
|---|---:|
| Tracked modified files | 25 |
| Untracked files (excluding ignored cache) | 143 |
| Runtime map entries | 61 |
| Allowlist identities | 61 |
| Unique R2 object references | 122 |
| Canaries | 3 |
| Intentionally unavailable | 2 |
| Browser flag | true |
| SEO flag | true |
| Download flag | false |
| Phase 16 production deployment | `dpl_GfG6Z1YsQsx41kFHuqs481JzkcY5` |

Tracked diff summary: **25 files changed, 1648 insertions, 508 deletions**.

## 3. Activation and SEO changes preserved

| Area | Evidence |
|---|---|
| Browser activation | `DEFAULT_R2_BROWSER_IMAGES_ENABLED = true`; generated map browser true |
| SEO activation | `DEFAULT_R2_SEO_IMAGES_ENABLED = true`; generated map SEO true |
| Downloads | `R2_DOWNLOADS_ENABLED` remains false |
| Map | 61 entries / 122 unique keys |
| Unavailable identities | `stranger-things-2`, `the-substance-2`; local SVG |
| Sitemap | 63 `<loc>`; 61 R2 + 2 placeholder; 0 Blob |
| Phase 16 production | Still `dpl_GfG6…`; no deployment/alias change in Phase 18 |

## 4. Files to include in the merge

### Source and generated runtime
- `automation/migration/` (49 files) — exporter, engine, versioning, tests, runtime map.
- `automation/identity/` (7 files) — identity planner/backfill tests.
- `automation/monitoring/` (2 files) — production health evaluation/tests.
- `src/lib/r2-image-map.generated.ts`
- `src/lib/r2-image-activation.ts`
- `src/lib/poster-availability.ts`
- `src/lib/poster-images.ts`
- `src/lib/download-image.ts`
- `src/lib/image-data-url.ts`
- `src/lib/image-load-state.ts`
- `src/components/PosterImage.tsx`
- `src/components/PosterImageFrame.tsx`
- `public/poster-unavailable.svg`

### Scripts and package tooling
- `scripts/export-r2-verified-mappings.ts`
- `scripts/export-versioned-r2-map.ts`
- `scripts/generate-r2-image-map.ts`
- `scripts/plan-identity-backfill.ts`
- `scripts/plan-versioned-migration.ts`
- `scripts/preflight-versioned-migration.ts`
- `scripts/poster-identity.js` / `.d.ts`
- `scripts/preview-r2-app.tsx`
- `scripts/preview-r2-client.tsx`
- `scripts/preview-r2-runtime.tsx`
- `scripts/browser-r2-preview.mjs`
- `scripts/browser-r2-routes.mjs`
- `scripts/production-health-check.ts`
- `package.json`, `package-lock.json`

### Migration evidence and reports
- `migration/r2-image-map.json`
- `migration/r2-resolver-allowlist.json`
- `migration/poster-manifest.json`
- `migration/optimized-artifacts.json`
- `migration/state/phase10a–10e-*.json`
- `migration/PHASE-*.md` reports and runbooks
- `migration/README.md`, `migration/RECOVERY-RUNBOOK.md`
- Phase 18 reports

### Tests
- `automation/migration/*.test.ts`
- `automation/identity/*.test.ts`
- `automation/r2-image-map.test.ts`
- `automation/poster-images.test.ts`
- `automation/image-load-state.test.ts`
- `automation/download-image.test.ts`
- `automation/monitoring/production-health.test.ts`
- `tests/runtime-preview.test.tsx`
- `tests/rollback-simulation.test.ts`
- `tests/seo-sitemap-optimized.test.tsx`

### Generated public artifact
- `public/sitemap-posters.xml` — 63 image URLs (61 R2 + 2 placeholder).

## 5. Files to exclude / review

| Item | Disposition |
|---|---|
| `migration/cache/` (116 large source/optimized images) | **Ignored** via `.gitignore`; do not commit |
| `.env`, `.env.local`, `.env.vercel` | Ignored; never commit |
| `.vercel/`, `.output/`, `dist/`, `.wrangler/` | Ignored build/deployment output |
| `migration/audit/*.jsonl` (11 files, ~1.5 MB) | Optional raw audit logs; exclude unless audit retention is required |
| `firebase-admin-key.json` | Ignored secret; never commit |
| `src/routeTree.gen.ts` | Generated route tree, already tracked/modified; include if route generation is part of the existing diff |
| `package-lock.json` | Review the `@aws-sdk/client-s3` dependency and lockfile changes before commit |

Secret scan: no secret-like untracked files were found. `.env.example` remains tracked and is **not** ignored. The over-broad `.env*` ignore added by Vercel CLI was removed; only `migration/cache/` was added.

## 6. Merge checklist

1. Review the tracked diff and untracked inventory; do not use `git add -A` blindly.
2. Confirm `migration/cache/` remains ignored and `migration/audit/` is intentionally included or excluded.
3. Confirm `.env.example` is tracked and no env/secret file is staged.
4. Confirm `package-lock.json` matches the intended `@aws-sdk/client-s3` dependency.
5. Run:
   - `npm test` / full Vitest suite
   - `npm run r2:map:check`
   - `npx tsc --noEmit`
   - scoped ESLint
   - `git diff --check`
   - `NITRO_PRESET=vercel npm run build`
6. Verify build output:
   - 61-entry map
   - browser true, SEO true, downloads false
   - sitemap 61 R2 + 2 placeholder, 0 Blob
   - `poster-unavailable.svg` present
7. Commit the reviewed changes (requires separate authorization).
8. Push and open/merge the PR (requires separate authorization).
9. Deploy SEO separately (requires separate production authorization); do not deploy the branch as browser-only.
10. After SEO deployment, run:
    `EXPECT_SEO=r2 npm run health:production`
11. Verify production OG/Twitter/JSON-LD/sitemap and no Blob.

## 7. Blockers requiring separate authorization

1. **No commit/push/merge authorization.** The branch is uncommitted; the Phase 16 production deployment was created from a local prebuilt bundle, not a Git commit.
2. **Production SEO is not deployed/activated.** Production remains Phase 16 browser-only; its sitemap still has 63 Blob image URLs.
3. **External social validators not tested.** No authenticated Facebook/Twitter validator checks were performed.
4. **Built-preview `EXPECT_SEO=r2` browser health check not completed** due the generated preview server’s static-root behavior; unit tests cover the evaluation logic.
5. **Pre-existing issues remain:** TypeScript `src/routes/__root.tsx:148`, hook warnings, CSRF warning, CLS concerns.
6. **Raw audit logs** require an explicit include/exclude decision.
7. **800px detail assets** remain a quality limitation.

## 8. Final merge-readiness status

**PASS WITH BLOCKERS.** The branch is implementation-complete and locally validated for review. It preserves Phase 16 browser activation, adds Phase 18 SEO R2 delivery, keeps downloads disabled, and has no production changes beyond the already-authorized Phase 16 deployment. Commit, push, merge, and production SEO activation remain separately authorized.
