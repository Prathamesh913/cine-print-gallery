import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { PosterImage } from "@/components/PosterImage";
import { getPosterImageUrl } from "@/lib/poster-images";
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

interface DailySpotlightProps {
  filmPosters: Poster[];
  totalPosters: number;
  totalArtists: number;
}

/**
 * Hero where the print sits inside the sentence. The headline reads
 * "One film. Many [print] visions." and the visitor flips the print to see
 * another artist's take on the same film.
 */
export function DailySpotlight({
  filmPosters,
  totalPosters,
  totalArtists,
}: DailySpotlightProps) {
  const [activePosterIdx, setActivePosterIdx] = useState(0);
  const activePoster = filmPosters[activePosterIdx] || filmPosters[0];

  useEffect(() => {
    if (!activePoster) return;
    const timer = window.setTimeout(() => {
      for (const poster of filmPosters) {
        if (poster.id === activePoster.id) continue;
        const image = new Image();
        image.src = getPosterImageUrl(poster, "gallery");
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [filmPosters, activePoster]);

  if (!activePoster || filmPosters.length === 0) return null;

  const filmTitle = activePoster.title ?? "Cinema";
  const filmYear = activePoster.year;
  const rawArtist =
    activePoster.artists && activePoster.artists.length > 0
      ? activePoster.artists[0].name
      : activePoster.artist;
  const artistName = rawArtist && rawArtist.trim() ? rawArtist.trim() : "Independent Artist";
  const totalCount = filmPosters.length;
  const nextInterpretation = () =>
    setActivePosterIdx((index) => (index + 1) % totalCount);

  return (
    <section
      aria-label="CinePrint manifesto"
      className="relative mx-auto flex min-h-[calc(100svh-72px)] w-full max-w-[1600px] flex-col px-4 pb-8 pt-6 sm:px-6 lg:pb-10"
    >
      <h1 className="my-auto flex flex-col items-start font-display uppercase leading-[0.9] tracking-[-0.01em] text-[clamp(46px,16vw,78px)] sm:flex-row sm:items-baseline sm:gap-x-[0.12em] sm:text-[clamp(56px,9vw,136px)]">
        <span className="block sm:contents">
          <span className="hero-rise inline-block">One film.</span>{" "}
          <span className="hero-rise inline-block" style={{ animationDelay: "80ms" }}>
            Many
          </span>
        </span>
        <span
          key={activePoster.id}
          aria-hidden
          className="hero-shutter my-[0.14em] block h-[35svh] min-h-[240px] max-h-[420px] shrink-0 overflow-hidden bg-[#1E1E1E] sm:my-0 sm:h-[3.15em] sm:min-h-0 sm:max-h-none"
          style={{ aspectRatio: "2 / 3" }}
        >
          <PosterImage
            poster={activePoster}
            purpose="gallery"
            loading="eager"
            fetchPriority="high"
            alt=""
            className="h-full w-full object-cover"
          />
        </span>
        <span className="block sm:contents">
          <span className="hero-rise inline-block" style={{ animationDelay: "200ms" }}>
            visions.
          </span>
        </span>
      </h1>

      <div className="mt-10 grid grid-cols-1 items-end gap-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-10">
        <div className="order-2 sm:order-none">
          <p
            className="hero-rise max-w-[38ch] text-[17px] leading-relaxed text-white/65"
            style={{ animationDelay: "300ms" }}
          >
            An independent archive of {totalPosters} alternative movie posters by {totalArtists}{" "}
            artists.
          </p>
          <a
            href="#gallery"
            onClick={(event) => {
              event.preventDefault();
              const gallery = document.getElementById("gallery");
              if (!gallery) return;
              const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
              gallery.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
            }}
            className={`hero-rise mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#FF6B6B] px-6 text-[15px] font-semibold text-[#121212] transition-[transform,background-color] duration-150 hover:bg-[#FF8585] active:scale-[0.98] sm:w-auto ${focusRing}`}
            style={{ animationDelay: "360ms" }}
          >
            Browse the archive
          </a>
        </div>

        <div
          aria-live="polite"
          className="order-1 flex flex-col items-start gap-1.5 sm:order-none sm:items-end sm:text-right"
        >
          <Link
            to="/poster/$id"
            params={{ id: activePoster.id }}
            className={`hero-rise max-w-[30ch] text-[18px] font-semibold leading-tight text-white hover:underline underline-offset-[0.22em] ${focusRing}`}
            style={{ animationDelay: "420ms" }}
          >
            {filmTitle}, {filmYear}
          </Link>
          <Link
            to="/artist/$slug"
            params={{ slug: slugifyArtist(artistName) }}
            className={`hero-rise max-w-[30ch] text-[15px] leading-snug text-white/55 transition-colors hover:text-white ${focusRing}`}
            style={{ animationDelay: "460ms" }}
          >
            {artistName}
          </Link>
          {totalCount > 1 && (
            <div
              className="hero-rise mt-2 flex items-center gap-3"
              style={{ animationDelay: "520ms" }}
            >
              <span className="text-[15px] tabular-nums text-white/55">
                {activePosterIdx + 1} of {totalCount}
              </span>
              <button
                type="button"
                onClick={nextInterpretation}
                className={`min-h-11 px-1 text-[15px] text-white/65 underline underline-offset-[0.22em] transition-colors hover:text-white ${focusRing}`}
              >
                Next interpretation
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export interface RailArtist {
  name: string;
  count: number;
  covers: Poster[];
}

/** ArtistRail — collection/folder card: artwork emerges from behind a substantial metadata panel. */
export function ArtistRail({ artists }: { artists: RailArtist[] }) {
  if (artists.length < 4) return null;

  return (
    <section aria-label="Explore artists">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-white/55 sm:text-xs">
        Explore Artists
      </p>
      <div
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-1 pb-3 scrollbar-hide"
        style={{ scrollPaddingInline: "1rem" }}
      >
        {artists.map(({ name, count, covers }) => (
          <Link
            key={name}
            to="/artist/$slug"
            params={{ slug: slugifyArtist(name) }}
            aria-label={`${name}, ${count} poster${count === 1 ? "" : "s"}`}
            className={`group relative flex w-56 shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-white/12 bg-white/[0.06] transition-[transform,border-color,background-color] duration-[160ms] ease-[var(--ease-out)] hover:border-white/20 hover:bg-white/[0.08] hoverable:hover:-translate-y-[1px] active:scale-[0.98] sm:w-64 ${focusRing}`}
          >
            {/* Artwork zone — fan rises from behind the lower card */}
            <div className="relative flex h-[168px] items-end justify-center overflow-visible px-3 pt-4 sm:h-[184px]">
              <div className="relative flex items-end justify-center">
                {covers.length === 1 ? (
                  <div className="relative h-[132px] w-[88px] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-md transition-[transform] duration-200 ease-[var(--ease-out)] hoverable:group-hover:-translate-y-[2px] hoverable:group-hover:scale-[1.01] group-focus-visible:-translate-y-[2px] group-focus-visible:scale-[1.01] sm:h-[144px] sm:w-[96px]">
                    <PosterImage
                      poster={covers[0]}
                      purpose="gallery"
                      loading="lazy"
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : covers.length === 2 ? (
                  <>
                    <div className="absolute bottom-0 left-1/2 h-[124px] w-[84px] -translate-x-[62%] -rotate-[5deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-85 shadow-md transition-[transform] duration-[280ms] ease-[var(--ease-out)] hoverable:group-hover:-translate-x-[70%] hoverable:group-hover:-rotate-[8deg] group-focus-visible:-translate-x-[70%] group-focus-visible:-rotate-[8deg] sm:h-[136px] sm:w-[92px]">
                      <PosterImage
                        poster={covers[0]}
                        purpose="gallery"
                        loading="lazy"
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="relative z-10 h-[132px] w-[88px] translate-x-[14%] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-lg transition-[transform] duration-200 ease-[var(--ease-out)] hoverable:group-hover:-translate-y-[3px] group-focus-visible:-translate-y-[3px] sm:h-[144px] sm:w-[96px]">
                      <PosterImage
                        poster={covers[1]}
                        purpose="gallery"
                        loading="lazy"
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="absolute bottom-0 left-1/2 h-[120px] w-[80px] -translate-x-[108%] -rotate-[6deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-80 shadow-md transition-[transform] duration-[280ms] ease-[var(--ease-out)] hoverable:group-hover:-translate-x-[118%] hoverable:group-hover:-rotate-[9deg] group-focus-visible:-translate-x-[118%] group-focus-visible:-rotate-[9deg] sm:h-[132px] sm:w-[88px]">
                      <PosterImage
                        poster={covers[0]}
                        purpose="gallery"
                        loading="lazy"
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="relative z-10 h-[132px] w-[88px] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-xl transition-[transform] duration-200 ease-[var(--ease-out)] hoverable:group-hover:-translate-y-[2px] hoverable:group-hover:scale-[1.01] group-focus-visible:-translate-y-[2px] group-focus-visible:scale-[1.01] sm:h-[144px] sm:w-[96px]">
                      <PosterImage
                        poster={covers[1]}
                        purpose="gallery"
                        loading="lazy"
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="absolute bottom-0 left-1/2 h-[120px] w-[80px] translate-x-[8%] rotate-[6deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-90 shadow-md transition-[transform] duration-[280ms] ease-[var(--ease-out)] hoverable:group-hover:translate-x-[16%] hoverable:group-hover:rotate-[9deg] group-focus-visible:translate-x-[16%] group-focus-visible:rotate-[9deg] sm:h-[132px] sm:w-[88px]">
                      <PosterImage
                        poster={covers[2]}
                        purpose="gallery"
                        loading="lazy"
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Lower collection panel — substantial, rounded top where it meets artwork */}
            <div className="flex flex-1 flex-col rounded-t-xl border-t border-white/10 bg-[#0F0F0F] px-4 pb-4 pt-4">
              <h3 className="line-clamp-2 min-h-[2.8em] text-left text-[15px] font-semibold leading-snug text-white">
                {name}
              </h3>
              <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
                <span className="font-mono text-xs tabular-nums text-white/50">
                  {count} poster{count === 1 ? "" : "s"}
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-xs text-white/60 transition-colors group-hover:text-white">
                  Explore <span aria-hidden>→</span>
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
