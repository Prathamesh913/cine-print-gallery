# Phase 8F — Focused Observability Integration & Blocker Remediation Report

Date: 2026-11-08  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`

## 1. What was fixed

- Wired `RunObserver`, `AuditLog`, `StructuredLogger`, failure classification, `BatchPauseController`, and run summaries into the real CLI paths: `migration:run`, `migration:canary`, `migration:verify`.
- Initialization happens before migration work and aborts the command on failure.
- Added CLI flags: `--audit`, `--run-id`, `--batch-id`, `--log-file`. Default audit path is `migration/audit/<run-id>.jsonl`.
- Engine events are persisted through the observer; lock acquire/release/reject events are emitted around the global migration lock.
- Workers settle and the observer checkpoints/closes before the command reports completion.
- `migration:verify` now reports verification results and sets a non-zero exit code when verification is incomplete; it does not print a migration-success summary.
- Fixed false-success reporting: completion now requires every selected poster verified, no skipped/pending/failed posters, and every planned object verified.
- Added `partialSuccess` so partial results remain distinguishable from full success.
- Fixed threshold accounting to use completed operations keyed by stable operation identity, not raw event positions. Source, R2 upload, CDN, and source HTTP 429 outcomes are measured; p95 uses completed-operation durations.
- Hard stops still scan the full history and override percentage thresholds.
- Audit now rejects non-deterministic caller-supplied event IDs and duplicate event IDs at append and during recovery.
- Recovered partial final lines remain usable: only fatal audit issues block summaries.
- Error masking fixed with `MigrationObservabilityError`, preserving the original operation error, its classification, and the secondary audit/logger error. CLI prints both.
- Object accounting now counts unique object keys and distinguishes attempted, uploaded, discovered, reconciled, origin-verified, public-verified, verified, conflicted, failed, and unknown objects. Upload acknowledgement alone is not verification.
- Redaction now covers environment-style secret assignments including `NOTION_KEY`, `FIREBASE_PRIVATE_KEY`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFLARE_API_TOKEN`, `R2_SECRET_ACCESS_KEY`, `VERCEL_OIDC_TOKEN`, `API_KEY`, `ACCESS_TOKEN`, `CLIENT_SECRET`, and `PASSWORD`, including casing and `_`, `-`, `.`, or space separators.
- Updated migration README and recovery runbook for the CLI flags and observer wiring.

## 2. Exact files changed

**Added**

- `automation/migration/command-runner.ts` — shared CLI observer factory, observed-batch lock wrapper, observer close helper.
- `automation/migration/cli-observability.test.ts` — 8-test CLI/engine/observer smoke suite.
- `migration/PHASE-8F-REMEDIATION-REPORT.md` — this report.

**Modified**

- `automation/migration/cli.ts`
- `automation/migration/cli-args.ts`
- `automation/migration/cli-args.test.ts`
- `automation/migration/engine.ts`
- `automation/migration/health.ts`
- `automation/migration/health.test.ts`
- `automation/migration/audit.ts`
- `automation/migration/audit.test.ts`
- `automation/migration/observer.ts`
- `automation/migration/failures.ts`
- `automation/migration/redaction.ts`
- `automation/migration/logger.test.ts`
- `automation/migration/source.ts`
- `automation/migration/types.ts`
- `migration/README.md`
- `migration/RECOVERY-RUNBOOK.md`

## 3. Actual CLI observability integration

- `createCliObserver` opens `AuditLog` with a stable run ID and batch ID, constructs `StructuredLogger`, and passes `RunObserver` to the engine as `eventSink`.
- `migration:run` and `migration:canary`:
  - initialize the observer before the global lock;
  - emit `lock.acquired` inside the lock;
  - run the engine with the observer;
  - emit `lock.released` after workers settle;
  - print an audit-backed summary with planned/verified/skipped/failed/pending posters and object counts;
  - close the observer in `withObserver`, preserving the original error if cleanup fails.
- `migration:verify`:
  - initializes the observer with `live_preflight` evidence;
  - emits run/batch and per-poster verification events;
  - prints the existing verification summary;
  - sets `process.exitCode = 1` when any verification is incomplete;
  - never prints a migration-success summary.
- Defaults:
  - `--run-id` generated when omitted; reuse it for resume.
  - `--batch-id` defaults to a deterministic hash of the selected poster IDs.
  - `--audit` defaults to `migration/audit/<run-id>.jsonl`.
  - `--log-file` is optional; when set, structured JSON lines are written there.
- Initialization or audit-write failure aborts the command. No success is reported without required audit persistence.

## 4. Smoke-test result

