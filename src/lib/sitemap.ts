import { slugifyArtist } from "./posters";
import type { Poster } from "./posters";
import { getPosterSeoImageUrl } from "./poster-images";
import { SITE_ORIGIN } from "./seo";

/**
 * Pure sitemap builders (M5). No Firestore, no filesystem, no timestamps from
 * the build clock — identical catalogue input always yields byte-identical XML.
 *
 * Data access (paginated Firestore reads) lives in scripts/generate-sitemap.ts
 * and feeds these builders through the narrow RawPosterRow seam below.
 */

export const STATIC_PATHS = [
  "/",
  "/about",
  "/artists",
  "/genres",
  "/styles",
  "/submit",
  "/constellation",
] as const;

export const SITEMAP_INDEX_FILE = "sitemap.xml";
export const SITEMAP_STATIC_FILE = "sitemap-static.xml";
export const SITEMAP_POSTERS_FILE = "sitemap-posters.xml";
export const SITEMAP_ARTISTS_FILE = "sitemap-artists.xml";
export const SITEMAP_FILMS_FILE = "sitemap-films.xml";
export const SITEMAP_GENRES_FILE = "sitemap-genres.xml";
export const SITEMAP_STYLES_FILE = "sitemap-styles.xml";

export const SITEMAP_MAX_URLS = 50_000;
export const SITEMAP_MAX_BYTES = 50_000_000;

export interface RawPosterRow {
  id: string;
  data: Record<string, unknown>;
}

export interface SitemapUrlEntry {
  loc: string;
  lastmod?: string;
  image?: string;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && !id.includes("/");
}

function imageOf(
  data: Record<string, unknown>,
  id: string,
  resolveImage: (poster: Poster) => string,
): string | undefined {
  const image =
    (typeof data.image === "string" && data.image.trim()) ||
    (typeof data.posterImageUrl === "string" && data.posterImageUrl.trim()) ||
    "";
  const raw = image ? image.trim() : undefined;
  if (!raw) return undefined;
  try {
    const optimized = resolveImage({ id, image: raw } as Poster);
    return optimized.trim() ? optimized.trim() : raw;
  } catch {
    return raw;
  }
}

/**
 * Trustworthy modification date only: a real updatedAt value from catalogue
 * source data, normalized to YYYY-MM-DD. Anything else (missing, wrong type,
 * unparseable) yields undefined so the caller omits lastmod entirely —
 * never the build date.
 */
export function toLastmod(value: unknown): string | undefined {
  try {
    let millis: number | undefined;
    if (typeof value === "object" && value !== null && "toDate" in value) {
      const holder = value as { toDate: () => unknown };
      if (typeof holder.toDate === "function") {
        const date = holder.toDate();
        if (date instanceof Date && !Number.isNaN(date.getTime())) millis = date.getTime();
      }
    } else if (value instanceof Date) {
      if (!Number.isNaN(value.getTime())) millis = value.getTime();
    } else if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      millis = value;
    } else if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value.trim());
      if (!Number.isNaN(parsed)) millis = parsed;
    }
    if (millis === undefined) return undefined;
    return new Date(millis).toISOString().split("T")[0];
  } catch {
    return undefined;
  }
}

/**
 * Poster page entries. Mirrors the route loader's validity predicate exactly:
 * published status is enforced by the Firestore query, and a route resolves
 * only for a non-empty id with artwork. Duplicates collapse to one URL.
 * Sorted by id for deterministic output.
 */
export function posterUrlEntries(
  rows: readonly RawPosterRow[],
  resolveImage: (poster: Poster) => string = getPosterSeoImageUrl,
): SitemapUrlEntry[] {
  const seen = new Set<string>();
  const entries: SitemapUrlEntry[] = [];
  for (const row of rows) {
    if (!isValidId(row.id) || seen.has(row.id)) continue;
    const image = imageOf(row.data, row.id, resolveImage);
    if (!image) continue;
    seen.add(row.id);
    const entry: SitemapUrlEntry = { loc: `${SITE_ORIGIN}/poster/${row.id}`, image };
    const lastmod = toLastmod(row.data.updatedAt);
    if (lastmod) entry.lastmod = lastmod;
    entries.push(entry);
  }
  entries.sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));
  return entries;
}

