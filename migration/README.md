# CinePrint Migration Manifest

This directory contains the Phase 1 identity and asset-recovery manifest for the 63 existing CinePrint posters. It is generated from read-only Notion, Firestore, Raindrop and Vercel Blob metadata.

## Files

| File                               | Purpose                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `poster-manifest.json`             | Machine-readable manifest; one entry per poster (63 entries).                                                            |
| `poster-manifest-report.md`        | Human-readable reconciliation report and full manifest table.                                                            |
| `firestore-identities.json`        | Snapshot of the 63 current Firestore document IDs and their `notionPageId`, `image`, and `posterImageUrl` fields.        |
| `dry-run-validation.json`          | Machine-readable proof that the manifest ID set equals the current Firestore ID set and that all required checks passed. |
| `engine-design.md`                 | Phase 2 migration engine design, state machine, safety rules and test strategy.                                          |
| `dry-run-report.md`                | Phase 2 read-only dry-run report.                                                                                        |
| `dry-run-report.json`              | Machine-readable dry-run report.                                                                                         |
| `canary-plan.md`                   | Proposed canary selection and commands; not executed.                                                                    |
| `migration-state.json`             | Durable Phase 2 state file, created only by an `--execute` run.                                                          |
| `medium-confidence-approvals.json` | Optional explicit approval file for medium-confidence entries. Not created by default.                                   |

## Regenerate

```bash
npx tsx automation/migration/build-poster-manifest.ts
```

The builder reads:

- Firestore `posters` collection via the public Firebase client config.
- Notion database `Poster Library` via `NOTION_KEY` / `NOTION_DATABASE_ID`.
- Raindrop bookmarks via `RAINDROP_ACCESS_TOKEN`.
- Vercel Blob object metadata via `BLOB_READ_WRITE_TOKEN` (`list`/`head` only).

It does not write to any external service. It downloads the 63 source images into memory only to compute MIME, dimensions, size and SHA-256.

## Validate

```bash
npx vitest run automation/migration/manifest.test.ts
```

The test is offline and deterministic. It reads `poster-manifest.json` and `firestore-identities.json` and asserts:

- Exactly 63 entries, with unique `cineprintPosterId` values.
- The manifest ID set equals the current Firestore ID set.
- Every `notionPageId` and `currentImageUrl` matches the Firestore snapshot.
- Every entry has a source URL, availability, MIME, dimensions, size, SHA-256, original R2 key and optimized R2 key.
- 61 high-confidence identities and 2 medium-confidence identities.
- 51 existing optimized assets and 12 that must be regenerated.
- No duplicate source URLs, Raindrop IDs, original keys or optimized keys.

## Identity contract

- `cineprintPosterId` is the **current Firestore document ID** and is immutable for this migration.
- `notionDerivedId` is the ID the current `parsePage` would generate; it is recorded only for reconciliation and must equal `cineprintPosterId`.
- `raindropId` is the source bookmark `_id`, not a poster identity.
- `originalR2Key` mirrors the current Blob object key.
- `optimizedR2Key` follows the existing convention:
  - `cineprint/optimized/<raindropId>.webp` for `artwork-*` posters.
  - `cineprint/optimized/external/<posterId>.webp` for external posters.
  - `cineprint/optimized/legacy/<posterId>.webp` for legacy Raindrop posters.

## Review items

- `stranger-things-2` and `the-substance-2` are medium-confidence matches. They are external images inside multi-image Notion pages. The page-level `Poster Image URL` matches a pbs media ID, and the recovered source size and MIME match the existing Blob original exactly. Review before copy.
- The 12 `artwork-*` posters without optimized Blob objects must be regenerated from their recovered sources.
- The 19 external optimized WebP objects exist in Blob but the current resolver does not use them. They are recorded as `optimizedCurrentlyUnused`.

## Phase 2 — R2 migration engine

