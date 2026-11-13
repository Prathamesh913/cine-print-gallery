# CinePrint Automation — Approval Model

Status: **implemented in the approval-simplification PR, not deployed or
activated.**

This document records the approval-gate audit, the gates that were removed and
retained, the configuration required to run the schedules, and the operational
risks that remain deferred.

---

## 1. Pipeline and the single editorial decision

```text
Raindrop → TMDB → R2 → Notion Draft → [Notion Status: Published] → Firestore → CinePrint
```

The only editorial approval is the manual `Draft → Published` transition in
Notion. The publishing sync reads every non-archived catalogue page but only
records whose `Status` is `Published` are eligible for Firestore synchronization.
A `Draft` page is never created in Firestore.

Ingestion only ever writes `Status = Draft`. It does not publish.

---

## 2. Approval gates found in the previous implementation

These gates are **not interchangeable**. The audit distinguishes them because
removing one must not silently remove another.

| #   | Gate                                 | Where it lived                                                                  | What it protected                                     | Classification                                 |
| --- | ------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| 1   | Notion `Status`                      | Notion data source                                                              | Editorial approval; eligibility for Firestore         | **Editorial approval (retained)**              |
| 2   | GitHub Environment required reviewer | `automation-manual-apply` environment + `environment:` on the reusable run body | A second human approval before a manual apply         | GitHub reviewer approval (**removed**)         |
| 3   | Exact confirmation phrase            | `APPLY-ONE-POSTER` in the dispatch gate and workflow input                      | Accidental apply from a mistyped or copied command    | Manual apply safety (**retained**)             |
| 4   | Manual write limit                   | `limit === 1` for manual apply                                                  | Blast radius of a troubleshooting run                 | Manual write limit (**retained**)              |
| 5   | Manual activation switch             | `AUTOMATION_MANUAL_APPLY_ENABLED == 'true'`                                     | Arms manual apply only                                | Manual activation (**retained**)               |
| 6   | Scheduled activation switch          | One shared `AUTOMATION_ENABLED`                                                 | Arms both cron lanes                                  | Scheduled activation (**split**)               |
| 7   | Event/source binding                 | Gate requires `workflow_dispatch` for manual and `schedule` for cron            | Prevents one trigger from satisfying another lane     | Independent safety (**retained**)              |
| 8   | Repository identity                  | Both `github.repository` and `github.event.repository.full_name`                | Prevents another repository calling the reusable body | Independent safety (**retained**)              |
| 9   | Bounded batch limits                 | `10` ingestion / `50` publishing                                                | Bounds a scheduled run                                | Independent safety (**retained**)              |
| 10  | Concurrency group                    | `cineprint-catalog-automation`, non-cancelling                                  | Serializes the two GitHub workflows                   | Independent safety (**retained**, with limits) |
| 11  | Dry-run read-only adapters           | CLI throwing proxies + credential blanking                                      | Dry-runs cannot write                                 | Independent safety (**retained**)              |

There was no `automation/activation/` module in this repository. The activation
logic lives in `automation/ingestion/run-authorization.mjs`; its tests live in
`automation/ingestion/run-authorization.test.ts`, and workflow-shape regressions
are covered by `automation/ingestion/workflows.test.ts`.

---

## 3. Gates removed

### 3.1 GitHub Environment reviewer approval

Before this change, manual apply ran in the `automation-manual-apply` GitHub
Environment. That environment had a `required_reviewers` protection rule, so a
manual apply paused until a reviewer approved the deployment.

That approval duplicated the Notion decision. It is removed:

- The automation workflows no longer set `environment:`.
- The reusable run bodies no longer accept an environment input.
- The authorization gate no longer requires or validates an environment name.
- The `required_reviewers` protection rule is removed from the
  `automation-manual-apply` environment so the setting cannot imply an approval
  that the workflow does not use. The environment's `main` deployment branch
  policy is left in place as an audit artifact; it is no longer consulted.
- Workflow tests assert that no automation workflow contains `environment:`,
  `required_reviewers`, `automation-manual-apply`, or `automation-scheduled`.

Verify the repository setting:

```bash
gh api repos/Prathamesh913/cine-print-gallery/environments/automation-manual-apply \
  --jq '[.protection_rules[].type]'
```

Expected: `["branch_policy"]`. A `required_reviewers` entry means the setting
was reintroduced; the workflow still does not wait for it, but it should be
removed to avoid a misleading approval prompt on unrelated environment use.

### 3.2 Shared scheduled switch

`AUTOMATION_ENABLED` armed both scheduled lanes. It is replaced by:

- `AUTOMATION_INGESTION_ENABLED`
- `AUTOMATION_PUBLISHING_ENABLED`

The old variable is now ignored. This is intentionally fail-closed: if only the
old variable is present, neither schedule runs.

### 3.3 Compensating control: default branch for manual apply

Removing the environment also removes its deployment branch policy. The gate now
requires `github.ref == refs/heads/main` for manual apply. This is not a new
subsystem; it is one comparison in the existing gate, and it preserves the rule
that a feature branch must not receive production write credentials.

The rule is only meaningful if `main` is branch-protected. Do not remove `main`
protection while automation is active.

---

## 4. Gates retained

