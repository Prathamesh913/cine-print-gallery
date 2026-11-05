import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LayoutGrid } from "lucide-react";
import { PosterImage } from "@/components/PosterImage";
import { EmptyState } from "@/components/states";
import { filterTaxonomy, type TaxonomyEntry } from "@/lib/taxonomy";
import type { Poster } from "@/lib/posters";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

export interface TaxonomyDirectoryEntry {
  slug: string;
  name: string;
  posterIds: string[];
  representative: Poster;
}

interface Props {
  eyebrow: string;
  heading: string;
  lede: string;
  searchLabel: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyBody: string;
  entries: TaxonomyEntry<Poster>[];
  basePath: "/genre" | "/style";
}

/**
 * Shared discovery directory for genres and styles. Every entry and its
 * link renders in the initial SSR HTML; the search box only filters
 * client-side and never removes destinations from the markup.
 */
function CardBody({ entry }: { entry: TaxonomyEntry<Poster> }) {
  return (
    <>
      <span
        className="relative block w-full overflow-hidden bg-[#1E1E1E]"
        style={{ aspectRatio: "4 / 5" }}
      >
        <PosterImage
          poster={entry.representative}
          purpose="gallery"
          loading="lazy"
          alt={`${entry.representative.title} (${entry.representative.year}) by ${entry.representative.artist}`}
          className="h-full w-full object-cover transition-transform duration-200 ease-[var(--ease-out)] hoverable:group-hover:scale-[1.02]"
        />
      </span>
      <span className="flex flex-1 flex-col px-4 pb-4 pt-3">
        <span className="line-clamp-2 min-h-[2.8em] text-left text-[15px] font-semibold leading-snug text-white">
          {entry.name}
        </span>
        <span className="mt-2 flex items-center justify-between border-t border-white/5 pt-2.5">
          <span className="font-mono text-xs tabular-nums text-white/50">
            {entry.posterIds.length} poster{entry.posterIds.length === 1 ? "" : "s"}
          </span>
          <span
            aria-hidden
            className="inline-flex items-center gap-1 font-mono text-xs text-white/60 transition-colors group-hover:text-white"
          >
            Explore →
          </span>
        </span>
      </span>
    </>
  );
}

export function TaxonomyDirectory({
  eyebrow,
  heading,
  lede,
  searchLabel,
  searchPlaceholder,
  emptyTitle,
  emptyBody,
  entries,
  basePath,
}: Props) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterTaxonomy(entries, query), [entries, query]);

  return (
    <div className="page-shell w-full max-w-6xl flex-grow py-10">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-white/45">
          <li>
            <Link to="/" preload="intent" className="transition-colors hover:text-white/80">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-white/85">
            {heading}
          </li>
        </ol>
      </nav>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-widest text-white/45 sm:text-xs">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-semibold leading-tight text-[#F5F5F5] font-heading sm:text-4xl">
        {heading}
      </h1>
      <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-white/65">{lede}</p>

      {entries.length > 0 && (
        <div className="mt-6">
          <label
            htmlFor="taxonomy-search"
            className="mb-1.5 block text-xs uppercase tracking-widest text-white/55"
          >
            {searchLabel}
          </label>
          <input
            id="taxonomy-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            autoComplete="off"
            className="w-full max-w-md rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-[#F5F5F5] placeholder:text-white/35 focus:border-[#FF6B6B] focus:outline-none"
          />
        </div>
      )}

      {entries.length === 0 ? (
        <div className="mt-10">
          <EmptyState icon={LayoutGrid} title={emptyTitle} body={emptyBody}>
            <Link
              to="/"
              preload="intent"
              className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full bg-[#FF6B6B] px-5 text-sm font-semibold text-[#121212] transition hover:bg-[#FF8585]"
            >
              Browse the gallery
            </Link>
          </EmptyState>
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-10 text-sm text-white/60" role="status">
          No matches for &ldquo;{query.trim()}&rdquo; yet — try another term.
        </p>
      ) : (
        <>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-widest text-white/45">
            {visible.length} {visible.length === 1 ? "category" : "categories"}
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((entry) => (
              <li key={entry.slug}>
                {basePath === "/genre" ? (
                  <Link
                    to="/genre/$slug"
                    params={{ slug: entry.slug }}
                    preload="intent"
                    aria-label={`${entry.name}, ${entry.posterIds.length} poster${entry.posterIds.length === 1 ? "" : "s"}`}
                    className={`group relative flex h-full flex-col overflow-hidden rounded-xl border border-white/12 bg-white/[0.06] transition-[transform,border-color,background-color] duration-[160ms] ease-[var(--ease-out)] hover:border-white/20 hover:bg-white/[0.08] hoverable:hover:-translate-y-[1px] active:scale-[0.98] ${focusRing}`}
                  >
                    <CardBody entry={entry} />
                  </Link>
                ) : (
                  <Link
                    to="/style/$slug"
                    params={{ slug: entry.slug }}
                    preload="intent"
                    aria-label={`${entry.name}, ${entry.posterIds.length} poster${entry.posterIds.length === 1 ? "" : "s"}`}
                    className={`group relative flex h-full flex-col overflow-hidden rounded-xl border border-white/12 bg-white/[0.06] transition-[transform,border-color,background-color] duration-[160ms] ease-[var(--ease-out)] hover:border-white/20 hover:bg-white/[0.08] hoverable:hover:-translate-y-[1px] active:scale-[0.98] ${focusRing}`}
                  >
                    <CardBody entry={entry} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