The engine lives in `automation/migration/` and treats `poster-manifest.json` as the authoritative input. It downloads originals directly from Raindrop or `pbs.twimg.com`, verifies the Phase 1 SHA-256, regenerates WebP variants with the existing optimizer, and uploads to R2 with deterministic keys.

### Commands

```bash
# Read-only report. Never writes to R2.
npm run migration:dry-run

# Canary plan only. No downloads or uploads.
npm run migration:canary

# Canary execution (storage-only). Requires explicit operator approval.
npm run migration:canary -- --execute --posters 2001-a-space-odyssey,bugonia,artwork-1824607248

# Selected run. Requires --execute and --posters.
npm run migration:run -- --execute --posters 2001-a-space-odyssey,bugonia

# Full-catalogue run. Requires --execute and --all.
npm run migration:run -- --execute --all

# Read-only verification of uploaded objects.
npm run migration:verify
```

`run` fails closed unless it receives `--execute` and exactly one of `--all` or `--posters`. `--posters` is supported for `canary` and `run`; `dry-run` and `verify` reject poster selection. Duplicate and unknown IDs fail before any engine or R2 client is created.

Useful flags: `--all`, `--posters id1,id2`, `--break-lock`, `--concurrency 1-8`, `--manifest PATH`, `--snapshot PATH`, `--approvals PATH`, `--state PATH`, `--report PATH`, `--retry-conflicts`, `--retry-source-changed`.

### Safety

- `dry-run` and `verify` never write to R2.
- `run` requires `--execute` plus exactly one of `--all` or `--posters`.
- `canary` never accepts `--all`; it uses `--posters` or its default selection.
- `canary` accepts only high-confidence posters. Medium- and low-confidence entries are permanently excluded from canary selection, even when an approvals file exists. Approvals apply only to `run`.
- Unknown, duplicate or blocked IDs fail before any network client or engine execution.
- Existing R2 objects are never overwritten. A checksum mismatch, missing checksum metadata, missing/incorrect Content-Type, or missing/incorrect Cache-Control produces `CONFLICT`.
- Origin integrity is verified by reading actual R2 bytes with `GetObject` and computing SHA-256 independently. ETags are never treated as SHA-256.
- Public CDN delivery is verified separately after origin verification. Temporary CDN failures are retried with bounded exponential backoff; retry exhaustion produces `FAILED`.
- The engine only marks `VERIFIED` after both original and optimized variants pass origin checksum/metadata and public delivery verification.
- A state entry marked `VERIFIED` is revalidated against R2 and the public URLs on resume. Invalid or incomplete `VERIFIED` state fails closed.
- Without trusted state, optimized checksum status is reported as `UNVERIFIED`; the engine does not infer it from size or ETag.
- Source downloads use HTTPS only, exact host allowlisting, DNS resolution of all addresses, private/reserved IPv4/IPv6 rejection, pinned validated addresses, and independent redirect validation. TLS hostname verification remains enabled.
- Source responses are limited to 30 MB while streaming; the response stream is cancelled when the limit is exceeded.
- The `r2.dev` domain is rejected; the public base URL must be `https://images.cineprint.click`.
- Credentials are server-side only and are redacted from logs and errors.

### State and resume

Durable state is written to `migration/migration-state.json` only by `--execute` runs. The state file contains a hash of the manifest entries and is rejected if the manifest changes.

State saves are serialized through a queue. A failed save rejects its own caller but does not poison the queue: a later save is still attempted and writes the latest in-memory state. Atomic temp-file + rename semantics are preserved.

A migration-wide lock scoped to the bucket prevents two local processes using different `--state` paths from running concurrently. A per-state lock also remains. The global lock is **host-local** (`os.tmpdir()`); cross-host protection relies on `If-None-Match: *` conditional writes and the existing conflict checks, not on the local lock.

Stale locks are never removed based on PID alone. `--break-lock` is the explicit recovery flag for an execute run and is validated before removal:

- the lock must be valid JSON (not malformed);
- the lock scope and path must match the global namespace or this exact state path;
- the lock must have been created on this host;
- the PID must exist and must not be alive;
- the lock must be older than the 6-hour stale threshold.

