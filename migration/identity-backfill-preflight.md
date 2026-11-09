# Phase 7C-A — Notion identity schema and backfill preflight

## Status

- **Prepared locally:** the schema contract, the 63-record backfill planner, and the
  validation evidence.
- **Not created in Notion:** the `CinePrint Poster ID` property and the
  `Poster Identities` data source do **not** exist live.
- **Not backfilled:** no Notion page, property, row or relation was written.
- **Not synchronized:** no Firestore write, R2 write, deployment or activation was
  performed.

Machine-readable schema contract: `migration/notion-identity-schema.json`.
Planner: `scripts/plan-identity-backfill.ts`.
Planner tests: `automation/identity/backfill-planner.test.ts`.

## Post-execution status (Phase 7C-D)

The preflight above is preserved as historical pre-write evidence. The live state is
now:

| Item | Live value |
|---|---|
| Poster Library data source | `38c890a5-f3e2-808b-a395-000b9b97e9db` |
| `CinePrint Poster ID` property | `wRCR`, `rich_text` |
| Poster Identities data source | `412890a5-f3e2-81bb-a5fc-000b21b7ba8a` |
| Poster Identities parent | `38c890a5-f3e2-8007-83f8-da7b81a268e4` |
| Grouping Page relation target | `38c890a5-f3e2-808b-a395-000b9b97e9db` |
| Single-page property assignments | **51/51 exact** |
| Multi-image identity rows | **10/10 exact** |
| Canonical identities resolved | **61** |
| Unresolved medium identities | **2** — `stranger-things-2`, `the-substance-2` |
| Canonical dry-run conflicts | **0** |
| Potential Firestore creates | **0** |
| Potential Firestore updates | **61** |
| Firestore sync/writes | **None** |
| R2 canary | 3 allowlist / 3 map / 3 VERIFIED state / 6 objects / 6 CDN checks |

Phase 7C-D verification is complete. The two medium-confidence identities remain
untouched and require human visual decisions. No Firestore synchronization has been
authorized or performed.

## Approved architecture (Option D)

- Existing Poster Library pages remain editorial/grouping records.
- Single-poster pages receive a `CinePrint Poster ID` rich-text property.
- Multi-image pages receive explicit per-poster rows in a separate
  `Poster Identities` data source.
- All 63 existing Firestore document IDs are preserved.
- Canonical identity is never derived from title, slug, image URL, Raindrop ID or
  image-array position.

## Live schema inspected (read-only)

| Item | Value |
|---|---|
| Database | `38c890a5-f3e2-8007-83f8-da7b81a268e4` |
| Poster Library data source | `38c890a5-f3e2-808b-a395-000b9b97e9db` |
| Existing properties | 23 |
| `CinePrint Poster ID` | **absent** |
| `Poster Identities` data source | **absent** |
| Notion pages | 57 |
| Pages with images | 56 |
| Empty page | 1 (`3b4890a5-f3e2-8034-8d2a-ffd20e73eae6`) |
| Multi-image pages | 5 |
| Multi-image identities | 12 |

Existing relevant property types:

| Property | Type |
|---|---|
| `Name` | title |
| `Image URL` | url |
| `Poster Image URL` | url |
| `Raindrop ID` | rich_text |
| `Slug` | rich_text |
| `Status` | select |

## Proposed schema

### Poster Library property

| Property | Type | Purpose |
|---|---|---|
| `CinePrint Poster ID` | `rich_text` | Immutable canonical Firestore ID for a single-poster page |

Payload:

```js
notion.dataSources.update({
  data_source_id: "38c890a5-f3e2-808b-a395-000b9b97e9db",
  properties: {
    "CinePrint Poster ID": { type: "rich_text", rich_text: {} },
  },
});
```

### Poster Identities data source

Create under the existing database (the database parent block is not shared with the
integration, so a new database under that parent is not a validated path):

```js
notion.dataSources.create({
  parent: { type: "database_id", database_id: "38c890a5-f3e2-8007-83f8-da7b81a268e4" },
  title: [{ type: "text", text: { content: "Poster Identities" } }],
  properties: {
    "Poster ID": { type: "title", title: {} },
    "Grouping Page": {
      type: "relation",
      relation: {
        data_source_id: "38c890a5-f3e2-808b-a395-000b9b97e9db",
        type: "single_property",
        single_property: {},
      },
    },
    "Image URL": { type: "url", url: {} },
    "Raindrop ID": { type: "rich_text", rich_text: {} },
    "Source Provider": {
      type: "select",
      select: {
        options: [{ name: "raindrop-file" }, { name: "pbs-twimg" }, { name: "other" }],
      },
    },
    "Source SHA-256": { type: "rich_text", rich_text: {} },
    "Source Revision": { type: "number", number: { format: "number" } },
    "Status": {
      type: "select",
      select: {
        options: [{ name: "active" }, { name: "unresolved" }, { name: "superseded" }],
      },
    },
    "Verified At": { type: "date", date: {} },
  },
});
```

Do **not** create `Grouping Page ID` by default. The Phase 7B adapter supports it as a
fallback only if the live relation cannot be created. If both relation and fallback
are populated and disagree, the adapter fails closed with `MULTIPLE_GROUPING_PAGES`.

## API capabilities

