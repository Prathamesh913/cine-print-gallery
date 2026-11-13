# CinePrint Raindrop Automation — Architecture

Status: implemented on `feat/raindrop-auto-ingestion` (not committed, not deployed).
Audit: `docs/raindrop-automation-audit.md`.
Operations: `docs/raindrop-automation-operations.md`.
Recovery: `docs/raindrop-automation-failure-recovery.md`.

---

## 1. Goals

```
Save poster to a Raindrop collection
  -> automated ingestion (validate, enrich, host, draft)
  -> human reviews and publishes in Notion
  -> publishing sync updates Firestore
  -> CinePrint serves the poster from R2
```

Constraints preserved from the existing production system:

- Firestore `/posters/*` stays the public catalogue; the frontend query
  (`status == "published"`) is unchanged.
- Cloudflare R2 remains the image origin (`https://images.cineprint.click`) and
  the existing 61-entry runtime map keeps working.
- Vercel Blob is never used by the automated pipeline.
- The two intentionally unavailable identities keep their placeholder.
- No new database, queue, or service is introduced.

---

## 2. Component map

```
automation/ingestion/
  cli.ts                  entry point, modes, dry-run safety
  config.ts               env parsing (names only in errors)
  logger.ts               JSON logs to stderr + redaction
  raindrop.ts             bounded Raindrop fetch (paging, 429, 5xx, timeouts)
  validation.ts           bookmark validation + dedupe + revision compare
  identity.ts             poster identity, fingerprints, review decisions
  download.ts             bounded HTTPS image download + magic-byte checks
  image.ts                sharp WebP variant via existing optimizer
  r2-images.ts            immutable versioned upload + origin/CDN verification
  notion-pages.ts         bounded published-page polling
  publish.ts              identity resolution, record build, Firestore sync
  poster-catalog.ts       catalogue interface + in-memory adapter
  state.ts                durable job/run state (Firestore + in-memory)
  runner.ts               resumable ingestion orchestration
  firestore-adapters.ts   Admin SDK adapters (CLI only)
```

Reused without modification:

- `automation/parser.ts` — Raindrop tag conventions.
- `automation/tmdb/*` — search, exact matching, ambiguity handling, details.
- `automation/blob/optimize.ts` — WebP generation (max width 800, quality 80).
- `automation/migration/r2.ts` — S3 client, checksums, public verification.
- `automation/migration/versioning.ts` — versioned key builders, optimizer ID.
- `automation/migration/runtime-map.ts` — URL/key validation constants.
- `automation/notion/*` — client and draft sync (extended with the canonical
  property; legacy mapping is unchanged when no identity is supplied).
- `scripts/poster-identity.js` — canonical identity helpers.
- `scripts/sync-notion-to-firestore.js` — `parsePageData()` record shape.
- `src/lib/poster-images.ts` — resolver (extended with a dynamic reference).

Additive frontend changes:

- `src/lib/r2-image-reference.ts` — shared strict validator for dynamic refs.
- `src/lib/posters.ts` — optional `r2Image` on `Poster`.
- `src/lib/notion.ts` — maps and validates `r2Image` from Firestore.
- `src/lib/poster-images.ts` — static map first, then validated dynamic ref.

---

## 3. Ingestion flow

```
RAINDROP (GET /rest/v1/raindrops/{collection}?sort=-created&perpage=50&page=N)
   |
   v
dedupe by Raindrop ID -> validate tags/link/image
   |
   v
load automationIngestionJobs/{posterId}
   |
   +-- terminal + same revision  -> skip (alreadyProcessed)
   +-- needs_review + no decision -> skip (needsReview)
   +-- failed + retry window open -> resume
   |
   v
TMDB enrichment (exact title+year+type; ambiguity -> needs_review)
   |
   v
download -> validate -> optimize WebP -> SHA-256
   |
   v
R2: cineprint/versions/original/{posterId}/{sourceSha}.{ext}
    cineprint/versions/optimized/{posterId}/{sourceSha}-sharp-...-w800-q80.webp
    put If-None-Match: * -> HEAD verify -> origin GET verify -> CDN GET verify
   |
   v
Notion draft: Status=Draft, Image URL=R2 original,
              CinePrint Poster ID=artwork-{raindropId}
   |
   v
stage notion_draft_created
```

