import { base64ToHex } from "./checksum";
import { buildCanaryPlan } from "./canary";
import {
  blockedReason,
  expectedObjects,
  isEntryBlocked,
  publicUrl,
} from "./manifest";
import type { Approvals } from "./manifest";
import type {
  CanaryPlanItem,
  ManifestEntry,
  PosterManifest,
  R2ObjectMetadata,
  R2Store,
} from "./types";

export type DestinationStatus =
  | "MISSING"
  | "ALREADY_VERIFIED"
  | "PRESENT"
  | "CONFLICT"
  | "ERROR";

export interface DestinationObjectState {
  posterId: string;
  variant: "original" | "optimized";
  key: string;
  status: DestinationStatus;
  sizeBytes: number | null;
  contentType: string | null;
  reason: string | null;
}

export interface ProviderSummary {
  provider: string;
  entries: number;
  originalBytes: number;
  existingOptimizedBytes: number;
  estimatedMissingOptimizedBytes: number;
  estimatedTotalUploadBytes: number;
}

export interface DryRunReport {
  generatedAt: string;
  mode: "dry-run";
  publicBaseUrl: string;
  totals: {
    posters: number;
    sourceImages: number;
    expectedR2Objects: number;
    originalBytes: number;
    existingOptimizedBytes: number;
    estimatedMissingOptimizedBytes: number;
    estimatedOptimizedBytes: number;
    estimatedTotalUploadBytes: number;
    medianOptimizedRatio: number;
    missingObjects: number;
    conflictingObjects: number;
    alreadyVerifiedObjects: number;
    presentObjects: number;
  };
  providers: ProviderSummary[];
  objects: DestinationObjectState[];
  blocked: Array<{
    posterId: string;
    identityConfidence: string;
    reason: string;
  }>;
  regeneration: string[];
  canary: CanaryPlanItem[];
  notes: string[];
}

