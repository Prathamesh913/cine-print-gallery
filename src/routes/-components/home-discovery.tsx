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

const stackOffsets = [
  { x: 0, y: 0, rotate: 0, opacity: 1 },
  { x: 34, y: 30, rotate: 3, opacity: 0.7 },
  { x: -34, y: 46, rotate: -2, opacity: 0.45 },
];

/**
 * The daily film's prints as a physical stack. The film and artist sit together
 * as the print label, the lift control sits with the prints, and the stack
 * cycles the interpretations when the visitor is not interacting with it.
 */
export function DailySpotlight({
  filmPosters,
  totalPosters,
  totalArtists,
}: DailySpotlightProps) {
  const [activePosterIdx, setActivePosterIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const activePoster = filmPosters[activePosterIdx] || filmPosters[0];
  const totalCount = filmPosters.length;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

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

  useEffect(() => {
    if (totalCount < 2 || reduceMotion || paused) return;
    let interval: number | undefined;
    const start = window.setTimeout(() => {
      setActivePosterIdx((current) => (current + 1) % totalCount);
      interval = window.setInterval(() => {
        setActivePosterIdx((current) => (current + 1) % totalCount);
      }, 3000);
    }, 1500);
    return () => {
      window.clearTimeout(start);
      if (interval) window.clearInterval(interval);
    };
  }, [totalCount, reduceMotion, paused, resetKey]);

  if (!activePoster || filmPosters.length === 0) return null;

  const filmTitle = activePoster.title ?? "Cinema";
  const filmYear = activePoster.year;
  const rawArtist =
    activePoster.artists && activePoster.artists.length > 0
      ? activePoster.artists[0].name
      : activePoster.artist;
  const artistName = rawArtist && rawArtist.trim() ? rawArtist.trim() : "Independent Artist";

  const choose = (index: number) => {
    setActivePosterIdx(index);
    setResetKey((key) => key + 1);
  };
  const next = () => choose((activePosterIdx + 1) % totalCount);

  return (
    <section className="relative mx-auto flex min-h-[calc(100svh-72px)] w-full max-w-[1600px] flex-col px-4 pb-8 pt-6 sm:px-6 lg:pb-10">
      <div className="flex items-start justify-between gap-6 pb-4 md:pb-6">
        <div>
          <Link
            to="/poster/$id"
            params={{ id: activePoster.id }}
            className={`hero-rise font-display text-2xl uppercase tracking-wide hover:underline underline-offset-[0.14em] md:text-3xl ${focusRing}`}
          >
            {filmTitle}, {filmYear}
          </Link>
          <Link
            to="/artist/$slug"
            params={{ slug: slugifyArtist(artistName) }}
            className={`hero-rise mt-1 block w-fit text-[15px] text-white/60 transition-colors hover:text-white md:text-[16px] ${focusRing}`}
            style={{ animationDelay: "40ms" }}
          >
            {artistName}
          </Link>
        </div>
        <p className="hidden text-[15px] text-white/55 md:block">The daily film</p>
      </div>

      <div className="flex flex-1 flex-col gap-8 md:flex-row md:items-center md:gap-10 lg:gap-12">
        <div className="w-full shrink-0 md:w-[46%]">
          <div
            className="hero-rise relative mx-auto aspect-[3/4] w-full max-w-[260px] md:mx-0 md:max-w-[420px] lg:max-w-[460px]"
            style={{ animationDelay: "80ms" }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setPaused(false);
              }
            }}
          >
            {filmPosters.map((poster, index) => {
              const relative = (index - activePosterIdx + totalCount) % totalCount;
              const offset = stackOffsets[relative] ?? stackOffsets[0];
              const isTop = relative === 0;
              return (
                <button
                  key={poster.id}
                  type="button"
                  onClick={() => (isTop ? next() : choose(index))}
                  aria-label={isTop ? "Lift the next print" : `Bring print ${index + 1} to the top`}
                  aria-pressed={isTop}
                  className="absolute left-1/2 top-1/2 aspect-[2/3] w-[78%] overflow-hidden bg-[#1E1E1E] transition-[transform,opacity] duration-[480ms] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]"
                  style={{
                    transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) rotate(${offset.rotate}deg)`,
                    zIndex: totalCount - relative,
                    opacity: offset.opacity,
                  }}
                >
                  <PosterImage
                    poster={poster}
                    purpose="gallery"
                    loading={isTop ? "eager" : "lazy"}
                    fetchPriority={isTop ? "high" : "auto"}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </button>
              );
            })}
          </div>

          {totalCount > 1 && (
            <div className="mt-5 hidden items-center gap-4 md:flex">
              <button
                type="button"
                onClick={next}
                className={`hero-rise min-h-11 px-1 text-[15px] text-white/65 underline underline-offset-[0.22em] transition-colors hover:text-white ${focusRing}`}
                style={{ animationDelay: "140ms" }}
              >
                Lift the next print
              </button>
              <span
                className="hero-rise text-[15px] tabular-nums text-white/55"
                style={{ animationDelay: "160ms" }}
              >
                {activePosterIdx + 1} of {totalCount}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col justify-center">
          <h1 className="hero-rise font-display uppercase leading-[0.88] tracking-[-0.01em] text-[clamp(48px,5.6vw,96px)]">
            One film.
            <br />
            Many visions.
          </h1>

          <p
            className="hero-rise mt-6 max-w-[46ch] text-[17px] leading-relaxed text-white/65"
            style={{ animationDelay: "160ms" }}
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
            className={`hero-rise mt-6 inline-flex min-h-12 w-fit items-center justify-center rounded-full bg-[#FF6B6B] px-6 text-[15px] font-semibold text-[#121212] transition-[transform,background-color] duration-150 hover:bg-[#FF8585] active:scale-[0.98] ${focusRing}`}
            style={{ animationDelay: "240ms" }}
          >
            Browse the archive
          </a>

          {totalCount > 1 && (
            <div className="mt-5 flex items-center gap-4 md:hidden">
              <button
                type="button"
                onClick={next}
                className={`hero-rise min-h-11 px-1 text-[15px] text-white/65 underline underline-offset-[0.22em] transition-colors hover:text-white ${focusRing}`}
                style={{ animationDelay: "300ms" }}
              >
                Lift the next print
              </button>
              <span
                className="hero-rise text-[15px] tabular-nums text-white/55"
                style={{ animationDelay: "320ms" }}
              >
                {activePosterIdx + 1} of {totalCount}
              </span>
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