If any check fails, the lock is left in place and the command prints the exact manual recovery command (`rm "<lock path>"`). Never delete a lock while a migration may be running. `PutObject` also uses `If-None-Match: *` as an atomic create-once guard; a `412 PreconditionFailed` becomes `CONFLICT`.

`VERIFIED` entries are revalidated before being skipped; `FAILED` and `SOURCE_UNAVAILABLE` entries are retried; `CONFLICT` and `SOURCE_CHANGED` require `--retry-conflicts` / `--retry-source-changed`.

### Medium-confidence approval

The two medium-confidence entries remain blocked by default. To approve one for a `run` (never for a canary), create `migration/medium-confidence-approvals.json`:

```json
{
  "approved": ["stranger-things-2"]
}
```

High-confidence IDs in the approvals file are rejected. `run` refuses to process an unapproved medium/low-confidence entry. `canary` refuses every medium/low-confidence entry, approved or not.

### Storage-only canary versus production cutover

The canary writes six R2 objects and verifies them. It does **not** change the production resolver, DNS, deployment or any user-facing URL. A successful canary proves the storage path only; it is not a cutover.

Exact canary scope — three high-confidence posters and six objects:

| Poster                 | Original key                        | Optimized key                                          |
| ---------------------- | ----------------------------------- | ------------------------------------------------------ |
| `2001-a-space-odyssey` | `cineprint/raindrop/1528361110.png` | `cineprint/optimized/legacy/2001-a-space-odyssey.webp` |
| `bugonia`              | `cineprint/external/bugonia.jpg`    | `cineprint/optimized/external/bugonia.webp`            |
| `artwork-1824607248`   | `cineprint/raindrop/1824607248.jpg` | `cineprint/optimized/1824607248.webp`                  |

`stranger-things-2` and `the-substance-2` remain excluded from the canary.

### Phase 4 — R2 resolver mapping (disabled by default)

The production resolver now has a verified R2 mapping path, but **R2 image resolution is disabled by default**. The application behaves exactly as before until a separate activation review.

**Files and commands**

| Item                                     | Purpose                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `migration/r2-resolver-allowlist.json`   | Explicit poster IDs permitted to use R2. Currently exactly the three canary IDs.                                                   |
| `scripts/export-r2-verified-mappings.ts` | Reads the manifest, `migration/migration-state.json` and the allowlist; writes `migration/r2-image-map.json`.                      |
| `migration/r2-image-map.json`            | Committed audit mapping with exact keys, URLs, checksums, sizes, Content-Types and verification timestamps.                        |
| `scripts/generate-r2-image-map.ts`       | Converts the audit mapping into `src/lib/r2-image-map.generated.ts`; `--check` detects drift.                                      |
| `src/lib/r2-image-map.generated.ts`      | The only runtime mapping source. Exports `R2_BROWSER_IMAGES_ENABLED = false`, `R2_SEO_IMAGES_ENABLED = false` and the compact map. |

```bash
npm run r2:map:export     # manifest + state + allowlist → migration/r2-image-map.json
npm run r2:map:generate   # audit JSON → src/lib/r2-image-map.generated.ts
npm run r2:map:check      # fails if the generated file is stale
```

**Exporter validation (fail closed)**

Every allowlisted ID must pass all checks or the exporter exits non-zero with the poster ID and reason:

1. ID exists in the manifest.
2. ID is explicitly allowlisted.
3. `identityConfidence === "high"`.
4. Migration state is `VERIFIED`.
5. Original key equals the manifest key.
6. Optimized key equals the manifest key.
7. Original SHA-256 equals the manifest value.
8. Original size equals the manifest value.
9. Original upload flag and verification timestamp are valid.
10. Optimized upload flag and verification timestamp are valid.
11. Optimized SHA-256 and size are present.
12. Original and optimized Content-Types are valid; original key extension matches the MIME; optimized key ends in `.webp`.
13. The exact existing Blob image URL matches `currentImageUrl`, `currentImageObjectKey` and the original key.
14. R2 URLs use exactly `https://images.cineprint.click` and the exact keys.

