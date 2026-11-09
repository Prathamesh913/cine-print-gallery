# CinePrint R2 Migration — Recovery Runbook

This runbook is for a future, separately authorized R2 migration. Nothing in this document authorizes an upload, overwrite, deletion, deployment, or activation. Commands that can mutate external services are marked **[AUTHORIZATION REQUIRED]**.

The current environment has **no reliable rollback source in Vercel Blob**. Blob objects may be missing, stale, or unavailable (the canary path has previously returned 403). Rollback must use verified R2 historical versions and explicit version pointers, not Blob.

## 1. Pre-run validation

1. Confirm the branch and HEAD match the approved migration commit.
2. Confirm the worktree contains no unexpected changes:
   ```bash
   git status --porcelain=v1
   git rev-parse HEAD
   ```
3. Confirm the six canary objects, state, map, allowlist, and generated runtime map are unchanged:
   ```bash
   sha256sum migration/migration-state.json migration/r2-image-map.json \
     migration/r2-resolver-allowlist.json src/lib/r2-image-map.generated.ts
   npm run r2:map:check
   ```
4. Validate the manifest and identity snapshot:
   ```bash
   npx vitest run automation/migration/manifest.test.ts automation/identity
   ```
5. Confirm no medium-confidence poster is in scope. The two medium identities remain excluded until separately approved.
6. Confirm the optimizer identity (`sharp` version and `libvips` version) matches the version recorded in the plan.

## 2. Local plan inspection

```bash
npm run migration:dry-run
npm run migration:preflight
npm run migration:preflight -- --json
```

Local pre-flight is **not bucket evidence**. It validates the 58 eligible posters / 116 planned keys, the final key convention, duplicate keys, canary exclusion, and canary URL preservation. It reports every key as `UNKNOWN` with `LOCAL_PLAN_ONLY` evidence and blocks uploads.

Inspect the report for:

- `planned keys: 116`
- `local validation: ok`
- `canary keys excluded: yes`
- `canary URLs unchanged: yes`
- no duplicate keys
- the expected optimizer identity

## 3. Authorized live pre-flight **[AUTHORIZATION REQUIRED]**

A live pre-flight performs read-only `HeadObject` requests only. It must be explicitly authorized and run with `mode: "live"`, `allowLiveHead: true`, and an R2 store. Do not run it from this phase.

Before authorizing it, confirm:

- the bucket and public base URL are the approved production values;
- the run uses the same manifest and optimizer identity as the local plan;
- no migration or canary writer holds the lock.

The live report must cover all 116 keys. A partial result set is a hard stop.

## 4. Interpreting pre-flight classifications

| Classification    | Meaning                                                                                                            | Operator action                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `ABSENT`          | `HeadObject` returned 404. The key is absent.                                                                      | Safe to plan a create-only upload.                                                                       |
| `EXISTS_MATCH`    | Object exists and every locally verifiable field matches.                                                          | Do not upload. Record as already present; a byte-level verification is still required before activation. |
| `EXISTS_MISMATCH` | Object exists but identity, checksum, size, type, Cache-Control, or metadata differs.                              | **Hard stop.** Never overwrite or adopt. Investigate ownership and provenance.                           |
| `UNKNOWN`         | The check was inconclusive (timeout, abort, or a field that cannot be locally confirmed, such as optimized bytes). | **Hard stop.** Re-run the authorized pre-flight or perform read-only verification.                       |
| `ERROR`           | The request failed for a non-conclusive reason.                                                                    | **Hard stop.** Investigate credentials, permissions, endpoint, and network.                              |

`complete: false` or `blocksUpload: true` means no upload may start. A failed HEAD is never proof of absence.

## 5. Batch execution and checkpoints

**[AUTHORIZATION REQUIRED]** for any execute command.

Use an explicit poster selection and a stable run ID. The CLI initializes `RunObserver` before work, opens the audit log, and passes the observer to the engine. The engine writes state checkpoints after each durable transition and emits audit events. Keep state and audit files separate:

- state: `migration/migration-state.json` (or an approved `--state` path)
- audit: a run-specific append-only JSONL file, one per run (`--audit`, default `migration/audit/<run-id>.jsonl`)
- stable identity: `--run-id` and `--batch-id`
- optional structured log: `--log-file`

Recommended execution shape:

1. Start with a small canary selection.
2. Verify each poster before widening the batch.
3. Check the audit sequence is monotonic and the summary is consistent.
4. Never run two writers against the same state or audit path.

## 6. Verification and final inventory

```bash
npm run migration:verify
```

Verification is read-only. It checks origin bytes, checksums, metadata, and public CDN delivery. A final inventory must show:

- planned objects = 116
- verified objects = expected count
- zero conflicts
- zero unknown objects
- zero pending posters
- every poster either verified or explicitly skipped with a documented reason

Do not activate the versioned map based on local or mock evidence.

## 7. Threshold-triggered pause

Defaults:

| Signal                        | Threshold | Action                                    |
| ----------------------------- | --------- | ----------------------------------------- |
| Source failure rate           | > 5%      | Pause                                     |
| R2 upload failure rate        | > 2%      | Pause                                     |
| CDN verification failure rate | > 1%      | Pause                                     |
| HTTP 429 rate                 | > 5%      | Pause and reduce concurrency after review |
| p95 operation latency         | > 30 s    | Warning and investigation                 |

