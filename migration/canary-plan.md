# CinePrint — R2 Migration Canary Plan

**Status:** planned only. **No canary execution has been performed.**  
**Prerequisite:** explicit operator approval before any `--execute` command.

## 1. Canary selection

| Role | Poster ID | Provider | Original key | Optimized key | Source size | Blob optimized existed |
|---|---|---|---|---:|---:|---|
| Raindrop authenticated source | `2001-a-space-odyssey` | `raindrop-file` | `cineprint/raindrop/1528361110.png` | `cineprint/optimized/legacy/2001-a-space-odyssey.webp` | 2,165,830 B | yes (131,070 B) |
| Direct pbs source | `bugonia` | `pbs-twimg` | `cineprint/external/bugonia.jpg` | `cineprint/optimized/external/bugonia.webp` | 471,241 B | yes (85,200 B) |
| Artwork source / regeneration | `artwork-1824607248` | `pbs-twimg` | `cineprint/raindrop/1824607248.jpg` | `cineprint/optimized/1824607248.webp` | 1,329,925 B | **no — regenerate** |

### Why these three

- `2001-a-space-odyssey` exercises the authenticated Raindrop file endpoint and the legacy optimized key convention.
- `bugonia` exercises a direct `pbs.twimg.com` source and the external optimized key convention.
- `artwork-1824607248` exercises the artwork key convention and the 12 missing optimized variants that must be regenerated.

### Medium-confidence entries

No medium-confidence entry is selected by default. The two blocked entries are:

- `stranger-things-2` — Raindrop `1521167165`, pbs source, 2,728,405 B.
- `the-substance-2` — Raindrop `1786264374`, pbs source, 77,278 B.

Both have exact source size/MIME matches to the existing Blob originals, but they remain `READY_WITH_REVIEW`. They are **permanently excluded from canary selection**, even if an approvals file exists. An approvals file only authorizes them for `run`:

```json
{
  "approved": ["stranger-things-2"]
}
```

The canary fails closed if a medium- or low-confidence ID is requested explicitly.

## 2. Commands

Plan only (no downloads, no uploads):

```bash
npm run migration:canary
```

Plan for explicit IDs only:

```bash
npm run migration:canary -- --posters 2001-a-space-odyssey,bugonia,artwork-1824607248
```

Execute the canary (requires approval):

```bash
npm run migration:canary -- \
  --execute \
  --posters 2001-a-space-odyssey,bugonia,artwork-1824607248
```

Do not run the `--execute` form until the operator has approved the canary.

## 3. Expected canary result

The canary should create and verify **6 R2 objects**:

| Variant | Object |
|---|---|
| original | `cineprint/raindrop/1528361110.png` |
| optimized | `cineprint/optimized/legacy/2001-a-space-odyssey.webp` |
| original | `cineprint/external/bugonia.jpg` |
| optimized | `cineprint/optimized/external/bugonia.webp` |
| original | `cineprint/raindrop/1824607248.jpg` |
| optimized | `cineprint/optimized/1824607248.webp` |

Expected public URLs:

- `https://images.cineprint.click/cineprint/raindrop/1528361110.png`
- `https://images.cineprint.click/cineprint/optimized/legacy/2001-a-space-odyssey.webp`
- `https://images.cineprint.click/cineprint/external/bugonia.jpg`
- `https://images.cineprint.click/cineprint/optimized/external/bugonia.webp`
- `https://images.cineprint.click/cineprint/raindrop/1824607248.jpg`
- `https://images.cineprint.click/cineprint/optimized/1824607248.webp`

Expected original sizes are exact from Phase 1. Optimized sizes are generated at runtime; the two existing Blob optimized sizes are shown above only as reference. The artwork optimized object is generated fresh because no Blob object existed.

## 4. Canary verification checklist

For each selected poster, the engine must confirm:

1. Source HTTP status is 200 and the body decodes as an image.
2. Source SHA-256 equals the Phase 1 manifest value.
3. Source MIME, size and dimensions match the manifest.
4. Optimized WebP is valid, applies EXIF orientation and does not upscale.
5. Original R2 origin bytes pass independent `GetObject` SHA-256, size, Content-Type and Cache-Control verification.
6. Optimized R2 origin bytes pass independent `GetObject` SHA-256, size, Content-Type and Cache-Control verification.
7. Both public URLs return HTTP 200 with the expected content type and actual bytes, separately from origin verification.
8. Temporary CDN propagation failures are retried with bounded backoff; permanent failures end in `FAILED`.
9. State transitions end at `VERIFIED` only after both origin and public checks pass.
10. The migration-wide lock is held and `If-None-Match: *` prevents overwriting an existing key.
11. No existing object is overwritten; conflicts stop for review.
12. Original and optimized file sizes are reported.

This is a **storage-only canary**. It does not change the production resolver, DNS, deployment or user-facing URLs. Verified mapping and browser/download resolver infrastructure now exist but remain disabled by default; production activation is a separate reviewed phase.

## 5. Rollback

The canary writes only six new objects. If a canary object must be removed, do it only with explicit operator approval and only for the exact canary keys above. Do not delete any other R2 object. Do not touch Vercel Blob.

## 6. Safety

- No production resolver changes.
- No Notion, Raindrop, Firestore, Vercel Blob, DNS or deployment writes.
- No full migration.
- No overwrite of existing R2 objects.
- Medium-confidence entries are never eligible for the canary. Approvals apply only to `run`.
- `--break-lock` removes only a validated stale lock; it refuses live, malformed, foreign-host or out-of-scope locks. Manual recovery instructions are printed when automatic recovery is refused.
