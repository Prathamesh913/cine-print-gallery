# CinePrint — R2 Migration Engine Design (Phase 2)

**Status:** implemented and unit-tested; **not executed** against R2.  
**Scope:** direct source → R2 migration for the 63 Phase 1 posters.  
**Non-goals:** no Notion, Raindrop, Firestore, Vercel Blob, DNS or deployment writes; no production resolver changes; no Firebase document ID changes.

## 1. Design goals

- Treat `migration/poster-manifest.json` as the authoritative migration input.
- Preserve every existing Firestore document ID exactly.
- Download originals directly from Raindrop or `pbs.twimg.com`.
- Verify the downloaded bytes against the Phase 1 SHA-256.
- Generate optimized WebP variants using the existing CinePrint `optimizeImage` implementation.
- Upload original and optimized objects to R2 with deterministic keys.
- Never overwrite an existing R2 object blindly.
- Persist durable state for safe resume after interruption.
- Block medium-confidence mappings until explicitly approved.
- Keep dry-run and verify strictly read-only.

## 2. Module layout

| Module                                   | Responsibility                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `automation/migration/manifest.ts`       | Load and validate the Phase 1 manifest, Firestore snapshot, approvals, object keys and public URLs.                                   |
| `automation/migration/source.ts`         | Safe source download, host allowlist, redirect validation, MIME/image decoding, checksum verification.                                |
| `automation/migration/checksum.ts`       | SHA-256/MD5 helpers and constant-time comparison.                                                                                     |
| `automation/migration/r2.ts`             | R2 S3 client, `HeadObject`, `GetObject` origin verification, conditional `PutObject`, metadata verification, public URL verification. |
| `automation/migration/optimize.ts`       | Wrapper around the existing `automation/blob/optimize.ts` implementation.                                                             |
| `automation/migration/state.ts`          | Atomic migration state, manifest hash guard, lock file.                                                                               |
| `automation/migration/canary.ts`         | Canary selection and blocked-entry detection.                                                                                         |
| `automation/migration/engine.ts`         | Per-poster state machine, upload orchestration, concurrency, resume.                                                                  |
| `automation/migration/dry-run-report.ts` | Read-only destination inspection and report generation.                                                                               |
| `automation/migration/cli.ts`            | `dry-run`, `canary`, `run`, `verify` commands.                                                                                        |
| `automation/migration/engine.test.ts`    | Mocked-network/R2 tests for all safety-critical paths.                                                                                |

## 3. Data flow

```text
Phase 1 manifest
  → validate entries, Firestore IDs, approvals
  → for each entry:
      download source (Raindrop auth or pbs)
      validate HTTP status, MIME, decode, size, dimensions
      compare SHA-256 with manifest
      optimize to WebP (800px, q80, EXIF orientation, no upscaling)
      GetObject origin verification, original target
        exists + checksum/metadata match → ALREADY_VERIFIED
        exists + mismatch                → CONFLICT, stop
        absent                           → PutObject (If-None-Match: *) + GetObject verify
      GetObject origin verification, optimized target
        same rules
      verify public CDN bytes separately (bounded retries)
      mark VERIFIED only after both origin and public checks pass
```

## 4. State machine

Durable state is stored separately from the manifest in `migration/migration-state.json` (created only by an `--execute` run). The state file contains a hash of the manifest entries; resuming against a different manifest is rejected.

```text
PENDING
  → SOURCE_DOWNLOADED
  → SOURCE_VERIFIED
  → OPTIMIZED
  → READY_TO_UPLOAD
  → ORIGINAL_UPLOADED
  → OPTIMIZED_UPLOADED
  → VERIFIED

Failure states:
  SOURCE_UNAVAILABLE   source HTTP/auth/network failure
  SOURCE_CHANGED       checksum/MIME/size/dimension mismatch
  CONFLICT             existing R2 object has different content or no checksum metadata
  FAILED               optimization/upload/verification failure
  READY_WITH_REVIEW    medium/low confidence not approved
```