**Runtime mapping guard**

A poster uses R2 only when all of the following are true:

- The relevant activation switch is `true`.
- The exact Firestore poster ID exists in `R2_IMAGE_MAP`.
- `entry.blobImageUrl === poster.image`.

If any condition fails, the existing Blob resolver runs unchanged. No R2 URL or key is inferred at runtime.

**Browser, download and SEO separation**

Repository defaults:

| Switch                      | Location                         | Controls                                                                                  | Default |
| --------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- | ------- |
| `R2_BROWSER_IMAGES_ENABLED` | generated map                    | `getPosterImageUrl()` for `gallery`, `detail`, `original`; `getOptimizedPosterImageUrl()` | `false` |
| `R2_SEO_IMAGES_ENABLED`     | generated map                    | `getPosterSeoImageUrl()` used by SEO/OG/JSON-LD/sitemap                                   | `false` |
| `R2_DOWNLOADS_ENABLED`      | `src/lib/r2-image-activation.ts` | `getPosterDownloadUrl()` original-byte downloads                                          | `false` |

Browser consumers use `getPosterImageUrl()`: `PosterImage`, home discovery/preloading, constellation thumbnails, poster detail and related posters. SEO consumers use `getPosterSeoImageUrl()`: `src/lib/seo.ts`, `src/lib/structured-data.ts`, `src/lib/sitemap.ts`, and route `head`/OG builders. Downloads use `getPosterDownloadUrl()`; it selects the verified R2 original when downloads are enabled, otherwise the existing `posterImageUrl || image` Blob URL.

Preview/local activation uses `VITE_VERCEL_ENV=preview` (or `development`) plus `VITE_R2_BROWSER_IMAGES=true` and/or `VITE_R2_DOWNLOADS=true`. SEO has no preview override in this phase. Production builds never enable preview flags. The generated map defaults remain `false`; `r2:map:check` still passes without regenerating.

**Browser/download test configuration (reversible)**

```bash
VITE_VERCEL_ENV=development VITE_R2_BROWSER_IMAGES=true VITE_R2_DOWNLOADS=true npm run dev
```

For a Vercel preview, set the same flags with `VITE_VERCEL_ENV=preview` in preview-only environment settings. No repository default or generated-map change is required.

**Fallback sequence**

`PosterImage` uses a finite, deduplicated candidate list from the resolver:

```
R2 optimized → R2 original → Blob original
```

Each candidate is attempted at most once. R2 original is offered only for an exact verified map entry. Unknown/unmapped posters keep Blob optimized → Blob original. Downloads are separate and do not use the display fallback. Blob fallback is not operationally verified while the store returns HTTP 403.

**Removing one poster / disabling globally**

- Remove the poster ID from `migration/r2-resolver-allowlist.json`, then run `npm run r2:map:export`, `npm run r2:map:generate`, and `npm run r2:map:check`.
- To disable R2 globally, remove the preview `VITE_R2_*` flags and keep repository defaults `false`; for a production switch change, restore the generated defaults and regenerate. No R2 or Blob data changes are required.

**Medium-confidence exclusion**

`stranger-things-2` and `the-substance-2` are not in the allowlist. The exporter rejects any allowlisted ID that is not `high` confidence, even if a medium-confidence approval file exists. The generator also requires the runtime map IDs to exactly equal the allowlist IDs.

**Runtime isolation**

Production imports only `src/lib/r2-image-map.generated.ts`. It never reads `migration/migration-state.json`, the manifest, or any other file under `migration/`.

**Blob fallback limitation**

Sampled Vercel Blob URLs currently return `HTTP 403` with body `Your store is blocked`. Keeping the Blob fallback in code does not mean it is currently operational. Verify the Blob store status before relying on fallback or rollback. If the store remains blocked, a resolver rollback to Blob will not restore images.

