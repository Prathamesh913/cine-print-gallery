# Phase 17 — Activation Preservation Record

Date: 2026-11-09  
Purpose: preserve the exact browser-image activation state without committing, pushing, stashing, or changing production.

## Repository state

| Item | Value |
|---|---|
| Branch | `feat/r2-image-storage` |
| HEAD | `ec5401ca82bb7d71f4679c60f2994cbc607177fe` |
| Tracked modified files | 24 |
| Untracked files | 254 (includes the migration tree) |
| Production deployment | `dpl_GfG6Z1YsQsx41kFHuqs481JzkcY5` |
| Deployment URL | `cine-print-gallery-3ewpytu75-prathameshjadhav913-8679s-projects.vercel.app` |
| Production alias | `cineprint.click` |
| Deployment created | 2026-11-09T13:20:27.245Z |
| Route-compatible rollback target | `dpl_GsLqJduvaWPtPy1zbkHzeUgYEqzC` |

No commit, push, stash, checkout, reset, clean, or restore was performed.

## Activation file inventory

### Source changes that enable browser delivery

| File | Role | State |
|---|---|---|
| `automation/migration/runtime-map.ts` | Holds `DEFAULT_R2_BROWSER_IMAGES_ENABLED = true` and map/allowlist validation | Untracked |
| `src/lib/r2-image-map.generated.ts` | Generated runtime map with browser true, SEO false | Untracked |
| `migration/r2-image-map.json` | 61-entry source map | Untracked |
| `migration/r2-resolver-allowlist.json` | 61-identity allowlist | Untracked |
| `src/lib/poster-availability.ts` | Explicit unavailable set for the 2 unresolved identities | Untracked |
| `public/poster-unavailable.svg` | Local accessible unavailable asset | Untracked |
| `src/lib/poster-images.ts` | R2-only candidates for mapped posters, unavailable handling, no Blob fallback | Tracked modified |
| `src/components/PosterImage.tsx` | Status/decode/timeout handling and local unavailable asset | Tracked modified |
| `src/lib/r2-image-activation.ts` | Browser/SEO/download activation gates | Untracked |

### Activation-related test updates

| File | State |
|---|---|
| `automation/migration/runtime-map.test.ts` | Untracked |
| `automation/r2-image-map.test.ts` | Untracked |
| `automation/poster-images.test.ts` | Tracked modified |
| `tests/runtime-preview.test.tsx` | Untracked |
| `tests/seo-sitemap-optimized.test.tsx` | Tracked modified |

These tests now assert browser delivery enabled while SEO/download remain disabled, and preserve unavailable-identity behavior.

### Phase 17 monitoring tooling (not part of the production bundle)

- `automation/monitoring/production-health.ts`
- `automation/monitoring/production-health.test.ts`
- `scripts/production-health-check.ts`
- `package.json` script `health:production`

## Feature-flag state

| Flag | Local generated map | Production asset |
|---|---|---|
| `R2_BROWSER_IMAGES_ENABLED` | **true** | **true** |
| `R2_SEO_IMAGES_ENABLED` | **false** | **false** |
| `R2_DOWNLOADS_ENABLED` | **false** | **false** (env-gated; no preview/download env inlined) |

Production `poster-images-*.js` activation snippet contains browser true, SEO false, and the env-gated download expression. No `VITE_R2_*` or `VITE_VERCEL_ENV` values are inlined in the production asset.

## Generated artifact hashes

| Artifact | SHA-256 |
|---|---|
| `src/lib/r2-image-map.generated.ts` | `ad55ebe18e7b4e965af2e6f87cc74531d284e184df4902084ffd79caa2ac24f8` |
| `migration/r2-image-map.json` | `edb7459be7b2f26e858783af2e089b5b486463e11a212aeeacef40d89b474357` |
| `migration/r2-resolver-allowlist.json` | `fc23a5e615f6eb4cd8217abdec843d26b19c056b69f859c9d3635a8a2dc5f50f` |
| `automation/migration/runtime-map.ts` | `94f8b2517d85edfc7683455ed68c479f4894333507bdf1f958e5aca6c49f7ff7` |
| `src/lib/poster-availability.ts` | `4c7518365c198329139a0fe80e7e75eab12d35a18ae0f3fd5c50852cd5d92aae` |
| `public/poster-unavailable.svg` | `0f650e4ea2787e80d52442c37c1d6160e6527226173f902f3f15dbcecef6b6d9` |
| `src/lib/poster-images.ts` | `ade9343954b5cbb3e3d4523a8e3a67a11c68196a4c381fb461d6fa3902b6f18d` |
| `src/components/PosterImage.tsx` | `ed53cb48b165c9b9fcf7ecc127c82164380bbbb3c71394f8668d3594242d13e5` |
| `migration/PHASE-16-PRODUCTION-CUTOVER-REPORT.md` | `9dc58cc244dbabd7d98d71573d747e53597eef124358495a58e2a6075ad3cba9` |
| `migration/BROWSER-DELIVERY-CUTOVER-RUNBOOK.md` | `48bef9e9749a06b0522d947057a38a00edd87800a1d91f20c18f0b917db44ed9` |

## Map identity and reference counts

| Metric | Value |
|---|---:|
| Runtime map entries | 61 |
| Allowlist identities | 61 |
| Unique R2 object references | 122 |
| Versioned originals | 58 |
| Versioned optimized | 58 |
| Canary entries | 3 |
| Intentionally unavailable identities | 2 |
| Duplicate identities/keys | 0 |
| Excluded identities in map | 0 |

The two unavailable identities are `stranger-things-2` and `the-substance-2`; they remain catalogue entries with the local placeholder, not map entries.

## Deployment vs worktree fidelity

**Verified:**

- Production `poster-images-DhY-btCC.js` SHA-256 is `51649dd47676a659d53371475bb318ab4c173b748532777143367af11749e9bb`.
- Local `.vercel/output/static/assets/poster-images-DhY-btCC.js` has the **same SHA-256**.
- Production activation flags match the local generated map: browser true, SEO false, downloads false.
- Production browser checks confirm 61 mapped R2 posters and 2 unavailable placeholders, with zero Blob requests.

**Inference:**

- The deployed activation bundle was produced from this worktree’s activation state. No evidence of extra deployed app changes was found.

**Not tested:**

- A byte-for-byte comparison of every deployed HTML/server/function artifact against a fresh rebuild.
- Git provenance: the deployment was created from a local prebuilt bundle, not a Git commit. The worktree activation changes remain uncommitted.

**Reproducibility:**

- The current uncommitted worktree is **behaviorally sufficient** to reproduce the deployed browser-image behavior: browser default true, generated map 61/122, unavailable set, placeholder, SEO/download false.
- Exact byte reproduction requires the same build environment, `NITRO_PRESET=vercel`, and the preserved sitemap/route-tree artifacts.
- A future Git-based deployment will not include the activation until the changes are committed under separate authorization.

## Preservation conclusion

**PASS.** The activation state is documented, hashed, and locally reproducible. Production matches the local activation asset hash. The principal preservation risk is that the activation remains uncommitted and the deployment was created from local prebuilt output.
