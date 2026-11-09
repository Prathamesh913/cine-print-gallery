# CinePrint — Poster Identity & Asset Recovery Manifest

**Generated:** 2026-11-07T05:01:59.239Z  
**Baseline:** ec5401c  
**Source commit:** ec5401ca82bb7d71f4679c60f2994cbc607177fe  
**Mode:** read-only audit; no Notion, Raindrop, Firestore, Blob or R2 writes.

## 1. Executive summary

- Firestore documents: **63**
- Notion pages: **57**
- Manifest entries: **63**
- Identity coverage: **63/63**
- Source coverage: **63/63**
- Firestore IDs preserved: **63/63**
- High-confidence identities: **61**
- Medium-confidence identities: **2**
- Optimized assets existing: **51**
- Optimized assets to regenerate: **12**
- Source size/MIME matches existing Blob original: **63**
- Source size/MIME mismatches: **0**
- Duplicate source URLs: **0**
- Duplicate Raindrop IDs: **0**

## 2. Source providers

| Provider | Entries |
|---|---:|
| raindrop-file | 31 |
| pbs-twimg | 32 |
| unknown | 0 |

## 3. Source-to-Blob size reconciliation

- Sources whose size and MIME exactly match the existing Blob original: **63/63**
- Sources with a size or MIME mismatch: **0**

An exact size and MIME match is strong evidence that the recovered Raindrop/pbs source is the same asset as the Blob original. It is not a cryptographic comparison because the Blob content is currently inaccessible.

## 4. Identity match methods

| Method | Entries |
|---|---:|
| poster_image_raindrop | 20 |
| firestore_raindrop_id | 14 |
| blob_path_raindrop_multi | 10 |
| poster_image_pbs | 17 |
| poster_image_pbs_multi_external | 2 |

## 5. Migration status

| Status | Entries |
|---|---:|
| READY_TO_COPY | 61 |
| READY_WITH_REVIEW | 2 |

## 6. Multi-image Notion pages

| Notion page | Title | Images | Poster IDs | Poster Image URL provider |
|---|---|---:|---|---|
| 38d890a5-f3e2-8002-bd6d-d95cf0f42567 | Backrooms | 3 | backrooms-1, backrooms-2, backrooms-3 | raindrop-file |
| 38c890a5-f3e2-8033-86d0-f64c12255e6b | No Other Choice | 2 | no-other-choice-2025-1, no-other-choice-2025-2 | raindrop-file |
| 38c890a5-f3e2-804c-a1ee-eb60974fb46e | The Substance | 2 | the-substance-1, the-substance-2 | pbs-twimg |
| 38c890a5-f3e2-80fa-bf29-e86e56cd77a2 | Stranger Things | 3 | stranger-things-1, stranger-things-2, stranger-things-3 | pbs-twimg |
| 38c890a5-f3e2-80b2-a595-ccb0b76f4743 | Kill Bill | 2 | kill-bill-vol-1-1, kill-bill-vol-1-2 | raindrop-file |

## 7. Ambiguous or review-required mappings

| Poster ID | Notion page | Raindrop ID | Method | Confidence | Status | Reason |
|---|---|---|---|---|---|---|
| stranger-things-2 | 38c890a5-f3e2-80fa-bf29-e86e56cd77a2 | 1521167165 | poster_image_pbs_multi_external | medium | READY_WITH_REVIEW | Multi-image page with an external image; matched via page-level Poster Image URL (pbs) and external Blob key. Bookmark movie/show tag does not confirm poster title "Stranger Things". Source size and MIME match the existing Blob original exactly (2728405 bytes, image/jpeg). Optimized Blob object exists at cineprint/optimized/external/stranger-things-2.webp. Optimized external object exists but the current resolver does not use it. Multi-image external match raised to medium confidence because the source size and MIME match the existing Blob original exactly. |
| the-substance-2 | 38c890a5-f3e2-804c-a1ee-eb60974fb46e | 1786264374 | poster_image_pbs_multi_external | medium | READY_WITH_REVIEW | Multi-image page with an external image; matched via page-level Poster Image URL (pbs) and external Blob key. Bookmark movie/show tag does not confirm poster title "The Substance". Source size and MIME match the existing Blob original exactly (77278 bytes, image/jpeg). Optimized Blob object exists at cineprint/optimized/external/the-substance-2.webp. Optimized external object exists but the current resolver does not use it. Multi-image external match raised to medium confidence because the source size and MIME match the existing Blob original exactly. |

