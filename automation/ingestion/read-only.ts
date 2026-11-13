/**
 * Read-only adapters for dry runs.
 *
 * A dry run must read production state so skip detection and planned updates
 * match an apply run, but it must never be able to write. These wrappers make
 * that a structural guarantee: every mutating method throws instead of relying
 * on each call site to remember `if (dryRun)`.
 */

import type { PosterCatalog } from "./poster-catalog";
import type { JobStore, RunStore } from "./state";

export class DryRunWriteError extends Error {
  constructor(operation: string) {
    super(`Dry run attempted a Firestore write (${operation}); refusing to modify state`);
    this.name = "DryRunWriteError";
  }
}

export function readOnlyJobStore(store: JobStore): JobStore {
  return {
    get: (posterId) => store.get(posterId),
    list: () => store.list(),
    save: async () => {
      throw new DryRunWriteError("automationIngestionJobs.save");
    },
  };
}

export function readOnlyPosterCatalog(catalog: PosterCatalog): PosterCatalog {
  return {
    get: (id) => catalog.get(id),
    listAll: () => catalog.listAll(),
    listByNotionPageId: (pageId) => catalog.listByNotionPageId(pageId),
    create: async () => {
      throw new DryRunWriteError("posters.create");
    },
    update: async () => {
      throw new DryRunWriteError("posters.update");
    },
  };
}

export function readOnlyRunStore(): RunStore {
  return {
    save: async () => {
      throw new DryRunWriteError("automationIngestionRuns.save");
    },
  };
}
