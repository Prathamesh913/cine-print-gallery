/**
 * Catalogue identities whose source image cannot be verified strongly enough
 * to migrate, and whose legacy Blob object is unavailable (403).
 *
 * Both remain first-class catalogue entries. Browser rendering uses a neutral
 * "Image unavailable" asset instead of a broken image or an unrelated poster.
 * No R2 object exists for either identity, and no upload is authorized in this
 * phase.
 */
export const INTENTIONALLY_UNAVAILABLE_POSTER_IDS = new Set([
  "stranger-things-2",
  "the-substance-2",
]);

export const POSTER_UNAVAILABLE_REASON =
  "Source identity remains medium-confidence; no verified R2 object exists and the legacy Blob object returns 403.";

export function isPosterImageUnavailable(posterId: string): boolean {
  return INTENTIONALLY_UNAVAILABLE_POSTER_IDS.has(posterId);
}
