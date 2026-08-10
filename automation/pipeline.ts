import type { EnrichedDraft } from "./tmdb/types";
import type { BlobImageImporter, ImageSourceKind, ImportImageStatus } from "./blob/import";

export type ImageStageResult =
  | {
      ok: true;
      draft: EnrichedDraft;
      status: ImportImageStatus;
      url: string;
      sourceKind: ImageSourceKind;
    }
  | { ok: false; draft: EnrichedDraft; reason: string };

export interface ImageStageOptions {
  raindropToken: string;
  dryRun?: boolean;
}

export function isRaindropFileUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "api.raindrop.io";
  } catch {
    return false;
  }
}

export async function applyImageStage(
  draft: EnrichedDraft,
  importer: Pick<BlobImageImporter, "importImage">,
  options: ImageStageOptions,
): Promise<ImageStageResult> {
  const sourceKind: ImageSourceKind = isRaindropFileUrl(draft.imageUrl) ? "raindrop" : "external";

  try {
    const result = await importer.importImage(
      {
        raindropId: draft.raindropId,
        imageUrl: draft.imageUrl,
        sourceKind,
        raindropToken: options.raindropToken,
      },
      { dryRun: options.dryRun },
    );

    return {
      ok: true,
      draft: { ...draft, imageUrl: result.url },
      status: result.status,
      url: result.url,
      sourceKind,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, draft, reason };
  }
}
