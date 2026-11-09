# Canonical poster identity contract (Phase 7B)

## Status

- **Implemented locally:** `scripts/poster-identity.js`, the fail-closed sync plan in
  `scripts/sync-notion-to-firestore.js`, and the tests under `automation/identity/`.
- **Created in Notion (Phase 7C-B):** `CinePrint Poster ID` is live as `wRCR`
  (`rich_text`); `Poster Identities` is live as
  `412890a5-f3e2-81bb-a5fc-000b21b7ba8a`, with `Grouping Page` targeting the Poster
  Library data source.
- **Backfilled (Phase 7C-C):** 51 single-page property values and 10 per-image identity
  rows were written and verified exactly. 61 identities resolve; `stranger-things-2`
  and `the-substance-2` remain intentionally unresolved.
- **7C-D verified:** the live canonical dry-run reports 61 resolved, 2 unresolved,
  0 conflicts, 0 potential creates and 0 Firestore writes. No Firestore sync has run.
- **7C-A preflight preserved:** `migration/notion-identity-schema.json` and
  `migration/identity-backfill-preflight.md` retain the pre-write evidence and now
  record the post-execution status.
- **Not activated:** no R2, Blob, deployment, or production activation was performed.

## Canonical identity

The canonical poster ID is the existing Firestore document ID.

Invariants:

1. `posterId` is permanent.
2. All 63 existing Firestore document IDs remain unchanged.
3. `posterId` is never regenerated from title, slug, image URL, or array position.
4. Reordering a page's images never changes poster IDs.
5. Replacing an image never changes poster ID.
6. Replacing a Raindrop bookmark never changes poster ID.
7. Moving a poster between editorial groups never changes poster ID.
8. A new image never silently becomes a new poster.
9. Missing identity is unresolved.
10. Conflicting identity fails closed before any write.

`raindropId`, image URL, SHA-256, MIME type, dimensions and revision describe the
**source**, not the poster. They may change without changing the poster ID.

## Hybrid Notion architecture

### Path A — single-poster pages

Proposed property: `CinePrint Poster ID` (`rich_text`).

- All rich-text segments are joined, not just the first.
- Surrounding whitespace is trimmed.
- Empty values, invalid formats, duplicates, unknown IDs and page mismatches fail closed.
- If the property exists but is invalid, the sync never falls back to slug or title.

### Path B — multi-image editorial pages

Proposed data source: `Poster Identities`, one row per poster.

| Field | Purpose |
|---|---|
| `Poster ID` | Existing canonical Firestore ID |
| `Grouping Page` | Relation to the Poster Library page (or `Grouping Page ID` text fallback) |
| `Image URL` | Exact image/source association |
| `Raindrop ID` | Optional source bookmark |
| `Source Provider` | Source classification |
| `Source SHA-256` | Optional verified source fingerprint |
| `Source Revision` | Source revision number |
| `Status` | `active`, `superseded`, or `unresolved` |

The adapter is isolated in `scripts/poster-identity.js` (`identityRecordsFromNotion`).
The relation schema is **not created**; the text fallback is supported behind the
same interface. Phase 7B tests use fixtures, not live Notion.

## Resolution precedence

1. Valid, unique, consistent `CinePrint Poster ID` for a single-image page.
2. Valid, unique, consistent per-image identity record for a multi-image page.
3. Controlled legacy transition only:
   - `artwork-<raindropId>` when it matches exactly one existing Firestore document.
   - Explicit `<slug>` when the page has exactly one image and the match is unique.
4. Otherwise unresolved; fail closed.

Never used as canonical identity: image position, title, title-derived slug, image URL,
or array order. Legacy fallback is visible in dry-run warnings and cannot create a
Firestore document or override a conflicting canonical identity.

## Modes

| Mode | Behavior | Writes |
|---|---|---|
| `legacy` | Dry-run compatibility only; unique explicit legacy matches for single pages, never positional multi-image IDs | **Refused** |
| `transition` | Canonical identity preferred; unique explicit legacy match allowed | Allowed after validation |
| `canonical` | Canonical property/per-image records required; no legacy fallback | Allowed after validation |

Default: `transition` with legacy fallback enabled. After the 7C backfill, use
`canonical` (and `--no-legacy`) and remove the legacy path.

The old `parsePage` remains available for the read-only manifest builder. The
canonical write path uses `parsePageData`, which does not generate a positional ID
at all. `legacy` mode is a dry-run compatibility mode; it does not re-enable
positional multi-image identity.

## Fail-closed behavior

The sync resolves and validates the full identity set before the first write. It aborts
with zero writes on any of:

