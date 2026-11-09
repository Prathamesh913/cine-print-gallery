import { blockedReason, isEntryBlocked } from "./manifest";
import type { Approvals } from "./manifest";
import type { CanaryPlanItem, ManifestEntry, PosterManifest } from "./types";

export interface CanarySelectionOptions {
  requestedPosterIds?: string[];
}

export function buildCanaryPlan(
  manifest: PosterManifest,
  approvals: Approvals,
  options: CanarySelectionOptions = {},
): CanaryPlanItem[] {
  const byId = new Map(manifest.entries.map((entry) => [entry.cineprintPosterId, entry]));
  let selected: ManifestEntry[];

  if (options.requestedPosterIds && options.requestedPosterIds.length > 0) {
    const seenIds = new Set<string>();
    selected = options.requestedPosterIds.map((id) => {
      if (seenIds.has(id)) {
        throw new Error(`Duplicate canary poster ID: ${id}`);
      }
      seenIds.add(id);
      const entry = byId.get(id);
      if (!entry) throw new Error(`Unknown canary poster ID: ${id}`);
      return entry;
    });
  } else {
    const raindrop = manifest.entries.find(
      (entry) => entry.sourceProvider === "raindrop-file" && entry.identityConfidence === "high",
    );
    const pbs = manifest.entries.find(
      (entry) =>
        entry.sourceProvider === "pbs-twimg" &&
        entry.identityConfidence === "high" &&
        !entry.cineprintPosterId.startsWith("artwork-"),
    );
    const artwork = manifest.entries.find(
      (entry) =>
        entry.cineprintPosterId.startsWith("artwork-") &&
        entry.identityConfidence === "high" &&
        entry.optimizedAction === "regenerate",
    );
    // Medium-confidence entries are never appended automatically, even when an
    // approvals file exists. Canary is restricted to audited high-confidence IDs.
    selected = [raindrop, pbs, artwork].filter(
      (entry): entry is ManifestEntry => Boolean(entry),
    );
  }

  const seen = new Set<string>();
  const deduped = selected.filter((entry) => {
    if (seen.has(entry.cineprintPosterId)) return false;
    seen.add(entry.cineprintPosterId);
    return true;
  });

  const nonHigh = deduped.filter((entry) => entry.identityConfidence !== "high");
  if (nonHigh.length > 0) {
    throw new Error(
      `Canary selection must contain only high-confidence posters. Excluded: ${nonHigh
        .map((entry) => `${entry.cineprintPosterId} (${entry.identityConfidence})`)
        .join(", ")}`,
    );
  }

  const blocked = deduped.filter((entry) => isEntryBlocked(entry, approvals));
  if (blocked.length > 0) {
    throw new Error(
      `Canary selection contains blocked entries: ${blocked
        .map((entry) => `${entry.cineprintPosterId} (${blockedReason(entry, approvals) ?? "blocked"})`)
        .join(", ")}`,
    );
  }

  return deduped.map((entry) => ({
    posterId: entry.cineprintPosterId,
    provider: entry.sourceProvider,
    originalKey: entry.originalR2Key ?? "",
    optimizedKey: entry.optimizedR2Key ?? "",
    optimizedAction: entry.optimizedAction,
    identityConfidence: entry.identityConfidence,
    blocked: false,
    blockedReason: null,
  }));
}
