# CinePrint Raindrop Automation — Failure Recovery

This document describes how the pipeline fails, what state survives, and how to
recover without duplicates or data loss.

Related:

- `docs/raindrop-automation-architecture.md`
- `docs/raindrop-automation-operations.md`

---

## 1. State machine

```
discovered
  -> validating
     -> enriching
        -> needs_review            (human decision required)
        -> uploading
           -> image_verified
              -> notion_draft_created
                 -> awaiting_publication   (status changed in Notion)
                    -> published
                       -> firestore_synced
  -> failed                        (retryable or exhausted)
```

Terminal for ingestion: `notion_draft_created`, `awaiting_publication`,
`published`, `firestore_synced`.

Resumable without a new bookmark: `validating`, `enriching`, `uploading`,
`image_verified`, plus `failed` when the retry window is open, plus
`needs_review` when a `reviewDecision` was added.

Every transition is written to `automationIngestionJobs/{posterId}` **before**
the next external call. A crash therefore loses at most the work of the stage
that had not completed.

---

## 2. Stage failure matrix

| Stage              | Example cause                                  | Retryable?   | State after failure                    | Recovery                                |
| ------------------ | ---------------------------------------------- | ------------ | -------------------------------------- | --------------------------------------- |
| Raindrop fetch     | 401/403                                        | No           | Run aborts before jobs                 | Fix token; rerun                        |
| Raindrop fetch     | 429 / 5xx / timeout                            | Yes (in-run) | Automatic backoff                      | None unless exhausted, then rerun       |
| Validation         | Missing tag/year/image                         | No           | No job (or previous job untouched)     | Fix the bookmark; rerun                 |     | TMDB | No match / ambiguous | No  | `needs_review` | Correct tags or add a review decision |
| TMDB               | 429 / 5xx / timeout                            | Yes          | `failed` + `nextAttemptAt`             | Automatic retry                         |
| Download           | 429 / 5xx / timeout                            | Yes          | `failed` + `nextAttemptAt`             | Automatic retry                         |
| Download           | Wrong content type / bad signature / too large | No           | `failed`                               | Replace the source image                |
| Optimize           | Undecodable image / pixel cap                  | No           | `failed`                               | Replace the source image                |
| R2 upload          | Network / 5xx / CDN propagation                | Yes          | `failed` (+ possible verified objects) | Automatic retry reuses objects          |
| R2 integrity       | Existing key has different bytes               | No           | `failed`                               | Investigate; keys are content-addressed |
| Notion             | 429 / 5xx / network                            | Yes          | `failed` (+ possible page)             | Retry updates the existing page         |
| Notion             | 401 / invalid schema                           | No           | `failed`                               | Fix token/permissions; retry            |
| Publish resolution | Missing identity / metadata                    | No           | `needsReview` / failed entry           | Fix Notion data                         |
| Firestore          | Write or read-back failure                     | Yes          | Job stays `published`                  | Rerun; no duplicate                     |
| Firestore          | Page already associated elsewhere              | No           | Failed entry                           | Resolve the ownership conflict manually |

Source-data validation failures count as `needsReview`, not `failed`, so one
malformed bookmark does not make every scheduled run exit non-zero. They remain
visible in `failures[]` with `stage: "validating"`.

---

## 3. Critical partial-failure cases

### 3.1 R2 succeeded, Notion not yet created

Evidence: job stage `uploading` or `image_verified`; `images` may be present.

Retry:

1. `images` exists and the source revision is unchanged → the image stage is
   skipped entirely.
2. The R2 publisher is not called again.
3. The Notion draft is created from the verified original URL.

If the process died immediately after `put()` but before the state write, the
retry recomputes the same content-addressed keys. `put()` returns
`PreconditionFailed`; the publisher verifies the existing object by HEAD, origin
GET and CDN GET and treats it as reused. Bytes are never overwritten.

### 3.2 Notion draft created, state not persisted

Evidence: the Notion page exists with the same `Raindrop ID`; the job may still
say `uploading`.

Retry:

1. `findByRaindropId` finds the page.
2. The pipeline updates only changed fields.
3. No second page is created.

### 3.3 Published in Notion, Firestore write not completed

Evidence: Notion `Status = Published`; Firestore document missing or stale.

Retry:

1. The publishing sync re-resolves the identity.
2. If the document is missing, it creates it; if it is stale, it updates it.
3. A read-back confirms `status: "published"` and a non-empty image.
4. The job moves to `firestore_synced`.

The job may be stuck at `published`; that is intentional and resumable.

### 3.4 Firestore write succeeded, job state write failed

Evidence: the document matches the intended record; the job is still `published`.

Retry:

1. The publisher compares every mapped field.
2. Match → `alreadySynchronized`; no write.
3. The job is advanced to `firestore_synced` if needed.

### 3.5 Source image changed at the same Raindrop bookmark

`lastUpdate` changes → previous `images` and `sourceImageSha256` are cleared at
the validating stage.

