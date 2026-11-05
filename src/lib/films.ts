import { type Poster } from "./posters";
import { toLastmod, type SitemapUrlEntry } from "./sitemap";
import { SITE_ORIGIN } from "./seo";

/**
 * M7 film/show identity and grouping (model-the-domain: identity is a
 * typed value with one construction site, not scattered conditionals).
 *
 * Identity preference: TMDB ID + media type, then IMDb ID + media type,
 * then normalized title + year + media type. Title equality alone never
 * establishes identity (the catalogue contains distinct films sharing a
 * title under different TMDB IDs).
 */

export const MIN_FILM_POSTERS = 3;

export interface FilmPosterInput {
  id: string;
  title: string;
  year: number;
  mediaType?: string;
  tmdbId?: string;
  imdbId?: string;
  image?: string;
  artists?: Array<{ name: string }>;
  artist?: string;
  /** Raw source timestamp; normalized only when building sitemap entries. */
  updatedAt?: unknown;
}

export interface FilmGroup<TPoster = Poster> {
  /** Stable identity key, e.g. "tmdb:62:movie". Never exposed in URLs. */
  key: string;
  /** Unique deterministic route slug (year-suffixed only on collision). */
  slug: string;
  title: string;
  year?: number;
  mediaType: string;
  isShow: boolean;
  /** Deduplicated by poster id, sorted by id for deterministic output. */
  posters: TPoster[];
  posterIds: string[];
  /** First poster in stable order: the deterministic representative. */
  representative: TPoster;
  /** Latest member updatedAt (YYYY-MM-DD) for sitemap lastmod, if any. */
  updatedAtMax?: string;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeMediaType(mediaType: string | undefined): string {
  return (mediaType ?? "").trim().toLowerCase();
}

/** Same normalization as poster/artist slugs: lowercase, strip punctuation, hyphenate. */
export function slugifyFilmTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  return slug || "film";
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

function modeYear(years: number[]): number | undefined {
  const nonZero = years.filter((y) => y > 0);
  if (nonZero.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const year of nonZero) counts.set(year, (counts.get(year) ?? 0) + 1);
  let best = Number.POSITIVE_INFINITY;
  let bestCount = -1;
  for (const [year, count] of [...counts.entries()].sort(([a], [b]) => a - b)) {
    if (count > bestCount) {
      best = year;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Map a raw catalogue row to film input. Returns null for records that can
 * never render a valid poster page (missing id or unusable artwork),
 * mirroring the route loader predicate.
 */
export function filmInputFromRow(row: {
  id: string;
  data: Record<string, unknown>;
}): FilmPosterInput | null {
  if (typeof row.id !== "string" || !row.id || row.id.includes("/")) return null;
  const data = row.data;
  // Defense in depth: the Firestore query already restricts to published
  // rows, but a non-published record must never produce a film URL.
  if ("status" in data && data.status !== "published") return null;
  const image =
    (typeof data.image === "string" && data.image.trim()) ||
    (typeof data.posterImageUrl === "string" && data.posterImageUrl.trim()) ||
    "";
  if (!image) return null;
  const artists = Array.isArray(data.artists)
    ? data.artists
        .filter(
          (a) => a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string",
        )
        .map((a) => ({ name: String((a as { name: string }).name) }))
    : undefined;
  return {
    id: row.id,
    title: typeof data.title === "string" ? data.title.trim() : "",
    year: typeof data.year === "number" ? data.year : Number(data.year) || 0,
    mediaType: typeof data.mediaType === "string" ? data.mediaType : undefined,
    tmdbId: typeof data.tmdbId === "string" ? data.tmdbId : undefined,
    imdbId: typeof data.imdbId === "string" ? data.imdbId : undefined,
    image: image.trim(),
    artists,
    artist: typeof data.artist === "string" ? data.artist : undefined,
    updatedAt: (data as { updatedAt?: unknown }).updatedAt,
  };
}

function identityKey(input: FilmPosterInput): string | null {
  const media = normalizeMediaType(input.mediaType);
  const tmdb = (input.tmdbId ?? "").trim();
  if (tmdb) return `tmdb:${tmdb}|${media}`;
  const imdb = (input.imdbId ?? "").trim();
  if (imdb) return `imdb:${imdb}|${media}`;
  const title = normalizeTitle(input.title);
  if (!title) return null;
  return `title:${title}|${input.year || 0}|${media}`;
}

interface MutableGroup<TPoster extends FilmPosterInput> {
  key: string;
  members: TPoster[];
  posterById: Map<string, TPoster>;
}

/**
 * Group inputs by resolved identity, preserving the original poster objects.
 * Invalid members are dropped, poster ids deduplicated (first wins in
 * id-sorted order). Deterministic output.
 */
export function buildFilmGroups<TPoster extends FilmPosterInput>(
  inputs: readonly TPoster[],
): FilmGroup<TPoster>[] {
  const sorted = [...inputs]
    .filter((p) => typeof p.id === "string" && p.id && typeof p.title === "string")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = new Map<string, MutableGroup<TPoster>>();
  for (const input of sorted) {
    const key = identityKey(input);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { key, members: [], posterById: new Map() };
      groups.set(key, group);
    }
    if (!group.posterById.has(input.id)) {
      group.posterById.set(input.id, input);
      group.members.push(input);
    }
  }

  const prelim = [...groups.values()]
    .map((group) => {
      const titles = group.members.map((m) => m.title.trim()).filter(Boolean);
      const title = mode(titles);
      const year = modeYear(group.members.map((m) => m.year));
      const mediaType = mode(group.members.map((m) => normalizeMediaType(m.mediaType)));
      const updatedAts = group.members
        .map((m) => toLastmod(m.updatedAt))
        .filter((d): d is string => typeof d === "string")
        .sort();
      const posters = [...group.posterById.values()].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
      return {
        key: group.key,
        title,
        year,
        mediaType,
        posters,
        updatedAtMax: updatedAts[updatedAts.length - 1],
      };
    })
    .filter((g) => g.title && g.posters.length > 0)
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : a.key < b.key ? -1 : 1));

  // Unique slugs: year suffix only on collision, counter only on pathological repeat.
  const used = new Set<string>();
  return prelim.map((group) => {
    const base = slugifyFilmTitle(group.title);
    let slug = base;
    if (used.has(slug)) {
      slug = group.year ? `${base}-${group.year}` : base;
      let n = 2;
      while (used.has(slug)) {
        slug = group.year ? `${base}-${group.year}-${n}` : `${base}-${n}`;
        n++;
      }
    }
    used.add(slug);
    const isShow = group.mediaType === "show";
    return {
      key: group.key,
      slug,
      title: group.title,
      year: group.year,
      mediaType: group.mediaType,
      isShow,
      posters: group.posters,
      posterIds: group.posters.map((p) => p.id),
      representative: group.posters[0],
      updatedAtMax: group.updatedAtMax,
    };
  });
}

/** Eligible groups only: the single shared rule used by route and sitemap. */
export function eligibleFilmGroups<TPoster extends FilmPosterInput>(
  inputs: readonly TPoster[],
): FilmGroup<TPoster>[] {
  return buildFilmGroups(inputs).filter((g) => g.posterIds.length >= MIN_FILM_POSTERS);
}

/** Resolve an eligible group by route slug, or null (→ genuine 404). */
export function resolveFilmSlug<TPoster extends FilmPosterInput>(
  inputs: readonly TPoster[],
  slug: string,
): FilmGroup<TPoster> | null {
  return eligibleFilmGroups(inputs).find((g) => g.slug === slug) ?? null;
}

/** Resolve the eligible film group containing a poster, or null. */
export function filmGroupForPoster<TPoster extends FilmPosterInput>(
  inputs: readonly TPoster[],
  posterId: string,
): FilmGroup<TPoster> | null {
  return eligibleFilmGroups(inputs).find((g) => g.posterIds.includes(posterId)) ?? null;
}

/** Film slug for a poster id, or null when the poster has no eligible page. */
export function filmSlugForPoster<TPoster extends FilmPosterInput>(
  inputs: readonly TPoster[],
  posterId: string,
): string | null {
  return filmGroupForPoster(inputs, posterId)?.slug ?? null;
}

/** Sitemap entries for eligible groups: canonical loc + reliable lastmod. */
export function filmUrlEntries(groups: readonly FilmGroup[]): SitemapUrlEntry[] {
  return groups
    .filter((g) => g.posterIds.length >= MIN_FILM_POSTERS)
    .map((g) => {
      const entry: SitemapUrlEntry = { loc: `${SITE_ORIGIN}/film/${g.slug}` };
      if (g.updatedAtMax) entry.lastmod = g.updatedAtMax;
      return entry;
    })
    .sort((a, b) => (a.loc < b.loc ? -1 : 1));
}
