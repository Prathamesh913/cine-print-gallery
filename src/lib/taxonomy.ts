import { toLastmod, type SitemapUrlEntry } from "./sitemap";
import { SITE_ORIGIN } from "./seo";

/**
 * M9 genre & style taxonomy (model-the-domain: category identity is a
 * typed value with one construction site, not scattered conditionals).
 *
 * One generic engine serves both dimensions. Identity is the normalized
 * label plus an explicit synonym table — never fuzzy matching. Distinct
 * raw labels that normalize identically share documented rules (trim,
 * whitespace collapse, unicode-dash folding); a slug taken by a different
 * key gets a counter suffix instead of a silent merge.
 */

export interface TaxonomyDimension {
  kind: "genre" | "style";
  /** Detail route prefix, e.g. "/genre". */
  basePath: "/genre" | "/style";
  /** Normalized label -> canonical key for documented equivalents. */
  synonyms: Record<string, string>;
  /** Canonical key -> human-readable display label. */
  displayNames: Record<string, string>;
}

export const MIN_TAXONOMY_POSTERS = 3;

export const GENRE_DIMENSION: TaxonomyDimension = {
  kind: "genre",
  basePath: "/genre",
  // Explicit, reviewable equivalents only. Catalogue evidence: "Sci-Fi"
  // (non-breaking hyphen U+2011, 19 posters) and "Science Fiction"
  // (7 posters) denote the same genre; no poster carries both.
  synonyms: { "science fiction": "sci-fi" },
  displayNames: { "sci-fi": "Sci-Fi" },
};

export const STYLE_DIMENSION: TaxonomyDimension = {
  kind: "style",
  basePath: "/style",
  synonyms: {},
  displayNames: {},
};

export interface TaxonomyPosterInput {
  id: string;
  genre?: unknown;
  style?: unknown;
  image?: string;
  posterImageUrl?: string;
  updatedAt?: unknown;
}

export interface TaxonomyEntry<TPoster = TaxonomyPosterInput> {
  /** Canonical identity key (normalized, synonym-resolved). */
  key: string;
  /** Unique deterministic route slug. */
  slug: string;
  /** Human-readable display label. */
  name: string;
  /** Sorted unique poster ids with usable artwork. */
  posterIds: string[];
  /** Member posters, sorted by id for deterministic output. */
  posters: TPoster[];
  /** First poster in stable order: the deterministic representative. */
  representative: TPoster;
  /** Latest member updatedAt (YYYY-MM-DD) for sitemap lastmod, if any. */
  updatedAtMax?: string;
}

