# Phase 8E — Integrated Acceptance, Safety & Migration Readiness Audit

Date: 2026-11-08  
Repository: `/tmp/opencode/wt-r2-image-storage`  
Branch: `feat/r2-image-storage`  
HEAD: `ec5401ca82bb7d71f4679c60f2994cbc607177fe`

## 1. Executive verdict

**Overall: NO-GO for live migration or production activation.**

The storage, identity, versioned-key, create-only upload, bounded-verification, state, and locking layers are substantially implemented and covered by local tests. The local 116-key pre-flight plan is internally consistent and makes no bucket claim.

However, Phase 8D observability is **not integrated into the CLI execution path**. Only tests construct `RunObserver`; `migration:run`, `migration:canary`, and `migration:verify` never initialize an `AuditLog`, `StructuredLogger`, `BatchPauseController`, or run summary. An actual CLI execution can therefore upload, checkpoint, and report results without audit evidence, threshold pause, or hard-stop enforcement.

The audit also found several false-success and evidence-integrity defects in the Phase 8D modules:

1. A live run with a **skipped** poster can report `complete: true` and `liveSuccess: true`.
2. The last-500-event threshold window can drop an operation's `started` event while retaining its failure, producing a biased rate and a missed pause.
3. Source HTTP 429 responses are not represented in the 429-rate denominator because source events do not carry `httpStatus`.
4. `AuditLog.append` accepts duplicate caller-supplied event IDs.
5. A benign recovered partial audit line permanently blocks `resumeSafe` and `liveSuccess` through the audit-issue count.
6. Logging/audit failures can mask the original migration error.
7. `verifiedObjects` counts uploaded-but-unverified objects as verified.
8. Redaction does not catch environment-style assignments such as `NOTION_KEY=...`.

**Live pre-flight readiness: GO WITH CONDITIONS** — the read-only live mode exists and is explicitly gated, but it is not wired to an operator CLI, has never been run live, and must follow Phase 8F remediation plus separate authorization.

**Live migration / activation: NO-GO** — unresolved medium-confidence identities, no live 116-key inventory, no live byte verification, no integrated observability, and no reliable Blob rollback source.

## 2. Initial and final Git status

| | Initial | Final |
|---|---|---|
| Branch | `feat/r2-image-storage` | `feat/r2-image-storage` |
| HEAD | `ec5401ca82bb7d71f4679c60f2994cbc607177fe` | `ec5401ca82bb7d71f4679c60f2994cbc607177fe` |
| Modified tracked files | 19 | 19 |
| Untracked entries | 18 | 18 |
| `git status` lines | 37 | 37 |

The only file created by this phase is `migration/PHASE-8E-ACCEPTANCE-REPORT.md`. All pre-existing modifications and untracked files are preserved. No reset, clean, stash, restore, checkout, branch switch, commit, or push was performed.

Baseline hashes:

```
migration/migration-state.json        4b85f5cc76766d38a2e5dbf5b2bde79fa3dc31dc2c88c09dd22bfb07650798d1
migration/r2-image-map.json           d2c98e282689eed624cbd05caa890387a7954d56d43263b74809a8b77ae20005
migration/r2-resolver-allowlist.json  0240fcb1ff76cc7696f28122cdd3682e985b61736f2b03a93cab234b137e2ea4
src/lib/r2-image-map.generated.ts     7ede657116cf18d62d2c11b2bced20ae2c612a5aa7e9edd493d24eab69bf336c
migration/poster-manifest.json        c98c90c80c0234fab0b17f00f7d5ed4842873e4832a408462c016ee35d6e79a2
```

## 3. Audit scope and exclusions

### Inspected

