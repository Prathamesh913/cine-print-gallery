# CinePrint Raindrop Automation — Operations

Status: configured, **not activated**. Scheduled workflows perform no work until
`AUTOMATION_ENABLED` is set to `true`.

Related:

- `docs/raindrop-automation-audit.md`
- `docs/raindrop-automation-architecture.md`
- `docs/raindrop-automation-failure-recovery.md`

---

## 1. Workflows

| Workflow               | File                                           | Schedule (UTC)    | Manual              | Timeout |
| ---------------------- | ---------------------------------------------- | ----------------- | ------------------- | ------- |
| Raindrop ingestion     | `.github/workflows/raindrop-ingestion.yml`     | `*/20 * * * *`    | `workflow_dispatch` | 20 min  |
| Notion publishing sync | `.github/workflows/notion-publishing-sync.yml` | `5,25,45 * * * *` | `workflow_dispatch` | 15 min  |

Both share `concurrency.group: cineprint-catalog-automation` with
`cancel-in-progress: false`, so they never overlap. A queued run waits for the
current one to finish.

Both jobs are guarded by:

```yaml
if: vars.AUTOMATION_ENABLED == 'true'
```

Until that repository variable exists and equals `true`, scheduled and manual
runs are skipped.

---

## 2. Required secrets (names only)

Set in **Settings → Secrets and variables → Actions → Secrets**:

| Secret                          | Used by   | Purpose                     |
| ------------------------------- | --------- | --------------------------- |
| `RAINDROP_ACCESS_TOKEN`         | ingestion | Raindrop API bearer token   |
| `TMDB_API_KEY`                  | ingestion | TMDB v3 API key             |
| `NOTION_KEY`                    | both      | Notion integration token    |
| `R2_ACCOUNT_ID`                 | ingestion | Cloudflare account ID       |
| `R2_ACCESS_KEY_ID`              | ingestion | R2 access key               |
| `R2_SECRET_ACCESS_KEY`          | ingestion | R2 secret key               |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | both      | Firestore Admin credentials |

Never print, commit, or artifact any of these values. The workflows pass them
only as step environment variables.

## 3. Required repository variables (non-secret)

Set in **Settings → Secrets and variables → Actions → Variables**:

| Variable                                  | Example                          | Purpose                                    |
| ----------------------------------------- | -------------------------------- | ------------------------------------------ |
| `AUTOMATION_ENABLED`                      | `true`                           | Activation gate (absent/false = disabled)  |
| `RAINDROP_COLLECTION_ID`                  | `12345678`                       | Designated ingestion collection            |
| `NOTION_DATABASE_ID`                      | UUID                             | Poster Library database                    |
| `NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID` | UUID                             | Optional multi-image identity rows         |
| `R2_BUCKET_NAME`                          | bucket name                      | Never change without an approved migration |
| `R2_PUBLIC_BASE_URL`                      | `https://images.cineprint.click` | Must stay the production domain            |

---

## 4. Running manually

### Dry-run (default)

GitHub → Actions → select workflow → **Run workflow** → leave `apply` unchecked.

Or locally:

```bash
npm run automation:ingest:dry
npm run automation:publish:dry
npm run automation:all:dry
```

Dry-run rules:

- Reads Raindrop, TMDB, Notion and (when Admin credentials are available)
  Firestore.
- Never writes R2, Notion, Firestore, or pipeline state.
- If `FIREBASE_SERVICE_ACCOUNT_JSON` is unavailable locally, existing job and
  catalogue state is empty; the report will look like everything is new.
- Exit code is `0` even when records need review or fail, unless the process
  itself fails.

### Apply run

GitHub → Run workflow → check `apply`, or locally:

```bash
npm run automation:ingest
npm run automation:publish
```

`--apply` requires:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- the complete R2 credential set (ingestion)
- `NOTION_KEY`, `NOTION_DATABASE_ID`
- `RAINDROP_ACCESS_TOKEN`, `RAINDROP_COLLECTION_ID`, `TMDB_API_KEY` (ingestion)

Apply runs exit `1` when any record failed, after writing the summary.

### CLI reference

```text
tsx automation/ingestion/cli.ts --mode ingest|publish|all [--apply]
                                [--limit N] [--max-pages N]
                                [--run-id ID] [--summary-out PATH]
```

- stdout: one JSON summary document.
- stderr: structured JSON logs.
- `--summary-out` also writes the summary to a file (CI uses `artifacts/`).

Example:

```bash
npx tsx automation/ingestion/cli.ts \
  --mode ingest --limit 5 --max-pages 2 \
  --run-id local-dry-1 \
  --summary-out /tmp/ingest.json
```

---

## 5. Report fields

Ingestion:

```json
{
  "mode": "ingest",
  "dryRun": true,
  "counts": {
    "bookmarksDiscovered": 12,
    "alreadyProcessed": 5,
    "newCandidates": 7,
    "tmdbMatches": 6,
    "needsReview": 1,
    "uploadsVerified": 0,
    "notionDraftsCreated": 0,
    "notionDraftsUpdated": 0,
    "failed": 0
  },
  "failures": []
}
```

