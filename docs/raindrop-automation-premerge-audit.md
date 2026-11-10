# CinePrint Raindrop Automation — Pre-Merge Audit (Remediated)

Status: remediation audit complete.
Branch: `feat/raindrop-auto-ingestion`
Base: `origin/main` @ `ad1851c`
Worktree: `/tmp/opencode/wt-raindrop-auto-ingestion`
Date: 2026-11-10

The earlier pre-merge audit found four critical blockers. This revision records
the original findings, the root causes, the focused remediations, the regression
tests that prove them, the verification results, and the new verdict.

At the time of this audit, no commit, push, merge, deploy, workflow activation,
or live Raindrop/Notion/Firebase/R2 write had been performed. External
integrations were exercised only with mocks and fixtures.

---

## 1. New verdict

**MERGE READY** for the feature branch, subject to the activation prerequisites
in §7. All four original critical blockers are fixed and have dedicated
regression tests. The remaining findings are non-blocking hardening/documentation
items.

| Area | Original | Current |
|---|---|---|
| Security | **FAIL** — token leak | **PASS** — token origin isolation |
| Dynamic R2 resolution | **FAIL** — invalid refs masked | **PASS** — invalid refs fail closed |
| Idempotency/recovery | NEEDS ATTENTION | **PASS for the four blockers**; remaining hardening |
| GitHub Actions | PASS with caveats | **PASS with caveats** (unchanged) |
| Data correctness | NEEDS ATTENTION — blank status | **PASS for blank/unknown status**; schema caveat remains |
| Testing | NEEDS ATTENTION | **PASS for blocker regressions**; external boundaries remain mocked |
| Build/deployment | NEEDS ATTENTION | App build + map check PASS; full prebuild not run |

---

## 2. Resolved blockers

### P0-1 — Raindrop bearer-token leakage — **FIXED**

Original finding:

- `automation/ingestion/download.ts` sent `Authorization: Bearer <token>` on every
  request in a manual redirect loop.
- `automation/ingestion/cli.ts` attached the token using
  `url.includes("api.raindrop.io")`.
- A redirect to `attacker.example` received the token. A URL such as
  `https://evil.example/api.raindrop.io/poster.png` also passed the substring
  check.

Root cause:

Credential attachment was decided once from the original URL/string and then
reused for every redirect hop; host validation was substring-based.

Remediation:

- `automation/ingestion/download.ts`
  - Added `RAINDROP_AUTH_HOST = "api.raindrop.io"` and
    `isRaindropAuthOrigin(url)`.
  - Added `headersForUrl(url, authToken)` which attaches `Authorization` only
    for the exact trusted host and default HTTPS port.
  - Authorization is recomputed for **every** request, including every redirect
    hop; cross-origin redirects carry no token.
  - `assertSafeImageUrl` now rejects non-default HTTPS ports in addition to
    protocol/credential/private-host checks.
- `automation/ingestion/cli.ts`
  - Removed the substring check; the downloader owns the host decision.
- Preserved timeout, redirect-count, byte-cap, content-type and signature checks.

Regression tests (`automation/ingestion/download.test.ts`):

- `sends the token to the exact Raindrop API origin`
- `never sends the token to an external URL that merely contains the API hostname`
- `strips the token when a trusted Raindrop response redirects to an attacker`
- `does not trust a hostname that contains raindrop.io as a substring`
- `keeps authorization on a redirect that stays on the exact trusted origin`
- `reattaches authorization only after an untrusted hop returns to the trusted origin`
- `rejects a protocol downgrade before making the next request`
- `rejects a redirect to an unexpected port before making the next request`
- `rejects an initial URL with an unexpected port`
- `does not leak the token through multiple redirect hops`

The reproduced attacker-redirect scenario now asserts `authorization === null` on
the untrusted hop.

Remaining limitation: external image hosts still use the platform DNS resolver;
DNS rebinding/alternate private-IP encodings are not pinned. This is a hardening
item, not the original token-leak blocker.

---

