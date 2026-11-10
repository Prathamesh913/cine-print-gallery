/**
 * Stable identities for the ingestion pipeline.
 *
 * A Raindrop bookmark is the source; the poster is the catalogue identity.
 * `artwork-{raindropId}` matches the existing automated-artwork convention in
 * `scripts/sync-notion-to-firestore.js`, so a new record resolves identically
 * during publishing without any positional or title-derived fallback.
 */

import crypto from "node:crypto";

export class InvalidRaindropIdError extends Error {}

const NUMERIC_ID = /^\d+$/;
const POSTER_ID = /^[a-z0-9][a-z0-9-]*$/;

export function posterIdForRaindrop(raindropId: string): string {
  const trimmed = String(raindropId ?? "").trim();
  if (!NUMERIC_ID.test(trimmed)) {
    throw new InvalidRaindropIdError("Raindrop ID must be numeric");
  }
  const posterId = `artwork-${trimmed}`;
  if (!POSTER_ID.test(posterId)) {
    throw new InvalidRaindropIdError("Derived poster ID is not valid");
  }
  return posterId;
}

export function sourceKeyForRaindrop(raindropId: string): string {
  return `raindrop:${String(raindropId).trim()}`;
}

export function isPosterId(value: unknown): value is string {
  return typeof value === "string" && POSTER_ID.test(value);
}

/** Deterministic JSON with sorted object keys, used for change detection. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function contentFingerprint(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export interface HumanDecision {
  posterId: string;
  raindropId: string;
  tmdbId: number;
  decidedAt: string;
}

/**
 * Ambiguous TMDB matches are never auto-selected. A human may persist a
 * decision as a job document field; the pipeline then reuses that exact TMDB
 * identity on retry instead of re-ranking candidates.
 */
export function reviewDecisionFromJob(
  job: { reviewDecision?: Partial<HumanDecision> | null } | null,
): HumanDecision | null {
  const decision = job?.reviewDecision;
  if (!decision) return null;
  if (
    typeof decision.posterId !== "string" ||
    typeof decision.raindropId !== "string" ||
    typeof decision.tmdbId !== "number" ||
    !Number.isInteger(decision.tmdbId) ||
    decision.tmdbId <= 0 ||
    typeof decision.decidedAt !== "string" ||
    !Number.isFinite(Date.parse(decision.decidedAt))
  ) {
    return null;
  }
  return {
    posterId: decision.posterId,
    raindropId: decision.raindropId,
    tmdbId: decision.tmdbId,
    decidedAt: decision.decidedAt,
  };
}