- `automation/migration/manifest.ts`, `canary.ts`, `engine.ts`, `source.ts`, `optimize.ts`, `r2.ts`, `state.ts`, `lock.ts`, `versioning.ts`, `preflight.ts`, `retry.ts`.
- `automation/migration/events.ts`, `redaction.ts`, `logger.ts`, `audit.ts`, `failures.ts`, `health.ts`, `observer.ts`.
- `automation/migration/cli.ts`, `cli-args.ts`.
- `scripts/preflight-versioned-migration.ts`, `scripts/generate-r2-image-map.ts`, `scripts/export-r2-verified-mappings.ts`.
- `src/lib/poster-images.ts`, `r2-image-activation.ts`, `download-image.ts`, `seo.ts`, `sitemap.ts`, `r2-image-map.generated.ts`.
- `migration/README.md`, `migration/RECOVERY-RUNBOOK.md`, `migration/engine-design.md`.
- Migration and identity tests, including Phase 8D observability tests.

### Executed safely

- Focused migration tests.
- Identity + migration tests.
- Full local test suite.
- Scoped ESLint on Phase 8D modules and engine.
- `tsc --noEmit`.
- `git diff --check`.
- `npm run r2:map:check`.
- `npm run migration:preflight` (local-only; 0 HeadObject requests).

### Explicitly not executed

- No R2 HEAD/GET/PUT/delete.
- No live pre-flight, canary, migration, or verification.
- No Vercel Blob, Firestore, Notion, Raindrop, Vercel, Cloudflare, DNS, deployment, or activation.
- No `.env.local`, credentials, tokens, cookies, private keys, or service-account JSON.
- No `migration:dry-run` or `migration:verify` because they construct an R2 store and may read external object metadata.

## 4. Cross-phase architecture findings

### 4.1 Identity and manifest

- Canonical identity is `cineprintPosterId`, documented as the Firestore document ID (`migration/README.md`, identity contract).
- `validateManifest` requires `notionDerivedId === cineprintPosterId` (`automation/migration/manifest.ts:108-109`).
- The manifest builder assigns `cineprintPosterId: doc.id` (`automation/migration/build-poster-manifest.ts:730`). Positional indexes in the builder are iteration counters only; they are not used as identity.
- Medium/low-confidence entries are blocked unless explicitly approved for `run`, and canaries always reject non-high confidence (`automation/migration/manifest.ts:329-337`, `automation/migration/canary.ts:58-71`).
- The two medium-confidence posters remain excluded from the 58-poster scope and from canary selection.

**Finding:** Identity handling is correct for the 58 high-confidence scope. The two medium identities remain unresolved by design.

### 4.2 Versioned keys and canaries

- Original keys use the full source SHA-256: `cineprint/versions/original/<posterId>/<sha256>.<ext>` (`automation/migration/versioning.ts:256-270`).
- Optimized keys include the full source SHA-256 and optimizer slug: `sharp-<version>-libvips-<version>` (`automation/migration/versioning.ts:272-285`).
- Version IDs also use the full SHA-256 (`automation/migration/versioning.ts:287-301`).
- `assertNoSourceChecksumCollision` fails closed on a truncated-ID collision (`automation/migration/versioning.ts`).
- The six legacy canary keys are pinned in `LEGACY_CANARY_KEYS` and are the only accepted legacy keys.
- Local pre-flight enumerates exactly 116 keys (58 originals + 58 optimized) and excludes the six canary keys.

**Finding:** Key design is internally consistent. No canary rewrite or legacy-key adoption path was found.

### 4.3 Create-only uploads and ambiguous outcomes

- `PutObjectCommand` always sets `IfNoneMatch: "*"` (`automation/migration/r2.ts:496`).
- `uploadWithReconciliation` never overwrites on a lost response or 412 (`automation/migration/engine.ts:282-354`).
- Matching read-back accepts the object as uploaded/verified; mismatching read-back becomes a hard conflict; unavailable read-back becomes an unknown outcome and stops the poster.
- Tests cover lost response with matching read-back, mismatching read-back, unavailable read-back, 412 with matching bytes, 412 with different bytes, and retry only after proven absence (`automation/migration/engine-reconciliation.test.ts`).

**Finding:** Upload safety is sound in the tested paths. No overwrite path was found.