### P0-2 — Invalid dynamic R2 references silently fell back — **FIXED**

Original finding:

- `src/lib/notion.ts` validated `r2Image` and dropped it when invalid.
- The resolver only failed closed when `poster.r2Image` was present, so an
  invalid supplied reference looked absent and fell through to
  `blobOptimizedUrl ?? poster.image`.

Root cause:

The Firestore → `Poster` mapper collapsed three states (absent, valid, invalid)
into two (absent, valid). The resolver’s fail-closed branch was never reached for
invalid Firestore data.

Remediation:

- `src/lib/posters.ts`: added `r2ImageInvalid?: boolean`.
- `src/lib/notion.ts`: exported `toPlainPoster` for direct regression testing and
  now sets `r2ImageInvalid: true` whenever `r2Image` was supplied but validation
  failed. Absent references remain absent.
- `src/lib/poster-images.ts`: `dynamicEntryFor` checks `r2ImageInvalid` before
  the enabled/absent checks and returns `{ kind: "invalid" }`.
  `getPosterImageFallbackUrl` also returns the neutral unavailable asset for an
  invalid supplied reference.
- Static-map precedence is unchanged: a valid generated-map entry still wins.
  Intentionally unavailable poster IDs still return the placeholder.
- Invalid references now produce the unavailable placeholder for browser/SSR/
  SEO/download and never invoke Blob/raw fallback.

Regression tests (`tests/poster-images-dynamic.test.ts`):

- `keeps a valid dynamic reference`
- `marks a malformed supplied reference instead of dropping it`
- `marks a wrong-identity reference`
- `leaves an absent reference unchanged for legacy records`
- `fails closed for an invalid supplied reference instead of using Blob or raw image`
- Validation cases: malformed object, wrong hostname, wrong poster identity,
  invalid hash/size/content type, URL/key mismatch.
- Existing dynamic-resolution tests continue to cover valid optimized/original
  URLs, static precedence, unavailable placeholders and legacy no-reference
  behaviour.

Remaining limitation: the build-time sitemap still constructs a partial poster
without `r2Image`; see §6. Browser/SSR/OG/Twitter/JSON-LD use the full `Poster`
and are fixed.

---

### P0-3 — Blank Notion status could mass-unpublish records — **FIXED**

Original finding:

- `normalizeNotionStatus("")` returned `"review"`.
- The down-sync loop wrote that value to every associated Firestore document,
  removing records from the public `status == "published"` query.

Root cause:

Missing/blank/unknown status was treated as a recognized transition instead of
invalid input.

Remediation:

- `automation/ingestion/publish.ts`: `normalizeNotionStatus` now returns
  `string | null`; blank, whitespace-only and unknown values return `null`.
  Recognized values: `published`, `review`/`in review`, `draft`/`unpublished`,
  `archived`/`rejected`.
- The down-sync loop validates the status **before** checking whether documents
  are associated. A null result increments `needsReview`, adds a failure entry
  for human review, logs `publish.status_invalid`, and performs no write.
- Explicit supported transitions still update status; no Firestore deletes were
  added.

Regression tests (`automation/ingestion/publish.test.ts`):

- `preserves Published when Notion Status is blank`
- `preserves Published when the Status property is missing`
- `preserves Draft when Notion Status is blank`
- `applies an explicit unpublished transition`
- `rejects an unknown status without changing the record`
- `does not let one malformed status block another valid transition`
- `reports a missing status even when no Firestore document is associated`
- Existing unpublish/republish tests remain green.

---

### P0-4 — Firestore update could recreate deleted documents — **FIXED**

Original finding:

- `FirestorePosterCatalog.update` used
  `doc.set({ ... }, { merge: true })`, which creates a missing document.
- The in-memory adapter also created from `?? {}`, hiding the issue.

Root cause:

The adapter implemented “upsert” instead of update-only semantics, contrary to
the legacy sync’s deliberate `batch.update()` safeguard.

Remediation:

- `automation/ingestion/poster-catalog.ts`: added typed
  `PosterDocumentMissingError`; `InMemoryPosterCatalog.update` now throws it when
  the document is absent.