`automation/migration/cli-observability.test.ts` — **8 tests passed**, covering the shared CLI observer/runner path:

1. A successful mocked poster produces the expected audit events and a complete/live-success summary; the lock is held during the upload and released after workers settle.
2. An unavailable poster yields `skippedPosters: 1`, `complete: false`, and `liveSuccess: false`.
3. A source failure with a failing log sink retains the original `SourceUnavailableError` message and adds the secondary observability failure.
4. An upload acknowledgement alone yields `uploadedObjects: 1`, `verifiedObjects: 0`, and no success.
5. Source HTTP 429 events are included in the 429 metric and trigger a pause.
6. Non-deterministic/duplicate event IDs are rejected; recovered partial audit history remains usable (`resumeSafe` and `liveSuccess` can still be true).
7. Environment-style secrets are redacted while poster IDs and R2 keys are preserved.
8. A logger sink failure throws `LogSinkError` rather than silently succeeding.

## 5. Test results

| Check | Result |
|---|---|
| Migration tests | **20 files, 300 tests passed** |
| Identity + migration tests | **25 files, 382 tests passed** |
| Full suite | **943 passed, 4 skipped, 1 failed** |
| Scoped ESLint | **clean (exit 0)** |
| `tsc --noEmit` | **1 pre-existing error**, `src/routes/__root.tsx:148` |
| `git diff --check` | **pass** |
| `npm run r2:map:check` | **pass** — "Generated runtime map is up to date" |

Known pre-existing failure, not repaired: `tests/security/public-firebase-isolation.test.ts:44`, caused by the static `getAdminDb` import in `src/lib/notion.ts:8`.

## 6. Remaining blockers and limitations

- **No live R2 evidence.** No live pre-flight, HEAD/GET, inventory, byte verification, or migration was performed. Live readiness remains **NOT TESTED**.
- **Two medium-confidence identities remain unresolved** and excluded.
- **Locks remain host-local.** Cross-host coordination still depends on R2 conditional writes.
- **Vercel Blob remains an unreliable rollback source.**
- **Audit durability is checkpoint-based.** Critical events are fsynced at state checkpoints and observer close, not on every append.
- **Audit retention/rotation is not implemented.** Each run uses one append-only file; operators must manage retention separately.
- **`migration:verify` does not gate its read-only loop on the pause controller.** It records verification failures but continues reporting all results; it exits non-zero on incomplete verification.
- **Repository-wide lint remains pre-existing/unclean.** Scoped lint for changed migration files is clean.
- No live pre-flight or migration authorization is implied by these fixes.

## 7. Git status and HEAD preservation

- Branch: `feat/r2-image-storage`
- HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`
- Initial and final status: **37 lines**, **19 modified tracked files**, **18 untracked entries**.
- No reset, clean, stash, restore, checkout, branch switch, commit, push, merge, or rebase.
- All pre-existing worktree modifications and untracked files are preserved.
- The only new repository files are the three listed in section 2.

## 8. Canary artifact preservation

Unchanged hashes:

```
migration/migration-state.json        4b85f5cc76766d38a2e5dbf5b2bde79fa3dc31dc2c88c09dd22bfb07650798d1
migration/r2-image-map.json           d2c98e282689eed624cbd05caa890387a7954d56d43263b74809a8b77ae20005
migration/r2-resolver-allowlist.json  0240fcb1ff76cc7696f28122cdd3682e985b61736f2b03a93cab234b137e2ea4
src/lib/r2-image-map.generated.ts     7ede657116cf18d62d2c11b2bced20ae2c612a5aa7e9edd493d24eab69bf336c
```

Six canary keys unchanged:

```
2001-a-space-odyssey   cineprint/raindrop/1528361110.png      cineprint/optimized/legacy/2001-a-space-odyssey.webp
bugonia                cineprint/external/bugonia.jpg         cineprint/optimized/external/bugonia.webp
artwork-1824607248     cineprint/raindrop/1824607248.jpg     cineprint/optimized/1824607248.webp
```

Allowlist remains `2001-a-space-odyssey`, `bugonia`, `artwork-1824607248`. Production browser/download/SEO flags remain disabled by default.

## 9. External-service confirmation

No external service was contacted or mutated:

- No R2 HEAD/GET/PUT/delete.
- No live pre-flight, canary, migration, or verification.
- No Firestore, Notion, Raindrop, Vercel Blob, Vercel, Cloudflare, or DNS access.
- No deployment, environment, secret, or activation change.
- No commit, push, merge, rebase, or branch switch.
- All tests used local fixtures, mocks, and temporary directories.
- No secret values were inspected or printed.