### 4.4 Origin and public verification

- Origin `GetObject` reads are bounded by expected size and a hard ceiling (`automation/migration/r2.ts:126-176, 354-460`).
- Public reads are bounded by expected size, a hard 30 MB ceiling, and a timeout; `Content-Length` is checked before streaming and the body is streamed with cancellation on overflow (`automation/migration/r2.ts:575-735`).
- Public verification validates status, MIME, length, SHA-256, and immutable Cache-Control.
- Source acquisition enforces HTTPS, host allowlists, DNS pinning, private-address rejection, redirect validation, a 30 MB streaming limit, and a configurable 120-second timeout (`automation/migration/source.ts`).

**Finding:** Bounded verification is implemented. Live CDN and R2 behavior remain untested.

### 4.5 State, locking, and resume

- State writes validate the exact payload before replacement, write a `0600` temp file, fsync it, rename atomically, and best-effort fsync the directory (`automation/migration/state.ts:50-100, 360-405`).
- Manifest-hash guards reject state created for a different manifest.
- Per-state and global locks use ownership tokens and refuse to release a lock whose token/PID/host no longer matches (`automation/migration/state.ts:513-538`, `automation/migration/lock.ts:31-39, 118-145`).
- Locks are explicitly host-local; cross-host coordination is not implemented.

**Finding:** Local state and lock behavior matches the documented design. Cross-host safety still depends on conditional R2 writes.

### 4.6 Resolver, map, allowlist, and activation

- The generated runtime map contains exactly the three canary entries and sets `R2_BROWSER_IMAGES_ENABLED = false` and `R2_SEO_IMAGES_ENABLED = false` (`src/lib/r2-image-map.generated.ts:12-13`).
- The resolver only uses an R2 entry when the switch is enabled, the poster ID matches exactly, and `entry.blobImageUrl === poster.image` (`src/lib/poster-images.ts:66-79`).
- Downloads require the separate `R2_DOWNLOADS_ENABLED` preview/local flag (`src/lib/r2-image-activation.ts`).
- Browser, download, and SEO switches remain independently controlled and disabled by default.
- `migration/r2-resolver-allowlist.json` still contains only the three canaries.
- Blob is a display fallback, not a rollback source. The runbook and README explicitly state Blob is unreliable in this environment (`migration/README.md:256-258`, `migration/RECOVERY-RUNBOOK.md:5`).

**Finding:** Production behavior is unchanged and disabled by default. No activation occurred.

## 5. Phase 8D integration and observability findings

### 5.1 Critical: no CLI execution path initializes observability

`automation/migration/cli.ts` does not import or construct `RunObserver`, `AuditLog`, `StructuredLogger`, `BatchPauseController`, `computeRunSummary`, `classifyFailure`, or `decideFailure`.

- `createEngine` builds a `MigrationEngine` without `eventSink` (`automation/migration/cli.ts:131-171`).
- `runCanary` and `runFull` call `createEngine` and `engine.canary/run` without an observer (`automation/migration/cli.ts:257-294`).
- `runVerify` uses the same engine without an observer (`automation/migration/cli.ts:295-310`).
- The only `new RunObserver(...)` calls in the repository are in `automation/migration/observer.test.ts`.

`MigrationEngine` treats `eventSink` as optional (`automation/migration/engine.ts:58, 125, 148-152`). When omitted, `emit()` is a no-op and `saveState()` never emits or fsyncs audit evidence.

**Consequence:** an actual `migration:run` or `migration:canary` can upload, checkpoint, and print a successful result without any durable audit trail, without `BatchPauseController`, without threshold pause, without hard-stop enforcement through the controller, and without a run summary.

This is a **NO-GO** blocker for observability acceptance.

### 5.2 Critical: hard stops are not enforced without an observer

The engine already returns `CONFLICT`, `SOURCE_CHANGED`, or `FAILED` for the affected poster, but `mapWithConcurrency` continues scheduling other posters. Hard-stop enforcement comes only from `BatchPauseController`, which is fed only by `RunObserver.record`.