/** Normalize a raw catalogue label for identity (not display). */
export function normalizeTaxonomyLabel(raw: string): string {
  return raw
    .replace(/[‐-―−]/g, "-")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Same slug convention as poster/artist/film slugs. */
export function slugifyTaxonomyLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  return slug || "category";
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

function rawLabels(input: TaxonomyPosterInput, dim: TaxonomyDimension): string[] {
  const raw = dim.kind === "genre" ? input.genre : input.style;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return values.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function hasUsableArtwork(input: TaxonomyPosterInput): boolean {
  return Boolean(
    (typeof input.image === "string" && input.image.trim()) ||
    (typeof input.posterImageUrl === "string" && input.posterImageUrl.trim()),
  );
}

interface MutableGroup<TPoster extends TaxonomyPosterInput> {
  names: string[];
  posterById: Map<string, TPoster>;
  updatedAts: string[];
}

/**
 * Group inputs by resolved category identity. Members without usable
 * artwork are dropped; poster ids deduplicated (first wins in id-sorted
 * order). Output sorted by poster count desc, then name asc.
 */
export function buildTaxonomy<TPoster extends TaxonomyPosterInput>(
  inputs: readonly TPoster[],
  dim: TaxonomyDimension,
): TaxonomyEntry<TPoster>[] {
  const sorted = [...inputs]
    .filter((p) => typeof p.id === "string" && p.id)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = new Map<string, MutableGroup<TPoster>>();
  for (const input of sorted) {
    if (!hasUsableArtwork(input)) continue;
    const seen = new Set<string>();
    for (const raw of rawLabels(input, dim)) {
      const normalized = normalizeTaxonomyLabel(raw);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      const key = dim.synonyms[normalized] ?? normalized;
      let group = groups.get(key);
      if (!group) {
        group = { names: [], posterById: new Map(), updatedAts: [] };
        groups.set(key, group);
      }
      group.names.push(raw.trim());
      if (!group.posterById.has(input.id)) {
        group.posterById.set(input.id, input);
        const lastmod = toLastmod(input.updatedAt);
        if (lastmod) group.updatedAts.push(lastmod);
      }
    }
  }

  const prelim = [...groups.entries()].map(([key, group]) => {
    const posters = [...group.posterById.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const updatedAts = [...group.updatedAts].sort();
    const display = dim.displayNames[key] ?? mode(group.names);
    return {
      key,
      name: display,
      posters,
      posterIds: posters.map((p) => p.id),
      updatedAtMax: updatedAts[updatedAts.length - 1],
    };
  });

  // Unique slugs: counter suffix only on genuine collision, never a merge.
  // The map records which identity claimed each slug, so two distinct
  // categories can never share a URL.
  const used = new Map<string, string>();
  const entries: TaxonomyEntry<TPoster>[] = prelim.map((group) => {
    const base = slugifyTaxonomyLabel(group.name);
    let slug = base;
    let n = 2;
    while (used.has(slug) && used.get(slug) !== group.key) {
      slug = `${base}-${n++}`;
    }
    if (!used.has(slug)) {
      used.set(slug, group.key);
    }
    return {
      ...group,
      slug,
      representative: group.posters[0],
    };
  });

  entries.sort((a, b) =>
    b.posterIds.length !== a.posterIds.length
      ? b.posterIds.length - a.posterIds.length
      : a.name < b.name
        ? -1
        : 1,
  );
  return entries;
}

/** Slugs whose disambiguation suffix was required (report, don't merge). */
export function findCollidedSlugs<TPoster extends TaxonomyPosterInput>(
  inputs: readonly TPoster[],
  dim: TaxonomyDimension,
): Array<{ slug: string; key: string }> {
  const out: Array<{ slug: string; key: string }> = [];
  for (const entry of buildTaxonomy(inputs, dim)) {
    const base = slugifyTaxonomyLabel(entry.name);
    if (entry.slug !== base) out.push({ slug: entry.slug, key: entry.key });
  }
  return out.sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

/** Eligible groups only: the single shared rule used by route and sitemap. */
export function eligibleTaxonomy<TPoster extends TaxonomyPosterInput>(
  inputs: readonly TPoster[],
  dim: TaxonomyDimension,
): TaxonomyEntry<TPoster>[] {
  return buildTaxonomy(inputs, dim).filter((g) => g.posterIds.length >= MIN_TAXONOMY_POSTERS);
}

/** Resolve an eligible category by route slug, or null (→ genuine 404). */
export function resolveTaxonomySlug<TPoster extends TaxonomyPosterInput>(
  inputs: readonly TPoster[],
  dim: TaxonomyDimension,
  slug: string,
): TaxonomyEntry<TPoster> | null {
  return eligibleTaxonomy(inputs, dim).find((g) => g.slug === slug) ?? null;
}

/** Case-insensitive substring filter over display names (progressive enhancement). */
export function filterTaxonomy<TPoster extends TaxonomyPosterInput>(
  entries: readonly TaxonomyEntry<TPoster>[],
  query: string,
): TaxonomyEntry<TPoster>[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}

/** Map a raw catalogue row to taxonomy input. Null when the record can
 * never render a valid poster page (bad id, unpublished, no usable
 * artwork), mirroring the route loader predicate. */
export function taxonomyInputFromRow(row: {
  id: string;
  data: Record<string, unknown>;
}): TaxonomyPosterInput | null {
  if (typeof row.id !== "string" || !row.id || row.id.includes("/")) return null;
  const data = row.data;
  if ("status" in data && data.status !== "published") return null;
  const image = typeof data.image === "string" ? data.image : undefined;
  const posterImageUrl = typeof data.posterImageUrl === "string" ? data.posterImageUrl : undefined;
  const hasArtwork = Boolean((image && image.trim()) || (posterImageUrl && posterImageUrl.trim()));
  if (!hasArtwork) return null;
  return {
    id: row.id,
    genre: data.genre,
    style: data.style,
    image,
    posterImageUrl,
    updatedAt: (data as { updatedAt?: unknown }).updatedAt,
  };
}

/** Sitemap entries for eligible groups: canonical loc + reliable lastmod. */
export function taxonomyUrlEntries(
  groups: readonly TaxonomyEntry[],
  dim: TaxonomyDimension,
): { loc: string; lastmod?: string }[] {
  return groups
    .filter((g) => g.posterIds.length >= MIN_TAXONOMY_POSTERS)
    .map((g) => {
      const entry: { loc: string; lastmod?: string } = {
        loc: `${SITE_ORIGIN}${dim.basePath}/${g.slug}`,
      };
      if (g.updatedAtMax) entry.lastmod = g.updatedAtMax;
      return entry;
    })
    .sort((a, b) => (a.loc < b.loc ? -1 : 1));
}
