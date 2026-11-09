# Phase 17 — Stabilization Report

Date: 2026-11-09  
Worktree: `/tmp/opencode/wt-r2-image-storage`  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`  
Production: `https://cineprint.click`  
Deployment: `dpl_GfG6Z1YsQsx41kFHuqs481JzkcY5`

## 1. Executive summary

**PASS — production remains stable, activation state is preserved, and repeatable read-only health checks are in place.**

- Production still serves the Phase 16 activated deployment and `cineprint.click` alias.
- 72/72 production health checks passed: 63 home links, 155 R2 images, 0 Blob, 0 broken, 0 duplicate/failed image requests, 0 console errors.
- Browser delivery is enabled; SEO and downloads remain disabled.
- The production `poster-images` asset hash exactly matches the local deployed build asset, confirming the activation bundle.
- Activation changes remain uncommitted and are documented with file hashes, inventory, map counts, and deployment identity.
- No deployment, promotion, rollback, alias change, flag change, R2 mutation, external write, commit, or push occurred in Phase 17.

Workstream status:

| Workstream | Status |
|---|---|
| A — Establish exact activation state | **PASS** |
| B — Preserve activation changes | **PASS** |
| C — Repeatable production health checks | **PASS** |
| D — Monitoring baselines | **PASS** |
| E — Remaining risks | **PASS** (documented) |

## 2. Workstream A — Exact activation state

### Verified facts

- Branch `feat/r2-image-storage`, HEAD `ec5401ca82bb7d71f4679c60f2994cbc607177fe`.
- Production deployment `dpl_GfG6Z1YsQsx41kFHuqs481JzkcY5` is READY and owns `cineprint.click`.
- Runtime map: 61 entries, 61 allowlist identities, 122 unique R2 object references, 3 canaries, 2 intentionally unavailable identities.
- Browser flag: **true**.
- SEO flag: **false**.
- Download flag: **false** (env-gated; no preview/download env inlined).
- Production asset: `/assets/poster-images-DhY-btCC.js`.
- Production asset SHA-256: `51649dd47676a659d53371475bb318ab4c173b748532777143367af11749e9bb`.
- Local `.vercel/output/static/assets/poster-images-DhY-btCC.js` has the **same SHA-256**.
- Production browser checks: 63 links, 155 R2 images, 0 Blob, 0 broken, 0 duplicate/failed image requests, 0 console errors.

### Activation inventory

Source/default:
- `automation/migration/runtime-map.ts` — `DEFAULT_R2_BROWSER_IMAGES_ENABLED = true`.
- `src/lib/r2-image-activation.ts` — independent browser/SEO/download gates.

Generated/required:
- `src/lib/r2-image-map.generated.ts` — browser true, SEO false.
- `migration/r2-image-map.json` — 61 entries.
- `migration/r2-resolver-allowlist.json` — 61 identities.
- `src/lib/poster-availability.ts` — 2 unavailable identities.
- `public/poster-unavailable.svg` — local placeholder.

Browser integration:
- `src/lib/poster-images.ts` — R2-only candidates for mapped posters, unavailable handling, no Blob fallback.
- `src/components/PosterImage.tsx` — decode/status/timeout and local unavailable asset.

Tests updated for activation:
- `automation/migration/runtime-map.test.ts`
- `automation/r2-image-map.test.ts`
- `automation/poster-images.test.ts`
- `tests/runtime-preview.test.tsx`
- `tests/seo-sitemap-optimized.test.tsx`

### Local-only / environment behavior

- Production activation is compiled from the default constant; it is not an env-only toggle.
- The env override applies only for `VITE_VERCEL_ENV=preview/development`.
- No `VITE_R2_*` or `VITE_VERCEL_ENV` values are inlined in the production asset.
- SEO and downloads remain disabled independently.

### Deployment vs worktree

- **Verified:** production client asset hash equals the local deployed build asset hash.
- **Inference:** the deployed activation bundle was produced from this worktree’s activation state; no evidence of extra deployed app changes.
- **Not tested:** byte-for-byte comparison of every deployed HTML/server/function artifact against a fresh rebuild.
- **Not tested:** Git provenance. The deployment was created from a local prebuilt bundle; activation changes are uncommitted.
- **Reproducibility:** the current worktree is behaviorally sufficient to reproduce the activation. Exact byte reproduction requires the same build environment, `NITRO_PRESET=vercel`, and preserved sitemap/route-tree artifacts.

## 3. Workstream B — Preservation record

Created `migration/PHASE-17-ACTIVATION-PRESERVATION.md` with:

- Branch/HEAD and worktree counts.
- Tracked/untracked activation file inventory.
- Feature-flag states.
- SHA-256 hashes for critical generated and source artifacts.
- 61/61/122 map counts and canary/unavailable identity counts.
- Deployment ID/URL/alias and creation timestamp.
- Production-vs-worktree asset hash match.
- Reproducibility assessment and uncommitted-deployment caveat.

No activation code was modified in Phase 17. No commit, push, stash, or file overwrite occurred.