With the CLI not wiring an observer:

- a checksum mismatch does not stop the run;
- an object conflict does not stop the run;
- an ambiguous upload does not stop the run;
- state/audit failures are not classified through the controller.

This contradicts the Phase 8D hard-stop policy in actual CLI execution.

### 5.3 High: `liveSuccess` can be true with skipped posters

`computeRunSummary` defines completion as:

```ts
const complete = planned.length > 0 && verified + skipped === planned.length && failed === 0;
const liveSuccess = evidence === "live_migration" && complete && blockingReasons.length === 0;
```

`skipped` posters do not add a blocking reason (`automation/migration/health.ts:156-174`).

A synthetic fixture with one `VERIFIED` poster and one `SOURCE_UNAVAILABLE` poster produced:

```json
{
  "complete": true,
  "liveSuccess": true,
  "skippedPosters": 1,
  "blockingReasons": []
}
```

**Consequence:** a live run that silently skipped a poster can claim live success. This is a false-success defect and a hard blocker for honest completion reporting.

### 5.4 High: threshold window can bias rates

`evaluateThresholds` slices the last 500 events (`automation/migration/health.ts:276`). One poster operation emits multiple events. If a `source.download.started` event falls outside the window while its `source.download.failed` event remains inside, the denominator becomes zero and the failure is ignored.

Synthetic fixture: one source started, one source failed, then 499 unrelated poster events. Result:

```json
{
  "decision": "continue",
  "sourceAttempts": 0,
  "sourceFailures": 1,
  "sourceFailureRate": null
}
```

**Consequence:** a 100% observed source failure can fail to pause because the window split the operation pair. The window must be operation-aware or pair-aware, not a raw event slice.

### 5.5 High: source HTTP 429 responses are absent from the 429 metric

Source events do not include `httpStatus` (`automation/migration/engine.ts:219-239`). Only CDN completion events include it (`automation/migration/engine.ts:688, 727`). `evaluateThresholds` counts only events with `httpStatus` (`automation/migration/health.ts:292-294`).

Synthetic fixture with a source completed event and a source failed event produced:

```json
{
  "httpResponses": 0,
  "http429": 0,
  "http429Rate": null
}
```

**Consequence:** the HTTP 429 threshold measures CDN responses only; source 429s cannot pause the run. This is a monitoring blind spot.

### 5.6 High: duplicate event IDs are accepted

`AuditLog.append` uses `draft.eventId ?? eventIdFor(...)` but never checks whether the ID already exists (`automation/migration/audit.ts:281-301`). A synthetic probe appended two events with `eventId: "evt-fixed-id"` at sequences 1 and 2; both were accepted.

**Consequence:** event identity is not unique, which weakens correlation and evidence integrity. Duplicate IDs must be rejected at append and on recovery.

### 5.7 Medium: benign partial-line recovery permanently blocks success

A partial final line is preserved in a sidecar and reported as a non-fatal issue (`automation/migration/audit.ts`). `RunObserver.summary` passes `auditIssues: read.issues.length` (`automation/migration/observer.ts:120-127`), and `computeRunSummary` adds a blocking reason for any issue count (`automation/migration/health.ts:165-166`).

A synthetic probe after recovery produced:

```json
{
  "auditIssues": 1,
  "resumeSafe": false,
  "liveSuccess": false,
  "blockingReasons": ["Audit history reports 1 issue(s)"]
}
```

**Consequence:** a successfully recovered interrupted append permanently blocks resume and live success unless the sidecar is manually removed. Recovery behavior should distinguish fatal corruption from a preserved, non-fatal tail.

### 5.8 Medium: logging/audit failures can mask the original error

`RunObserver.record` appends to audit, then logs, then updates the controller (`automation/migration/observer.ts:76-84`). The engine calls `emit()` inside catch blocks (`automation/migration/engine.ts:225-240, 875-890`) and inside `saveState` (`:155-171`).