function objectChecksum(head: R2ObjectMetadata): string | null {
  if (head.metadataSha256) return head.metadataSha256.toLowerCase();
  if (head.checksumSha256) return base64ToHex(head.checksumSha256);
  return null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0.1;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      results[current] = await worker(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function buildDryRunReport(input: {
  manifest: PosterManifest;
  r2: R2Store;
  approvals: Approvals;
  publicBaseUrl?: string;
}): Promise<DryRunReport> {
  const { manifest, r2, approvals } = input;
  const publicBaseUrl = (input.publicBaseUrl ?? "https://images.cineprint.click").replace(
    /\/+$/,
    "",
  );

  const objects = expectedObjects(manifest);
  const objectStates = await mapWithConcurrency(objects, 6, async (object): Promise<DestinationObjectState> => {
    const entry = manifest.entries.find(
      (candidate) => candidate.cineprintPosterId === object.posterId,
    );
    if (!entry) {
      return {
        posterId: object.posterId,
        variant: object.variant,
        key: object.key,
        status: "ERROR",
        sizeBytes: null,
        contentType: null,
        reason: "Manifest entry not found",
      };
    }

    try {
      const head = await r2.head(object.key);
      if (!head) {
        return {
          posterId: object.posterId,
          variant: object.variant,
          key: object.key,
          status: "MISSING",
          sizeBytes: null,
          contentType: null,
          reason: null,
        };
      }

      if (object.variant === "original") {
        const actual = objectChecksum(head);
        if (!actual) {
          return {
            posterId: object.posterId,
            variant: object.variant,
            key: object.key,
            status: "CONFLICT",
            sizeBytes: head.size,
            contentType: head.contentType,
            reason: "Existing object has no SHA-256 metadata",
          };
        }
        if (entry.sourceSha256 && actual === entry.sourceSha256.toLowerCase()) {
          return {
            posterId: object.posterId,
            variant: object.variant,
            key: object.key,
            status: "ALREADY_VERIFIED",
            sizeBytes: head.size,
            contentType: head.contentType,
            reason: null,
          };
        }
        return {
          posterId: object.posterId,
          variant: object.variant,
          key: object.key,
          status: "CONFLICT",
          sizeBytes: head.size,
          contentType: head.contentType,
          reason: "Existing object checksum differs from the manifest",
        };
      }

      if (
        entry.existingOptimizedObject.sizeBytes !== null &&
        head.size !== entry.existingOptimizedObject.sizeBytes
      ) {
        return {
          posterId: object.posterId,
          variant: object.variant,
          key: object.key,
          status: "CONFLICT",
          sizeBytes: head.size,
          contentType: head.contentType,
          reason: "Existing optimized object size differs from the Phase 1 inventory",
        };
      }

      return {
        posterId: object.posterId,
        variant: object.variant,
        key: object.key,
        status: "PRESENT",
        sizeBytes: head.size,
        contentType: head.contentType,
        reason: null,
      };
    } catch (error) {
      return {
        posterId: object.posterId,
        variant: object.variant,
        key: object.key,
        status: "ERROR",
        sizeBytes: null,
        contentType: null,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const ratios = manifest.entries
    .filter(
      (entry) =>
        entry.existingOptimizedObject.exists &&
        entry.existingOptimizedObject.sizeBytes &&
        entry.sourceSizeBytes,
    )
    .map((entry) => (entry.existingOptimizedObject.sizeBytes as number) / (entry.sourceSizeBytes as number));
  const medianOptimizedRatio = median(ratios);

  let originalBytes = 0;
  let existingOptimizedBytes = 0;
  let estimatedMissingOptimizedBytes = 0;
  const providerMap = new Map<string, ProviderSummary>();

  for (const entry of manifest.entries) {
    const entryOriginalBytes = entry.sourceSizeBytes ?? 0;
    const existing = entry.existingOptimizedObject.sizeBytes ?? 0;
    const estimatedMissing = entry.existingOptimizedObject.exists
      ? 0
      : Math.round(entryOriginalBytes * medianOptimizedRatio);
    const optimizedBytes = existing + estimatedMissing;

    originalBytes += entryOriginalBytes;
    existingOptimizedBytes += existing;
    estimatedMissingOptimizedBytes += estimatedMissing;

    const provider = entry.sourceProvider;
    const current = providerMap.get(provider) ?? {
      provider,
      entries: 0,
      originalBytes: 0,
      existingOptimizedBytes: 0,
      estimatedMissingOptimizedBytes: 0,
      estimatedTotalUploadBytes: 0,
    };
    current.entries += 1;
    current.originalBytes += entryOriginalBytes;
    current.existingOptimizedBytes += existing;
    current.estimatedMissingOptimizedBytes += estimatedMissing;
    current.estimatedTotalUploadBytes += entryOriginalBytes + optimizedBytes;
    providerMap.set(provider, current);
  }

  const countStatus = (status: DestinationStatus) =>
    objectStates.filter((object) => object.status === status).length;

  const blocked = manifest.entries
    .filter((entry) => isEntryBlocked(entry, approvals))
    .map((entry) => ({
      posterId: entry.cineprintPosterId,
      identityConfidence: entry.identityConfidence,
      reason: blockedReason(entry, approvals) ?? "Blocked",
    }));

  const regeneration = manifest.entries
    .filter((entry) => entry.optimizedAction === "regenerate")
    .map((entry) => entry.cineprintPosterId);

  const canary = buildCanaryPlan(manifest, approvals);

  const notes: string[] = [
    "Dry-run only: no R2 objects were uploaded or modified.",
    "Original size is taken from the Phase 1 manifest sourceSizeBytes.",
    "Existing optimized size is taken from the Phase 1 Blob inventory.",
    "Missing optimized size is estimated from the median optimized/source byte ratio of the 51 existing optimized assets.",
    "Phase 2 regenerates every optimized WebP from the verified source; it does not read or copy optimized objects from Vercel Blob.",
    "optimizedAction records whether a Blob optimized object existed in Phase 1; it is provenance, not a Phase 2 copy instruction.",
    "Optimized checksums cannot be predicted without generating the WebP; dry-run verifies existence and size only.",
  ];

  return {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    publicBaseUrl,
    totals: {
      posters: manifest.entries.length,
      sourceImages: manifest.entries.filter((entry) => Boolean(entry.sourceImageUrl)).length,
      expectedR2Objects: manifest.entries.length * 2,
      originalBytes,
      existingOptimizedBytes,
      estimatedMissingOptimizedBytes,
      estimatedOptimizedBytes: existingOptimizedBytes + estimatedMissingOptimizedBytes,
      estimatedTotalUploadBytes: originalBytes + existingOptimizedBytes + estimatedMissingOptimizedBytes,
      medianOptimizedRatio,
      missingObjects: countStatus("MISSING"),
      conflictingObjects: countStatus("CONFLICT"),
      alreadyVerifiedObjects: countStatus("ALREADY_VERIFIED"),
      presentObjects: countStatus("PRESENT"),
    },
    providers: [...providerMap.values()].sort((a, b) => a.provider.localeCompare(b.provider)),
    objects: objectStates,
    blocked,
    regeneration,
    canary,
    notes,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function renderDryRunMarkdown(report: DryRunReport): string {
  const lines: string[] = [];
  lines.push("# CinePrint — Migration Dry-Run Report");
  lines.push("");
  lines.push(`**Generated:** ${report.generatedAt}  `);
  lines.push(`**Mode:** ${report.mode} — no R2 writes  `);
  lines.push(`**Public base URL:** ${report.publicBaseUrl}`);
  lines.push("");
  lines.push("## 1. Totals");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");
  lines.push(`| Posters | ${report.totals.posters} |`);
  lines.push(`| Source images | ${report.totals.sourceImages} |`);
  lines.push(`| Expected R2 objects | ${report.totals.expectedR2Objects} |`);
  lines.push(`| Original bytes | ${formatBytes(report.totals.originalBytes)} |`);
  lines.push(`| Existing optimized bytes | ${formatBytes(report.totals.existingOptimizedBytes)} |`);
  lines.push(`| Estimated missing optimized bytes | ${formatBytes(report.totals.estimatedMissingOptimizedBytes)} |`);
  lines.push(`| Estimated total upload | ${formatBytes(report.totals.estimatedTotalUploadBytes)} |`);
  lines.push(`| Median optimized/source ratio | ${(report.totals.medianOptimizedRatio * 100).toFixed(2)}% |`);
  lines.push("");
  lines.push("## 2. Destination state");
  lines.push("");
  lines.push("| State | Objects |");
  lines.push("|---|---:|");
  lines.push(`| Missing | ${report.totals.missingObjects} |`);
  lines.push(`| Already verified | ${report.totals.alreadyVerifiedObjects} |`);
  lines.push(`| Present (optimized, size matched) | ${report.totals.presentObjects} |`);
  lines.push(`| Conflicting | ${report.totals.conflictingObjects} |`);
  lines.push("");
  lines.push("## 3. Per-provider breakdown");
  lines.push("");
  lines.push("| Provider | Entries | Original bytes | Existing optimized | Estimated missing optimized | Estimated total upload |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const provider of report.providers) {
    lines.push(
      `| ${provider.provider} | ${provider.entries} | ${formatBytes(provider.originalBytes)} | ${formatBytes(provider.existingOptimizedBytes)} | ${formatBytes(provider.estimatedMissingOptimizedBytes)} | ${formatBytes(provider.estimatedTotalUploadBytes)} |`,
    );
  }
  lines.push("");
  lines.push("## 4. Blocked medium-confidence assets");
  lines.push("");
  if (report.blocked.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Poster ID | Confidence | Reason |");
    lines.push("|---|---|---|");
    for (const item of report.blocked) {
      lines.push(`| ${item.posterId} | ${item.identityConfidence} | ${item.reason} |`);
    }
  }
  lines.push("");
  lines.push("## 5. Optimized variants to regenerate");
  lines.push("");
  if (report.regeneration.length === 0) {
    lines.push("None.");
  } else {
    for (const id of report.regeneration) lines.push(`- ${id}`);
  }
  lines.push("");
  lines.push("## 6. Canary plan");
  lines.push("");
  lines.push("| Poster ID | Provider | Confidence | Blob optimized existed | Blocked |");
  lines.push("|---|---|---|---|---|");
  for (const item of report.canary) {
    lines.push(
      `| ${item.posterId} | ${item.provider} | ${item.identityConfidence} | ${item.optimizedAction} | ${item.blocked ? "yes" : "no"} |`,
    );
  }
  lines.push("");
  lines.push("## 7. Notes");
  lines.push("");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  lines.push("## 8. Safety");
  lines.push("");
  lines.push("No R2, Notion, Raindrop, Firestore, Vercel Blob, DNS or deployment writes were performed. This report is derived from the Phase 1 manifest and read-only R2 `HeadObject` checks.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}