### Deferred before full migration or cutover

- **F9 — resolver compatibility.** Phase 4.0/4.1 implemented the verified mapping infrastructure, but R2 resolution remains disabled. Activation is a separate reviewed step. Until then, production behavior is unchanged.
- **F11 — manifest key/MIME validation (open).** The manifest validator checks that `sourceMimeType` is an image MIME type but does not compare the original key extension to the source MIME. The Phase 4 exporter performs that check for exported mappings; the manifest validator itself remains unchanged.

### Live integration checks outstanding

Phase 3 verified the six canary objects live: R2 `GetObject` bytes, SHA-256, size, Content-Type, Cache-Control, public CDN HTTP 200 and public-byte equality. Still outstanding for broader migration and activation: Blob store availability, R2 behavior for the remaining catalogue, CDN monitoring under production traffic, TLS/DNS behavior on every host, and resolver activation monitoring.

### Tests

```bash
npx vitest run \
  automation/migration/manifest.test.ts \
  automation/migration/engine.test.ts \
  automation/migration/cli-args.test.ts \
  automation/migration/r2.test.ts \
  automation/migration/source.test.ts \
  automation/migration/lock.test.ts \
  automation/migration/optimize.test.ts \
  automation/migration/state.test.ts \
  automation/r2-image-map.test.ts \
  automation/image-load-state.test.ts \
  automation/download-image.test.ts
```

The engine tests use mocked network and R2 clients; no real credentials are required.

## Phase 7B — Canonical identity and fail-closed sync

Phase 7B adds a canonical identity resolver and a fail-closed Notion-to-Firestore
sync plan. The canonical ID remains the existing Firestore document ID; identity is
never derived from title, slug, image URL, or image-array position.

- Resolver: `scripts/poster-identity.js`
- Sync integration: `scripts/sync-notion-to-firestore.js`
- Contract and transition details: `migration/identity-contract.md`
- Tests: `automation/identity/`

The proposed `CinePrint Poster ID` property and `Poster Identities` data source are
**not created in Notion** and the live data is **not backfilled**. A live canonical
dry-run will remain unresolved for multi-image pages until Phase 7C.

Safe local commands:

```bash
node scripts/sync-notion-to-firestore.js --dry-run
node scripts/sync-notion-to-firestore.js --dry-run --identity-mode=canonical
npx vitest run --config automation/identity/vitest.config.ts
```

`--prune` is disabled unless `--allow-prune` is also passed and the full identity set
validates with no unresolved, conflicting, or orphaned identities. Phase 7B does not
execute prune or any Firestore write.

## Phase 7C-A — Notion schema and backfill preflight

Phase 7C-A prepared the live Notion schema contract and the 63-record backfill plan
without writing to Notion.

- Schema contract: `migration/notion-identity-schema.json`
- Preflight plan and counts: `migration/identity-backfill-preflight.md`
- Planner: `scripts/plan-identity-backfill.ts`
- Planner tests: `automation/identity/backfill-planner.test.ts`

Live preflight (historical, Phase 7C-A): 51 single-page `ADD`, 10 high-confidence
multi-image records, 2 medium-confidence entries blocked, 63 total, 61 automatically
backfillable.

**Phase 7C-D live status:** the schema and backfill are complete. `CinePrint Poster ID`
is live (`wRCR`, rich_text), `Poster Identities` is live
(`412890a5-f3e2-81bb-a5fc-000b21b7ba8a`), 51/51 single-page values and 10/10 identity
rows verify exactly, and the canonical dry-run resolves 61 with 2 intentionally
unresolved medium entries and 0 conflicts. No Firestore sync or write was performed.

## Phase 8C — execution reliability and pre-flight hardening

### Versioned key convention (final)

New versioned objects use the **full** SHA-256, not a 16-character prefix:

