# CinePrint — Migration Dry-Run Report

**Generated:** 2026-11-07T05:58:30.992Z  
**Mode:** dry-run — no R2 writes  
**Public base URL:** https://images.cineprint.click

## 1. Totals

| Metric | Value |
|---|---:|
| Posters | 63 |
| Source images | 63 |
| Expected R2 objects | 126 |
| Original bytes | 145.80 MB |
| Existing optimized bytes | 7.00 MB |
| Estimated missing optimized bytes | 1.95 MB |
| Estimated total upload | 154.76 MB |
| Median optimized/source ratio | 7.92% |

## 2. Destination state

| State | Objects |
|---|---:|
| Missing | 126 |
| Already verified | 0 |
| Present (optimized, size matched) | 0 |
| Conflicting | 0 |

## 3. Per-provider breakdown

| Provider | Entries | Original bytes | Existing optimized | Estimated missing optimized | Estimated total upload |
|---|---:|---:|---:|---:|---:|
| pbs-twimg | 32 | 38.49 MB | 2.51 MB | 1.95 MB | 42.96 MB |
| raindrop-file | 31 | 107.31 MB | 4.49 MB | 0 B | 111.80 MB |

## 4. Blocked medium-confidence assets

| Poster ID | Confidence | Reason |
|---|---|---|
| stranger-things-2 | medium | Identity confidence is medium; explicit approval is required |
| the-substance-2 | medium | Identity confidence is medium; explicit approval is required |

## 5. Optimized variants to regenerate

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

## 6. Canary plan

| Poster ID | Provider | Confidence | Blob optimized existed | Blocked |
|---|---|---|---|---|
| 2001-a-space-odyssey | raindrop-file | high | reuse-existing | no |
| bugonia | pbs-twimg | high | reuse-existing | no |
| artwork-1824607248 | pbs-twimg | high | regenerate | no |

## 7. Notes

- Dry-run only: no R2 objects were uploaded or modified.
- Original size is taken from the Phase 1 manifest sourceSizeBytes.
- Existing optimized size is taken from the Phase 1 Blob inventory.
- Missing optimized size is estimated from the median optimized/source byte ratio of the 51 existing optimized assets.
- Phase 2 regenerates every optimized WebP from the verified source; it does not read or copy optimized objects from Vercel Blob.
- optimizedAction records whether a Blob optimized object existed in Phase 1; it is provenance, not a Phase 2 copy instruction.
- Optimized checksums cannot be predicted without generating the WebP; dry-run verifies existence and size only.

## 8. Safety

No R2, Notion, Raindrop, Firestore, Vercel Blob, DNS or deployment writes were performed. This report is derived from the Phase 1 manifest and read-only R2 `HeadObject` checks.