Retry downloads the new image, derives new versioned keys, uploads new objects,
verifies them, and updates the Notion draft image URL. The poster identity
(`artwork-{raindropId}`) does not change.

---

## 4. Inspecting and unblocking a record

Use a trusted Admin SDK session (local terminal or a one-off script). Never use
browser credentials.

```js
const job = await db.collection("automationIngestionJobs").doc("artwork-123").get();
console.log(job.data());
```

### Retry now (clear the backoff)

```js
await db.collection("automationIngestionJobs").doc("artwork-123").update({
  retryable: true,
  nextAttemptAt: null,
  stage: "failed",
});
```

Then run the ingestion workflow manually with `action: apply`,
`confirm_apply: APPLY-ONE-POSTER` and `limit: 1` (with
`AUTOMATION_MANUAL_APPLY_ENABLED=true` and the environment approved).

### Resolve an ambiguous TMDB match

Add a reviewed decision to the job:

```js
await db
  .collection("automationIngestionJobs")
  .doc("artwork-123")
  .update({
    reviewDecision: {
      posterId: "artwork-123",
      raindropId: "123",
      tmdbId: 487558,
      decidedAt: new Date().toISOString(),
    },
    retryable: true,
    nextAttemptAt: null,
  });
```

The next run uses that exact TMDB ID instead of re-ranking candidates.

### Retry a publishing record

The publishing sync retries automatically each run. To force it, ensure the
Notion page is still `Published` and run the publish workflow manually with
`action: apply`, `confirm_apply: APPLY-ONE-POSTER` and `limit: 1`.

If a Firestore document is associated with the wrong Notion page, the sync fails
closed. Correct `notionPageId` only after confirming the canonical identity
contract; do not delete either document until the audit trail is captured.

---

## 5. Rollback and containment

### Pause automation

Set repository variable `AUTOMATION_ENABLED=false` (or delete it) to stop
scheduled runs. Set `AUTOMATION_MANUAL_APPLY_ENABLED=false` (or delete it) to
disarm manual apply. The two switches are independent; an in-flight run finishes.

### Bad image uploaded for one poster

Do not overwrite the object. The keys are content-addressed. Options:

1. Fix the source bookmark and let the next run mint new keys.
2. If the record must be hidden immediately, set the Notion `Status` to `Draft`.
   The public frontend only serves `published` records, but the existing
   publishing sync does not delete the Firestore document. Coordinate removal of
   the Firestore document separately if required.

### Bad Notion draft

Delete or archive the page in Notion, then archive the state document:

```js
await db.collection("automationIngestionJobs").doc("artwork-123").update({
  stage: "failed",
  retryable: true,
  nextAttemptAt: null,
  notionPageId: null,
  notionStatus: null,
});
```

The next run creates a new draft.

### Firestore document created incorrectly

The sync never deletes documents. To remove one:

1. Capture the document contents and the run summary.
2. Confirm it is not the canonical record for another page.
3. Delete it with an approved Admin operation.

Re-running the sync recreates it from the published Notion page.

### Frontend regression after deployment

Revert the deployment that introduced the dynamic resolver. Static map entries
for the existing catalogue are unaffected, and Firestore records keep their
`r2Image` field, which older code ignores.

---

## 6. Run-level failures

| Symptom                                 | Diagnosis                                | Action                              |
| --------------------------------------- | ---------------------------------------- | ----------------------------------- |
| Workflow skipped                        | Scheduled lane: `AUTOMATION_ENABLED` not `true`; manual apply: `AUTOMATION_MANUAL_APPLY_ENABLED` not `true` | Expected until the relevant lane is activated |
| `Missing required environment variable` | Secret/variable absent                   | Add it; the name is in the error    |
| `R2 bucket/domain` error                | Partial R2 configuration                 | Set all five R2 values              |
| `Missing Firebase...`                   | Admin credential absent                  | Add `FIREBASE_SERVICE_ACCOUNT_JSON` |
| `Notion authentication failed (401)`    | Token revoked                            | Rotate `NOTION_KEY`                 |
| `Raindrop authentication failed`        | Token revoked                            | Rotate `RAINDROP_ACCESS_TOKEN`      |
| Zero published records                  | Notion `Status` value differs            | Confirm exact value `Published`     |
| All records `needsReview`               | Canonical ID and Raindrop ID both absent | Fix the Notion page                 |
| Exit code 1 with `failed > 0`           | Per-record failures                      | Read `failures[]` and use section 4 |
| Summary looks all-new in dry-run        | No Admin credentials locally             | Expected; see operations doc        |

---

## 7. Guarantees and non-guarantees

Guaranteed:

- A verified R2 object is never overwritten by a retry.
- A retried Notion stage does not create a duplicate page.
- A retried Firestore stage does not create a duplicate document.
- A failed stage does not lose the poster identity or the verified image
  references.
- A dry-run performs no external writes.

Not guaranteed:

- Automatic deletion/archival when a Notion page disappears.
- Automatic resolution of ambiguous TMDB identities.
- Automatic repair of conflicting Notion pages that claim the same poster ID.
- Sitemap updates without a deployment.
