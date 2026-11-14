/**
 * Explicitly confirmed poster image repair targets.
 *
 * This is intentionally a closed allowlist. The repair command is not a general
 * importer: adding a poster here is a reviewed data decision with a confirmed
 * source, hash, dimensions and Notion grouping page.
 */

export interface RepairTarget {
  readonly posterId: string;
  readonly artist: string;
  readonly sourceUrl: string;
  readonly sourceProvider: "pbs-twimg";
  readonly expectedContentType: "image/jpeg";
  readonly expectedSha256: string;
  readonly expectedDimensions: Readonly<{ width: number; height: number }>;
  readonly expectedSizeBytes: number;
  readonly raindropId: string;
  readonly notionPageId: string;
  /** Current legacy Blob source identity on the Firestore document and Notion page. */
  readonly existingImageUrl: string;
}

export const REPAIR_TARGETS: Readonly<Record<string, RepairTarget>> = Object.freeze({
  "the-substance-2": Object.freeze({
    posterId: "the-substance-2",
    artist: "Eileen Steinbach",
    sourceUrl: "https://pbs.twimg.com/media/HMtwlGHXgAAYt0L?format=jpg&name=medium",
    sourceProvider: "pbs-twimg",
    expectedContentType: "image/jpeg",
    expectedSha256: "7235e3b6206fb71c761af2df87540ca3a7735cf7fb0dadadbb62e446cb029d3d",
    expectedDimensions: Object.freeze({ width: 690, height: 1024 }),
    expectedSizeBytes: 77_278,
    raindropId: "1786264374",
    notionPageId: "38c890a5-f3e2-804c-a1ee-eb60974fb46e",
    existingImageUrl:
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/external/the-substance-2.jpg",
  }),
  "stranger-things-2": Object.freeze({
    posterId: "stranger-things-2",
    artist: "Butcher Billy",
    sourceUrl: "https://pbs.twimg.com/media/G9gZV6dWEAAOjjU?format=jpg&name=4096x4096",
    sourceProvider: "pbs-twimg",
    expectedContentType: "image/jpeg",
    expectedSha256: "303277e83081b273e0ea271bccba7d3a9bed17a8a9227903cec51ede078ee25b",
    expectedDimensions: Object.freeze({ width: 2473, height: 3297 }),
    expectedSizeBytes: 2_728_405,
    raindropId: "1521167165",
    notionPageId: "38c890a5-f3e2-80fa-bf29-e86e56cd77a2",
    existingImageUrl:
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/external/stranger-things-2.jpg",
  }),
});

export class RepairTargetError extends Error {}

/**
 * Resolve an exact, duplicate-free allowlist. Unknown and unsupported IDs are
 * the same condition here: the command only supports confirmed targets.
 */
export function selectRepairTargets(ids: readonly string[]): RepairTarget[] {
  if (ids.length === 0) {
    throw new RepairTargetError("At least one poster ID is required");
  }

  const seen = new Set<string>();
  const targets: RepairTarget[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) throw new RepairTargetError("Poster IDs must not be empty");
    if (seen.has(id)) throw new RepairTargetError(`Duplicate poster ID: ${id}`);
    seen.add(id);

    const target = REPAIR_TARGETS[id];
    if (!target) {
      throw new RepairTargetError(
        `Unsupported poster ID: ${id}. Supported IDs: ${Object.keys(REPAIR_TARGETS).join(", ")}`,
      );
    }
    targets.push(target);
  }
  return targets;
}