Rules:

- A `VERIFIED` entry is revalidated against R2 origin bytes, both persisted SHA-256 values and the public URLs before it is skipped. A `VERIFIED` entry is never trusted solely because the local state says so.
- Malformed or incomplete `VERIFIED` state fails closed with `FAILED`.
- `CONFLICT` and `SOURCE_CHANGED` are not retried unless `--retry-conflicts` / `--retry-source-changed` is passed.
- `FAILED` and `SOURCE_UNAVAILABLE` are retried on the next run.
- State writes use a temp file + rename.
- A migration-wide lock scoped to the bucket prevents two local migration processes using different state paths from writing concurrently; a per-state lock also remains.
- `VERIFIED` is only written after both original and optimized objects pass checksum, metadata and public URL verification.

## 5. Source security

- Only HTTPS sources are accepted.
- Host allowlist:
  - Raindrop: `api.raindrop.io`, `up.raindrop.io`.
  - External: `pbs.twimg.com`.
- Redirects are followed manually and only to allowlisted hosts.
- Every hop resolves DNS with `dns.lookup({ all: true, verbatim: true })`.
- All resolved IPv4 and IPv6 addresses must be public. Private, loopback, link-local, unspecified, multicast, reserved, documentation, ULA, IPv4-mapped-private, Teredo and 6to4 destinations are rejected.
- A DNS answer containing any non-public address is rejected as a whole.
- The validated address is pinned into the HTTPS connection via a custom `lookup` callback. The request still uses the original hostname for SNI and TLS certificate verification; `rejectUnauthorized` is never disabled.
- Redirects are independently re-resolved and re-validated before the next request.
- Embedded URL credentials are rejected.
- The Raindrop token is sent only to `api.raindrop.io`; it is never sent to `up.raindrop.io` or `pbs.twimg.com`.
- Authorization headers and token query parameters are redacted from errors and logs.
- Source timeout: configurable, default 120 seconds (`MIGRATION_SOURCE_TIMEOUT_MS`, bounded to 1–600000 ms). The timeout aborts the underlying request and response stream, not only the caller's wait.
- Source size limit: 30 MB, enforced while consuming the response stream. Content-Length is checked as an early hint, but the streaming byte counter is authoritative.
- The response stream is destroyed/cancelled as soon as the limit is exceeded.
- MIME allowlist: JPEG, PNG, WebP, GIF.
- The body must decode with `sharp` and have positive dimensions.
- The downloaded SHA-256 must equal the Phase 1 manifest value; otherwise `SOURCE_CHANGED`.
- Limitation: DNS pinning is implemented with Node's `https` lookup callback. A local hosts-file or DNS compromise cannot redirect the pinned connection after validation, but a shared bucket accessed from multiple machines still requires the global lock/conditional-write controls described below.

## 6. R2 safety

- Uses the existing `@aws-sdk/client-s3` dependency.
- Endpoint: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.
- Public base URL must be `https://images.cineprint.click`; the `r2.dev` domain is rejected.
- Credentials are read from server-only environment variables and never logged.
- Every upload performs an origin-byte preflight using `GetObject`.
  - Existing + origin SHA-256, size, Content-Type and Cache-Control match → skip upload.
  - Existing + checksum mismatch → `CONFLICT`.
  - Existing without SHA-256 metadata → `CONFLICT`.
  - Existing without or with incorrect Content-Type → `CONFLICT`.
  - Existing without or with incorrect Cache-Control → `CONFLICT`.
  - Absent → `PutObject`.