Denominators are completed operations in the sampling window (default 500 completed operations). Percentages are not evaluated below 20 samples. Hard stops always take precedence.

On pause:

1. Stop starting new posters. Running workers are allowed to settle.
2. Wait for `settle()` / worker completion before releasing the lock.
3. Inspect the audit and summary.
4. Fix the cause, validate state, then resume the **same** run, batch, and poster selection.

## 8. Hard-stop investigation

These are hard stops and cannot be overridden by thresholds:

- checksum mismatch
- source revision change
- object conflict
- unexpected object or inventory mismatch
- origin verification failure
- metadata mismatch
- ambiguous upload
- state persistence failure
- lock ownership failure
- incomplete pre-flight
- unexpected internal error

Do not auto-resume. Collect the required evidence from the failure policy, resolve the underlying condition, validate state, and obtain operator approval before a new run.

## 9. Ambiguous upload reconciliation

A lost upload response is not a conflict and is not permission to overwrite.

1. Read the object back with bounded attempts.
2. If it exists and all expected bytes, length, Content-Type, Cache-Control, and user metadata match, accept it as uploaded/verified.
3. If it exists and differs, treat it as a hard conflict.
4. If it is proven absent, a create-only retry is safe.
5. If existence cannot be established, stop the poster as failed/unknown.

Never use `PutObject` to "repair" an ambiguous object.

## 10. State corruption and recovery

The state writer validates the exact payload before replacing the live file, writes a temp file, fsyncs it, renames atomically, and best-effort fsyncs the directory.

If state is corrupt:

1. Stop all writers.
2. Preserve the corrupt file and audit log as evidence.
3. Validate the last known-good checkpoint from the audit trail.
4. Do not hand-edit state to make a run look successful.
5. Rebuild state only through a separately reviewed recovery procedure, then re-verify against R2.

A leftover `.tmp` file is ignored on load and never auto-promoted. Directory fsync is not portable; unsupported error codes are documented and ignored, but the file fsync + rename still apply.

## 11. Lock ownership and stale locks

Locks are host-local files with a random ownership token. Release refuses to remove a lock whose token, PID, or hostname no longer matches.

- A live lock: do not remove it.
- A stale lock: confirm no migration is running, then use the explicit `--break-lock` recovery path.
- A malformed, foreign-host, or out-of-scope lock: inspect manually; never delete blindly.

Cross-host coordination is not implemented. `If-None-Match: *` conditional writes remain the final protection against duplicate object creation.

## 12. Safe resume of the same batch

Resume requires:

- the same stable run ID and audit log;
- the same batch ID;
- the same explicit poster selection;
- validated state;
- no hard-stop condition;
- a complete, authorized pre-flight for any key that has not been conclusively checked.

The audit sequence must continue monotonically. A different run ID against an existing audit log is rejected. Resume with the same `--run-id`, `--batch-id`, `--audit` path and explicit poster selection; the CLI prints the audit path and an audit-backed summary.

## 13. Rollback through verified historical versions

Rollback changes selection metadata only:

1. Select a previously **verified** original version and its matching optimized derivative.
2. Write an explicit current-version pointer.
3. Validate the history pair (same source checksum, derivative belongs to the selected original).
4. Keep superseded objects; do not delete them.
5. Re-run origin and public verification after the pointer change.

Do **not** use Vercel Blob as a rollback source. It is not a reliable source of truth in this environment.

## 14. Production activation **[AUTHORIZATION REQUIRED]**

Activation is a separate authorization. It requires:

- a complete live migration summary;
- zero hard stops;
- verified inventory;
- a separately reviewed resolver/activation change;
- explicit approval to change browser, download, or SEO behavior.

Do not activate the versioned map, resolver defaults, or SEO output as part of a migration run.

## 15. Retention and deletion **[AUTHORIZATION REQUIRED]**

Object deletion, lifecycle rules, and audit retention changes are a separate authorization. The migration does not delete superseded objects automatically. Preserve audit history and version records until a reviewed retention decision is approved.

## Audit and observability reference

The local observability stack is implemented in:

- `automation/migration/events.ts` — versioned event schema and enums
- `automation/migration/logger.ts` — structured JSON logging and sink-failure policy
- `automation/migration/audit.ts` — append-only JSONL audit trail
- `automation/migration/failures.ts` — failure categories and operator policies
- `automation/migration/health.ts` — summaries, thresholds, pause/resume controller
- `automation/migration/observer.ts` — run observer that ties audit, logging, and pause control together

A run observer is constructed with a stable `runId`, optional `batchId`, an evidence mode (`local_plan`, `mock`, `live_preflight`, `live_migration`), an audit path, the planned poster IDs, and optional log sinks. The engine accepts it through `eventSink`.

Audit records are never rewritten. A partial final line is preserved in a `.partial-<timestamp>.log` sidecar, the incomplete tail is removed from the active log, and the recovery is reported. Malformed complete records, duplicate sequences, and out-of-order sequences fail closed.
