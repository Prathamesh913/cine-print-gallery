# CinePrint Raindrop Automation — Operations

Status: configured, **not activated**. Nothing writes until an operator explicitly
authorizes it. Manual dry-runs are always available; manual applies and
scheduled applies have separate, independent gates (see §1.1).

Related:

- `docs/raindrop-automation-audit.md`
- `docs/raindrop-automation-architecture.md`
- `docs/raindrop-automation-failure-recovery.md`

---

## 1. Workflows

| Workflow (entry point) | File                                           | Schedule (UTC)    | Manual              | Timeout |
| ---------------------- | ---------------------------------------------- | ----------------- | ------------------- | ------- |
| Raindrop ingestion     | `.github/workflows/raindrop-ingestion.yml`     | `*/20 * * * *`    | `workflow_dispatch` | 20 min  |
| Notion publishing sync | `.github/workflows/notion-publishing-sync.yml` | `5,25,45 * * * *` | `workflow_dispatch` | 15 min  |

Both entry points share a single non-cancelling concurrency group. The run body
for each integration lives in a `workflow_call`-only reusable workflow
(`automation-ingest-run.yml`, `automation-publish-run.yml`), which re-checks the
resolved authorization before `npm ci` and before any credential is exposed to a
step.

### 1.1 Activation lanes

| Lane | Trigger | Required gate | Limit | Writes | Environment |
| --- | --- | --- | --- | --- | --- |
| Manual dry-run | `workflow_dispatch`, `action=dry-run` | None — runs while both activation variables are unset | Operator-selected, 1–100 | Never | `automation-manual-dry-run` |
| Manual apply | `workflow_dispatch`, `action=apply` | `AUTOMATION_MANUAL_APPLY_ENABLED == 'true'` **and** `confirm_apply == 'APPLY-ONE-POSTER'` | Exactly `1` | Yes | `automation-manual-apply` (protect with required reviewers) |
| Scheduled apply | `schedule` | `AUTOMATION_ENABLED == 'true'` **and** `github.event_name == 'schedule'` | `10` (ingestion) / `50` (publish) | Yes | `automation-scheduled` |

The gates never overlap:

- `AUTOMATION_ENABLED` cannot make a manual dispatch writable.
- `AUTOMATION_MANUAL_APPLY_ENABLED` cannot arm a cron run.
- A manual dispatch can never satisfy the scheduled event check, and a scheduled
  event can never satisfy the manual event check.
- Setting either variable does not change the other, and neither is inferred from
  a missing input.
- Each lane is bound to its own environment (`automation-manual-dry-run`,
  `automation-manual-apply`, `automation-scheduled`); the gate rejects a run that
  tries to reuse another lane's environment.

Invalid dispatch input (unknown action, non-numeric or out-of-range limit, apply
without the confirmation phrase, apply without the manual gate) fails in the
`Validate dispatch inputs` job. The write job depends on that validation and is
skipped when it fails.

Concurrency note: `concurrency.group: cineprint-catalog-automation` with
`cancel-in-progress: false` only serializes GitHub Actions runs of these two
workflows. It does **not** protect against local CLI runs, other repositories, or
any independent runner. Do not run a local `--apply` while a workflow is active.

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

| Variable                                  | Example                          | Purpose                                                        |
| ----------------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| `AUTOMATION_ENABLED`                      | `true`                           | Scheduled-lane gate only (absent/false = cron disabled)         |
| `AUTOMATION_MANUAL_APPLY_ENABLED`         | `true`                           | Manual-apply-lane gate only (absent/false = apply dispatch skipped) |
| `RAINDROP_COLLECTION_ID`                  | `12345678`                       | Designated ingestion collection                                |
| `NOTION_DATABASE_ID`                      | `38c890a5f3e2800783f8da7b81a268e4` | Poster Library **database** (not a data source)              |
| `NOTION_POSTER_DATA_SOURCE_ID`            | `38c890a5-f3e2-808b-a395-000b9b97e9db` | Poster Library **data source** (see §3.0)                    |
| `NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID` | `412890a5-f3e2-81bb-a5fc-000b21b7ba8a` | Optional multi-image identity **data source** (see §3.1)      |
| `R2_BUCKET_NAME`                          | bucket name                      | Never change without an approved migration                     |
| `R2_PUBLIC_BASE_URL`                      | `https://images.cineprint.click` | Must stay the production domain                                |

