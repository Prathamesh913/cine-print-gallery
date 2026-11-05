import { Link } from "@tanstack/react-router";
import type { Poster } from "@/lib/posters";
import { PosterGrid } from "@/components/PosterGrid";

interface Props {
  title: string;
  year?: number;
  isShow: boolean;
  genres: string[];
  description: string;
  posters: Poster[];
}

/**
 * Server-rendered film/show landing content: one H1, real catalogue
 * metadata, and the eligible poster collection through the shared
 * PosterGrid (same cards, saves, and context menus as the gallery).
 */
export function FilmArticle({ title, year, isShow, genres, description, posters }: Props) {
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
          <li aria-current="page" className="min-w-0 max-w-[40ch] truncate text-white/85">
            {title}
          </li>
        </ol>
      </nav>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-widest text-white/45 sm:text-xs">
        Alternative {isShow ? "TV" : "Movie"} Posters
      </p>
      <h1 className="mt-2 text-3xl font-semibold leading-tight text-[#F5F5F5] font-heading sm:text-4xl">
        Alternative Posters for {title}
      </h1>

      <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-white/70">
        {year !== undefined && year > 0 && (
          <span className="font-medium text-white/85">{year}</span>
        )}
        {year !== undefined && year > 0 && <span className="text-white/30">•</span>}
        <span className="capitalize">{isShow ? "TV Series" : "Movie"}</span>
        <span className="text-white/30">•</span>
        <span>
          {posters.length} poster{posters.length === 1 ? "" : "s"}
        </span>
        {genres.map((genre) => (
          <span key={genre} className="inline-flex items-center text-xs text-white/65">
            <span className="mx-1 text-white/30">/</span>
            {genre}
          </span>
        ))}
      </p>

      <p className="mt-4 max-w-[70ch] text-sm leading-relaxed text-white/65">{description}</p>

      <div className="mt-8">
        <PosterGrid posters={posters} />
      </div>
    </article>
  );
}