## 8. Optimized asset inventory

- Existing: **51**
- Missing and must be regenerated: **12**
- Existing but currently unused by the resolver: **19**

| Variant | All entries | Existing | Missing |
|---|---:|---:|---:|
| legacy | 30 | 30 | 0 |
| external | 19 | 19 | 0 |
| artwork | 14 | 2 | 12 |

### Optimized assets to regenerate

- artwork-1824607248
- artwork-1824628665
- artwork-1824637521
- artwork-1824638987
- artwork-1824644552
- artwork-1824648439
- artwork-1824734129
- artwork-1831537050
- artwork-1831537996
- artwork-1831541280
- artwork-1831541566
- artwork-1831544424

### Optimized external assets currently unused

- bugonia
- cure-1997
- everything-everywhere-all-at-once
- frankenstein-2025
- her
- lady-vengeance
- midsommar
- mother-2009
- mother-2017
- mullholland-drive
- obsession-2025
- parasite
- project-hail-mary
- stranger-things-2
- tenet
- the-mummy-1999
- the-shape-of-water
- the-substance-2
- the-way-of-seeing-life

## 9. Proposed `CinePrint Poster ID` schema change (not applied)

Add a new Notion property:

| Property | Type | Purpose |
|---|---|---|
| `CinePrint Poster ID` | `rich_text` | Immutable canonical poster identity; initialized from the current Firestore document ID. |

Proposed sync precedence:

1. If `CinePrint Poster ID` is non-empty, use it as the Firestore document ID.
2. Otherwise, fall back to the current `artwork-<raindropId>` / `slug` / `slug-<n>` logic.
3. Backfill `CinePrint Poster ID` with the current Firestore document ID for all 63 posters.
4. Add `Raindrop ID` to legacy pages only after the precedence change is deployed and dry-run verified.
5. Split the 5 multi-image pages into 12 poster pages (or use a per-poster mapping) before adding per-poster Raindrop IDs.

This report does **not** apply the schema change.

## 10. Dry-run validation

The manifest is validated against `migration/firestore-identities.json` and the results are written to `migration/dry-run-validation.json`.

- Manifest entries: **63**
- Firestore documents: **63**
- ID sets match: **yes**
- Missing from manifest: **0**
- Extra in manifest: **0**
- Notion page ID mismatches: **0**
- Current image URL mismatches: **0**
- Notion-derived ID mismatches: **0**
- Sources available: **63/63**
- Optimized existing: **51**
- Optimized to regenerate: **12**

| Check | Result |
|---|---|
| exactly63Entries | PASS |
| exactly63FirestoreDocuments | PASS |
| allFirestoreIdsPreserved | PASS |
| allNotionPageIdsMatch | PASS |
| allCurrentImageUrlsMatch | PASS |
| allNotionDerivedIdsMatch | PASS |
| allSourcesAvailable | PASS |
| allSourcesHaveSha256 | PASS |
| allSourcesHaveDimensions | PASS |
| allOriginalKeysPresent | PASS |
| allOptimizedKeysPresent | PASS |
| noDuplicateSourceUrls | PASS |
| noDuplicateRaindropIds | PASS |

## 11. Full manifest table