- `automation/ingestion/firestore-adapters.ts`: `update` now calls
  `DocumentReference.update`, never `set`. Missing documents map to
  `PosterDocumentMissingError` (including `not-found` and numeric
  `google-cloud` code 5).
- `create` remains the separate explicit creation path and still uses `set` with
  audit timestamps.
- `automation/ingestion/publish.ts`: creation is now authorised only by an
  ingestion job at `notion_draft_created`/`awaiting_publication`. A missing
  document with a later job stage (for example `firestore_synced`) throws
  `PosterDocumentMissingError` instead of recreating. A page with no ingestion
  job is held for review rather than creating a catalogue document.
- Existing association checks (canonical ID, `notionPageId`, legacy document
  reuse) remain enforced. Read-back and unchanged-record avoidance remain.

Regression tests:

- `automation/ingestion/poster-catalog.test.ts`
  - `updates an existing in-memory document`
  - `fails instead of recreating a missing in-memory document`
  - `uses Firestore update, never set, for an existing document`
  - `throws a typed error and does not recreate when Firestore update misses`
  - `keeps creation as a separate explicit set path`
- `automation/ingestion/publish.test.ts`
  - `does not create a new catalogue document without an ingestion job`
  - `does not recreate a document deleted after synchronization`
  - `refuses to update a document associated with another Notion page`
  - existing create/update/read-back/legacy checks remain green.

Remaining limitation: `create` still uses `set` rather than Firestore `create()`,
so a pathological race between the existence check and creation could overwrite a
concurrently created document. The workflow concurrency group makes this
unlikely; an atomic `create()` is a recommended hardening follow-up.

---

## 3. Cross-cutting end-to-end regression

`automation/ingestion/e2e-regression.test.ts`

Test: `runs the full mocked pipeline without credential leakage or duplicate writes`

Covers:

- New Raindrop bookmark.
- Image download with a redirect from `api.raindrop.io` to `cdn.example.com`;
  asserts the token is present only on the trusted hop.
- Real `prepareImage`/WebP generation from the PNG fixture.
- Real `R2ImagePublisher` against a fake R2 store; asserts two object writes and
  versioned keys.
- Real `NotionDraftSync` against a fake Notion client; asserts one Draft creation.
- Retry after a simulated crash between R2 verification and Notion creation:
  no new R2 writes, no duplicate Notion page, update path used.
- Published synchronization creates a Firestore record with `r2Image`.
- Blank Notion status preserves the published record.
- Explicit Draft/Published transitions update the record.
- No credential in the untrusted redirect request.

No external integration is claimed as verified. All Notion/R2/Firebase/Raindrop
interactions in this test are mocks/fixtures.

---

## 4. Re-run verification

| Check | Result |
|---|---|
| Focused blocker tests (download, dynamic resolver, publish, poster catalog, e2e, runner) | **85 passed** |
| Full suite | **100 files, 1,154 passed, 4 skipped** (1,158 total) |
| `npx tsc --noEmit` | 1 pre-existing error (`src/routes/__root.tsx:148`) |
| Scoped ingestion typecheck | no errors in new ingestion/dynamic files; pre-existing `automation/notion` SDK typing errors remain |
| Scoped ESLint on changed/new files | exit 0 |
| Repo-wide `npm run lint` | pre-existing 749 errors / 19 warnings; unrelated to this feature |
| `npx vite build` | exit 0 |
| Client bundle secret scan | no automation/Admin secret references in `.output/public` |
| `npm run r2:map:check` | pass; generated map unchanged |
| `git diff --check` | pass |
| External writes | none |

The 4 skipped tests are the pre-existing conditional
`tests/security/firebase-admin-packaging.test.ts` cases.

---

## 5. Security assessment after remediation