- Origin verification reads the actual R2 object bytes, computes SHA-256 independently and compares it to the expected checksum. ETags are never treated as SHA-256.
- Public CDN verification is a separate check after origin verification. It validates HTTP status, size, Content-Type and the actual public bytes.
- Public CDN verification uses bounded retries with exponential backoff and jitter. Temporary 404/408/425/429/5xx/network/content mismatches are retried; 401/403/400/410 are treated as permanent. Retry exhaustion produces `FAILED`.
- `PutObject` sets:
  - exact `Content-Type`
  - `Cache-Control: public, max-age=31536000, immutable`
  - `x-amz-meta-sha256`
  - poster ID, variant and source-provider metadata
- Cloudflare's S3 compatibility table marks SHA-256 `FULL_OBJECT` as not implemented and `COMPOSITE` as implemented. The engine therefore does not send S3 checksum headers or rely on the R2 checksum response. It computes SHA-256 from `GetObject` bytes and stores its own `sha256` metadata; origin verification compares the actual bytes.
- `PutObject` uses `If-None-Match: *`. Cloudflare documents this as an atomic create-once condition; a `412 PreconditionFailed` becomes `CONFLICT`.
- A migration-wide lock scoped to the bucket prevents two local processes using different `--state` paths from running concurrently. Conditional writes are the second line of defense.
- No object is deleted or overwritten.
- Authoritative references: Cloudflare R2 S3 API compatibility (`GetObject`, `PutObject` conditional operations) and R2 Extensions (`If-None-Match: *` atomic create-once semantics).

## 7. Optimization

- Reuses `optimizeImage()` from `automation/blob/optimize.ts`.
- Settings: 800px max width, WebP quality 80, `withoutEnlargement: true`.
- Applies EXIF orientation with `.rotate()` before resizing and WebP encoding.
- Output dimensions and `sourceWidth`/`sourceHeight` reflect the corrected orientation.
- Preserves transparency.
- Validates WebP magic bytes, dimensions, aspect ratio and no upscaling.
- Records optimized dimensions and byte size.
- **All 63 optimized variants are regenerated from the verified source.** The engine does not read or copy optimized objects from Vercel Blob.
- Phase 1 `optimizedAction` is provenance only: `reuse-existing` means a Blob optimized object existed; `regenerate` means it was missing. It is not a Phase 2 copy instruction.

## 8. Retries, concurrency and resume

- Source download: 3 attempts with exponential backoff and jitter.
- R2 upload: 3 attempts with exponential backoff and jitter.
- Public CDN verification: 5 attempts by default with exponential backoff and jitter; temporary failures only.
- Default concurrency: 3; configurable with `--concurrency` from 1 to 8.
- The state file is saved after each state transition.
- State saves are serialized. A failed save rejects its own caller but does not poison the queue; a later save is still attempted and writes the latest state. Atomic temp-file + rename semantics are preserved.
- A migration-wide lock scoped to the bucket prevents two local processes using different `--state` paths from running concurrently. A per-state lock also remains.
- The global lock is host-local (`os.tmpdir()`). Cross-host protection relies on `If-None-Match: *` conditional writes and conflict checks.
- Stale locks are never removed based on PID alone. `--break-lock` is the explicit recovery mechanism for an execute run and refuses live, malformed, foreign-host or out-of-scope locks. Manual recovery instructions are printed when automatic recovery is refused.
- A verified entry is revalidated before being skipped; it is never re-uploaded unnecessarily.

## 9. Medium-confidence approval

The two medium-confidence entries (`stranger-things-2`, `the-substance-2`) are blocked by default. Approval is separate from the manifest and requires a file:

```json
{
  "approved": ["stranger-things-2"]
}
```

Default path: `migration/medium-confidence-approvals.json` (not created). Use `--approvals PATH` to point elsewhere. High-confidence IDs in the approvals file are rejected. `run` refuses to process an unapproved medium/low-confidence entry. `canary` accepts only high-confidence posters; medium/low-confidence entries are permanently excluded even when approved, and explicit selection fails closed.

## 10. CLI