- Notion `Draft`/`Published` eligibility, unchanged.
- Exact `APPLY-ONE-POSTER` confirmation.
- Manual apply limit of exactly one record.
- `AUTOMATION_MANUAL_APPLY_ENABLED` switch.
- Per-lane scheduled switches.
- Event/source binding in both the caller job and the reusable body.
- Repository identity checks on both the workflow and event repositories.
- Bounded scheduled limits.
- Dry-run read-only adapters and credential blanking.
- Shared non-cancelling concurrency group.
- Fail-closed behavior: a missing variable, missing gate name, malformed limit,
  wrong event, wrong repository, or wrong ref rejects the run before `npm ci` or
  any credential is exposed.

---

## 5. Scheduled activation configuration

This PR does **not** enable schedules. The cron expressions are committed, but
each lane skips unless its own repository variable is exactly `true`.

Required configuration, set by an operator in
**Settings → Secrets and variables → Actions → Variables**:

| Variable                          | Effect when `true`            | Effect when absent or not `true` |
| --------------------------------- | ----------------------------- | -------------------------------- |
| `AUTOMATION_INGESTION_ENABLED`    | Ingestion cron lane runs      | Ingestion cron lane skips        |
| `AUTOMATION_PUBLISHING_ENABLED`   | Publishing cron lane runs     | Publishing cron lane skips       |
| `AUTOMATION_MANUAL_APPLY_ENABLED` | Manual apply dispatch may run | Manual apply job skips           |

Activation is per lane and can be verified without dispatching:

```bash
gh variable list --repo Prathamesh913/cine-print-gallery
```

Expected disabled state: none of the three variables is `true`. Expected
enabled ingestion state: `AUTOMATION_INGESTION_ENABLED=true`, with
`AUTOMATION_PUBLISHING_ENABLED` still absent or `false`.

Do not enable a schedule merely because this PR merged or because tests pass.
The deferred risks in §7 must be accepted first, and a live end-to-end run must
have passed.

---

## 6. Scheduled operation

When each lane is enabled:

- Ingestion discovers Raindrop bookmarks on its cron and creates `Draft` pages
  in Notion. Existing identity and duplicate checks are unchanged.
- Publishing polls Notion on its cron and processes only `Published` pages.
- `Draft`, `Review`, `Archived` and unrecognized statuses are not created.
  Existing Firestore documents whose Notion page moves away from `Published` are
  down-synchronized to the corresponding non-public status.
- Neither cron lane writes `Published` itself. Publishing a Draft remains a
  human action in Notion.

### 6.1 Why a scheduled run can show every job skipped

Scheduled workflows use the workflow file from the latest default-branch commit
at the moment GitHub queues the run. A run queued before a gate fix therefore
uses the old gate, even if `main` and the repository variables have since
changed.

Diagnose in this order:

1. Compare the run's `headSha` with `git log origin/main`. If the run predates
   the gate fix, its skipped jobs are historical, not current behaviour.
2. Confirm the run's `createdAt` is after both the merge and the repository
   variables were created. Variables are read at run time; they do not
   retroactively arm earlier runs.
3. Inspect the `scheduled` job's `if:` and confirm it uses the lane variable
   (`AUTOMATION_INGESTION_ENABLED` or `AUTOMATION_PUBLISHING_ENABLED`).
4. Confirm the `scheduled` job has no `needs:`. The `Validate dispatch inputs`
   job is `workflow_dispatch`-only and is expected to be skipped on schedule
   events. A dependency on it would skip scheduled execution through GitHub's
   implicit `success()` check.

`automation/ingestion/workflows.test.ts` now models this graph: a schedule event
with the lane enabled reaches only `scheduled`, while both manual lanes still
pass through `validate`. The test fails if `needs: validate` is added to a
scheduled job or if the event/variable conditions drift.

---

## 7. Deferred operational risks

The production-hardening milestone is intentionally deferred. These are the
known risks of doing so; they are not silently replaced by new infrastructure.

1. **No distributed lock.** GitHub Actions share a non-cancelling concurrency
   group, but a local CLI run, another workflow, or an independent runner can
   overlap a cron run. Job and catalogue reads are non-transactional. Overlap can
   cause duplicate work, redundant writes, or confusing run reports. Mitigation:
   do not run local `--apply` while a scheduled run is active; keep manual apply
   to one record.
2. **No atomic-write infrastructure.** Catalogue creation uses a read-then-create
   sequence guarded by an identity check and a read-back, not a Firestore
   transaction. Two concurrent runs could both pass the check for the same new
   identity. This is unlikely at current volume but is not impossible.
3. **No dynamic sitemap redesign.** Newly published posters appear in the sitemap
   only after a deployment. This was already true and is unchanged by this PR.
4. **No new retry framework.** Retry behavior remains the existing per-stage
   logic. Permanent image-preparation errors can still consume the retry budget;
   transient failures rely on the next scheduled run.
5. **No broad architecture refactor.** The activation gate remains a plain ESM
   module invoked by workflow steps. This keeps the change reviewable, but it
   also means gate behavior is split between workflow YAML and the module; the
   workflow tests exist to catch drift.

None of these risks is a reason to reintroduce a second human approval step.
They are reasons to keep scheduled lanes disabled until an operator accepts the
risks and verifies a live end-to-end run.

---

## 8. Rollback

- Disable a scheduled lane by setting its variable to `false` or deleting it.
- Disarm manual apply the same way with `AUTOMATION_MANUAL_APPLY_ENABLED`.
- Revert the PR to restore the previous environment references and the shared
  `AUTOMATION_ENABLED` switch. Re-add environment reviewers only if the
  duplicated approval is deliberately restored.
- No data migration or schema change is part of this PR.