| Check | Verdict |
|---|---|
| Token attachment to untrusted hosts | **PASS** — exact host allowlist, no substring matching, no cross-origin forwarding. |
| Redirect protocol/port validation | **PASS** — HTTPS and default port enforced before each request. |
| Log redaction | **PASS** — Bearer and credential-query redaction; no URL/token logging in download errors. |
| Firestore automation collections | **PASS** — no client rules; default deny. Admin SDK only. No rules change required; explicit deny is optional defense-in-depth. |
| Public poster metadata | **NEEDS ATTENTION (low)** — `contentHash` remains on public poster documents. It is not a credential, but it is unnecessary ingestion metadata. Move to a private collection or omit when convenient. |
| Dynamic R2 validation | **PASS** — valid, invalid and absent states are distinct; invalid refs fail closed. |
| Credential boundary in client bundle | **PASS** — no automation/Admin references in the public build. |

---

## 6. Remaining non-blocking limitations

1. **Sitemap dynamic references** — `src/lib/sitemap.ts` `imageOf` still builds a
   partial `{ id, image }` poster, so `r2Image` is not passed to
   `getPosterSeoImageUrl`. New posters appear in the sitemap with the unoptimized
   R2 original after a deployment. Sitemap generation is build-time, so new
   posters are absent until a deployment regardless.
2. **No distributed lock** — GitHub Actions share a concurrency group, but
   manual/local runs can overlap. Job/catalogue reads are non-transactional.
   Recommend a Firestore lease/transaction for hard cross-run protection.
3. **Permanent image-preparation errors are retried** — `ImagePreparationError`
   is not in the non-retryable branch of `runner.ts:isRetryableError`; an
   undecodable image consumes the retry budget. Cosmetic/reliability only.
4. **Constellation fallback** — `src/routes/constellation.tsx` falls back to
   `node.image` on display-image error, bypassing the resolver’s placeholder for
   invalid dynamic refs. PosterImage itself is correct.
5. **Create path guard** — catalogue creation requires an ingestion job at
   `notion_draft_created`/`awaiting_publication`. A manually created Notion page
   with no ingestion job is held for review rather than creating a document.
   This is intentional for update-only safety and should be documented for
   editors.
6. **Firestore create race** — create still uses `set`; an atomic `create()` is
   preferable.
7. **Live Notion schema** — the 24-property schema was not re-queried in this
   read-only audit. Field names/types are inherited from the existing production
   mapper; `CinePrint Poster ID` is confirmed live as rich_text.
8. **Source/style/tags** — new records default `source: "Raindrop"`,
   `style: "Minimalist"` and `tags: []` because the current Notion schema has no
   pipeline-set values.
9. **Full Vercel prebuild** — `npm run build` runs palette extraction and sitemap
   generation, requires public Firebase config, and writes tracked generated
   files. It was not run in this audit; run it in the preview/deployment
   environment before activation.
10. **External integrations** — Notion query shapes, Firestore Admin rules/index
    behavior, R2/S3 behavior and GitHub scheduling are still mock/inspection
    verified only.
11. **Notion polling bounds** — 10 pages × 100 rows and no `filter_properties`.
12. **Firestore scans** — job/catalogue scans cap at 1,000 documents.

---

## 7. Activation prerequisites (unchanged)

1. Review/merge the branch with authorization.
2. Deploy the frontend so the dynamic resolver (and P0-2 flag handling) is live.
3. Add the secrets and variables in
   `docs/raindrop-automation-operations.md`.
4. Confirm Firestore rules keep `automationIngestionJobs` and
   `automationIngestionRuns` client-inaccessible (default deny).
5. Run both workflows manually with `apply` unchecked.
6. Run the approved single-poster ingestion and publishing rehearsal from the
   operations document.
7. Set `AUTOMATION_ENABLED=true` only after those steps pass.

No workflow was activated, no schedule was enabled, and no production data was
changed during this remediation.

---

## 8. Final recommendation

**MERGE READY** for code review/merge.

All four original critical blockers have:

- a focused implementation change,
- a regression test that would fail before the fix,
- successful focused and full-suite verification.

The remaining items are non-blocking hardening, documentation, or deployment
verification. Activation remains separately gated and unauthorized.