/**
 * Artist page entries derived from the same catalogue rows with the single
 * authoritative slug helper. Drops empty/unknown slugs and duplicates.
 */
export function artistUrlEntries(rows: readonly RawPosterRow[]): SitemapUrlEntry[] {
  const slugs = new Set<string>();
  for (const row of rows) {
    if (!isValidId(row.id)) continue;
    const data = row.data;
    const rawNames = Array.isArray(data.artists)
      ? data.artists.map((a) =>
          a && typeof a === "object" ? String((a as { name?: unknown }).name ?? "") : "",
        )
      : [typeof data.artist === "string" ? data.artist : ""];
    for (const raw of rawNames) {
      const name = raw.trim();
      if (!name || name.toLowerCase() === "unknown") continue;
      const slug = slugifyArtist(name);
      if (!slug || slug === "unknown") continue;
      slugs.add(slug);
    }
  }
  return [...slugs].sort().map((slug) => ({ loc: `${SITE_ORIGIN}/artist/${slug}` }));
}

export function staticUrlEntries(): SitemapUrlEntry[] {
  return STATIC_PATHS.map((path) => ({ loc: `${SITE_ORIGIN}${path}` }));
}

function urlEntryXml(entry: SitemapUrlEntry, withImage: boolean): string {
  const lines = [`  <url>`, `    <loc>${escapeXml(entry.loc)}</loc>`];
  if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
  if (withImage && entry.image) {
    lines.push(
      `    <image:image>`,
      `      <image:loc>${escapeXml(entry.image)}</image:loc>`,
      `    </image:image>`,
    );
  }
  lines.push(`  </url>`);
  return lines.join("\n");
}

export function buildUrlsetXml(entries: readonly SitemapUrlEntry[], withImage = false): string {
  const xmlns = withImage
    ? 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'
    : 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  const urls = entries.map((entry) => urlEntryXml(entry, withImage)).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${xmlns}>\n${urls}\n</urlset>\n`;
}

export function buildSitemapIndexXml(childFiles: readonly string[]): string {
  const entries = [...childFiles]
    .sort()
    .map(
      (file) => `  <sitemap>\n    <loc>${escapeXml(`${SITE_ORIGIN}/${file}`)}</loc>\n  </sitemap>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
}

export function buildRobotsTxt(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/${SITEMAP_INDEX_FILE}\n`;
}

export function assertSitemapLimits(urlCount: number, byteLength: number): void {
  if (urlCount > SITEMAP_MAX_URLS) {
    throw new Error(`Sitemap URL limit exceeded: ${urlCount} > ${SITEMAP_MAX_URLS}`);
  }
  if (byteLength > SITEMAP_MAX_BYTES) {
    throw new Error(`Sitemap size limit exceeded: ${byteLength} > ${SITEMAP_MAX_BYTES}`);
  }
}

export interface PagedRows {
  rows: RawPosterRow[];
  nextCursor: string | null;
}

/**
 * Cursor-pagination driver. Calls fetchPage until the catalogue is exhausted,
 * preserving source order and failing loudly on infrastructure errors —
 * never resolving to a silent partial set.
 */
export async function collectAllPages(
  fetchPage: (cursor: string | null) => Promise<PagedRows>,
  maxPages = 2000,
): Promise<RawPosterRow[]> {
  const all: RawPosterRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const { rows, nextCursor } = await fetchPage(cursor);
    all.push(...rows);
    if (nextCursor === null) return all;
    cursor = nextCursor;
  }
  throw new Error(`Pagination did not terminate after ${maxPages} pages`);
}
