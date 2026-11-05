import { Link } from "@tanstack/react-router";
import { PosterGrid } from "@/components/PosterGrid";
import type { Poster } from "@/lib/posters";

export interface RelatedFilm {
  name: string;
  /** Film slug when the film has an eligible landing page, else null (plain text). */
  slug: string | null;
  count: number;
}

interface Props {
  eyebrow: string;
  heading: string;
  meta: Array<{ label: string; value: string }>;
  description: string;
  relatedTitle?: string;
  related?: RelatedFilm[];
  posters: Poster[];
  basePath: "/genre" | "/style";
  title: string;
}

/**
 * Shared detail page for genre and style landing pages. Breadcrumb,
 * single H1, grounded metadata, optional related-film links (real
 * anchors only), and the eligible posters through the shared PosterGrid.
 */
export function TaxonomyDetail({
  eyebrow,
  heading,
  meta,
  description,
  relatedTitle,
  related,
  posters,
  basePath,
  title,
}: Props) {
  return (
    <article className="page-shell w-full max-w-6xl flex-grow py-10">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-white/45">
          <li>
            <Link to="/" preload="intent" className="transition-colors hover:text-white/80">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              to={basePath === "/genre" ? "/genres" : "/styles"}
              preload="intent"
              className="transition-colors hover:text-white/80"
            >
              {basePath === "/genre" ? "Genres" : "Styles"}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="min-w-0 max-w-[40ch] truncate text-white/85">
            {title}
          </li>
        </ol>
      </nav>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-widest text-white/45 sm:text-xs">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-semibold leading-tight text-[#F5F5F5] font-heading sm:text-4xl">
        {heading}
      </h1>

      <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-white/70">
        {meta.map((item, index) => (
          <span key={item.label} className="inline-flex items-center gap-x-2.5">
            {index > 0 && (
              <span aria-hidden="true" className="text-white/30">
                •
              </span>
            )}
            <span>
              <span className="sr-only">{item.label}: </span>
              <span className="font-medium text-white/85">{item.value}</span>
            </span>
          </span>
        ))}
      </p>

      <p className="mt-4 max-w-[70ch] text-sm leading-relaxed text-white/65">{description}</p>

      {related && related.length > 0 && (
        <section aria-label={relatedTitle ?? "Related"} className="mt-8">
          <h2 className="text-lg font-semibold font-heading">{relatedTitle}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {related.map((film) => (
              <li key={film.name}>
                {film.slug ? (
                  <Link
                    to="/film/$slug"
                    params={{ slug: film.slug }}
                    preload="intent"
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 text-sm text-white/85 transition hover:border-[#FF6B6B]/60 hover:text-white"
                  >
                    {film.name}
                    <span className="font-mono text-xs tabular-nums text-white/45">
                      {film.count}
                    </span>
                  </Link>
                ) : (
                  <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 text-sm text-white/60">
                    {film.name}
                    <span className="font-mono text-xs tabular-nums text-white/35">
                      {film.count}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8">
        {/* Small, bounded groups: render every eligible poster for
            crawlability instead of paginating behind a scroll sentinel. */}
        <PosterGrid posters={posters} pageSize={Math.max(posters.length, 1)} />
      </div>
    </article>
  );
}
