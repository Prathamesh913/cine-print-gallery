# Poster Image Repair — Versioned R2 Workflow

This is the scoped repair path for confirmed poster images whose legacy Blob
source is blocked and whose poster document has no valid `r2Image` reference.

It does **not** modify the 58-poster migration baseline, the three canaries, the
artifact manifest, the manifest hashes, the phase-state files, or the generated
static R2 map.

## Scope

The command is a closed allowlist. It currently supports only:

- `the-substance-2`
- `stranger-things-2`

Adding a poster requires a reviewed change to
`automation/repair/targets.ts` with a confirmed source URL, SHA-256, dimensions,
size, Raindrop bookmark, artist, Notion grouping page and legacy image identity.

## Architecture

```text
pbs source
  -> existing downloadSourceImage validation
  -> existing prepareImage (sharp WebP, 800px max, q80)
  -> existing planR2Keys (versioned content-addressed keys)
  -> existing R2ImagePublisher (create-only, read-back, public verification)
  -> Notion Poster Identities row (only if missing)
  -> Firestore update-only r2Image reference
  -> dynamic resolver + sitemap
```

The static `R2_IMAGE_MAP` remains authoritative for the existing migrated
catalogue. These two identities use the **dynamic** `r2Image` contract:

```text
cineprint/versions/original/<posterId>/<sourceSha256>.jpg
cineprint/versions/optimized/<posterId>/<sourceSha256>-sharp-<version>-w800-q80.webp
```

The actual keys are produced by `planR2Keys`; do not hardcode them.

## Confirmed targets

```text
the-substance-2
  source:     https://pbs.twimg.com/media/HMtwlGHXgAAYt0L?format=jpg&name=medium
  sha256:     7235e3b6206fb71c761af2df87540ca3a7735cf7fb0dadadbb62e446cb029d3d
  dimensions: 690 x 1024
  bytes:      77,278
  raindrop:   1786264374
  artist:     Eileen Steinbach

stranger-things-2
  source:     https://pbs.twimg.com/media/G9gZV6dWEAAOjjU?format=jpg&name=4096x4096
  sha256:     303277e83081b273e0ea271bccba7d3a9bed17a8a9227903cec51ede078ee25b
  dimensions: 2473 x 3297
  bytes:      2,728,405
  raindrop:   1521167165
  artist:     Butcher Billy
```

`the-substance-2` is intentionally accepted at 690×1024. Its optimized WebP is
690px wide because the optimizer does not upscale.

## Usage

### Dry-run (default, read-only)

```bash
npm run repair:posters -- \
  --posters the-substance-2,stranger-things-2
```

The dry run:

- downloads and validates both sources,
- prepares the exact optimized WebP,
- prints the exact planned original/optimized keys,
- reads existing R2 objects and verifies them,
- reads the Firestore document and plans an update/no-op,
- reads the Notion page and plans an identity-row create/no-op,
- performs **zero** R2, Firestore or Notion writes.

It writes a JSONL audit file under the OS temp directory by default. Use
`--audit PATH` to choose another location. The default is deliberately outside
the repository and outside tracked migration state.

### Execute

```bash
npm run repair:posters -- \
  --posters the-substance-2,stranger-things-2 \
  --execute
```

Required environment:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `NOTION_KEY`
- `NOTION_DATABASE_ID`
- `NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_BASE_URL`

`NOTION_POSTER_DATA_SOURCE_ID` is optional when the database exposes a single
poster data source. The identities data source is required for consistency.

## Write semantics

### R2

- Uses `R2ImagePublisher`.
- `PutObject` is create-only (`If-None-Match: *`).
- Existing objects are verified against bytes, size, Content-Type, cache policy
  and metadata; a mismatch fails closed. Nothing is overwritten.
- A partial original upload is safe: retry re-verifies and reuses it, then
  uploads the optimized object.
- Origin and public CDN checks run before the reference is attached to Firestore.

### Firestore

- Update-only on an existing document.
- Requires `status: published`, the confirmed `notionPageId` and the confirmed
  legacy `image` value.