```
cineprint/versions/original/<posterId>/<sourceSha256>.<ext>
cineprint/versions/optimized/<posterId>/<optimizedSha256>-<optimizerSlug>-w<width>-q<quality>.webp
optimizerSlug = <name>-<version>-libvips-<libvipsVersion>
```

Original keys use the full source SHA-256. Optimized keys use the full SHA-256 of the actual optimized output bytes, not the source hash. Full hashes remove prefix-collision risk. Version IDs also carry the full hash. `assertNoSourceChecksumCollision` still fails closed if two different checksums ever map to one version ID. The six legacy canary keys are unchanged and remain the only accepted legacy keys.

### Read-only pre-flight

```bash
npm run migration:preflight
npm run migration:preflight -- --json
npm run migration:preflight -- --out /tmp/preflight.json
```

The command reads `poster-manifest.json`, `migration-state.json`, `r2-image-map.json`, and the versioned plan. It enumerates exactly **116** keys for the **58** eligible high-confidence posters and validates:

- 58 eligible posters and 116 unique keys, two per poster;
- every key matches the final key convention;
- the six canary keys are excluded;
- the canary state, keys, and public URLs still match the existing map.

By default the command is **local-only**. Every key is reported as `UNKNOWN` with `LOCAL_PLAN_ONLY` evidence, `complete: false`, and `blocksUpload: true`. No R2 request is made and no absence claim is implied.

A future, separately authorized live run may pass `mode: "live"`, `allowLiveHead: true`, and an `R2Store`. It uses bounded `HeadObject` requests only and classifies each key as `ABSENT`, `EXISTS_MATCH`, `EXISTS_MISMATCH`, `UNKNOWN`, or `ERROR`. Timeouts and inconclusive requests become `UNKNOWN`; a failed HEAD is never treated as absence. Existing objects are compared on poster ID, variant, source checksum, optimizer identity, content type, Cache-Control, and length where locally known. Existing objects are never adopted or overwritten merely because the key matches. Optimized checksums and lengths are unknown before optimization, so an existing optimized object whose identity metadata matches is still classified `UNKNOWN` until a byte-level verification runs.

`blocksUpload` is true unless the live run is complete and every key is `ABSENT` or `EXISTS_MATCH`.

A future versioned upload must write the provenance user metadata the pre-flight requires: `poster-id`, `variant`, `sha256`, `source-provider` for originals; and `poster-id`, `variant`, `sha256`, `source-sha256`, `optimizer`, `width`, `quality` for optimized derivatives. An existing object without these tags is a mismatch and is never adopted.

### Source and verification bounds

- Source timeout defaults to 120 seconds and is configurable with `MIGRATION_SOURCE_TIMEOUT_MS` (bounded to 1–600000 ms). The timeout aborts DNS waiting, the HTTPS request, and the response body read; the downloader clears its timer and destroys the response in `finally`.
- Origin `GetObject` reads are capped at the expected object size. A declared `Content-Length` larger than expected fails before the body is read; the streaming byte counter is authoritative.
- Public CDN verification is capped by expected size and a hard 30 MB ceiling. `Content-Length` is checked first, then the body is streamed with a hard limit and the stream is cancelled on overflow.
- Public verification validates status, MIME type, byte count, SHA-256, and `Cache-Control: public, max-age=31536000, immutable`. A missing or non-immutable Cache-Control fails.
- Permanent 4xx responses (401/403/404/410/422) are not retried. 408/425/429/5xx and timeouts are retried within the bounded attempt budget. Checksum changes, source changes, and metadata conflicts are never retried.
- Every retry and timeout path settles before the engine releases its locks or reports completion.

### Ambiguous uploads

Uploads remain create-only (`If-None-Match: *`). A lost response or a 412 is never resolved by overwriting:

- read the object back with bounded attempts;
- if it exists and bytes, length, Content-Type, Cache-Control, and user metadata all match, treat it as uploaded/verified;
- if it exists and differs, classify a hard conflict;
- if it does not exist, retry the create-only upload within the budget;
- if existence cannot be established, stop the poster as `FAILED` with an explicit unknown-outcome message.