If `emit()` throws `LogSinkError` or `AuditWriteError`, the original source/upload/state error is replaced by the logging error.

**Consequence:** the run still fails (no false success), but the operator may lose the root cause. Preserve the original error and attach the logging failure as secondary context.

### 5.9 Medium: `verifiedObjects` counts uploaded-but-unverified objects

`computeRunSummary` increments `verifiedObjects` for `state.originalUploaded` and `state.optimizedUploaded` (`automation/migration/health.ts:132-143`). These flags mean uploaded, not verified. A fixture with `ORIGINAL_UPLOADED` produced `verifiedObjects: 1` with no `VERIFIED` state.

**Consequence:** object counts can overstate verified inventory. Count verified objects only from a `VERIFIED` state or an explicit object-level verification event.

### 5.10 Medium: redaction misses environment-style assignments

`redactString` handles Bearer/Basic credentials, sensitive headers, sensitive query parameters, data URIs, and long base64 values. It does not redact arbitrary environment-style assignments.

Probe results:

```
NOTION_KEY=super-secret              => NOTION_KEY=super-secret
RAINDROP_ACCESS_TOKEN=abc123         => RAINDROP_ACCESS_TOKEN=abc123
```

**Consequence:** if a future event includes an environment-like string, it can leak. Current code does not intentionally log env values, but the redaction guarantee is incomplete for the stated test category.

### 5.11 Medium: audit append is visible before it is durable

`AuditLog.append` writes with `fs.writeSync`; `checkpoint()` performs fsync (`automation/migration/audit.ts:293-315`). The engine calls `eventSink.checkpoint()` only after a successful state save (`automation/migration/engine.ts:155-167`). `RunObserver.record` does not fsync each event.

**Consequence:** a crash after an append but before a checkpoint can leave an event visible in the page cache but not durable. Critical events (upload completed, poster verified) should be fsynced at defined checkpoints, not only when a later state save happens.

### 5.12 Medium: pause/resume and audit are not operator-accessible

`BatchPauseController` and `RunObserver` work in tests, but:

- no CLI flag selects an audit path or run ID;
- no CLI flag selects a batch ID;
- no CLI path constructs a controller;
- no CLI path emits `operator.pause`, `operator.abort`, or `operator.resume`;
- no CLI path prints a run summary;
- no CLI path calls `assertHealthy()` before success.

Resume is a library operation requiring the same run ID, batch ID, and poster selection; operators cannot perform it through the documented CLI.

### 5.13 Low: lock and preflight events are schema-only

Event types exist for `lock.acquired/rejected/recovered/released` and `preflight.started/completed`, but neither the CLI global lock nor `scripts/preflight-versioned-migration.ts` emits them. The schema supports the events; the wiring is absent.

## 6. Crash consistency and recovery findings

| Scenario | Result |
|---|---|
| Append followed by crash before checkpoint | Event may be visible in page cache but not durable. No per-event fsync. |
| Crash during a partial final line | Partial tail preserved in `.partial-<timestamp>.log`; active log truncated only at the incomplete tail. |
| Recovery with a valid complete prefix | Complete prefix parses; sequence continues. Non-fatal sidecar issue remains in `auditIssues`. |
| Duplicate sequence | Rejected by `parseLines`; `AuditCorruptionError`. |
| Out-of-order sequence | Rejected; `AuditCorruptionError`. |
| Resume with same run ID | Audit sequence continues; run ID retained. |
| Resume with different run ID | Rejected. |
| Concurrent append | Lock file with ownership token; second opener rejected. |
| Stale audit lock | Explicit `breakLock` only after scope/host/dead-PID/age validation. |
| Audit disk-full/permission failure | `AuditWriteError` propagates; no silent success. |
| State save failure | State store rejects; engine propagates; lock released. |
| State partial write | `.tmp` is ignored on load and overwritten by the next save; never auto-promoted. |
| State manifest-hash change | Load rejected. |
| State/lock ownership mismatch | Release refuses to unlink. |