Publishing:

```json
{
  "mode": "publish",
  "dryRun": false,
  "counts": {
    "publishedRecordsDiscovered": 4,
    "firestoreRecordsCreated": 2,
    "firestoreRecordsUpdated": 1,
    "alreadySynchronized": 1,
    "needsReview": 0,
    "failed": 0
  },
  "failures": []
}
```

`failures[]` entries never contain credentials. They identify the poster,
Raindrop ID (when known), stage, reason and retryability.

Both workflows also write the counts to the GitHub Actions job summary and
upload `artifacts/*-summary.json` (retained 14 days).

---

## 6. Monitoring and diagnosis

Start with the job summary, then the structured logs:

```bash
gh run list --workflow=raindrop-ingestion.yml
gh run view <run-id> --log
```

Each log line is JSON with `ts`, `level`, `runId`, `mode`, `dryRun`, `event`,
and event-specific fields. Useful events:

| Event                           | Meaning                                  |
| ------------------------------- | ---------------------------------------- |
| `raindrop.fetched`              | pages/bookmarks read, truncation flag    |
| `ingest.candidates_selected`    | discovered vs already processed vs batch |
| `ingest.dry_run_upload_planned` | planned versioned keys, no write         |
| `ingest.stage_failed`           | stage failure with retryability          |
| `r2.object_verified`            | origin + CDN verified                    |
| `r2.object_reused`              | existing verified object reused          |
| `publish.identity_unresolved`   | needs review or conflict                 |
| `publish.record_synced`         | Firestore create/update confirmed        |
| `publish.record_failed`         | write or read-back failure               |

Inspect durable state with a trusted Admin session:

```text
automationIngestionJobs/{posterId}
automationIngestionRuns/{runId}
```

Never query or export these collections from a browser client.

---

## 7. Publication workflow

1. Reviewer opens the Notion Draft created by ingestion.
2. Verify title, year, media type, artist, genre, library and image.
3. Set `Status` to `Published`.
4. Wait for the next publishing sync (≤ 20 minutes) or run it manually.
5. Confirm the record exists in Firestore with `status: "published"` and an
   image URL.
6. The public site refreshes within its existing 2-minute in-memory cache.

The publishing sync never changes `Status`; it only reads it. If you move a
record back to Draft, Review, Archived or Rejected, the next sync sets the
Firestore document's `status` accordingly and the public query stops serving it.

---

## 8. Activation checklist

Nothing below has been executed. Activation requires explicit approval.

1. **Merge authorization and deployment** — this branch is not committed,
   pushed, or deployed. The dynamic resolver change only takes effect when the
   frontend is deployed.
2. **Firestore rules** — add server-only denial rules for
   `automationIngestionJobs` and `automationIngestionRuns`. Admin SDK access is
   unaffected.
3. **Secrets and variables** — add every name in sections 2 and 3.
4. **Dry-run verification** — run both workflows manually with `apply`
   unchecked and compare the report with the Notion catalogue.
5. **Integration approval** — if an integration test needs real R2/Notion/
   Firestore writes, obtain explicit approval first; do not run it as part of
   implementation.
6. **First apply batch** — run ingestion manually with `apply: true` and
   `limit: 1`. Confirm the Notion Draft, both R2 objects, and the CDN response.
7. **Publish one record** — set its Notion Status to Published, run the
   publishing workflow with `apply: true`, and confirm the Firestore document
   and public page.
8. **Enable schedules** — set `AUTOMATION_ENABLED=true` only after steps 1–7
   pass.

To pause automation at any time, set `AUTOMATION_ENABLED` to `false` or delete
it. In-flight runs finish; queued runs skip.

---

## 9. Security model

- Least privilege: `permissions: contents: read`; no PR trigger.
- Actions are pinned to commit SHAs.
- Explicit timeouts and a shared non-cancelling concurrency group.
- Secrets are injected per step; the CLI never prints environment values.
- Logs redact bearer tokens and credential query parameters.
- R2 public base URL is fixed to `https://images.cineprint.click`; `.r2.dev` is
  rejected by the existing store factory.
- New R2 objects use versioned keys and `If-None-Match`, so a run cannot
  overwrite verified bytes.
- Notion/Firestore input is validated before use; malformed dynamic image
  references fail closed.

---

## 10. Known operational limitations

- Dry-run without Admin credentials cannot read durable state.
- `RAINDROP_COLLECTION_ID` is a variable, not a secret; changing it starts a new
  source namespace. Existing poster identities remain stable.
- Batch limits mean a large backlog drains over several runs.
- The publishing sync scans at most 1,000 rows per run (10 × 100).
- The sitemap is generated at build time; newly published posters enter it on
  the next deployment (existing behaviour).
- Published pages with incomplete metadata are reported, not written. Complete
  the Notion properties and rerun.
- Automated drafts default `style` to `Minimalist` and `tags` to empty because
  the current Notion schema has no pipeline-set values for them.
- Deleting a Notion page does not delete or archive the Firestore document; the
  pipeline never prunes catalogue data.