### State durability

State saves still use temp-file + rename and remain serialized through the save queue. Before replacing the live file, the exact payload is re-parsed and validated (schema, manifest hash, entry identity/state). The temp file is written with mode `0600` and `fsync`ed before rename; the containing directory is `fsync`ed on a best-effort basis.

Platform limitation: directory `fsync` is not portable. Windows and some filesystems reject it with `EINVAL`, `EPERM`, `EBADF`, `EISDIR`, `ENOTSUP`, or `EACCES`; those codes are ignored and the file-level fsync + atomic rename still apply. A leftover `.tmp` file from an interrupted write is ignored on load and overwritten by the next successful save; it is never auto-promoted, because completeness cannot be proven.

### Locking and concurrency

The migration-wide and per-state locks remain **host-local** files. Each lock now records a random ownership token; release refuses to unlink a lock whose token, PID, or hostname no longer matches. Stale-lock recovery still requires `--break-lock` and the existing validation (scope, host, dead PID, age).

Cross-host coordination is not implemented in this phase. `MigrationLockBackend` documents the interface a future R2-conditional or quorum lock would implement. Until then, `If-None-Match: *` conditional writes remain the final protection against duplicate object creation, and the engine waits for every worker to settle before releasing locks.

## Phase 8D — observability, audit and recovery

Structured, versioned events are defined in `automation/migration/events.ts`. Events carry a schema version, deterministic event ID (run + sequence), timestamp, run/batch/poster identity, operation and outcome, attempt, duration, HTTP status, byte counts, expected/observed SHA-256, failure category, retryability, and an explicit evidence mode: `local_plan`, `mock`, `live_preflight`, or `live_migration`.

`automation/migration/logger.ts` emits one JSON object per line to console and/or local file sinks. It redacts authorization and cookie headers, sensitive query parameters, signed URLs, embedded credentials, data URIs, base64 payloads, and binary values. Sink failures throw by default; with the `collect` policy the run must call `assertHealthy()` before reporting success. Logging never changes migration outcomes silently.

`automation/migration/audit.ts` writes one append-only JSONL file per run with monotonic sequence numbers. It validates every record, retains the run ID across resume, fsyncs at checkpoints, and fails closed on malformed complete records, duplicate or out-of-order sequences, and ownership mismatch. A partial final line is preserved in a `.partial-<timestamp>.log` sidecar and reported; complete records are never rewritten.

`automation/migration/failures.ts` centralizes failure categories, retryability, skippability, pause/stop requirements, required evidence, and operator actions. Hard stops always override threshold-based pauses.

`automation/migration/health.ts` computes deterministic batch summaries and evaluates the Phase 8A thresholds. Percentages use completed operations as denominators, a configurable sampling window (default 500 completed operations), and a minimum of 20 samples before any percentage decision. `BatchPauseController` prevents new poster work while paused, lets running workers settle, and requires validated state plus the same run/batch/poster selection to resume. Hard-stopped runs cannot resume.

The engine accepts an optional `eventSink` (`RunObserver` implements it) and emits run, batch, poster, source, optimization, upload, origin-verification, CDN-verification, reconciliation and state-checkpoint events. Without an `eventSink`, behavior is unchanged.

`migration:run`, `migration:canary` and `migration:verify` initialize `RunObserver` before work. The observer opens the append-only audit log, constructs the structured logger, wires the pause controller, and is passed to the engine as `eventSink`. Initialization failure aborts the command. Use `--audit PATH`, `--run-id ID`, `--batch-id ID` and `--log-file PATH` to control the evidence location and stable identity. Without `--audit`, the default is `migration/audit/<run-id>.jsonl`. Reuse the same `--run-id` and audit path to resume the same history.

The operator procedure is in [`RECOVERY-RUNBOOK.md`](./RECOVERY-RUNBOOK.md). Vercel Blob is explicitly **not** a reliable rollback source; rollback uses verified R2 historical versions and explicit pointers.
