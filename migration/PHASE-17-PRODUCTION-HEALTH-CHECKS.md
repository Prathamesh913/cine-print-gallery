# Phase 17 — Production Health Checks

Date: 2026-11-09  
Target: `https://cineprint.click`  
Mode: read-only production checks; no writes, deployments, alias changes, or R2 mutations.

## Tooling

The repeatable check reuses the existing Phase 13/14 route harness and adds activation/SEO isolation checks:

```bash
cd /tmp/opencode/wt-r2-image-storage
npm run health:production
```

What it does:

1. Runs `scripts/browser-r2-routes.mjs` against `https://cineprint.click` at desktop and mobile.
2. Fetches production home and mapped-detail HTML plus the hashed `poster-images-*.js` asset.
3. Verifies routes, R2 delivery, unavailable placeholders, no Blob/broken/duplicate/failed images, console health, and activation flags.
4. Writes machine-readable JSON to `/tmp/opencode/phase17-health/health-<timestamp>.json` and `health-latest.json`.
5. Prints a concise summary and exits non-zero on critical failure.

Related commands:

```bash
# Route-only harness (42 checks)
ROUTES_BASE_URL=https://cineprint.click node scripts/browser-r2-routes.mjs

# Route HTTP availability
for p in / /genres /poster/backrooms-3 /poster/the-substance-2 /poster/stranger-things-2; do
  curl -sS -o /dev/null -w "$p %{http_code}\n" "https://cineprint.click$p"
done
```

The health check writes only local artifacts and screenshots. It does not authenticate, mutate, upload, or schedule anything.

## Baseline: 2026-11-09T13:52:20.340Z

| Item | Value |
|---|---|
| Health checks | **72 passed, 0 failed, 0 warnings** |
| Deployment ID | `dpl_GfG6Z1YsQsx41kFHuqs481JzkcY5` |
| Production alias | `cineprint.click` |
| Asset | `/assets/poster-images-DhY-btCC.js` |
| Asset SHA-256 | `51649dd47676a659d53371475bb318ab4c173b748532777143367af11749e9bb` |
| Browser flag | **true** |
| SEO flag | **false** |
| Download flag | **false** |

Route/image baseline:

| Route / viewport | Result |
|---|---|
| Home desktop | 63 links; 155 R2 images; 0 Blob; 0 broken; 124 decoded, 31 lazy pending; 0 failures |
| Home mobile | 63 links; 155 R2 images; 0 Blob; 0 broken; 155 decoded; 0 failures |
| Mapped detail desktop/mobile | R2 optimized; 0 Blob; 0 broken; decode 0 failures |
| Unavailable `the-substance-2` | Placeholder; 0 Blob; 0 broken |
| Unavailable `stranger-things-2` | Placeholder; 0 Blob; 0 broken |
| Genres desktop/mobile | 10 R2 images; 0 Blob; 0 broken |
| Console errors / exceptions | 0 / 0 |
| Duplicate image requests | 0 |
| Failed image requests | 0 |
| Unexpected image hosts | None (local placeholder host is `cineprint.click`) |

Production activation checks:

- Browser R2 delivery active (home has R2 images; 61 mapped identities).
- SEO remains off R2: mapped-detail `og:image` is still Blob-hosted.
- No `VITE_R2_*` or `VITE_VERCEL_ENV` values are inlined in the production asset.
- Both unavailable identities render the local accessible placeholder.

## Repeat schedule

Run at approximately **1 hour**, **6 hours**, and **24 hours** after the Phase 16 cutover, and after any production change.

```bash
cd /tmp/opencode/wt-r2-image-storage
npm run health:production
```

Record the printed `generatedAt`, `checks`, `failed`, `warnings`, and output path.

### Compare runs

Each run writes a timestamped JSON and updates `health-latest.json`. To compare two runs:

```bash
node -e '
const fs = require("fs");
const [aPath, bPath] = process.argv.slice(1);
const a = JSON.parse(fs.readFileSync(aPath, "utf8"));
const b = JSON.parse(fs.readFileSync(bPath, "utf8"));
console.log(JSON.stringify({
  from: { at: a.generatedAt, failed: a.summary.failed, warnings: a.summary.warnings },
  to: { at: b.generatedAt, failed: b.summary.failed, warnings: b.summary.warnings },
  newFailures: b.checks.filter(c => c.status === "FAIL" && !a.checks.some(x => x.name === c.name && x.status === "FAIL")).map(c => c.name)
}, null, 2));
' /tmp/opencode/phase17-health/health-<old>.json /tmp/opencode/phase17-health/health-latest.json
```

A healthy repeat should keep:

- `failed = 0`
- `warnings = 0` or only documented warnings
- 63 home links
- 155 R2 images on home
- 0 Blob, 0 broken, 0 failed, 0 duplicate image requests
- Both unavailable IDs present
- Browser true / SEO false / downloads false

## Failure thresholds and actions

| Signal | Action |
|---|---|
| Any unexpected Blob image request | Investigate immediately; check map/flag regression |
| Any broken mapped poster | Investigate immediately; check R2 status/map |
| Multiple image failures or route regressions | Escalate; consider rollback only with fresh explicit authorization |
| Home/detail/category 5xx or timeout | Escalate; route regression |
| Console exception or significant console error | Investigate; escalate if rendering-affecting |
| Missing/unexpected unavailable placeholder | Investigate; check `poster-availability`/asset |
| SEO image switched to R2 | Stop; SEO must remain disabled |
| Download activation observed | Stop; downloads must remain disabled |
| Major production regression | Use the verified route-compatible rollback procedure only with fresh explicit authorization |

Do **not** use `dpl_6NRu…` as a rollback target; it failed the `/genres` compatibility check. The verified route-compatible target is `dpl_GsLqJduvaWPtPy1zbkHzeUgYEqzC`.

No rollback was performed in Phase 17. No scheduled job, cron task, or external monitoring service was created.

## Interpretation rules

- A 0-byte or missing image is critical; lazy below-the-fold images pending during a short harness run are expected and are not failures.
- Blob 403s are not an acceptable fallback; any Blob image request is a regression.
- The local placeholder host `cineprint.click` is expected for the two unavailable identities.
- Production deployment identity is verified via Vercel inspection/alias, not inferred from a URL alone.