| Capability | SDK validated | Live tested |
|---|---|---|
| Add rich-text property to existing data source | Yes | No |
| Create data source under existing database | Yes | No |
| Create relation property | Yes | No |
| Read relation targets | Yes | No |
| Create rows/pages in data source | Yes | No |
| Update existing page properties | Yes | No |
| Paginated data-source queries | Yes | Yes (57 pages) |
| Multi-segment rich text | Yes | Yes (adapter) |

Live schema creation is **NOT TESTED** and is prohibited in this phase.

## Backfill plan

Planner command:

```bash
npx tsx scripts/plan-identity-backfill.ts --json
npx tsx scripts/plan-identity-backfill.ts
```

Live preflight result (read-only, 2026-11-08):

| Metric | Result |
|---|---:|
| Single-poster pages | 51 |
| Single `ADD` | 51 |
| Multi-image pages | 5 |
| Multi-image identities | 12 |
| High-confidence multi records | 10 |
| Medium-confidence blocked | 2 |
| Total existing identities | 63 |
| Automatically backfillable | 61 |
| Unresolved | 2 |
| Duplicate IDs | 0 |
| Unknown IDs | 0 |
| Conflicting assignments | 0 |
| New IDs | 0 |
| Identity changes | 0 |
| Orphaned identity records | 0 |
| Orphaned Firestore docs | 0 |

The planner is idempotent for unchanged inputs and emits JSON or a human summary. It
has no write mode.

### Single-poster assignments

All 51 single-image pages currently have no `CinePrint Poster ID`. Each proposed value
is the exact existing Firestore document ID matched by page + exact image URL. The
full 51-row table is produced by the planner; representative rows:

| Page | Proposed | Action |
|---|---|---|
| `2001: A Space Odyssey` | `2001-a-space-odyssey` | ADD |
| `Bugonia` | `bugonia` | ADD |
| `Backrooms` (`artwork-1824607248` page) | `artwork-1824607248` | ADD |
| `The Substance` (`artwork-1831541280` page) | `artwork-1831541280` | ADD |

### Multi-image assignments (10 high-confidence)

| Poster ID | Grouping page | Raindrop ID |
|---|---|---|
| `backrooms-1` | Backrooms | 1779301125 |
| `backrooms-2` | Backrooms | 1779304223 |
| `backrooms-3` | Backrooms | 1786274036 |
| `no-other-choice-2025-1` | No Other Choice | 1563985378 |
| `no-other-choice-2025-2` | No Other Choice | 1563985321 |
| `the-substance-1` | The Substance | 1530975924 |
| `stranger-things-1` | Stranger Things | 1532498759 |
| `stranger-things-3` | Stranger Things | 1528195848 |
| `kill-bill-vol-1-1` | Kill Bill | 1606171492 |
| `kill-bill-vol-1-2` | Kill Bill | 1606171578 |

Each row also carries `Image URL`, `Source Provider`, `Source SHA-256`,
`Source Revision: 1`, `Status: active`, and `Verified At: null` (to be set in 7D).

### Two blocked medium-confidence identities

| Poster ID | Page | Required decision |
|---|---|---|
| `stranger-things-2` | Stranger Things | Confirm pbs `G9gZV6dWEAAOjjU` is the Butcher Billy poster for image 2/3; confirm bookmark `1521167165` title typo is benign |
| `the-substance-2` | The Substance | Confirm pbs `HMtwlGHXgAAYt0L` is the Eileen Steinbach poster for image 2/2; accept 690×1024 or re-source higher resolution |

No identity rows are prepared for these two.

## Validation results

- Planner live plan: `validation.ok = true`; zero duplicates, unknown IDs, conflicts,
  new IDs, identity changes, orphaned records/docs.
- Proposed-backfill fixture canonical dry-run: **61 resolved** (51 property + 10
  per-image), **2 unresolved** medium, **0 conflicts**, **0 potential creates**,
  **0 legacy-position** identities.
- Live canonical dry-run: still fail-closed — 0 resolved, 56 unresolved
  (51 `MISSING_CANONICAL_ID`, 5 `MISSING_IDENTITY_RECORDS`), 0 conflicts, 0 creates.
  This is expected because the schema and records do not exist yet.

## Exact write operations required in the next phase

1. `dataSources.update` on Poster Library to add `CinePrint Poster ID`.
2. `dataSources.create` for `Poster Identities` with the properties above.
3. `pages.update` on 51 single-poster pages to set `CinePrint Poster ID`.
4. `pages.create` for 10 high-confidence rows in `Poster Identities`.
5. Re-read the schema and rows; run the canonical dry-run until 63/63 resolved with
   zero conflicts and zero creates.
6. Only after human approval and a clean dry-run, authorize the Firestore sync.

Do not create rows for the two medium entries until the human decisions are recorded.

## Rollback considerations

- Property rollback: clear the 51 `CinePrint Poster ID` values; do not delete the
  property unless the schema is being fully reverted.
- Data-source rollback: archive the 10 created rows and the `Poster Identities` data
  source; do not touch Poster Library pages.
- Firestore is not written by this phase; no Firestore rollback is required yet.
- R2/migration artifacts are untouched.
- Re-run the planner after rollback to confirm 51/10/2 and zero conflicts.

## What is not done

- No Notion property or data source was created.
- No Notion page or identity row was updated/created.
- No Firestore, Raindrop, Blob, R2, deployment or activation change.
- The two medium-confidence mappings remain unapproved.
