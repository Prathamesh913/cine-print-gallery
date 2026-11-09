# Phase 19 — Merge Checklist

Date: 2026-11-09  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`  
Target: `main`

## Pre-merge verification (completed)

- [x] Full suite: **1004 passed, 0 failed**
- [x] Focused SEO tests: **12 passed**
- [x] Phase 12C browser harness: **47/47**
- [x] Route harness: **42/42**
- [x] Production health: **73/73**
- [x] Built-preview SEO health (`EXPECT_SEO=r2`): **73/73**
- [x] `r2:map:check`: pass
- [x] Vercel-target build: pass
- [x] Browser true / SEO true / downloads false
- [x] Sitemap: 61 R2 + 2 placeholder, 0 Blob
- [x] 61 mapped / 2 unavailable / 63 total; 122 unique R2 references
- [x] No secrets or environment files staged/untracked
- [x] `git diff --check`: pass

Known pre-existing issues (accepted, not fixed):
- TypeScript error `src/routes/__root.tsx:148`.
- ESLint hook warnings in `PosterImage.tsx`.
- TanStack Start CSRF warning.
- CLS from font/footer reflow.

## Files to include

- `automation/migration/` — migration engine, exporter, runtime map, tests.
- `automation/identity/` — identity tooling/tests.
- `automation/monitoring/` — production health evaluation/tests.
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
- `public/sitemap-posters.xml`
- `scripts/` migration, preview, browser, and health scripts
- `migration/r2-image-map.json`
- `migration/r2-resolver-allowlist.json`
- `migration/poster-manifest.json`
- `migration/optimized-artifacts.json`
- `migration/state/phase10a–10e-*.json`
- `migration/PHASE-*.md` reports/runbooks
- `tests/` and `automation/*.test.ts`
- `package.json`, `package-lock.json`, `.gitignore`

## Files to exclude

- [x] `migration/cache/` — ignored; 116 large local images.
- [x] `migration/audit/` — ignored; 11 raw JSONL run logs (duplicate pairs, non-sensitive, summarized elsewhere).
- [x] `.env`, `.env.local`, `.env.vercel`, `.env.production` — ignored secrets.
- [x] `.vercel/`, `.output/`, `dist/`, `.wrangler/` — ignored build/deployment output.
- [x] `firebase-admin-key.json` — ignored secret.

Do not use `git add -A` without reviewing the untracked list.

## Commands before commit

```bash
cd /tmp/opencode/wt-r2-image-storage
npx vitest run --config automation/identity/vitest.config.ts
npx vitest run --config automation/identity/vitest.config.ts tests/seo-sitemap-optimized.test.tsx
npm run r2:map:check
npx tsc --noEmit
npx eslint automation/monitoring/production-health.ts scripts/production-health-check.ts src/lib/seo.ts src/lib/sitemap.ts src/lib/structured-data.ts src/lib/poster-images.ts src/components/PosterImage.tsx tests/seo-sitemap-optimized.test.tsx
git diff --check
NITRO_PRESET=vercel npm run build
```

Expected build:

- 61-entry map
- browser true, SEO true, downloads false
- sitemap 61 R2 + 2 placeholder, 0 Blob
- `.vercel/output/static/poster-unavailable.svg` present

## Commit and merge (requires approval)

- [ ] Commit reviewed changes with a migration/SEO message.
- [ ] Push the branch.
- [ ] Open/merge PR into `main`.
- [ ] Do not merge with `migration/cache/` or `migration/audit/` staged.
- [ ] Confirm `.env.example` remains tracked and env files are not staged.

## Production deployment (separate approval)

1. Deploy the SEO-enabled branch/build.
2. Ensure sitemap regeneration and deployment.
3. Confirm browser true / SEO true / downloads false.
4. Verify OG/Twitter/JSON-LD/sitemap use R2, 0 Blob.
5. Run:

```bash
EXPECT_SEO=r2 npm run health:production
```

6. Monitor against the runbook thresholds.

## Rollback

- Current route-compatible target: `dpl_GsLqJduvaWPtPy1zbkHzeUgYEqzC`.
- Do not use `dpl_6NRuPPnZdbeXFFktUQpuB4B6Zafg` (missing `/genres`).
- Do not use Blob as a recovery path.
- Actual rollback requires separate authorization and verification.

## Approval actions

1. Approve commit.
2. Approve push/PR/merge.
3. Approve SEO production deployment.
4. Approve post-deploy production health run.
5. Decide audit-log retention (currently excluded).