- Only `r2Image` is written; unrelated fields are preserved.
- A valid, different existing `r2Image` is a conflict and is never replaced.
- An absent or invalid `r2Image` is replaced with the new verified reference.
- The document is read back and validated; unrelated fields must be unchanged.

### Notion

The poster page itself is **not** edited. Editorial `Status` is never changed,
and a Draft page fails closed before any write.

A missing `Poster Identities` row is created because the two pages are
multi-image and the publishing sync resolves each image through an active
identity row. The row uses:

- `Poster ID`
- `Grouping Page`
- `Image URL` = the page's existing confirmed image URL
- `Raindrop ID`
- `Source Provider` = `pbs-twimg`
- `Source SHA-256`
- `Source Revision` = 1
- `Status` = `active`
- `Verified At`

If a matching active row already exists, nothing is written. A conflicting or
duplicate row fails closed. The row is read back and validated.

Without this row, each publishing sync would report the repaired image as
`needs_review` because the multi-image page has no identity association for it.

## Frontend resolution

`INTENTIONALLY_UNAVAILABLE_POSTER_IDS` remains in place. The resolver now treats
a **fully validated dynamic `r2Image`** as sufficient to leave the unavailable
state. This means:

- valid repaired references resolve to the R2 optimized/original URL;
- invalid or incomplete references still show `poster-unavailable.svg`;
- posters without a valid reference keep the placeholder;
- a static map entry remains authoritative over a dynamic reference;
- the fallback for an unavailable ID remains the neutral asset, never the
  blocked Blob URL.

The same resolution rule is used by detail pages, gallery cards, Open Graph,
JSON-LD, downloads and sitemap. Sitemap rows now pass the raw Firestore
`r2Image` through with the image identity instead of constructing only
`{ id, image }`.

## Static map and migration baseline

These two records are intentionally **not** added to:

- `migration/poster-manifest.json`
- `migration/optimized-artifacts.json`
- `migration/state/phase10*.json`
- `migration/r2-image-map.json`
- `migration/r2-resolver-allowlist.json`
- `src/lib/r2-image-map.generated.ts`

The generated static map continues to contain 61 entries: 58 migrated posters
and 3 canaries. Dynamic `r2Image` references are a separate, existing runtime
contract and do not alter the exporter invariants.

## Monitoring after the repair

`automation/monitoring/production-health.ts` is catalogue-driven:

- It reads published posters from Firestore and resolves each one exactly like
  the production resolver: the trusted static map entry first, then a validated
  dynamic `r2Image` reference.
- It fetches each optimized public R2 URL and checks HTTP 200, `image/webp` and
  a valid WebP signature.
- Homepage and sitemap checks derive expected counts from the published
  catalogue instead of hard-coded assumptions. The current published catalogue
  is resolved live, so catalogue growth does not require a monitor change.
- Failures name the affected poster IDs.
- The repaired detail routes are checked as R2-rendered pages, not intentional
  placeholders. The fail-closed placeholder path still applies to any identity
  in `INTENTIONALLY_UNAVAILABLE_POSTER_IDS` without a valid reference.

The deployed sitemap is generated at build time. It updates on the next normal
deployment; before that deployment, the health monitor will correctly report the
stale sitemap rather than masking it.

## Recovery and rollback

- **Dry-run fails:** resolve the reported source/Firestore/Notion/R2 mismatch;
  no writes occurred.
- **Partial R2 upload:** rerun the same command. Existing objects are verified
  and reused; no overwrite.
- **Notion creation fails:** Firestore is not updated; the placeholder remains.
  Rerun after fixing Notion; the R2 objects are reused.
- **Firestore write/read-back fails:** the command exits non-zero. Inspect the
  document; a valid `r2Image` is fail-closed by the frontend. Do not delete R2
  objects or overwrite them manually.
- **Visible rollback:** the poster page can be returned to the placeholder by
  removing the valid `r2Image` reference from Firestore. R2 objects can remain
  without being referenced; do not delete immutable objects as part of a
  rollback.

## Safety boundary

This document describes the implementation. No production repair, upload,
Firestore write, Notion write or deployment is authorized by it. `--execute`
must be invoked separately after review.