### 3.0 Database IDs and data source IDs are different

Notion's data-source API distinguishes a database from the data sources inside
it. The CinePrint Poster Library database contains two data sources: `Poster
Library` (catalogue pages) and `Poster Identities` (per-image rows). Passing a
database ID where a data source ID is expected produces:

```
object_not_found: Could not find data_source with ID: <database id>
```

The publishing and ingestion pipelines therefore resolve and validate every
Notion object before reading or writing a record:

- `NOTION_DATABASE_ID` is the database used by `databases.retrieve`.
- `NOTION_POSTER_DATA_SOURCE_ID` is the catalogue data source. When it is set it
  is used directly. When it is absent and the database exposes exactly one data
  source, that one is used. When the database exposes several, the run fails with
  a configuration error that names the candidates; it never guesses.
- The resolved catalogue data source must expose the properties each pipeline
  writes: `Status` and `Image URL` for publishing, plus `Raindrop ID` for
  ingestion. This prevents accidentally polling the Poster Identities table.
- Page creation targets the resolved data source (`parent.data_source_id`), which
  is required by the Notion `2025-09-03` API when a database has several data
  sources.
- `NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID` must be a data source, must be
  readable, and must not be the catalogue data source. Publishing reads identity
  rows from it; ingestion does not use it.

Configuration errors name the variable and the offending ID (never a secret),
and distinguish an inaccessible ID from a missing optional one.

### 3.1 Poster identities data source is optional

`NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID` is **optional**, consistently across the
code and workflows:

- `automation/ingestion/config.ts` reads it with `optional(...)`; absence yields
  `null`.
- `NotionPollingSource.listIdentityRecords()` returns `[]` immediately when the
  id is unset or blank; it does not query the catalogue data source as a
  substitute and does not invent another data source.
- The publishing sync then resolves single-image pages normally, while a
  multi-image page with no identity records is reported as `needs review` (or a
  conflict) instead of guessing an image-to-poster mapping.
- Ingestion does not use this id at all (it creates drafts through
  `NotionApiClient`, which discovers the catalogue data source from the database).

Only the publishing sync passes the variable. Removing it is a supported
degraded mode for single-image catalogues, not a silent fallback.

### 3.2 Environments

The reusable run bodies select a GitHub Environment from the lane:

| Environment | Used by | Required protection |
| --- | --- | --- |
| `automation-manual-dry-run` | manual dry-run | None. Do not add reviewers: dry-runs are read-only and should stay frictionless. |
| `automation-manual-apply` | manual apply | **Required reviewers** (at least one) and, if available, restrict deployment branches to `main`. |
| `automation-scheduled` | scheduled apply | None. Keep this environment free of reviewers so cron runs are not blocked. |

These environments cannot be configured from workflow code. Before authorizing
the first manual apply, an administrator must open **Settings → Environments →
`automation-manual-apply`** and add at least one required reviewer. Until that is
done, GitHub auto-creates the environment without protection, so the confirmation
phrase and the `AUTOMATION_MANUAL_APPLY_ENABLED` variable remain the only gates.

There is no unprotected fallback: the reusable run body rejects a manual apply
that does not use `automation-manual-apply`, including an attempt to reuse
`automation-manual-dry-run` or `automation-scheduled`.


---

## 4. Running manually

### 4.1 Dispatch inputs

| Input | Type | Default | Meaning |
| --- | --- | --- | --- |
| `action` | choice: `dry-run` / `apply` | `dry-run` | The only way to request writes. A missing action is never interpreted as apply. |
| `confirm_apply` | string | empty | Must be exactly `APPLY-ONE-POSTER` for `apply`. Ignored for dry-runs. |
| `limit` | string | `1` | 1–100. `apply` requires exactly `1`. Invalid or empty values fail validation. |
| `max_pages` | string | `4` | Ingestion only; 1–20. |

