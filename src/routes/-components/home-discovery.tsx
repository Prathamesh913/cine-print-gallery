import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { PosterImage } from "@/components/PosterImage";
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

interface DailySpotlightProps {
  filmPosters: Poster[];
  totalPosters: number;
  totalArtists: number;
}

/** Manifesto-led hero — One Film, Many Visions proved by interactive stacked interpretations. */
export function DailySpotlight({
  filmPosters,
  totalPosters,
  totalArtists,
}: DailySpotlightProps) {
  const navigate = useNavigate();
  const [activePosterIdx, setActivePosterIdx] = useState(0);

  const activePoster = filmPosters[activePosterIdx] || filmPosters[0];
  if (!activePoster || filmPosters.length === 0) return null;

  const filmTitle = activePoster.title ?? "Cinema";
  const filmYear = activePoster.year;
  const rawArtist =
    activePoster.artists && activePoster.artists.length > 0
      ? activePoster.artists[0].name
      : activePoster.artist;
  const artistName = rawArtist && rawArtist.trim() ? rawArtist.trim() : "Independent Artist";
  const totalCount = filmPosters.length;

  return (
    <section
      aria-label="CinePrint manifesto"
      className="relative w-full flex flex-col gap-6 border-b border-white/10 pb-8 pt-6 px-4 sm:gap-8 sm:px-6 sm:pt-8 lg:flex-row lg:items-center lg:justify-between lg:gap-10 xl:gap-20 lg:py-10"
    >
      {/* Left: manifesto */}
      <div className="shrink-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
          Independent Print Archive — Est. 2026
        </p>
        <h1 className="mt-3 font-display text-[clamp(44px,7vw,110px)] uppercase leading-[0.85] tracking-[0.01em]">
          One Film.
          <br />
          <span className="text-[#FF6B6B]">Many Visions.</span>
        </h1>
        <p className="mt-5 max-w-[52ch] text-sm leading-relaxed text-white/60 sm:text-[15px]">
          Discover cinema through the work of independent artists. Every poster is an independent
          reinterpretation.
        </p>
        <a
          href="#artists"
          onClick={(e) => {
            e.preventDefault();
            const id = document.getElementById("artists");
            if (!id) return;
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            id.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
          }}
          className={`mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF6B6B] px-7 text-sm font-semibold text-[#121212] shadow-md shadow-[#FF6B6B]/15 transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-out)] hover:bg-[#FF8585] active:scale-95 ${focusRing}`}
        >
          Explore Artists
        </a>
        <p className="mt-4 font-mono text-[11px] tabular-nums tracking-wide text-white/35">
          {totalPosters} prints · {totalArtists} artists
        </p>
      </div>

      {/* Center: ambient fill for negative space — absolute, no layout shift */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[380px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FF6B6B]/[0.05] blur-[90px] lg:block"
      />

      {/* Right: film interpretations — interactive fanned stack */}
      <div className="shrink-0 lg:mr-[clamp(7rem,12vw,16rem)]">
        <div className="group relative mx-auto flex h-[400px] max-w-[600px] items-end justify-center sm:h-[360px] sm:max-w-[470px] lg:mx-0 lg:max-w-[470px] lg:h-[380px]">
          {totalCount === 1 ? (
            <Link
              to="/poster/$id"
              params={{ id: activePoster.id }}
              aria-label={`${filmTitle} by ${artistName} — view poster`}
              className={`relative h-[264px] w-[176px] overflow-hidden rounded-lg border border-white/15 bg-[#1E1E1E] shadow-[0_16px_32px_rgba(0,0,0,0.6)] transition-[transform,opacity,border-color] duration-[180ms] ease-[var(--ease-out)] hover:border-[#FF6B6B]/40 hoverable:hover:-translate-y-[2px] active:scale-[0.98] sm:h-[304px] sm:w-[202px] lg:h-[312px] lg:w-[208px] xl:h-[348px] xl:w-[232px] ${focusRing}`}
            >
              <PosterImage
                poster={activePoster}
                purpose="gallery"
                loading="eager"
                alt={`${activePoster.title} (${activePoster.year})`}
                className="h-full w-full object-cover"
              />
            </Link>
          ) : totalCount === 2 ? (
            <div className="relative flex h-full w-full items-end justify-center">
              {/* Back card (non-active) */}
              {(() => {
                const backIdx = (activePosterIdx + 1) % 2;
                const backPoster = filmPosters[backIdx];
                return (
                  <button
                    type="button"
                    onClick={() => setActivePosterIdx(backIdx)}
                    aria-label={`View poster by ${backPoster.artists?.[0]?.name || backPoster.artist}`}
                    className="cursor-pointer absolute bottom-0 left-1/2 h-[222px] w-[148px] -translate-x-[119%] -rotate-[6deg] origin-bottom overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-75 shadow-lg transition-[transform,opacity,border-color] duration-[260ms] ease-[var(--ease-out)] hover:opacity-100 hover:border-white/30 hover:-translate-x-[124%] hover:-rotate-[8deg] sm:h-[276px] sm:w-[184px] sm:-translate-x-[115%] lg:h-[255px] lg:w-[170px] lg:-translate-x-[121%] xl:h-[315px] xl:w-[210px] xl:-translate-x-[115%]"
                  >
                    <PosterImage
                      poster={backPoster}
                      purpose="gallery"
                      loading="eager"
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                );
              })()}

              {/* Front active card */}
              <div
                onClick={() => navigate({ to: "/poster/$id", params: { id: activePoster.id } })}
                className="relative z-10 h-[264px] w-[176px] cursor-pointer overflow-hidden rounded-lg border border-white/20 bg-[#1E1E1E] shadow-[0_20px_40px_rgba(0,0,0,0.8)] transition-[transform,border-color] duration-[180ms] ease-[var(--ease-out)] hover:border-[#FF6B6B]/60 hover:-translate-y-[3px] active:scale-[0.98] sm:h-[304px] sm:w-[202px] lg:h-[312px] lg:w-[208px] xl:h-[348px] xl:w-[232px]"
              >
                <PosterImage
                  poster={activePoster}
                  purpose="gallery"
                  loading="eager"
                  alt={`${activePoster.title} (${activePoster.year})`}
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          ) : (
            <div className="relative flex h-full w-full items-end justify-center">
              {/* Left back card */}
              {(() => {
                const leftIdx = (activePosterIdx - 1 + totalCount) % totalCount;
                const leftPoster = filmPosters[leftIdx];
                return (
                  <button
                    type="button"
                    onClick={() => setActivePosterIdx(leftIdx)}
                    aria-label={`View poster by ${leftPoster.artists?.[0]?.name || leftPoster.artist}`}
                    className="cursor-pointer absolute bottom-0 left-1/2 h-[216px] w-[144px] -translate-x-[106%] -rotate-[7deg] origin-bottom overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-75 shadow-lg transition-[transform,opacity,border-color] duration-[240ms] ease-[var(--ease-out)] hover:opacity-100 hover:border-white/30 hover:-translate-x-[118%] hover:-rotate-[9deg] sm:h-[252px] sm:w-[168px] sm:-translate-x-[119%] lg:h-[240px] lg:w-[160px] lg:-translate-x-[108%] xl:h-[282px] xl:w-[188px] xl:-translate-x-[111%]"
                  >
                    <PosterImage
                      poster={leftPoster}
                      purpose="gallery"
                      loading="eager"
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                );
              })()}

              {/* Center active card */}
              <div
                onClick={() => navigate({ to: "/poster/$id", params: { id: activePoster.id } })}
                className="relative z-10 h-[264px] w-[176px] cursor-pointer overflow-hidden rounded-lg border border-white/20 bg-[#1E1E1E] shadow-[0_20px_40px_rgba(0,0,0,0.8)] transition-[transform,border-color] duration-[180ms] ease-[var(--ease-out)] hover:border-[#FF6B6B]/60 hover:-translate-y-[3px] active:scale-[0.98] sm:h-[304px] sm:w-[202px] lg:h-[312px] lg:w-[208px] xl:h-[348px] xl:w-[232px]"
              >
                <PosterImage
                  poster={activePoster}
                  purpose="gallery"
                  loading="eager"
                  alt={`${activePoster.title} (${activePoster.year})`}
                  className="h-full w-full object-cover"
                />
              </div>

              {/* Right back card */}
              {(() => {
                const rightIdx = (activePosterIdx + 1) % totalCount;
                const rightPoster = filmPosters[rightIdx];
                return (
                  <button
                    type="button"
                    onClick={() => setActivePosterIdx(rightIdx)}
                    aria-label={`View poster by ${rightPoster.artists?.[0]?.name || rightPoster.artist}`}
                    className="cursor-pointer absolute bottom-0 left-1/2 h-[216px] w-[144px] translate-x-[6%] rotate-[7deg] origin-bottom overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-75 shadow-lg transition-[transform,opacity,border-color] duration-[240ms] ease-[var(--ease-out)] hover:opacity-100 hover:border-white/30 hover:translate-x-[18%] hover:rotate-[9deg] sm:h-[252px] sm:w-[168px] sm:translate-x-[19%] lg:h-[240px] lg:w-[160px] lg:translate-x-[8%] xl:h-[282px] xl:w-[188px] xl:translate-x-[11%]"
                  >
                    <PosterImage
                      poster={rightPoster}
                      purpose="gallery"
                      loading="eager"
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                );
              })()}
            </div>
          )}
        </div>

        {/* Info panel under stack */}
        <div className="mx-auto mt-4 flex max-w-[400px] flex-col items-center gap-1 border-t border-white/10 pt-3 text-center sm:max-w-[470px] lg:mx-0 lg:max-w-[470px]">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/35">
            {totalCount} interpretation{totalCount === 1 ? "" : "s"} · {filmYear}
          </span>
          <span className="max-w-[28ch] truncate font-heading text-sm font-semibold text-white">
            {filmTitle}
          </span>
          <span className="text-xs text-white/60">
            by{" "}
            <Link
              to="/artist/$slug"
              params={{ slug: slugifyArtist(artistName) }}
              className="text-[#FF6B6B] transition-colors hover:underline hover:text-[#FF8585]"
            >
              {artistName}
            </Link>
          </span>

          {totalCount > 1 && (
            <div className="mt-2 flex items-center justify-center gap-1.5">
              {filmPosters.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePosterIdx(idx)}
                  aria-label={`View poster by ${p.artists?.[0]?.name || p.artist}`}
                  className={`cursor-pointer h-1.5 rounded-full transition-all duration-200 ${
                    idx === activePosterIdx
                      ? "w-5 bg-[#FF6B6B]"
                      : "w-2 bg-white/25 hover:bg-white/50"
                  }`}
                />
              ))}
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