**Key limitation:** append visibility is not durability. The audit design is append-only and recoverable, but critical-event durability depends on a later checkpoint. Phase 8F should define mandatory fsync points for run start, poster verified/failed, upload completed/conflicted/ambiguous, state checkpoint, and run completion.

## 7. Failure-scenario results

| # | Scenario | Expected | Actual / evidence | Decision | State + audit | Resume | False success possible |
|---|---|---|---|---|---|---|---|
| 1 | Source timeout then success | Retry transient timeout | `SourceTimeoutError` is transient; bounded retry tests pass; no exact timeout→success E2E | Retry | State updated; audit only with observer | Yes | No |
| 2 | Permanent source failure | Skip/pause per policy | `SourceHttpStatusError` non-retryable; engine returns `SOURCE_UNAVAILABLE` and continues | Skip | State consistent; audit only with observer | Yes | No |
| 3 | Source checksum/revision change | Hard stop | Engine returns `SOURCE_CHANGED`; emits `source.checksum.changed` only with observer; controller stops only then | Hard stop with observer; continue without | State consistent | Only after manifest reconciliation | No |
| 4 | Optimization failure | Skip, no upload | Engine returns `FAILED`; test covers no upload | Skip | State consistent; audit only with observer | Yes | No |
| 5 | Conditional upload conflict | Hard stop, no overwrite | 412 maps to `CONFLICT`; `IfNoneMatch: "*"`; test passes | Hard stop with observer; continue without | State consistent | After conflict resolution | No |
| 6 | Ambiguous + matching read-back | Accept as verified | Reconciliation test passes; `alreadyVerified`/`reconciled` | Continue | State consistent; observer event | Yes | No |
| 7 | Ambiguous + mismatching read-back | Hard conflict | Test passes; no overwrite | Hard stop with observer | State `CONFLICT` | After investigation | No |
| 8 | Origin verification failure | Hard stop | Engine returns `CONFLICT`/`FAILED`; tests cover checksum/metadata | Hard stop with observer | State consistent | After investigation | No |
| 9 | CDN verification failure | Retry, then fail | Tests cover retry and exhaustion; policy retryable | Retry/skip | State `FAILED` | Yes | No |
| 10 | State persistence failure | Stop | State store throws; engine propagates; lock released test passes | Stop | Last valid state preserved | After repair | No |
| 11 | Audit persistence failure | Stop | Audit test covers disk-full; observer test breaks fd and run rejects | Stop | State may be saved before audit failure; divergence possible | After repair | No with observer; no audit without observer |
| 12 | Lock contention/stale lock | Reject/stop; explicit recovery | Lock tests pass; host-local only | Stop | Lock file preserved | Explicit `--break-lock` | No |
| 13 | Pause with multiple workers | No new work; settle | Controller settle test and engine allSettled test pass; not CLI-wired | Pause | Audit only with observer | Same batch/state | No |
| 14 | Process interruption then resume | Safe resume | Audit partial-line and state temp tests pass; no full process-kill E2E | Resume | Audit sequence continues | Library-only; no CLI flags | No |
| 15 | Manifest hash change | Reject state | Engine test rejects | Stop | State rejected | New state/manifest | No |
| 16 | Unexpected object/inventory discrepancy | Hard stop | Pre-flight `EXISTS_MISMATCH`/`UNKNOWN` blocks uploads; no live inventory run | Stop | Pre-flight report | After reconciliation | No |
| 17 | Versioned-key collision / existing key conflict | Fail closed | Collision and local-conflict tests pass; full SHA keys | Stop | Plan excluded | After key review | No |
| 18 | Local/mock evidence claims live success | Never | Health/observer tests enforce evidence mode; **but skipped-poster fixture reports `liveSuccess: true`** | — | Summary inconsistent | — | **Yes, for skipped posters** |

## 8. Test, lint, typecheck and map results