### 4.2 Dry-run

GitHub → Actions → select the workflow → **Run workflow** → `action: dry-run`
(the default). This works while `AUTOMATION_ENABLED` and
`AUTOMATION_MANUAL_APPLY_ENABLED` are both unset, and it does not receive any R2
or Firebase write credential.

Or locally:

```bash
npm run automation:ingest:dry
npm run automation:publish:dry
npm run automation:all:dry
npx tsx automation/ingestion/cli.ts --mode all --limit 5 --max-pages 2
```

Dry-run rules:

- Reads Raindrop, TMDB, Notion and (when Admin credentials are available)
  Firestore.
- Never writes R2, Notion, Firestore, or pipeline state.
- If `FIREBASE_SERVICE_ACCOUNT_JSON` is unavailable locally, existing job and
  catalogue state is empty; the report will look like everything is new.
- Exit code is `0` even when records need review or fail, unless the process
  itself fails.

### 4.3 Manual apply (one poster / one record)

Preconditions:

1. `automation-manual-apply` has at least one required reviewer.
2. `AUTOMATION_MANUAL_APPLY_ENABLED` is set to `true` immediately before the run.
3. The dry-run report was reviewed and one specific poster/record was approved.

GitHub → Run workflow → `action: apply`, `confirm_apply: APPLY-ONE-POSTER`,
`limit: 1`. The run waits for environment approval and then writes.

Locally, the CLI requires both the confirmation flag and an explicit limit;
without them it exits `2` and performs no work:

```bash
npx tsx automation/ingestion/cli.ts \
  --mode ingest --apply --confirm-apply --limit 1 \
  --run-id local-apply-1 \
  --summary-out /tmp/ingest-apply.json
```

`--apply` requires:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- the complete R2 credential set (ingestion)
- `NOTION_KEY`, `NOTION_DATABASE_ID`
- `RAINDROP_ACCESS_TOKEN`, `RAINDROP_COLLECTION_ID`, `TMDB_API_KEY` (ingestion)

Apply runs exit `1` when any record failed, after writing the summary.

After the single-poster run, set `AUTOMATION_MANUAL_APPLY_ENABLED` to `false` or
delete it. It is not a schedule switch, but leaving it set keeps the manual apply
lane armed. The former `npm run automation:ingest` / `automation:publish`
convenience scripts were removed so that no single command can write by itself.

### 4.4 CLI reference

```text
tsx automation/ingestion/cli.ts --mode ingest|publish|all
                                [--apply --confirm-apply --limit N]
                                [--max-pages N]
                                [--run-id ID] [--summary-out PATH]
```

- Dry-run is the default. `--apply` without `--confirm-apply` exits `2`.
- `--apply` without an explicit `--limit` exits `2`.
- `--confirm-apply` without `--apply` exits `2`.
- stdout: one JSON summary document.
- stderr: structured JSON logs.
- `--summary-out` also writes the summary to a file (CI uses `artifacts/`).


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
4. Wait for the next publishing sync (≤ 20 minutes) or run the publishing
   workflow's one-record apply lane to verify without waiting for cron.
5. Confirm the record exists in Firestore with `status: "published"` and an
   image URL.
6. The public site refreshes within its existing 2-minute in-memory cache.

The publishing sync never changes `Status`; it only reads it. If you move a
record back to Draft, Review, Archived or Rejected, the next sync sets the
Firestore document's `status` accordingly and the public query stops serving it.

---

## 8. Activation checklist

Nothing below has been executed. Each step requires explicit approval.

1. **Manual dry-run** — run both workflows with `action: dry-run` (works with
   both activation variables unset) or run the CLI dry-run commands locally.
2. **Review output** — compare `bookmarksDiscovered`, `newCandidates`,
   `needsReview`, `publishedRecordsDiscovered` and `alreadySynchronized` with the
   Raindrop collection, Notion catalogue and Firestore posters. Resolve
   `needsReview` entries before proceeding.