| Poster ID | Notion page | Title | Raindrop ID | Collection | Provider | MIME | Dimensions | Size | Confidence | Status | Optimized |
|---|---|---|---:|---|---|---|---:|---:|---|---|---|
| 2001-a-space-odyssey | 38c890a5-f3e2-8091-87c8-ea7df6db569f | 2001: A Space Odyssey | 1528361110 | 65021430 | raindrop-file | image/png | 864x1200 | 2115.1 KB | high | READY_TO_COPY | reuse-existing |
| art-of-a-hit-2024 | 38c890a5-f3e2-802f-be2b-e8ccc9fd785b | Art of A Hit | 1535262867 | 65021430 | raindrop-file | image/png | 1200x1781 | 2881.2 KB | high | READY_TO_COPY | reuse-existing |
| artwork-1812274995 | 3b6890a5-f3e2-81ca-b753-cad318357f27 | BlacKkKlansman | 1812274995 | 73692175 | raindrop-file | image/png | 1200x1781 | 3175.1 KB | high | READY_TO_COPY | reuse-existing |
| artwork-1813721087 | 3b6890a5-f3e2-81f8-8953-f08c4188e201 | Spider-Man: Brand New Day | 1813721087 | 73692175 | pbs-twimg | image/jpeg | 1400x1850 | 220.3 KB | high | READY_TO_COPY | reuse-existing |
| artwork-1824607248 | 3d3890a5-f3e2-8113-939f-d34a820223a7 | Backrooms | 1824607248 | 73692175 | pbs-twimg | image/jpeg | 2000x2963 | 1298.8 KB | high | READY_TO_COPY | regenerate |
| artwork-1824628665 | 3d3890a5-f3e2-818a-96ad-f63d648ad843 | Backrooms | 1824628665 | 73692175 | pbs-twimg | image/jpeg | 2000x2963 | 1381.0 KB | high | READY_TO_COPY | regenerate |
| artwork-1824637521 | 3d3890a5-f3e2-81e5-b9da-dde04e570528 | Primetime | 1824637521 | 73692175 | pbs-twimg | image/jpeg | 1836x2596 | 1861.2 KB | high | READY_TO_COPY | regenerate |
| artwork-1824638987 | 3d3890a5-f3e2-815a-8f09-f083f4a4ef7e | Primetime | 1824638987 | 73692175 | pbs-twimg | image/jpeg | 3277x4096 | 3373.9 KB | high | READY_TO_COPY | regenerate |
| artwork-1824644552 | 3d3890a5-f3e2-810d-a40b-d5f7f8817653 | Pearl | 1824644552 | 73692175 | pbs-twimg | image/jpeg | 2893x4096 | 2853.8 KB | high | READY_TO_COPY | regenerate |
| artwork-1824648439 | 3d3890a5-f3e2-8111-8b69-d44d07ca9997 | Spider-Man: Brand New Day | 1824648439 | 73692175 | pbs-twimg | image/jpeg | 1188x1782 | 658.6 KB | high | READY_TO_COPY | regenerate |
| artwork-1824734129 | 3d3890a5-f3e2-8136-982b-c2da9656440f | Spider-Man: Brand New Day | 1824734129 | 73692175 | pbs-twimg | image/jpeg | 3320x4096 | 1892.7 KB | high | READY_TO_COPY | regenerate |
| artwork-1831537050 | 3d3890a5-f3e2-8109-85b6-e4fc0cc1c455 | Eyes Wide Shut | 1831537050 | 73692175 | pbs-twimg | image/jpeg | 1350x2000 | 2183.5 KB | high | READY_TO_COPY | regenerate |
| artwork-1831537996 | 3d3890a5-f3e2-81fa-bfb6-e469650706c1 | Phantom Thread | 1831537996 | 73692175 | pbs-twimg | image/jpeg | 2000x2963 | 4622.9 KB | high | READY_TO_COPY | regenerate |
| artwork-1831541280 | 3d3890a5-f3e2-8101-b24a-df615ca2b0f8 | The Substance | 1831541280 | 73692175 | pbs-twimg | image/jpeg | 2000x3000 | 1237.8 KB | high | READY_TO_COPY | regenerate |
| artwork-1831541566 | 3d3890a5-f3e2-81f3-aaa1-f776b9c71a93 | Anora | 1831541566 | 73692175 | pbs-twimg | image/jpeg | 2000x3000 | 3474.1 KB | high | READY_TO_COPY | regenerate |
| artwork-1831544424 | 3d3890a5-f3e2-8146-9b89-cc82009408aa | Disclosure Day | 1831544424 | 73692175 | pbs-twimg | image/jpeg | 1010x1350 | 375.0 KB | high | READY_TO_COPY | regenerate |
| backrooms-1 | 38d890a5-f3e2-8002-bd6d-d95cf0f42567 | Backrooms | 1779301125 | 65021430 | raindrop-file | image/png | 674x900 | 497.4 KB | high | READY_TO_COPY | reuse-existing |
| backrooms-2 | 38d890a5-f3e2-8002-bd6d-d95cf0f42567 | Backrooms | 1779304223 | 65021430 | raindrop-file | image/png | 1701x2551 | 8099.0 KB | high | READY_TO_COPY | reuse-existing |
| backrooms-3 | 38d890a5-f3e2-8002-bd6d-d95cf0f42567 | Backrooms | 1786274036 | 65021430 | raindrop-file | image/png | 1383x2048 | 6056.9 KB | high | READY_TO_COPY | reuse-existing |
| black-widow | 38c890a5-f3e2-801d-bd27-d60abefe85fe | Black Widow | 1535263039 | 65021430 | raindrop-file | image/png | 1200x1500 | 1780.0 KB | high | READY_TO_COPY | reuse-existing |
| bugonia | 3ab890a5-f3e2-80cc-a499-f1d4aa68ab07 | Bugonia | 1791459718 | 65021430 | pbs-twimg | image/jpeg | 1359x2048 | 460.2 KB | high | READY_TO_COPY | reuse-existing (unused) |
| cure-1997 | 38c890a5-f3e2-80e0-a388-e53e73adb3e9 | Cure | 1520934248 | 65021430 | pbs-twimg | image/jpeg | 1701x2551 | 2668.6 KB | high | READY_TO_COPY | reuse-existing (unused) |
| dune-part-one | 3ab890a5-f3e2-800f-a747-d3a19a9d4500 | Dune: Part One | 1790103802 | 65021430 | raindrop-file | image/png | 2731x4096 | 17319.6 KB | high | READY_TO_COPY | reuse-existing |
| everything-everywhere-all-at-once | 38c890a5-f3e2-8080-9b73-f47d15f91de6 | Everything Everywhere All at once | 1520929331 | 65021430 | pbs-twimg | image/jpeg | 829x1200 | 355.4 KB | high | READY_TO_COPY | reuse-existing (unused) |
| frankenstein-2025 | 38c890a5-f3e2-809b-b737-f65cc8797063 | Frankenstein | 1520929629 | 65021430 | pbs-twimg | image/jpeg | 825x1199 | 279.7 KB | high | READY_TO_COPY | reuse-existing (unused) |
| friday-the-13th-2009 | 393890a5-f3e2-80d7-b7cf-f4966e1ad748 | Friday The 13th | 1779300010 | 65021430 | raindrop-file | image/png | 1280x1898 | 1909.4 KB | high | READY_TO_COPY | reuse-existing |
| furiosa-a-mad-max-saga | 38c890a5-f3e2-8006-82af-d1576b61649d | Furiosa: A Mad Max Saga | 1530975794 | 65021430 | raindrop-file | image/png | 776x1199 | 2194.2 KB | high | READY_TO_COPY | reuse-existing |
| hamnet | 39b890a5-f3e2-809f-b8f1-d80c21478f1a | Hamnet | 1786287206 | 65021430 | raindrop-file | image/png | 1366x2048 | 4842.4 KB | high | READY_TO_COPY | reuse-existing |
| heat-1995 | 38c890a5-f3e2-806a-9372-c0604a24154f | Heat | 1531827396 | 65021430 | raindrop-file | image/png | 961x1200 | 1457.6 KB | high | READY_TO_COPY | reuse-existing |
| her | 3ab890a5-f3e2-8007-a5e1-d3d5666e1645 | Her | 1791455601 | 65021430 | pbs-twimg | image/jpeg | 1326x2048 | 200.6 KB | high | READY_TO_COPY | reuse-existing (unused) |
| kill-bill-vol-1-1 | 38c890a5-f3e2-80b2-a595-ccb0b76f4743 | Kill Bill | 1606171492 | 65021430 | raindrop-file | image/png | 1080x1350 | 345.6 KB | high | READY_TO_COPY | reuse-existing |
| kill-bill-vol-1-2 | 38c890a5-f3e2-80b2-a595-ccb0b76f4743 | Kill Bill | 1606171578 | 65021430 | raindrop-file | image/png | 1365x2048 | 4646.8 KB | high | READY_TO_COPY | reuse-existing |
| lady-vengeance | 3ab890a5-f3e2-80f7-aab4-dfa833118076 | Sympathy for Lady Vengeance | 1791462354 | 65021430 | pbs-twimg | image/jpeg | 1553x2300 | 431.2 KB | high | READY_TO_COPY | reuse-existing (unused) |
| marty-supreme | 393890a5-f3e2-80ed-adac-cdc5e4ee1da7 | Marty Supreme | 1779298270 | 65021430 | raindrop-file | image/png | 1140x1762 | 3816.4 KB | high | READY_TO_COPY | reuse-existing |
| metropolis-1927 | 38c890a5-f3e2-8071-b896-d3203ff94674 | Metropolis | 1528364793 | 65021430 | raindrop-file | image/png | 1375x2048 | 6108.8 KB | high | READY_TO_COPY | reuse-existing |
| midsommar | 38c890a5-f3e2-80ae-aae0-f6a19cf1535a | Midsommar | 1520939308 | 65021430 | pbs-twimg | image/jpeg | 1061x1500 | 579.1 KB | high | READY_TO_COPY | reuse-existing (unused) |
| mighty-morphin-power-rangers-the-movie | 38c890a5-f3e2-80c2-b18c-d0ecd9ecb10e | Mighty Morphin Power Rangers: The Movie | 1528227517 | 65021430 | raindrop-file | image/png | 1290x1906 | 4260.0 KB | high | READY_TO_COPY | reuse-existing |
| mother-2009 | 38c890a5-f3e2-80a5-8df8-e2eaa3caaeab | Mother | 1520934630 | 65021430 | pbs-twimg | image/jpeg | 1701x2551 | 1940.9 KB | high | READY_TO_COPY | reuse-existing (unused) |
| mother-2017 | 38c890a5-f3e2-80a0-8f6e-c9826ff69016 | Mother! | 1520929882 | 65021430 | pbs-twimg | image/jpeg | 802x1200 | 207.8 KB | high | READY_TO_COPY | reuse-existing (unused) |
| mullholland-drive | 3ab890a5-f3e2-80bb-b3c3-e169486f6c31 | Mulholland Drive | 1791456228 | 65021430 | pbs-twimg | image/jpeg | 1766x2048 | 342.6 KB | high | READY_TO_COPY | reuse-existing (unused) |
| no-other-choice-2025-1 | 38c890a5-f3e2-8033-86d0-f64c12255e6b | No Other Choice | 1563985378 | 65021430 | raindrop-file | image/png | 840x1200 | 2009.7 KB | high | READY_TO_COPY | reuse-existing |
| no-other-choice-2025-2 | 38c890a5-f3e2-8033-86d0-f64c12255e6b | No Other Choice | 1563985321 | 65021430 | raindrop-file | image/png | 840x1200 | 1965.8 KB | high | READY_TO_COPY | reuse-existing |
| nope | 39b890a5-f3e2-805b-899b-f7d71c5fe43d | Nope | 1786278781 | 65021430 | raindrop-file | image/png | 1365x2048 | 3810.3 KB | high | READY_TO_COPY | reuse-existing |
| nosferatu-2024 | 38c890a5-f3e2-8090-85ee-dc2d236847b0 | Nosferatu | 1530975868 | 65021430 | raindrop-file | image/png | 1179x1814 | 2928.6 KB | high | READY_TO_COPY | reuse-existing |
| obsession-2025 | 393890a5-f3e2-8007-9657-ddbc5c26cdd4 | Obsession | 1780816176 | 65021430 | pbs-twimg | image/jpeg | 1140x1762 | 507.5 KB | high | READY_TO_COPY | reuse-existing (unused) |
| one-battle-after-another | 38c890a5-f3e2-8098-82f2-c0f56251413f | One Battle After Another | 1535266643 | 65021430 | raindrop-file | image/png | 959x1421 | 3309.2 KB | high | READY_TO_COPY | reuse-existing |
| parasite | 38c890a5-f3e2-807e-a0e8-fc57fc02072e | Parasite | 1520934785 | 65021430 | pbs-twimg | image/jpeg | 2250x3375 | 1391.9 KB | high | READY_TO_COPY | reuse-existing (unused) |
| peacemaker | 393890a5-f3e2-8073-b8f2-c23b8bdaf1a7 | Peacemaker | 1779292357 | 65021430 | raindrop-file | image/png | 792x1224 | 2260.6 KB | high | READY_TO_COPY | reuse-existing |
| project-hail-mary | 3ab890a5-f3e2-804d-93e4-f76f52b8246c | Project Hail Mary | 1791462993 | 65021430 | pbs-twimg | image/jpeg | 1428x2048 | 551.5 KB | high | READY_TO_COPY | reuse-existing (unused) |
| rogue-one-a-star-wars-story | 38c890a5-f3e2-807f-bc97-d10c5d9fd04a | Rogue One | 1530975832 | 65021430 | raindrop-file | image/png | 776x1199 | 910.9 KB | high | READY_TO_COPY | reuse-existing |
| stranger-things-1 | 38c890a5-f3e2-80fa-bf29-e86e56cd77a2 | Stranger Things | 1532498759 | 65021430 | raindrop-file | image/png | 1081x1350 | 3685.5 KB | high | READY_TO_COPY | reuse-existing |
| stranger-things-2 | 38c890a5-f3e2-80fa-bf29-e86e56cd77a2 | Stranger Things | 1521167165 | 65021430 | pbs-twimg | image/jpeg | 2473x3297 | 2664.5 KB | medium | READY_WITH_REVIEW | reuse-existing (unused) |
| stranger-things-3 | 38c890a5-f3e2-80fa-bf29-e86e56cd77a2 | Stranger Things | 1528195848 | 65021430 | raindrop-file | image/png | 1024x1536 | 2662.6 KB | high | READY_TO_COPY | reuse-existing |
| tenet | 39b890a5-f3e2-801e-be7b-f4c8ad4061a5 | Tenet | 1786264710 | 65021430 | pbs-twimg | image/jpeg | 1200x1781 | 245.6 KB | high | READY_TO_COPY | reuse-existing (unused) |
| the-handmaiden | 38c890a5-f3e2-80bd-8d69-c012fab29cc8 | The Handmaiden | 1529611344 | 65021430 | raindrop-file | image/png | 1175x1750 | 4175.1 KB | high | READY_TO_COPY | reuse-existing |
| the-killer-2023 | 38c890a5-f3e2-8051-aea1-c49563c91cb0 | The Killer | 1535262520 | 65021430 | raindrop-file | image/png | 1200x1781 | 3945.3 KB | high | READY_TO_COPY | reuse-existing |
| the-mummy-1999 | 393890a5-f3e2-80cb-9f63-d8874ad835aa | The Mummy | 1780835687 | 65021430 | pbs-twimg | image/jpeg | 1374x2048 | 480.9 KB | high | READY_TO_COPY | reuse-existing (unused) |
| the-platform | 38c890a5-f3e2-80b8-ae23-d9ff8182a138 | The Platform | 1535263689 | 65021430 | raindrop-file | image/png | 1200x1754 | 2334.6 KB | high | READY_TO_COPY | reuse-existing |
| the-shape-of-water | 38c890a5-f3e2-802a-b66c-ccbbc3315a9b | The Shape of Water | 1520929989 | 65021430 | pbs-twimg | image/jpeg | 960x1200 | 271.6 KB | high | READY_TO_COPY | reuse-existing (unused) |
| the-substance-1 | 38c890a5-f3e2-804c-a1ee-eb60974fb46e | The Substance | 1530975924 | 65021430 | raindrop-file | image/png | 1179x1817 | 3760.3 KB | high | READY_TO_COPY | reuse-existing |
| the-substance-2 | 38c890a5-f3e2-804c-a1ee-eb60974fb46e | The Substance | 1786264374 | 65021430 | pbs-twimg | image/jpeg | 690x1024 | 75.5 KB | medium | READY_WITH_REVIEW | reuse-existing (unused) |
| the-way-of-seeing-life | 3ab890a5-f3e2-8007-b77b-f9b940e6e86f | The Way of Seeing Life | 1791461362 | 65021430 | pbs-twimg | image/jpeg | 1080x1600 | 327.1 KB | high | READY_TO_COPY | reuse-existing (unused) |
| the-woman-who-ran | 38c890a5-f3e2-80c9-8234-dac3253f7c56 | The Woman Who Ran | 1566640397 | 65021430 | raindrop-file | image/png | 704x1024 | 619.2 KB | high | READY_TO_COPY | reuse-existing |

## 12. Safety statement

No Notion, Raindrop, Firestore, Vercel Blob, R2, DNS or deployment writes were performed. The manifest and snapshot are derived from read-only API responses. No credentials are included in the manifest.

