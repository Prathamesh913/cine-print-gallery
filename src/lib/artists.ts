import { slugifyArtist, type Poster } from "./posters";
import { toLastmod } from "./sitemap";

/**
 * M8 artist directory (model-the-domain: artist identity is a typed value
 * with one construction site, shared by the directory route and sitemap).
 *
 * Identity follows the existing artist-route rule: names are matched by
 * slugifyArtist, exactly like resolveArtist. Two distinct names that
 * collapse to one slug are ambiguous and excluded rather than merged.
 * The "unknown" slug is never a real artist and is always excluded.
 */

export interface ArtistPosterInput {
  id: string;
  title?: string;
  artists?: Array<{ name: string }>;
  artist?: string;
  image?: string;
  posterImageUrl?: string;
  updatedAt?: unknown;
}

export interface ArtistEntry<TPoster = Poster> {
  /** Directory slug, identical to the existing /artist/$slug route slug. */
  slug: string;
  /** Canonical display name (mode of observed forms, lexicographic tiebreak). */
  name: string;
  /** Sorted unique poster ids attributed to this artist. */
  posterIds: string[];
  /** Attributed posters, sorted by id for deterministic output. */
  posters: TPoster[];
  /** First poster in stable order: the deterministic preview artwork. */
  representative: TPoster;
  /** Latest member updatedAt (YYYY-MM-DD) for sitemap lastmod, if any. */
  updatedAtMax?: string;
}

export interface AmbiguousSlug {
  slug: string;
  names: string[];
}

function normalizedName(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Raw names a poster attributes, mirroring resolveArtist exactly. */
function posterNames(input: { artists?: Array<{ name: string }>; artist?: string }): string[] {
  if (input.artists && input.artists.length > 0) {
    return input.artists
      .map((a) => (typeof a?.name === "string" ? a.name.trim() : ""))
      .filter((name) => name.length > 0);
  }
  const legacy = typeof input.artist === "string" ? input.artist.trim() : "";
  return legacy ? [legacy] : [];
}

function hasUsableArtwork(input: { image?: string; posterImageUrl?: string }): boolean {
  return Boolean(
    (typeof input.image === "string" && input.image.trim()) ||
    (typeof input.posterImageUrl === "string" && input.posterImageUrl.trim()),
  );
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = "";
  let bestCount = -1;
  for (const [value, count] of [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

interface MutableArtist<TPoster extends ArtistPosterInput> {
  names: string[];
  posterById: Map<string, TPoster>;
  updatedAts: string[];
}

/**
 * Group inputs by artist slug. Invalid members (no usable artwork, no known
 * name) are dropped; poster ids deduplicated (first wins in id-sorted
 * order). Slug groups with more than one distinct normalized name are
 * ambiguous and excluded. Deterministic output sorted by slug.
 */
export function buildArtistDirectory<TPoster extends ArtistPosterInput>(
  inputs: readonly TPoster[],
): ArtistEntry<TPoster>[] {
  const sorted = [...inputs]
    .filter((p) => typeof p.id === "string" && p.id)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = new Map<string, MutableArtist<TPoster>>();
  for (const input of sorted) {
    if (!hasUsableArtwork(input)) continue;
    for (const rawName of posterNames(input)) {
      const slug = slugifyArtist(rawName);
      if (!slug || slug === "unknown") continue;
      let group = groups.get(slug);
      if (!group) {
        group = { names: [], posterById: new Map(), updatedAts: [] };
        groups.set(slug, group);
      }
      group.names.push(rawName);
      if (!group.posterById.has(input.id)) {
        group.posterById.set(input.id, input);
        const lastmod = toLastmod(input.updatedAt);
        if (lastmod) group.updatedAts.push(lastmod);
      }
    }
  }

  const entries: ArtistEntry<TPoster>[] = [];
  for (const [slug, group] of groups) {
    const distinct = [...new Set(group.names.map(normalizedName))];
    if (distinct.length !== 1) continue;
    const posters = [...group.posterById.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    if (posters.length === 0) continue;
    const updatedAts = [...group.updatedAts].sort();
    entries.push({
      slug,
      name: mode(group.names.map((n) => n.trim()).filter(Boolean)),
      posterIds: posters.map((p) => p.id),
      posters,
      representative: posters[0],
      updatedAtMax: updatedAts[updatedAts.length - 1],
    });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

/** Slug groups that cannot be resolved unambiguously; excluded from output. */
export function findAmbiguousSlugs<TPoster extends ArtistPosterInput>(
  inputs: readonly TPoster[],
): AmbiguousSlug[] {
  const bySlug = new Map<string, Set<string>>();
  for (const input of inputs) {
    if (!hasUsableArtwork(input)) continue;
    for (const rawName of posterNames(input)) {
      const slug = slugifyArtist(rawName);
      if (!slug || slug === "unknown") continue;
      if (!bySlug.has(slug)) bySlug.set(slug, new Set());
      bySlug.get(slug)!.add(normalizedName(rawName));
    }
  }
  return [...bySlug.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([slug, names]) => ({ slug, names: [...names].sort() }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

/** Resolve a directory entry by slug, or null when it is not listed. */
export function resolveArtistEntry<TPoster extends ArtistPosterInput>(
  inputs: readonly TPoster[],
  slug: string,
): ArtistEntry<TPoster> | null {
  return buildArtistDirectory(inputs).find((entry) => entry.slug === slug) ?? null;
}

/** Pure name filter for the directory search box (progressive enhancement). */
export function filterArtists<TPoster extends ArtistPosterInput>(
  entries: readonly ArtistEntry<TPoster>[],
  query: string,
): ArtistEntry<TPoster>[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}