Stable identities:

- Bookmark: `raindrop:{_id}`.
- Poster: `artwork-{_id}` (the existing automated-artwork convention).
- Versioned object keys: derived from poster ID + full source SHA-256.

A different image at the same Raindrop bookmark creates new immutable keys; the
old objects are never overwritten or deleted by the pipeline.

---

## 4. Publishing flow

```
Notion data source query (last_edited_time desc, bounded pages)
  -> Published pages: resolve identity and sync the full record
  -> Non-published pages with existing documents: sync status only
  -> resolve identity:
       single image + CinePrint Poster ID
       single image + Raindrop ID      -> artwork-{id}
       multi-image + active identity records (one per image)
  -> validate metadata and image URL
  -> build the existing record shape via parsePageData()
  -> attach r2Image when the ingestion job has verified references
  -> compare with the Firestore document
       unchanged -> alreadySynchronized (no write)
       new       -> create
       changed   -> update
  -> read back: status published + non-empty image
  -> job stage firestore_synced
```

Identity rules are fail-closed:

- A page-level ID on a multi-image page is a conflict.
- Two pages claiming one poster ID are a conflict and neither is written.
- An existing document associated with a different Notion page is a conflict.
- If no document exists under the resolved ID but exactly one document is
  already associated with the Notion page, that legacy document ID is preserved
  and updated instead of creating a parallel identity. This protects the two
  intentionally unavailable identities and any page without a backfilled
  canonical property.
- Missing required metadata blocks creation.
- New records must use an R2 image URL (no Blob/external fallback).

Why polling: Notion webhooks require a public HTTPS endpoint plus a verification
handshake and durable delivery handling. A GitHub Actions cron job cannot receive
them. Notion's public API supports data-source filtering and sorting by
`last_edited_time`; the sync uses bounded polling and change detection instead.

The automated publishing sync writes full records only for `Published` pages.
For a page moved back to Draft, Review, Archived or Rejected, it updates only the
`status` field of documents already associated with that page, so the public
`status == "published"` query stops serving it. It never creates a document for
an unpublished page and never deletes one. The legacy manual
`npm run sync:notion` command keeps its existing all-page behaviour and is not
invoked by either workflow.

---

## 5. Dynamic runtime image map (Phase C)

### Problem

`src/lib/r2-image-map.generated.ts` is bundled at build time and generated from
one-time migration evidence (58 migrated + 3 canary identities). Registering a
new poster there requires a code change and a production deployment.

### Solution

Keep the generated map authoritative for existing identities, and add an
optional `r2Image` object to the published Firestore poster document:

```json
{
  "image": "https://images.cineprint.click/cineprint/versions/original/artwork-123/<sha>.png",
  "r2Image": {
    "sourceSha256": "<source sha>",
    "original": {
      "key": "...",
      "url": "...",
      "sha256": "...",
      "sizeBytes": 123,
      "contentType": "image/png"
    },
    "optimized": {
      "key": "...",
      "url": "...",
      "sha256": "...",
      "sizeBytes": 45,
      "contentType": "image/webp"
    },
    "verifiedAt": "2026-11-10T..."
  }
}
```

Resolver order (`src/lib/poster-images.ts`):

1. Intentionally unavailable identity → neutral placeholder (unchanged).
2. Generated map entry, if the poster still points at the exact Blob identity.
3. Validated dynamic `r2Image` from the poster document.
4. Legacy Blob derivation / raw image (unchanged).

Safety properties:

- Shared validator requires HTTPS + `images.cineprint.click`, exact URL/key
  match, versioned key prefixes, the poster's own ID segment, valid SHA-256,
  positive sizes, WebP optimized content type and an ISO verification time.