| Command                                                   | Behavior                                                                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npm run migration:dry-run`                               | Read-only report; never writes to R2.                                                                                               |
| `npm run migration:canary`                                | Prints the canary plan; no downloads/uploads without `--execute`. Never accepts `--all`. Only high-confidence posters are eligible. |
| `npm run migration:canary -- --execute --posters id1,id2` | Executes the selected high-confidence canary with explicit approval. Medium/low-confidence IDs fail closed.                         |
| `npm run migration:run -- --execute --posters id1,id2`    | Executes only the selected posters; prints the exact selected IDs first.                                                            |
| `npm run migration:run -- --execute --all`                | Executes the full catalogue; prints all selected IDs first.                                                                         |
| `npm run migration:run`                                   | Fails closed: `run` requires `--execute` and exactly one of `--all` or `--posters`.                                                 |
| `npm run migration:verify`                                | Read-only verification; never modifies objects; rejects poster selection.                                                           |

`--posters` is accepted only by `canary` and `run`. `dry-run` and `verify` reject it. Duplicate and unknown IDs fail before an engine or R2 client is created.

Useful flags:

- `--all`
- `--posters id1,id2`
- `--break-lock` (execute runs only; validated stale global/per-state lock recovery)
- `--concurrency N`
- `--manifest PATH`
- `--snapshot PATH`
- `--approvals PATH`
- `--state PATH`
- `--report PATH`
- `--retry-conflicts`
- `--retry-source-changed`

## 11. Testing

`automation/migration/engine.test.ts` covers:

- Manifest and snapshot validation.
- Duplicate keys and invalid checksums.
- Approval file behavior.
- Source checksum mismatch.
- Unexpected MIME and invalid image bodies.
- Raindrop authentication failure without token leakage.
- External HTTP failure.
- Redirect to an arbitrary host.
- Dry-run never uploading.
- Existing object with matching checksum and metadata.
- Existing object with conflicting checksum.
- Existing object without checksum metadata.
- Existing object with missing or incorrect Content-Type.
- Existing object with missing or incorrect Cache-Control.
- Origin checksum mismatch, missing origin object and origin metadata mismatch.
- Successful origin and CDN verification.
- CDN temporarily unavailable then successful; permanent CDN failure; public bytes mismatch despite origin success.
- Upload failure after bounded retries.
- Resume after source failure.
- Valid `VERIFIED` state revalidated without re-downloading.
- `VERIFIED` state with missing fields, incorrect checksum, missing R2 object or failed public delivery.
- Verification without state: missing/malformed/valid state, with distinct origin/public checksum status.
- Medium-confidence blocking and approval.
- Optimization failure.
- Concurrent migration.
- Canary execution guard and exact selected-entry execution.
- Canary default selection.
- CLI scope isolation: `run --execute --posters` selects only those posters, `run --execute --all` selects 63, and contradictory/invalid arguments fail closed.
- State atomicity, manifest-hash guard and lock.
- Recoverable state-save queue: failed save rejects its caller, later save succeeds, latest state is written, concurrent saves serialize.
- Per-state lock recovery: live lock, stale lock, missing PID, malformed lock, wrong scope.
- Global lock across different state paths, lock failure before writes, stale lock handling, live/malformed/wrong-scope refusal.
- Conditional `PutObject` `If-None-Match: *` and 412 conflict handling.
- IPv4/IPv6 private/reserved address rejection, DNS mixtures, DNS pinning and redirect validation.
- Raindrop token non-forwarding and TLS hostname verification settings.
- EXIF orientations 1, 3, 6 and 8 with dimensions and pixel orientation.
- Streaming size limit with missing/incorrect Content-Length, oversized bodies and stream cancellation.
- Credential redaction.
- Dry-run report generation.

Additional test files:

- `automation/migration/cli-args.test.ts` — CLI selection and fail-closed argument tests.
- `automation/migration/r2.test.ts` — real `R2StoreImpl.verify`/`verifyOrigin` metadata and origin-byte tests.
- `automation/migration/source.test.ts` — DNS/SSRF and streaming-limit tests.
- `automation/migration/lock.test.ts` — migration-wide lock and stale-lock tests.
- `automation/migration/optimize.test.ts` — EXIF orientation tests.
- `automation/migration/state.test.ts` — recoverable save queue and per-state lock recovery tests.
- `automation/r2-image-map.test.ts` — mapping exporter, runtime map generator, resolver/download/SEO activation tests.
- `automation/image-load-state.test.ts` — Lightbox keyed loading/error state tests.
- `automation/download-image.test.ts` — download extension and image data-URL validation tests.

All tests use mocked network and R2 clients; no external credentials are required.

## 12. Implemented vs executed

**Implemented:** engine, CLI, R2 client wrapper, source validation, optimization wrapper, state store, lock, dry-run report, canary plan, tests.

**Executed in Phase 2:** read-only dry-run and read-only verify. R2 bucket was empty; 126 expected objects were reported missing; 0 conflicts.

**Phase 2.3:** independent R2 origin-byte verification, CDN retry handling, DNS pinning/SSRF controls, EXIF orientation, state-less verification reporting, migration-wide lock, conditional writes and streaming size limits are implemented and tested. No migration was executed.

**Phase 2.5:** recoverable state-save queue (F13), validated per-state stale-lock recovery (F12), canary restricted to high-confidence posters with permanent medium-confidence exclusion (F14), and operational documentation updates (F15). No migration was executed.

**Phase 3:** the six-object canary for `2001-a-space-odyssey`, `bugonia` and `artwork-1824607248` was executed and independently verified against R2 origin bytes and the public CDN. No full migration was executed.

**Phase 4.0/4.1:** verified mapping exporter, deterministic runtime map generator, and a disabled-by-default provider-aware resolver were implemented. R2 resolution remains disabled. No deployment or activation occurred.

**Phase 5.1/5.2:** 412 conflicts now classify as `CONFLICT`, retry counts are accurate, permanent upload errors are not retried, and fatal worker failures wait for in-flight workers before lock release. Downloads use verified R2 originals when enabled, display fallback is R2 optimized → R2 original → Blob original, and SEO/OG/JSON-LD/sitemap use the independent SEO resolver. Local staging with preview env activation passed; a Vercel preview deployment was blocked by missing CLI/project credentials. No production deployment or R2 write occurred.

**Not executed:** canary `--execute`, full `run --execute`, any R2 upload, any external service write.

## 13. Phase 4 — Resolver mapping (disabled by default)

Phase 4.0/4.1 added a verified poster-to-R2 mapping path. Phase 4.2 separates browser and SEO activation; both remain disabled.

- `migration/r2-resolver-allowlist.json` lists the only poster IDs permitted to use R2. It currently contains exactly `2001-a-space-odyssey`, `bugonia` and `artwork-1824607248`.
- `scripts/export-r2-verified-mappings.ts` reads the manifest, `migration/migration-state.json` and the allowlist, validates every required key/checksum/size/Content-Type/URL, and writes `migration/r2-image-map.json`. It fails closed on any invalid allowlisted entry.
- `scripts/generate-r2-image-map.ts` converts the audit JSON into `src/lib/r2-image-map.generated.ts`. It is deterministic, supports `--check`, and requires the runtime map IDs to exactly match the allowlist.
- `src/lib/poster-images.ts` preserves the existing browser API and adds an injectable `createPosterImageResolver(map, { browserEnabled, seoEnabled, downloadsEnabled })`.
- `R2_BROWSER_IMAGES_ENABLED` and `R2_SEO_IMAGES_ENABLED` are generated as `false`. Runtime code never reads `migration/`.
- Browser consumers use `getPosterImageUrl()` (`gallery`, `detail`, `original`) and `getOptimizedPosterImageUrl()`. SEO consumers use `getPosterSeoImageUrl()`. The `detail` purpose is no longer used for SEO.
- A mapping is used only when the relevant switch is enabled, the exact poster ID exists, and `entry.blobImageUrl === poster.image`. Otherwise the existing Blob resolver runs unchanged.
- Downloads use the verified R2 original when `R2_DOWNLOADS_ENABLED` is on; otherwise the existing `posterImageUrl || image` Blob URL. Download responses are server-fetched and content-type validated.
- `PosterImage` uses a finite deduplicated candidate list: R2 optimized → R2 original → Blob original. Each candidate is attempted at most once; unknown/unmapped posters keep Blob optimized → Blob original. Downloads do not use the display fallback.
- Medium-confidence IDs are excluded by the allowlist and by the exporter's `identityConfidence === "high"` check, independent of any approvals file.

Commands:

```bash
npm run r2:map:export
npm run r2:map:generate
npm run r2:map:check
```

**Browser/download test configuration:** set `VITE_VERCEL_ENV=development` (or `preview`), `VITE_R2_BROWSER_IMAGES=true` and/or `VITE_R2_DOWNLOADS=true`. Repository defaults stay `false`; SEO has no preview override. No generated map change is required.

**Blob fallback limitation:** sampled Vercel Blob URLs currently return HTTP 403 with `Your store is blocked`. The fallback remains in code but is not currently operational. Rollback to Blob will not restore images until the store is unblocked.

## 14. Phase 5 — Reliability and complete delivery

**Phase 5.1 — engine reliability**

- A 412 conditional write is unwrapped from `RetryExhaustedError` and recorded as `CONFLICT`; it is not retried and does not overwrite the object.
- `RetryExhaustedError` reports the actual number of attempts.
- Permanent upload 4xx errors carry `retryable=false` and are not retried.
- `mapWithConcurrency` uses `Promise.allSettled`: a fatal worker stops new scheduling, waits for in-flight workers, then releases locks. Completed per-entry state remains durable.

**Phase 5.2 — delivery**

- `src/lib/r2-image-activation.ts` separates browser, SEO and download activation. Repository defaults are false; preview/local env flags are the only opt-in path.
- `getPosterDownloadUrl()` selects the verified R2 original when downloads are enabled, preserving original bytes and format.
- `fetchImageDataUrl()` rejects non-image/HTML responses and unsupported content types; filenames derive their extension from the image URL/data URI.
- Display fallback is R2 optimized → R2 original → Blob original, finite and per-verified-entry only.
- SEO/OG/JSON-LD/sitemap use the independent SEO resolver and remain Blob while SEO activation is disabled.
- Blob remains 403; neither R2 original nor Blob is independent disaster recovery from an R2 service outage.

**Phase 5.3 — staging**

- Local staging used preview-only env activation (`VITE_VERCEL_ENV=development`, `VITE_R2_BROWSER_IMAGES=true`, `VITE_R2_DOWNLOADS=true`) and the exact three allowlisted IDs.
- Display, R2-original fallback, terminal failure UI, downloads and SEO isolation passed.
- Vercel preview deployment is blocked: no Vercel CLI, `.vercel` project link or preview credentials are available. No production deployment occurred.

## 15. Deferred before full migration or cutover

- **F9 — production resolver compatibility.** Verified mapping, browser/download and SEO delivery paths are implemented but disabled by default. Activation is a separate reviewed step.
- **F11 — manifest key/MIME validation (open).** `automation/migration/manifest.ts` validates `sourceMimeType` but does not compare the original key extension to the source MIME. The Phase 4 exporter performs that check for exported mappings; the manifest validator itself remains unchanged.

## 16. Live integration outstanding

Phase 3 verified the six canary objects live. Still outstanding for broader migration and activation: Blob store availability, R2 verification for the remaining catalogue, CDN monitoring under production traffic, and resolver activation monitoring. Unit and local integration tests use mocked R2 and HTTP clients.
