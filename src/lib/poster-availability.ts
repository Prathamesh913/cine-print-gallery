/**
 * Catalogue identities whose legacy Blob source is known to be unavailable.
 *
 * The placeholder is a fail-closed default, not a permanent ban. A poster with
 * a fully validated dynamic `r2Image` reference resolves from R2 even while its
 * ID remains in this list (see the resolver's verified-reference override).
 * Without a valid reference, the ID still renders the neutral asset instead of
 * the blocked Blob URL.
 */
export const INTENTIONALLY_UNAVAILABLE_POSTER_IDS = new Set([
  "stranger-things-2",
  "the-substance-2",
]);

export const POSTER_UNAVAILABLE_REASON =
  "No verified R2 image reference is present and the legacy Blob object returns 403.";

export function isPosterImageUnavailable(posterId: string): boolean {
  return INTENTIONALLY_UNAVAILABLE_POSTER_IDS.has(posterId);
}