| Check | Result |
|---|---|
| Focused migration tests | **19 files, 283 tests passed** |
| Identity + migration tests | **24 files, 365 tests passed** |
| Full local suite | **926 passed, 4 skipped, 1 failed** |
| Scoped ESLint (Phase 8D modules + engine) | **clean (exit 0)** |
| `tsc --noEmit` | **1 pre-existing error**, `src/routes/__root.tsx:148` |
| `git diff --check` | **pass** |
| `npm run r2:map:check` | **pass** — "Generated runtime map is up to date" |
| Local pre-flight | **116 planned keys, local validation ok, 116 UNKNOWN, 0 HeadObject requests, uploads blocked** |

Known pre-existing failures, not repaired:

- `tests/security/public-firebase-isolation.test.ts:44`, caused by the static `getAdminDb` import in `src/lib/notion.ts:8`.
- `src/routes/__root.tsx:148` TypeScript error.
- Repository-wide lint problems (500 problems in the Phase 8D baseline) in untouched files; scoped lint for the audited modules is clean.

## 9. Readiness matrix

| Area | Verdict | Basis |
|---|---|---|
| A. Local implementation correctness | **GO WITH CONDITIONS** | 283 migration tests pass; false-success, duplicate-ID, window-bias, and masking defects require remediation. |
| B. Identity and manifest integrity | **GO WITH CONDITIONS** | Canonical Firestore document ID and 63-entry validation pass; two medium identities remain unresolved and excluded. |
| C. Source acquisition reliability | **GO WITH CONDITIONS** | Timeout/cancellation/SSRF/bounded-read tests pass; live source behavior and 429 event coverage remain incomplete. |
| D. R2 upload safety | **GO WITH CONDITIONS** | Create-only and reconciliation tests pass; no live R2 inventory or bytes; audit integration missing. |
| E. Origin and CDN verification | **GO WITH CONDITIONS** | Bounded reads, checksum, metadata and Cache-Control tests pass; no live CDN evidence. |
| F. State and locking reliability | **GO WITH CONDITIONS** | Atomic write, fsync, recovery, and ownership tests pass; locks are host-local only. |
| G. Audit and observability | **NO-GO** | CLI never initializes the observer/audit/logger/controller/summary; duplicate IDs and partial-recovery blocking are unresolved. |
| H. Pause/resume and recovery | **NO-GO** | Controller works in isolation but is not CLI-wired; resume has no operator path; skipped-poster false success exists. |
| I. Full 63-poster migration readiness | **NO-GO** | 58 eligible, 2 medium unresolved, no live 116-key inventory, no live byte verification, observability not integrated. |
| J. Production browser/download activation | **NO-GO** | Defaults remain disabled; no live verification or activation authorization. |
| K. SEO activation | **NO-GO** | Default remains disabled; no live verification or activation authorization. |
| L. Separate live R2 pre-flight readiness | **GO WITH CONDITIONS** | Read-only live mode exists and is explicitly gated; requires Phase 8F remediation, operator wiring, and separate authorization. |

## 10. Critical blockers and residual risks

### Critical blockers

1. **Phase 8D is not wired into CLI execution.** Actual migrations have no audit evidence, no threshold pause, no hard-stop controller, and no run summary.
2. **Skipped posters can produce `liveSuccess: true`.**
3. **Threshold window can miss failures and source 429s are not measured.**
4. **Duplicate event IDs are accepted.**
5. **Recovered partial audit lines permanently block resume/live success.**
6. **Logging/audit failures can mask the original error.**

### Residual risks

- Two medium-confidence identities remain unresolved.
- No live 116-key inventory or byte-level verification.
- No live CDN/Cache-Control evidence.
- Locks are host-local; cross-host coordination depends on R2 conditional writes.
- Vercel Blob is not a reliable rollback source.
- `verifiedObjects` can overcount uploaded-but-unverified objects.
- Redaction misses environment-style assignments.
- Audit fsync points are not mandatory for critical events.
- No full process-kill or multi-host E2E recovery test.
- No live R2 pre-flight has been authorized or run.

