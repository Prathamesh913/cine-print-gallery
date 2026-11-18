import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { Poster } from "@/lib/posters";
import { FeaturedFan } from "@/components/FeaturedFan";
import { PosterGrid } from "@/components/PosterGrid";
import { buildGlowBackground } from "@/lib/collection-hero";

interface Props {
  title: string;
  year?: number;
  isShow: boolean;
  genres: string[];
  description: string;
  posters: Poster[];
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

/**
 * Server-rendered film/show collection page. Uses the same hero language as
 * the individual artist page — palette glow band, back pill, display title,
 * metadata line and featured poster fan — followed by the shared PosterGrid.
 * One H1 and every poster link stay in the initial HTML for crawlers.
 */
export function FilmArticle({ title, year, isShow, genres, description, posters }: Props) {
  const glowBackground = useMemo(() => buildGlowBackground(posters), [posters]);
  const genreSummary = genres.slice(0, 3).join(" · ");

  return (
    <article className="w-full">
      <div className="page-shell w-full pt-10">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-white/45">
            <li>
              <Link to="/" preload="intent" className="transition-colors hover:text-white/80">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="min-w-0 max-w-[40ch] truncate text-white/85">
              {title}
            </li>
          </ol>
        </nav>
      </div>

      <section className="relative">
        {/* Palette hero band — pure CSS from the bundled palette cache */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[220px] overflow-hidden rounded-b-3xl sm:h-[280px]"
        >
          <div className="absolute inset-0" style={{ background: glowBackground }} />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to right, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 42%, rgba(0,0,0,0) 78%)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0) 30%, rgba(0,0,0,0.75) 78%, #000000 100%)",
            }}
          />
        </div>

        <div className="page-shell relative z-10 pb-12 pt-5 sm:pb-16 sm:pt-8">
          <div>
            <Link
              to="/"
              preload="intent"
              className={`inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-4 font-mono text-[10px] uppercase tracking-widest text-white/65 transition-colors duration-150 ease-[var(--ease-out)] hover:border-white/25 hover:bg-white/10 hover:text-[#FF6B6B] sm:text-xs ${focusRing}`}
            >
              <ArrowLeft size={12} />
              <span>Back to Gallery</span>
            </Link>
          </div>

          <div className="mt-7 flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
            <div className="min-w-0 max-w-3xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-[#FF6B6B]">
                Premade Collection
              </p>
              <h1 className="mt-3 break-words font-display text-5xl uppercase leading-none text-[#F5F5F5] sm:text-6xl lg:text-7xl">
                Alternative Posters for {title}
              </h1>

              <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.25em] tabular-nums text-white/55">
                {posters.length} poster{posters.length !== 1 ? "s" : ""}
                {year !== undefined && year > 0 ? ` · ${year}` : ""}
                {` · ${isShow ? "TV Series" : "Movie"}`}
                {genreSummary ? ` · ${genreSummary}` : ""}
              </p>

              <p className="mt-5 max-w-[70ch] text-sm leading-relaxed text-white/65">
                {description}
              </p>
            </div>

            <FeaturedFan
              posters={posters}
              imageAlt={(poster) => `${poster.title} (${poster.year}) by ${poster.artist}`}
            />
          </div>
        </div>
      </section>

      <div className="page-shell flex-grow pb-16">
        <PosterGrid posters={posters} />
      </div>
    </article>
  );
}