- `DUPLICATE_ID` — the same canonical ID is claimed more than once.
- `UNKNOWN_ID` — the ID is not in the known Firestore identity set.
- `MISSING_FIRESTORE_DOCUMENT` — the ID is known but the live document is absent.
- `PAGE_MISMATCH` — the document's `notionPageId` conflicts with the resolved group.
- `MISSING_RELATION`, `INVALID_RELATION_TARGET`, `MULTIPLE_GROUPING_PAGES`.
- `INVALID_CANONICAL_ID`, `EMPTY_CANONICAL_ID`, `INVALID_PROPERTY_TYPE`.
- `MISSING_IDENTITY_RECORDS`, `NEW_IMAGE_WITHOUT_IDENTITY`.
- `MULTIPLE_IDENTITY_RECORDS` (reported as a duplicate claim).
- `MISSING_PAGE_IMAGE`, `AMBIGUOUS_PAGE_IMAGE`.

A new image is unresolved; a removed image leaves its identity **orphaned** and is
reported, not silently deleted. Orphaned identities preserve the Firestore document.

Writes use Firestore `update()` rather than `set(..., { merge: true })`. If a document
disappears after validation, the batch fails instead of recreating it. New poster
documents must be created through a separate authorized path.

## Dry-run

```bash
# Read-only, live Notion + Firestore when admin credentials exist,
# otherwise migration/firestore-identities.json.
node scripts/sync-notion-to-firestore.js --dry-run

# Canonical-only dry run, no legacy fallback.
node scripts/sync-notion-to-firestore.js --dry-run --identity-mode=canonical

# Machine-readable plan.
node scripts/sync-notion-to-firestore.js --dry-run --json
```

Dry-run output includes page counts, identity source counts, unresolved/conflict/
orphaned counts, potential creates (must be zero), potential updates, and prune
candidates. It never writes to Firestore, Notion, migration state, manifests, or R2.

The live Notion data does not yet contain the proposed property/data source, so a
live canonical dry-run is expected to be unresolved for multi-image pages until 7C.

## Prune restrictions

`--prune` is disabled by default and requires `--allow-prune`. Prune is refused when:

- the plan has any conflict, unresolved identity, or orphaned identity;
- any resolved ID would create a new document;
- the mode is legacy.

Prune archives only documents absent from a fully validated canonical identity set.
It never archives based on image position. Prune is not executed by Phase 7B.

## Multi-image pages

The five multi-image pages remain editorial groups. Each of their 12 posters gets an
identity row with its own canonical ID and image URL. The page's `Image URL` array is
display/editorial data; it is no longer authoritative for identity.

Reorder behavior:

- Reorder: IDs unchanged.
- Insert image: existing IDs unchanged; new image unresolved.
- Remove image: remaining IDs unchanged; removed identity orphaned.
- Move poster: ID unchanged; the Firestore `notionPageId` must be updated explicitly.
- Replace URL/Raindrop: ID unchanged; source revision/identity changes.

## Manifest and R2 compatibility

- The migration manifest continues to use the existing 63 Firestore IDs.
- The legacy `parsePage` remains for the read-only manifest builder; its generated
  `id` is explicitly non-authoritative for writes.
- The three canaries remain exact: `2001-a-space-odyssey`, `bugonia`,
  `artwork-1824607248`.
- The six R2 keys and the allowlist are unchanged. Identity code does not import R2
  or Blob clients and never writes objects.
- A changed image URL fails the resolver's `blobImageUrl` guard, so the old R2 entry
  is not silently reused.

## Phase 7C prerequisites

1. Human approval of the hybrid architecture and this contract.
2. Human decisions for `stranger-things-2` and `the-substance-2`.
3. Create the `CinePrint Poster ID` rich-text property (schema change).
4. Create the `Poster Identities` data source/relation (or approve the text fallback).
5. Backfill 51 single-poster properties and 12 identity rows; preserve all 63 IDs.
6. Run the canonical dry-run until zero unresolved/conflicts and 63/63 resolved.
7. Only then run the write sync with `--identity-mode=canonical`.

## Phase 7D validation

- Rebuild the manifest only after identity is frozen and approved.
- Verify manifest, Firestore and Notion identity agreement (63/63).
- Recheck the three-poster Preview canary and the six R2 objects.
- Re-export the R2 map only when explicitly authorized; verify the three entries are
  unchanged.

## Remaining assumptions

- The proposed relation/data-source API shape must be validated in 7C; the adapter
  currently supports both relation and text fallback but neither exists live.
- The legacy `parsePage` still produces positional IDs for the read-only manifest
  builder; 7D must switch it to the canonical resolver after backfill.
- `slug` remains a legacy/editorial field for multi-image pages; it is not identity
  and should be stabilized separately if the editorial model requires it.
- Source-level artist/source arrays are still positional on multi-image pages; this
  does not affect poster identity but should be reviewed in 7C.