- An invalid dynamic reference fails closed (`/poster-unavailable.svg`) instead
  of falling back to Blob or another identity.
- SEO, OG, JSON-LD and sitemap call sites use the same resolver, so new posters
  receive R2 SEO images automatically.
- Existing catalogue documents are not rewritten by the feature; only records
  the publishing sync touches receive the new optional field.
- Downloads remain behind the existing `R2_DOWNLOADS_ENABLED` policy.

Rejected alternatives:

| Alternative                                         | Why rejected                                             |
| --------------------------------------------------- | -------------------------------------------------------- |
| Regenerate and redeploy per poster                  | Violates the no-deploy requirement                       |
| New image-reference database/service                | Firestore already serves the catalogue; no justification |
| Fetch `migration/r2-image-map.json` at request time | Adds a public endpoint, latency and another write path   |
| Client inference of R2 URLs                         | Unsafe; identities must be verified, not guessed         |

---

## 6. Durable state

Firestore collections (Admin SDK only):

### `automationIngestionJobs/{posterId}`

| Field                                               | Meaning                                                                                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`                                             | `discovered`, `validating`, `enriching`, `needs_review`, `uploading`, `image_verified`, `notion_draft_created`, `awaiting_publication`, `published`, `firestore_synced`, `failed` |
| `attempts`                                          | Consecutive failed attempts                                                                                                                                                       |
| `retryable`, `nextAttemptAt`                        | Retry scheduling                                                                                                                                                                  |
| `raindropUpdatedAt`                                 | Source revision used for change detection                                                                                                                                         |
| `sourceImageUrl`, `sourceImageSha256`               | Resume without the bookmark list                                                                                                                                                  |
| `tmdbId`, `imdbId`, `slug`, `genres`, `libraryName` | Enrichment checkpoint                                                                                                                                                             |
| `images`                                            | Verified original/optimized R2 references                                                                                                                                         |
| `notionPageId`, `notionStatus`                      | Draft association                                                                                                                                                                 |
| `reviewDecision`                                    | Optional human TMDB decision for an ambiguous match                                                                                                                               |

### `automationIngestionRuns/{runId}`

Machine-readable execution summary for apply runs. Dry runs never write it.

No new persistence technology: Firestore is already the catalogue database and
the Admin SDK is already used server-side.

**Required Firestore rules addition before live activation** (server-only state;
client access must be denied):

```
match /automationIngestionJobs/{id} { allow read, write: if false; }
match /automationIngestionRuns/{id} { allow read, write: if false; }
```

Admin SDK writes bypass rules; explicit denial keeps the state private from
clients.

---

## 7. Idempotency and recovery summary

| Stage             | Retry behaviour                                                | Guarantee                             |
| ----------------- | -------------------------------------------------------------- | ------------------------------------- |
| Raindrop fetch    | 429 honour `Retry-After`, 5xx exponential, timeout abort       | Read-only                             |
| Validation        | Permanent failure, no retry                                    | No job written                        |
| TMDB              | Retryable failure; ambiguity held for review                   | Never auto-selects uncertain identity |
| Download/optimize | Retryable on network/size; permanent on invalid bytes          | No writes yet                         |
| R2 upload         | Deterministic keys + `If-None-Match`; existing object verified | No duplicate or overwrite             |
| Notion create     | `findByRaindropId` before create                               | No duplicate page                     |
| Notion update     | Changed fields only; Status untouched                          | Publishing workflow unaffected        |
| Firestore create  | Identity check + read-back                                     | No duplicate document                 |
| Firestore update  | Field comparison before write                                  | No unnecessary rewrite                |

Full matrices are in `docs/raindrop-automation-failure-recovery.md`.

---

## 8. Execution model

- Two GitHub Actions entry workflows, one shared concurrency group, plus a
  `workflow_call`-only run body each.
- Three independent lanes: manual dry-run (no activation variable), manual apply
  (`AUTOMATION_MANUAL_APPLY_ENABLED` + `APPLY-ONE-POSTER` confirmation + limit 1
  - default branch), scheduled ingestion (`AUTOMATION_INGESTION_ENABLED` +
    `schedule` event), scheduled publishing (`AUTOMATION_PUBLISHING_ENABLED` +
    `schedule` event).
- Schedule: ingestion every 20 minutes; publishing at `:05`, `:25`, `:45`.
- Manual `workflow_dispatch` defaults to dry-run; a missing action or confirmation
  is never interpreted as permission to write.
- Scheduled runs apply only after their own lane variable is `true` and the event
  is `schedule`; a manual dispatch can never satisfy that check, and one lane's
  variable cannot arm the other lane.
- The reusable run body re-verifies the resolved authorization before `npm ci`
  and before any credential reaches a step, including the source repository,
  event name, ref, apply flag, limit and lane gate.
- Reusable run bodies accept no other repository; the check uses both
  `github.repository` and `github.event.repository.full_name`.
- No automation lane uses a GitHub Environment, so no run waits for a human
  environment approval. Editorial approval is the Notion `Draft → Published`
  transition.
- Bounded batches: scheduled 10 ingestion / 50 publishing; manual apply is exactly
  1; dry-run uses the operator-selected limit (1–100).
- Concurrency inside a run: 2 posters by default.
- Explicit job timeouts: 20 minutes ingestion, 15 minutes publishing.

GitHub concurrency does not protect local CLI executions or independent runners.

---

## 9. Security model

- Credentials only in GitHub Actions secrets; non-secret configuration in
  repository variables.
- Manual apply requires the manual switch, confirmation phrase, limit 1 and the
  default branch. It does not use a GitHub Environment or a required reviewer;
  dry-runs never receive R2 or Firebase write credentials.
- Logs are JSON lines with bearer-token and credential-query redaction.
- Downloads are HTTPS-only, credential-free, private-host rejected, bounded by
  bytes and time; image signatures are validated.
- R2 keys are validated against the versioned prefixes and the poster ID; no
  path traversal or query strings.
- Notion and Firestore values are treated as untrusted input and validated.
- No privileged workflow runs on `pull_request`.
- Workflows use `permissions: contents: read` and pinned action SHAs.
- Pipeline state collections are server-only (rules above).
- Local `--apply` requires `--confirm-apply` and an explicit `--limit`.
- A read-only `automation-safety.yml` CI workflow validates the gates, workflow
  conditions and credential scoping on pull requests and `main` pushes; it has no
  secrets, environments or deployment access.

Known limitation: external image downloads use the platform DNS resolver, so a
public hostname resolving to a private address is not pinned. The migration
downloader's pinned-DNS client is host-allowlisted and is not reused for
arbitrary external posters.

---

## 10. Known limitations

1. First activation requires the Firestore rules addition and the two state
   collections to be allowed by the project's Admin credentials.
2. Dry-run without `FIREBASE_SERVICE_ACCOUNT_JSON` cannot see existing state, so
   it reports candidates as new and publishing as creates.
3. Notion polling is bounded to 10 pages × 100 rows per run.
4. Raindrop fetch is bounded to 4 pages × 50 newest bookmarks per run; jobs
   that fell outside the window are resumed from durable state.
5. Ambiguous TMDB matches require a human to write `reviewDecision` into the job
   document (or re-tag the bookmark) before they proceed.
6. Published pages with incomplete metadata (missing year, media type, genre,
   library, TMDB/IMDb ID, artist or slug) are reported instead of written, so a
   partial Notion page can never overwrite a complete catalogue document.
7. Sitemap regeneration remains build-time; a newly published poster appears in
   the sitemap on the next deployment (existing behaviour, unchanged).
8. Notion does not show the optimized URL; it is stored in Firestore. Adding
   Notion properties is a separate schema decision.
9. Automated drafts have no Notion `Source`, `Style` or `Tags` properties today.
   `source` is recorded as `Raindrop`; `style` falls back to `Minimalist` and
   `tags` stays empty until an editor sets them in Notion or the schema is
   extended.