3. **Configure credentials** — add every secret in §2 and every non-activation
   variable in §3 (leave `AUTOMATION_ENABLED` and
   `AUTOMATION_MANUAL_APPLY_ENABLED` unset). Add the required reviewer to
   `automation-manual-apply` (§3.2), and confirm Firestore rules keep
   `automationIngestionJobs` and `automationIngestionRuns` client-inaccessible.
4. **Obtain explicit approval for one-poster apply** — name the poster, the
   expected R2 keys, the expected Notion Draft and the rollback step. Only then
   set `AUTOMATION_MANUAL_APPLY_ENABLED=true`.
5. **Run the one-poster integration test** — `action: apply`,
   `confirm_apply: APPLY-ONE-POSTER`, `limit: 1`. Confirm the Notion Draft, both
   R2 objects and the CDN response. Set `AUTOMATION_MANUAL_APPLY_ENABLED=false`
   immediately afterwards.
6. **Verify publication separately** — set the Draft's Notion `Status` to
   `Published`, then run the publishing workflow's one-record apply lane
   (`action: apply`, `confirm_apply: APPLY-ONE-POSTER`, `limit: 1`). Confirm the
   Firestore document, `r2Image` reference, public page and sitemap after the next
   deployment.
7. **Enable schedules only after recurring-operation prerequisites are complete**
   — the distributed-lock decision, atomic Firestore creation, permanent-error
   retry handling and a passed live end-to-end run. Then set
   `AUTOMATION_ENABLED=true`. The manual variables must stay unset.

To pause automation at any time, set `AUTOMATION_ENABLED` to `false` or delete
it. In-flight runs finish; queued runs skip. To disarm manual apply, do the same
with `AUTOMATION_MANUAL_APPLY_ENABLED`; this never affects cron and vice versa.

---

## 9. Security model

- Least privilege: `permissions: contents: read`; no PR trigger.
- Actions are pinned to commit SHAs; the only unpinned `uses:` is the local
  reusable workflow reference.
- Explicit timeouts and a shared non-cancelling concurrency group.
- Independent authorization gates: schedule vs manual apply, checked both in the
  caller job condition and again before dependency installation in the reusable
  run body.
- Reusable run bodies are restricted to the `Prathamesh913/cine-print-gallery`
  repository using both `github.repository` and
  `github.event.repository.full_name`; because this is a public repository,
  `workflow_call` bodies are otherwise callable from other repositories.
- `.github/workflows/automation-safety.yml` runs the gate tests, ingestion tests,
  ESLint and actionlint on pull requests and `main` pushes. It has no secrets,
  environments, deployment or dispatch and uses `permissions: contents: read`.
- Manual apply requires an exact confirmation phrase, a single-item limit and
  the protected `automation-manual-apply` environment.
- Dry-runs receive no R2 credentials; R2 variables are blanked for non-apply
  runs. The publishing dry-run does receive `FIREBASE_SERVICE_ACCOUNT_JSON` so it
  can read existing state, but the CLI wraps the Firestore adapters in read-only
  proxies whose `create`, `update` and `save` methods throw.
- Firestore security rules do not apply to Admin SDK credentials, so the dry-run
  read-only guarantee is enforced in code, not by rules. For defence in depth a
  dedicated service account with `roles/datastore.viewer` can serve the same
  reads; Firestore IAM is project-wide, so it cannot be limited to a collection.
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

- A dry-run without Admin credentials cannot read durable state. The publishing
  workflow always supplies them; a local run without them reports
  `stateSource: "memory"` in the summary so the empty-state fallback is visible.
- A database that exposes several data sources requires
  `NOTION_POSTER_DATA_SOURCE_ID`; the run refuses to guess.
- GitHub concurrency does not protect local CLI executions or independent
  runners; coordinate them manually.
- `RAINDROP_COLLECTION_ID` is a variable, not a secret; changing it starts a new
  source namespace. Existing poster identities remain stable.
- Without `NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID`, multi-image pages are
  reported for review instead of being resolved from identity rows (§3.1).
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
