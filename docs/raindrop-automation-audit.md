# CinePrint Raindrop Automation — Audit

Status: Phase A audit, read-only investigation.
Branch: `feat/raindrop-auto-ingestion`
Base commit: `ad1851c` (`origin/main`, merge of the Cloudflare R2 migration, PR #17)
Worktree: `/tmp/opencode/wt-raindrop-auto-ingestion`
Date: 2026-11-10

No production write, deployment, DNS change, R2 mutation, Notion mutation, Firestore
mutation, or commit was performed during this audit.

---

## 1. Method

The audit read the current `origin/main` tree:

- `automation/**` (pipeline, TMDB, Notion, Blob, migration, identity, monitoring)
- `scripts/**` (Notion → Firestore sync, identity, runtime map, sitemap, health)
- `src/lib/**` (poster model, image resolver, activation flags, sitemap)
- `src/routes/**` SEO and catalogue call sites
- `migration/**` reports, manifests, identity contract, runbooks
- `package.json`, `.env.example`, `firestore.rules`, `vite.config.ts`, `tsconfig.json`

Baseline verification on the untouched worktree:

| Check                             | Result                                              |
| --------------------------------- | --------------------------------------------------- |
| `npx vitest run automation tests` | 84 files, 1000 passed, 4 skipped                    |
| `npx tsc --noEmit`                | 1 pre-existing error in `src/routes/__root.tsx:148` |
| `.github/`                        | Does not exist                                      |

---

## 2. Executive summary

The existing codebase contains a **manual, local, one-shot** import path:

```
Raindrop collection
  -> automation/index.ts
  -> parser -> TMDB enrichment -> image download -> Vercel Blob upload
  -> Notion Draft create/update -> human-readable console report
```

It is not an automation pipeline yet:

1. It has no durable state. Every run re-fetches the whole collection and
   re-processes every bookmark. "Already processed" detection relies only on a
   Notion query by Raindrop ID.
2. It uploads to **Vercel Blob**, not R2. The R2 migration built a separate,
   one-time migration engine and never connected ingestion to R2.
3. The Notion → Firestore sync **cannot create catalogue documents**. Its plan is
   fail-closed on any new identity (`potentialCreates > 0` blocks the run), and the
   writer only calls `batch.update()`.
4. The R2 runtime map is a build-time constant generated from migration evidence.
   A new poster can only enter it through a code change, regeneration, and
   redeployment.
5. There is no scheduler, no CI, no cron, no GitHub Actions, and no structured
   machine-readable execution report.

The desired UX therefore needs three additions: orchestration + durable state,
R2 image delivery for new posters, and a publishing sync that can create
Firestore documents safely. All three can extend existing modules; none requires
a new database or service.

---

## 3. Current architecture

### 3.1 Ingestion (manual, local)

```
RAINDROP_ACCESS_TOKEN
RAINDROP_COLLECTION_ID
        |
        v
automation/index.ts
  fetchBookmarks()            GET /rest/v1/raindrops/{collectionId}?page=N&perpage=50
        |                     (no sort, no since filter, full collection every run)
        v
automation/parser.ts
  parseBookmark()             tags: movie:Title|Year, show:Title|Year, artist:Artist
        |                     image: raindrop file endpoint, file link, image type
        v
automation/tmdb/service.ts
  enrichDraft()               exact title + exact year + media type only
        |                     ambiguous / no match / missing IMDb -> needs_review
        v
automation/pipeline.ts
  applyImageStage()           Raindrop file -> Bearer download, else external fetch
        |
        v
automation/blob/*
  downloadImage()             content-type + magic-byte checks
  BlobClient.put()            @vercel/blob, deterministic cineprint/raindrop/{id}.{ext}
        |
        v
automation/notion/*
  NotionDraftSync.syncOne()   findByRaindropId -> create or update changed fields
        |                     create always writes Status=Draft
        v
console report (human only)
```

### 3.2 Publishing (manual, local)

```
Notion database
  -> scripts/sync-notion-to-firestore.js
       fetchAllNotionPages()          all pages, no Status filter
       fetchIdentityRecords()         optional NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID
       scripts/poster-identity.js     canonical ID resolution, fail-closed plan
       buildSyncPlan()                refuses any potential create
       writeRecords()                 Firestore batch.update() only
  -> Firestore /posters/{posterId}
       status = "published" | "draft" | ...
       syncedAt / updatedAt
```

The public site reads:

```ts
query(collection(db, "posters"), where("status", "==", "published"));
```

and then drops records whose `image` is empty (`src/lib/notion.ts`).

### 3.3 Image delivery (live)

```
Firestore poster.image (Vercel Blob original)
        |
        v
src/lib/poster-images.ts
  createPosterImageResolver(R2_IMAGE_MAP, activation)
        |
        +-- R2 entry exists and poster.image === entry.blobImageUrl
        |     -> optimized R2 URL (gallery/detail)
        |     -> original R2 URL (original/download)
        |
        +-- no entry
              -> legacy Blob optimized URL derivation
              -> Blob original
```

`R2_IMAGE_MAP` is `src/lib/r2-image-map.generated.ts`, produced at build time from
`migration/r2-image-map.json` + `migration/r2-resolver-allowlist.json`. It is
bundled into the app. Both `R2_BROWSER_IMAGES_ENABLED` and
`R2_SEO_IMAGES_ENABLED` are `true` in the generated module (Phase 16/17 cutover);
downloads remain preview/local only.

61 identities are mapped today: 58 migrated to versioned keys and 3 legacy
canaries. `stranger-things-2` and `the-substance-2` are intentionally unavailable
and render `/poster-unavailable.svg`.

---

## 4. Scripts and their responsibilities

| Path                                           | Responsibility                                                                                                       | CI-safe today?                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `automation/index.ts`                          | Manual Raindrop → Notion import CLI                                                                                  | No: needs Raindrop, Notion, Blob, TMDB credentials and writes |
| `automation/parser.ts`                         | Tag/link/image validation into `CinePrintDraft`                                                                      | Yes, pure                                                     |
| `automation/pipeline.ts`                       | Image stage wrapper                                                                                                  | Yes, pure with injected importer                              |
| `automation/tmdb/*`                            | TMDB search, exact-match selection, details, cache                                                                   | Yes with injected fetch/cache                                 |
| `automation/notion/*`                          | Notion client, property mapping, draft sync, outcome report                                                          | Client needs credentials; mapping/sync testable with mocks    |
| `automation/blob/*`                            | Vercel Blob client, download, upload, WebP optimize, import                                                          | Blob paths need credentials; `optimize.ts` is local and pure  |
| `automation/migration/*`                       | One-time R2 migration engine, validation, state, locks, runtime map, R2 store, checksums, retry, public verification | Mostly pure; R2 operations need credentials                   |
| `automation/identity/*`                        | Tests/adapters for canonical poster identity                                                                         | Yes with fixtures                                             |
| `automation/monitoring/production-health.ts`   | Production URL checks                                                                                                | Yes, read-only                                                |
| `scripts/sync-notion-to-firestore.js`          | Notion → Firestore sync (the canonical write path)                                                                   | Needs Notion + Firebase Admin; writes when not dry-run        |
| `scripts/poster-identity.js`                   | Canonical identity resolution, sync plan, apply                                                                      | Yes, pure                                                     |
| `scripts/generate-r2-image-map.ts`             | Generates the bundled runtime map                                                                                    | Yes, pure file generation                                     |
| `scripts/export-versioned-r2-map.ts`           | One-time exporter from migration evidence                                                                            | Yes, pure file generation                                     |
| `scripts/generate-sitemap.ts`                  | Build-time sitemap from public Firestore                                                                             | Needs public Firebase config and network                      |
| `scripts/production-health-check.ts`           | Read-only production smoke checks                                                                                    | Yes                                                           |
| `scripts/preview-r2-*`, `scripts/browser-r2-*` | Preview harnesses                                                                                                    | Local only                                                    |

---

## 5. Audit questions

### 1. How are Raindrop bookmarks fetched?

`automation/index.ts` calls `GET https://api.raindrop.io/rest/v1/raindrops/{collectionId}`
with `Authorization: Bearer $RAINDROP_ACCESS_TOKEN`, 0-based `page`, `perpage=50`.
It loops until a short page or until the reported `count` is reached.

Weaknesses: no `sort`, no `since`/`lastUpdate` filter, no rate-limit handling, no
timeout, no retry, no paging cap, and no distinction between "new" and
"previously processed".

### 2. How is the target collection identified?

`RAINDROP_COLLECTION_ID` (required environment variable), embedded in the path.
There is no collection allowlist check beyond that value.

### 3. How are already-processed bookmarks detected?

Only indirectly: `NotionDraftSync.syncOne()` queries the Notion data source for a
page whose `Raindrop ID` rich-text equals the bookmark ID. There is no local or
Firestore checkpoint, no run history, and no stage tracking. A bookmark that
failed before Notion creation is invisible to this check and is retried only
because the whole collection is re-processed.

### 4. What metadata is extracted from Raindrop?

From tags:

- `movie:<Title>|<Year>` or `show:<Title>|<Year>` (first matching tag wins).
- `artist:<Name>` (zero or more; at least one is required).

From the bookmark:

- `_id` → `raindropId`
- `file.type` or `link` → image URL (`api.raindrop.io` file endpoint is rewritten
  to the REST v1 file endpoint by the downloader)
- `note` (normalized whitespace) else `link` → source URL

`created`, `lastUpdate`, `title`, `excerpt`, `collection`, `cover`, `media` are
available from the API but unused.

### 5. How are TMDB matches selected and validated?

`automation/tmdb/search.ts`:

1. Search by title, year, and media type.
2. Keep candidates whose normalized title matches exactly **and** whose release
   year matches exactly **and** whose `media_type` is compatible.
3. Rank by title (0.6), year (0.3), vote count (0.05), popularity (0.05).
4. One candidate → match; more than one → `ambiguous` → `needs_review`.
5. Details fetch must return an IMDb ID, otherwise `needs_review`.

This is conservative and already avoids silently picking an uncertain identity.
It does not persist a human decision for an ambiguous bookmark.

### 6. How are image downloads and validation handled?

`automation/blob/download.ts`:

- Raindrop file URLs are rewritten to the REST v1 file endpoint.
- Optional Bearer token is sent.
- Content type must be in `SUPPORTED_CONTENT_TYPES` (jpeg/png/webp/gif).
- Non-empty body and magic-byte signature check.

Missing: request timeout, maximum size, redirect policy, private-address
protection, retry/backoff, and image dimension validation.

The migration engine has a stronger downloader
(`automation/migration/source.ts`: host allowlist, DNS pinning, byte cap, timeout,
redirect cap, SHA-256, dimensions) but it is restricted to `raindrop-file` and
`pbs-twimg` and is not used by ingestion.

### 7. Does the ingestion pipeline still use Vercel Blob anywhere?

Yes. `automation/index.ts` instantiates `BlobClient` and `BlobImageImporter`.
`BLOB_READ_WRITE_TOKEN` (or OIDC + store ID) is mandatory before any processing.
`.env.example` still documents only Blob, not R2. **No ingestion code writes to R2.**

`@vercel/blob` remains a runtime dependency and the legacy Blob originals remain
the identity anchor of the existing runtime map (`blobImageUrl`).

### 8. How are images uploaded to Cloudflare R2?

Only by the one-time migration engine via `automation/migration/r2.ts`
(`R2StoreImpl`):

- S3 API at `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region `auto`.
- Bucket `R2_BUCKET_NAME`.
- `put()` uses `IfNoneMatch: "*"` so an existing key is never overwritten.
- `Cache-Control: public, max-age=31536000, immutable`.
- SHA-256 in object user metadata; optional S3 checksum.
- `head()`, `verifyOrigin()` (GET + hash + metadata), `publicVerify()` (CDN GET +
  hash + headers).
- `R2_PUBLIC_BASE_URL` must be HTTPS and exactly `https://images.cineprint.click`;
  `.r2.dev` is rejected.

### 9. How are optimized WebP images generated?

Two implementations exist:

- `automation/blob/optimize.ts` — sharp, max width 800, WebP quality 80, EXIF
  rotation, no enlargement. Used by the new import path.
- `automation/migration/optimize.ts` — the migration variant that also records
  hashes, sizes, dimensions, and the optimizer identity.

Optimized keys embed the optimizer identity:
`{sourceSha256}-sharp-{sharpVersion}-libvips-{libvipsVersion}-w800-q80.webp`.

### 10. How are original and optimized image URLs stored?

Existing catalogue:

- Firestore `image` / `posterImageUrl`: Vercel Blob original URL.
- Runtime map entry: `blobImageUrl`, `original.key/url/sha256/sizeBytes/contentType`,
  `optimized.key/url/...`, `verifiedAt`.
- Notion `Image URL`: the Blob original URL (single or newline-separated list).

The runtime map is the only place that carries both R2 URLs.

### 11. How are R2 image identities registered in the runtime map?

Through `migration/r2-image-map.json` (61 entries), validated by
`automation/migration/runtime-map.ts`, then converted into the bundled TypeScript
module by `scripts/generate-r2-image-map.ts`.

The versioned exporter (`buildVersionedRuntimeMap`) is hard-wired to the migration
evidence:

- exactly 58 migrated posters
- exactly 3 canary IDs
- five batch state files with a matching manifest hash
- one `VERIFIED` state per poster with uploaded original + optimized objects

It is a one-time migration tool, not an incremental registry. `--check` only
detects a stale generated file.

### 12. Does adding a poster require a code change or production deployment?

**Yes, today.**

- The resolver only reads the bundled `R2_IMAGE_MAP`.
- There is no Firestore-backed image reference and no runtime fetch.
- Therefore a new poster is served through the legacy Blob fallback (if its
  `image` is a Blob URL) or through its raw `image` URL. To serve R2 optimized
  bytes, the map must be regenerated and redeployed.

This is the critical Phase C blocker.

### 13. How are Notion Draft records created and updated?

`NotionDraftSync`:

- Find by `Raindrop ID` rich text.
- Create: map title, year, media type, genres, IMDb/TMDB IDs, library, slug,
  artist, image URL, source URL, Raindrop ID; always `Status = Draft`.
- Update: compute changed fields against the existing page and send only those.
  `Status` is never included, so a Published page keeps its status.
- Dry-run returns the planned payloads without writing.

The mapper does **not** write `CinePrint Poster ID`, even though that property is
live in Notion.

### 14. How does Notion → Firebase synchronization work?

`scripts/sync-notion-to-firestore.js`:

- Fetches every page (no Status filter) from the Poster Library data source.
- Optionally fetches `Poster Identities` rows.
- Resolves canonical IDs with `scripts/poster-identity.js`:
  1. `CinePrint Poster ID` property for single-image pages.
  2. Per-image identity rows for multi-image pages.
  3. Controlled legacy fallback: `artwork-{raindropId}` or explicit `Slug`,
     only when a matching Firestore document already exists.
- Builds a plan; **any unresolved identity, conflict, or potential create blocks
  all writes** with exit code 1.
- Converts each resolved page with `parsePageData()`.
- Writes with Firestore batch `update()` (400 per batch), setting `syncedAt` and
  `updatedAt`.
- Optional `--prune` archives documents that no longer resolve, but requires
  `--allow-prune` and a conflict-free plan.

### 15. How are duplicate records prevented?

- Canonical ID = Firestore document ID; never derived from title, slug, image URL,
  or array position.
- One claim per poster ID per run (`DUPLICATE_ID` conflict).
- A page and a document must agree on `notionPageId` (`PAGE_MISMATCH`).
- `MISSING_FIRESTORE_DOCUMENT` and `UNKNOWN_ID` are conflicts.
- Ingestion prevents duplicate Notion pages by querying `Raindrop ID` before
  create.

There is no duplicate protection against two different Raindrop bookmarks that
represent the same artwork; that remains a human concern.

### 16. Which operations are currently idempotent?

| Operation                 | Idempotent?     | Notes                                                                                  |
| ------------------------- | --------------- | -------------------------------------------------------------------------------------- |
| Raindrop fetch            | Yes             | Read-only                                                                              |
| Parsing / TMDB enrichment | Yes             | TMDB cache is in-memory only                                                           |
| Blob upload               | Partially       | `head()` reuse, but path is deterministic and not content-addressed                    |
| Notion create             | Yes in practice | Guarded by `findByRaindropId`; a crash between create and report is recovered next run |
| Notion update             | Yes             | Only changed fields; Status untouched                                                  |
| Notion → Firestore update | Yes             | Same records and values; but rewrites `syncedAt` every run                             |
| Firestore create          | **No**          | Not supported at all                                                                   |
| R2 upload                 | Yes             | `IfNoneMatch` + deterministic keys                                                     |
| Runtime map registration  | No              | Build-time only                                                                        |

### 17. How are failures recorded and recovered?

- Ingestion: console strings only; per-item failures are counted and printed.
  Recovery = rerun the whole script.
- Notion sync: returns `failed` outcomes with an error string; nothing durable.
- Migration engine: JSON batch state (`migration/state/*.json`), attempt counts,
  `lastError`, stage enum, global lock, retry classification. This is the only
  durable state machine in the repo.
- Notion → Firestore: exit code + console plan output; no durable per-record
  status.

### 18. Which scripts can safely run in CI?

Read-only or pure:

- `npm test`
- `npm run r2:map:check`
- `npm run migration:dry-run`
- `npm run migration:verify`
- `npm run health:production`
- `npm run sync:notion:dry` (needs Notion; no writes)
- `npm run optimize:images:dry`

Write-capable, so not safe without explicit approval:

- `npm run import:raindrop` (Notion + Blob writes)
- `npm run sync:notion` (Firestore writes)
- `npm run migration:run` / `migration:canary` (R2 writes)

### 19. Which scripts currently require local environment access?

Anything needing `.env` or local credentials:

- Raindrop, TMDB, Notion, Blob: ingestion.
- Notion + `FIREBASE_SERVICE_ACCOUNT_JSON` or `firebase-admin-key.json`: sync.
- R2 credentials: migration.
- Public `FIREBASE_*`: sitemap generation.

`scripts/sync-notion-to-firestore.js` also accepts a local
`migration/firestore-identities.json` snapshot for credential-free dry-runs.

### 20. Are there existing cron, GitHub Actions, or automation workflows?

No `.github/` directory. No cron configuration, no Vercel cron, no scheduled
job, no webhook handler. Automation is entirely manual/local.

---

## 6. Reusable modules

| Module                                                         | Reuse plan                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `automation/parser.ts`                                         | Keep as the tag/bookmark parser; use from the new orchestrator    |
| `automation/tmdb/service.ts` + `search.ts`                     | Keep as-is; ambiguous results already fail safe                   |
| `automation/blob/download.ts`                                  | Reuse content-type/signature rules; wrap with bounded fetch       |
| `automation/blob/optimize.ts`                                  | Reuse for WebP generation                                         |
| `automation/migration/r2.ts`                                   | Reuse `R2StoreImpl` for upload/verify/public verify               |
| `automation/migration/versioning.ts`                           | Reuse key builders, optimizer identity, SHA-256 helpers           |
| `automation/migration/runtime-map.ts`                          | Reuse URL/key validators; do **not** reuse the 58-poster exporter |
| `automation/migration/retry.ts`, `checksum.ts`, `redaction.ts` | Reuse retry classification, hashing, redaction                    |
| `automation/notion/client.ts`                                  | Reuse; add canonical-ID property support in the mapper            |
| `automation/notion/sync.ts`                                    | Reuse outcome model; extend for canonical ID                      |
| `scripts/poster-identity.js`                                   | Reuse pure identity helpers for publishing                        |
| `scripts/sync-notion-to-firestore.js`                          | Reuse `parsePageData()` record shape for compatibility            |
| `src/lib/poster-images.ts`                                     | Extend with a Firestore-backed dynamic reference                  |
| `src/lib/poster-availability.ts`                               | Preserve unchanged                                                |
| `src/lib/poster-images.test.ts` conventions                    | Extend resolver tests                                             |

---

## 7. Missing capabilities

1. Incremental Raindrop fetch with stable, durable bookmark identity.
2. Durable per-bookmark pipeline state and checkpointing.
3. Stage-level retry with backoff and API rate-limit handling.
4. Structured logs and machine-readable summaries.
5. Bounded concurrency.
6. R2 ingestion path (download → validate → optimize → upload → verify).
7. Runtime registration of new R2 image references without redeploy.
8. Notion Draft creation with canonical `CinePrint Poster ID`.
9. Firestore **create** path for newly published records.
10. Change detection so unchanged Firestore records are not rewritten.
11. Scheduling, concurrency control, and dry-run workflow entry points.
12. A safe way to hold ambiguous TMDB matches for review and resume them.
13. Recovery of a record published in Notion but not yet synced to Firestore.

---

## 8. Data flow (target)

```
Raindrop collection
  -> ingestion run (GitHub Actions, every 20 min, dry-run by default)
     -> job store (Firestore automationJobs/{posterId})        durable stage
     -> validate -> TMDB -> download -> optimize
     -> R2 original + optimized (versioned, immutable keys)
     -> origin + CDN verification
     -> Notion draft (Image URL = R2 original, CinePrint Poster ID = artwork-{raindropId})
     -> stage notion_draft_created

Reviewer publishes in Notion (Status = Published)
  -> publishing sync (GitHub Actions, every 20 min, separate offset)
     -> query Status = Published, ordered by last_edited_time
     -> identity resolution (canonical property / per-image / legacy raindrop)
     -> validate metadata + R2 image URL
     -> Firestore set/create or update (skip unchanged)
     -> embed dynamic r2Image reference in the poster document
     -> read-back verification
     -> stage firestore_synced

Public site
  -> Firestore published posters (unchanged query)
  -> resolver: static map first (existing 61), then poster.r2Image (new posters)
  -> R2 CDN
```

---

## 9. Security considerations

- Credentials are all server-side. The public site reads Firestore with the
  public client SDK and `allow read: if true` on `/posters/*`.
- `firebase-admin` must never enter the public route graph; `src/lib/notion.ts`
  imports Admin lazily inside the submission handler.
- The R2 public domain is fixed to `images.cineprint.click`; `.r2.dev` is
  rejected by the store factory.
- Existing migration redacts bearer tokens and query credentials
  (`redactSecrets`, `redactUrl`).
- Notion HTML/URL values are untrusted input. The new pipeline must validate
  scheme/host before using them, and must never log tokens or signed URLs.
- Firestore rules keep `/posters/*` write-only through the Admin SDK; new
  automation state collections need explicit rules (server-only) when introduced.
- GitHub Actions must use a minimal `GITHUB_TOKEN` permission set and must not
  run privileged jobs on `pull_request` from forks.

---

## 10. Recommended target architecture

One resumable orchestrator with injected adapters:

- `automation/ingestion/` — Raindrop source, validation, identity, state store,
  image stage, R2 stage, Notion stage, publisher, runner, CLI.
- Reuse `automation/tmdb` for enrichment, `blob/optimize` for WebP,
  `migration/r2` for storage, `notion/*` for drafts, and the pure identity
  helpers for publishing.
- Durable stage state in Firestore, keyed by the stable poster ID
  (`automationJobs/{posterId}`), with a run log document
  (`automationRuns/{runId}`). No new database or queue.
- Dynamic image references stored on the published poster document
  (`r2Image`), consumed by the existing resolver after the static map.
- Two GitHub Actions workflows, shared concurrency group, dry-run default,
  schedules gated behind a repository variable until activation is approved.

Details are in `docs/raindrop-automation-architecture.md`.

---

## 11. Blockers requiring an architectural decision

### B1. Dynamic runtime image map (critical)

The bundled map cannot accept new identities without a deploy. The proposed
solution is additive: keep the generated map for the existing 61 identities and
read an optional, validated `r2Image` object from the published Firestore
document for new identities. This uses the existing database and preserves all
current behaviour.

Rejected alternatives:

- Regenerating/deploying per poster — violates the "no deploy" requirement.
- A new image database/service — unnecessary; Firestore already serves the
  catalogue.
- Runtime fetching of `migration/r2-image-map.json` at request time — adds a
  public endpoint and latency to every request, and still needs a write path.

Decision needed: approve storing R2 references on the poster document.

### B2. Creating Firestore documents

The current sync deliberately refuses creates. The new publishing path will
create only when a page is `Published`, has a valid canonical ID
(`CinePrint Poster ID` or deterministic `artwork-{raindropId}`), has a unique
identity, and has a non-empty validated image URL. This is a policy change to the
existing fail-closed sync, so it is isolated in a new module and documented.

Decision needed: approve automated creates for published pages.

### B3. Notion schema changes

The audit deliberately avoids adding Notion properties. `CinePrint Poster ID` is
already live. Optimized URLs are stored in Firestore, not Notion. If an editor
needs to see both URLs in Notion, that is a separate schema change requiring
explicit approval.

### B4. Activation

Scheduled workflows will be committed disabled (repository variable gate) and
will require explicit approval plus secrets before any live run.

---

## 12. Preservation notes

- The R2 migration engine, manifests, batch state, generated map, activation
  flags, bucket, domain, and SEO/OG/sitemap behaviour are not modified.
- Existing catalogue documents are not migrated or rewritten by this feature.
- `stranger-things-2` and `the-substance-2` keep the unavailable placeholder.
- No production data is written during implementation or testing.

---

## 13. Post-implementation verification (same branch)

Recorded after Phase B–H work on `feat/raindrop-auto-ingestion`:

| Check                              | Result                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npx vitest run automation tests`  | 98 files, 1118 passed, 4 skipped                                                               |
| `npx tsc --noEmit`                 | 1 pre-existing error (`src/routes/__root.tsx:148`)                                             |
| Scoped ESLint on changed/new files | clean                                                                                          |
| `npx vite build`                   | pass                                                                                           |
| `npm run build` (prebuild)         | blocked locally by missing `FIREBASE_PROJECT_ID`/`FIREBASE_API_KEY`, unrelated to this feature |
| `npm run r2:map:check`             | pass — generated map unchanged                                                                 |
| R2/Notion/Firestore writes         | none                                                                                           |
| Git commits/pushes/deployments     | none                                                                                           |

The audit conclusions above remain unchanged. The target design and its
implementation are documented in `docs/raindrop-automation-architecture.md`.
