/**
 * Bookmark validation and normalisation.
 *
 * Reuses the existing tag parser (`automation/parser.ts`) so manual and
 * automated imports accept exactly the same Raindrop conventions.
 */

import { parseBookmark, type RaindropBookmark, type ValidationError } from "../parser";
import type { CinePrintDraft } from "../shared/cineprint-draft";
import { InvalidRaindropIdError, posterIdForRaindrop, sourceKeyForRaindrop } from "./identity";

export interface BookmarkInput extends RaindropBookmark {
  created?: string;
  lastUpdate?: string;
  title?: string;
  collection?: { $id?: number };
}

export interface ValidatedBookmark {
  bookmark: BookmarkInput;
  draft: CinePrintDraft & { posterId: string; raindropId: string };
  posterId: string;
  sourceKey: string;
  raindropUpdatedAt: string | null;
}

export type BookmarkValidation =
  | { ok: true; value: ValidatedBookmark }
  | {
      ok: false;
      raindropId: string | null;
      title: string | null;
      errors: ValidationError[];
      reason: string;
    };

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

export function validateBookmark(bookmark: BookmarkInput): BookmarkValidation {
  const raindropId = bookmark._id !== undefined ? String(bookmark._id) : null;
  const parsed = parseBookmark(bookmark);

  if (!parsed.ok) {
    return {
      ok: false,
      raindropId,
      title: typeof bookmark.title === "string" ? bookmark.title : null,
      errors: parsed.errors,
      reason: parsed.errors.map((error) => `${error.field}: ${error.message}`).join("; "),
    };
  }

  try {
    const posterId = posterIdForRaindrop(parsed.draft.raindropId);
    const draft = { ...parsed.draft, posterId };

    return {
      ok: true,
      value: {
        bookmark,
        draft: draft as ValidatedBookmark["draft"],
        posterId,
        sourceKey: sourceKeyForRaindrop(parsed.draft.raindropId),
        raindropUpdatedAt: isoOrNull(bookmark.lastUpdate ?? bookmark.created),
      },
    };
  } catch (error) {
    const reason =
      error instanceof InvalidRaindropIdError
        ? error.message
        : `Could not derive a poster identity: ${
            error instanceof Error ? error.message : String(error)
          }`;
    return {
      ok: false,
      raindropId,
      title: parsed.draft.title,
      errors: [{ field: "raindropId", message: reason }],
      reason,
    };
  }
}

export interface DedupeResult {
  unique: BookmarkInput[];
  duplicates: Array<{ raindropId: string; kept: BookmarkInput }>;
}

/** Keeps the newest-seen bookmark for each Raindrop ID. */
export function dedupeBookmarks(bookmarks: BookmarkInput[]): DedupeResult {
  const byId = new Map<string, BookmarkInput>();
  const duplicates: DedupeResult["duplicates"] = [];
  const duplicateIds = new Set<string>();

  for (const bookmark of bookmarks) {
    if (bookmark._id === undefined) continue;
    const id = String(bookmark._id);
    const existing = byId.get(id);

    if (!existing) {
      byId.set(id, bookmark);
      continue;
    }

    const existingUpdate = existing.lastUpdate ?? existing.created ?? "";
    const nextUpdate = bookmark.lastUpdate ?? bookmark.created ?? "";
    if (nextUpdate > existingUpdate) {
      byId.set(id, bookmark);
    }
    if (!duplicateIds.has(id)) {
      duplicates.push({ raindropId: id, kept: byId.get(id)! });
      duplicateIds.add(id);
    }
  }

  return { unique: [...byId.values()], duplicates };
}

/**
 * True when a previously completed job still describes the same source
 * revision, so the bookmark can be skipped without re-processing.
 */
export function isSameSourceRevision(
  job: { raindropUpdatedAt: string | null } | null,
  bookmark: { lastUpdate?: string; created?: string },
): boolean {
  if (!job) return false;
  const next = bookmark.lastUpdate ?? bookmark.created ?? null;
  if (!job.raindropUpdatedAt || !next) return false;
  return job.raindropUpdatedAt === next;
}