## 11. Recommended remediation phases, ordered by dependency

### Phase 8F — Observability integration and evidence integrity (must precede live pre-flight)

1. Wire `RunObserver`, `AuditLog`, `StructuredLogger`, `BatchPauseController`, failure classification, and summary into `migration:run`, `migration:canary`, and `migration:verify`.
2. Add explicit `--run-id`, `--batch-id`, `--audit`, and optional log-sink flags; require them for execute runs or generate and print a stable run ID.
3. Enforce `assertHealthy()` and mandatory audit persistence before reporting success.
4. Fix `liveSuccess` to require all planned posters verified, or explicitly block skipped posters.
5. Fix `verifiedObjects` to count only verified objects.
6. Reject duplicate event IDs at append and on recovery.
7. Distinguish fatal audit corruption from preserved non-fatal partial tails in summaries.
8. Make threshold windows operation-aware and add `httpStatus` to source events.
9. Preserve the original error when logging/audit emission fails.
10. Add end-to-end tests for pause/resume, hard stops, audit failure, and skipped-poster summaries.

### Phase 8G — Authorized live read-only pre-flight

- Add a CLI/runner mode for `mode: "live"` with explicit authorization.
- Perform read-only HEAD checks for all 116 keys.
- Reconcile classifications and block on any `UNKNOWN`, `ERROR`, or `EXISTS_MISMATCH`.
- No uploads.

### Phase 8H — Controlled canary/limited live migration

- Only after 8F and 8G.
- Small authorized batch, live audit, pause/resume, byte verification, and inventory reconciliation.

### Phase 8I — Full 58-poster migration readiness

- Resolve or formally exclude the two medium identities.
- Complete live inventory and byte verification.
- Validate monitoring, rollback, and retention procedures.

### Phase 8J — Production browser/download activation

- Separate authorization after live migration and monitoring evidence.

### Phase 8K — SEO activation

- Separate authorization; no activation in this phase.

## 12. What remains untested

Because no external service was contacted:

- Live R2 HEAD/GET/PUT behavior for the 116 proposed keys.
- Live object inventory, ownership, metadata, and byte integrity.
- Live public CDN HTTP status, Cache-Control, and byte equality.
- Live source acquisition from Raindrop/pbs in the current environment.
- Live Blob availability and fallback behavior.
- Firestore/Notion/Raindrop identity and metadata behavior.
- Real disk-full, permission, multi-host lock, and process-kill recovery.
- Production resolver, download, SEO, DNS, TLS, and deployment behavior.
- Any actual migration, canary, verification, or activation.

## 13. External-service confirmation

No external service was contacted or mutated during this phase:

- No R2 HEAD/GET/PUT/delete.
- No Vercel Blob, Firestore, Notion, Raindrop, Vercel, Cloudflare, or DNS request.
- No live pre-flight, canary, migration, verification, deployment, or activation.
- No environment, secret, credential, or configuration change.
- No commit, push, merge, rebase, or branch switch.
- All tests used local fixtures, mocks, and temporary directories.
- The only file written in the repository is this report.

## 14. Canary preservation confirmation

The six canary keys, state, map, allowlist, generated runtime map, and manifest remain unchanged:

```
2001-a-space-odyssey   cineprint/raindrop/1528361110.png      cineprint/optimized/legacy/2001-a-space-odyssey.webp
bugonia                cineprint/external/bugonia.jpg         cineprint/optimized/external/bugonia.webp
artwork-1824607248     cineprint/raindrop/1824607248.jpg     cineprint/optimized/1824607248.webp
```

Allowlist: `2001-a-space-odyssey`, `bugonia`, `artwork-1824607248`.

Hashes match the baseline listed in section 2. `npm run r2:map:check` passes.

---

**Final statement:** Phase 8E is an audit only. No implementation repair, live pre-flight, migration, deployment, or activation was performed. The system is **not ready for live migration or production activation**. A separately authorized read-only live pre-flight may be considered only after Phase 8F remediation.