## 4. Workstream C — Repeatable production health checks

Created:

- `automation/monitoring/production-health.ts` — pure evaluation/flag-parsing logic.
- `automation/monitoring/production-health.test.ts` — 6 focused tests.
- `scripts/production-health-check.ts` — read-only CLI wrapper.
- `package.json` script `health:production`.

The check reuses `scripts/browser-r2-routes.mjs` and adds:

- 63-link/home coverage.
- Both unavailable identities.
- Mapped detail and category checks.
- R2 vs Blob counts.
- Broken/duplicate/failed image checks.
- Console/exception checks.
- Production asset env-inlining checks.
- Mapped-detail SEO isolation check.

It writes machine-readable JSON under `/tmp/opencode/phase17-health/` and exits non-zero on critical failure. It does not authenticate, mutate, upload, or schedule anything.

## 5. Workstream D — Monitoring baseline

Baseline run: **2026-11-09T13:52:20.340Z**

| Metric | Result |
|---|---|
| Health checks | **72 passed, 0 failed, 0 warnings** |
| Deployment | `dpl_GfG6Z1YsQsx41kFHuqs481JzkcY5` |
| Alias | `cineprint.click` |
| Browser flag | true |
| SEO flag | false |
| Download flag | false |
| Home desktop | 63 links; 155 R2; 0 Blob; 0 broken; 124 decoded / 31 lazy pending |
| Home mobile | 63 links; 155 R2; 0 Blob; 0 broken; 155 decoded |
| Mapped detail | R2 optimized; 0 Blob; 0 broken |
| Unavailable `the-substance-2` | Placeholder; 0 Blob; 0 broken |
| Unavailable `stranger-things-2` | Placeholder; 0 Blob; 0 broken |
| Genres | 10 R2; 0 Blob; 0 broken |
| Console errors / exceptions | 0 / 0 |
| Duplicate image requests | 0 |
| Failed image requests | 0 |

Repeat commands and comparison procedure are documented in `migration/PHASE-17-PRODUCTION-HEALTH-CHECKS.md`:

```bash
cd /tmp/opencode/wt-r2-image-storage
npm run health:production
```

Recommended repeat points: ~1 hour, ~6 hours, ~24 hours. No scheduled job or external monitoring service was created.

## 6. Workstream E — Remaining risks

1. **SEO/OG/sitemap images still use inaccessible Blob URLs.** SEO remains disabled and is not ready.
2. **Download delivery remains disabled.**
3. **800px optimized detail assets** are upscaled ~1.28× on 375px DPR-3; zoom uses originals.
4. **Pre-existing TypeScript error** at `src/routes/__root.tsx:148`.
5. **Pre-existing ESLint hook warnings** in the R2 scope.
6. **CSRF middleware warning** in TanStack Start remains.
7. **CLS concerns** from font/footer reflow remain.
8. **Phase 16 monitoring was short** (two passes, ~4 minutes); Phase 17 baseline is a single read-only run. Long-term 1h/6h/24h checks are still required.
9. **Activation remains uncommitted.** The deployment came from a local prebuilt bundle; future Git-based deployments will not include it until committed under separate authorization.
10. **Previous deployment is not route-compatible.** Do not use `dpl_6NRu…` for rollback; use `dpl_GsLqJduvaWPtPy1zbkHzeUgYEqzC`.
11. No new production behavior regression was discovered in this phase.

## 7. Final validation

| Check | Result |
|---|---|
| Full suite | **999 passed, 0 failed** |
| Production health check | **72/72 passed** |
| `r2:map:check` | **pass** |
| Focused monitoring tests | **6 passed** |
| TypeScript | 1 pre-existing error at `src/routes/__root.tsx:148` |
| Scoped ESLint — new monitoring files | **0 errors** |
| `git diff --check` | **pass** |
| Activation changes altered in Phase 17 | **No** |
| SEO flag enabled | **No** |
| Download flag enabled | **No** |
| Production writes | **None** |
| Deployment/alias change | **None** |
| Git commit/push | **None** |

## 8. Files created/modified in Phase 17

**Created**

- `migration/PHASE-17-STABILIZATION-REPORT.md`
- `migration/PHASE-17-ACTIVATION-PRESERVATION.md`
- `migration/PHASE-17-PRODUCTION-HEALTH-CHECKS.md`
- `automation/monitoring/production-health.ts`
- `automation/monitoring/production-health.test.ts`
- `scripts/production-health-check.ts`

**Modified**

- `package.json` — added `health:production`.

No activation source, generated map, feature flag, or production configuration was changed.

## 9. Final status

**PASS.** Production is stable, the activation state is preserved and hashed, the production asset matches the local deployed build, and repeatable read-only health checks are available. The current uncommitted worktree faithfully represents the deployed browser-image activation behavior, with the documented caveat that the deployment is local-prebuilt and uncommitted.

No deployment, promotion, rollback, alias change, production flag change, R2 mutation, external write, commit, or push occurred in Phase 17.
