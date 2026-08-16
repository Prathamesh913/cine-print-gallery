import type { SyncOutcome } from "./sync";

export interface OutcomeCounts {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export function countOutcomes(outcomes: SyncOutcome[]): OutcomeCounts {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const outcome of outcomes) {
    if (outcome.kind === "created") {
      created += 1;
    } else if (outcome.kind === "updated") {
      if (outcome.changed) {
        updated += 1;
      } else {
        skipped += 1;
      }
    } else if (outcome.kind === "skipped") {
      skipped += 1;
    } else {
      failed += 1;
    }
  }

  return { created, updated, skipped, failed };
}
