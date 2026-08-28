import { Link } from "@tanstack/react-router";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { PosterImage } from "@/components/PosterImage";
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

interface DailySpotlightProps {
  filmPosters: Poster[];
  totalPosters: number;
  totalArtists: number;
}

/** Manifesto-led hero — One Film, Many Visions proved by stacked interpretations. */
export function DailySpotlight({ filmPosters, totalPosters, totalArtists }: DailySpotlightProps) {
  const representative = filmPosters[0];
  const filmTitle = representative?.title ?? "Cinema";
  const filmYear = representative?.year;

  return (
    <section
      aria-label="CinePrint manifesto"
      className="page-shell grid grid-cols-12 gap-6 border-b border-white/10 pb-8 pt-6 sm:gap-6 sm:pt-8 lg:gap-10 lg:pb-10"
    >
      {/* Left: manifesto */}
      <div className="col-span-12 lg:col-span-7">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
          Independent Print Archive — Est. 2026
        </p>
        <h1 className="mt-3 font-display text-[clamp(44px,7vw,110px)] uppercase leading-[0.85] tracking-[0.01em]">
          One Film.
          <br />
          <span className="text-[#FF6B6B]">Many Visions.</span>
        </h1>
        <p className="mt-5 max-w-[42ch] text-sm leading-relaxed text-white/60 sm:text-[15px]">
          Discover cinema through the work of independent artists.
          <br className="hidden sm:block" />
          Every poster is an independent reinterpretation.
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
          className={`mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF6B6B] px-7 text-sm font-semibold text-[#121212] shadow-md shadow-[#FF6B6B]/15 transition duration-150 ease-[var(--ease-out)] hover:bg-[#FF8585] active:scale-95 ${focusRing}`}
        >
          Explore Artists
        </a>
        <p className="mt-4 font-mono text-[11px] tabular-nums tracking-wide text-white/35">
          {totalPosters} prints · {totalArtists} artists
        </p>
      </div>

      {/* Right: film interpretations — fanned stack proves the headline */}
      <div className="col-span-12 lg:col-span-5 lg:pt-1">
        <div className="group relative mx-auto flex h-[300px] max-w-[400px] items-end justify-center sm:h-[360px] sm:max-w-[470px] lg:mr-0 lg:ml-auto lg:max-w-[470px] lg:h-[380px]">
          {filmPosters.length === 1 ? (
            <Link
              to="/poster/$id"
              params={{ id: filmPosters[0].id }}
              aria-label={`${filmTitle} — view poster`}
              className={`relative h-[264px] w-[176px] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-[0_16px_32px_rgba(0,0,0,0.6)] transition duration-200 ease-[var(--ease-out)] hover:border-white/20 group-hover:-translate-y-[3px] group-hover:scale-[1.01] group-focus-visible:-translate-y-[3px] group-focus-visible:scale-[1.01] sm:h-[304px] sm:w-[202px] lg:h-[312px] lg:w-[208px] xl:h-[348px] xl:w-[232px] ${focusRing}`}
            >
              <PosterImage
                poster={filmPosters[0]}
                purpose="gallery"
                loading="eager"
                alt={`${filmPosters[0].title} (${filmPosters[0].year})`}
                className="h-full w-full object-cover"
              />
            </Link>
          ) : filmPosters.length === 2 ? (
            <div className="relative flex h-full w-full items-end justify-center">
              <Link
                to="/poster/$id"
                params={{ id: filmPosters[0].id }}
                aria-label={`${filmPosters[0].title} by ${filmPosters[0].artist} — view poster`}
                className="absolute bottom-0 left-1/2 h-[222px] w-[148px] -translate-x-[119%] -rotate-[6deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-90 shadow-lg transition duration-300 ease-[var(--ease-out)] hover:opacity-100 sm:group-hover:-translate-x-[124%] lg:group-hover:-translate-x-[130%] xl:group-hover:-translate-x-[123%] sm:group-hover:-rotate-[9deg] lg:group-hover:-rotate-[9deg] xl:group-hover:-rotate-[9deg] sm:group-focus-visible:-translate-x-[124%] lg:group-focus-visible:-translate-x-[130%] xl:group-focus-visible:-translate-x-[123%] sm:group-focus-visible:-rotate-[9deg] lg:group-focus-visible:-rotate-[9deg] xl:group-focus-visible:-rotate-[9deg] sm:h-[276px] sm:w-[184px] sm:-translate-x-[115%] lg:h-[255px] lg:w-[170px] lg:-translate-x-[121%] xl:h-[315px] xl:w-[210px] xl:-translate-x-[115%]"
              >
                <PosterImage
                  poster={filmPosters[0]}
                  purpose="gallery"
                  loading="eager"
                  alt={`${filmPosters[0].title} (${filmPosters[0].year})`}
                  className="h-full w-full object-cover"
                />
              </Link>
              <Link
                to="/poster/$id"
                params={{ id: filmPosters[1].id }}
                aria-label={`${filmPosters[1].title} by ${filmPosters[1].artist} — view poster`}
                className="relative z-10 h-[264px] w-[176px] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-xl transition duration-200 ease-[var(--ease-out)] hover:border-white/20 group-hover:-translate-y-[3px] group-hover:scale-[1.015] group-focus-visible:-translate-y-[3px] group-focus-visible:scale-[1.015] sm:h-[304px] sm:w-[202px] lg:h-[312px] lg:w-[208px] xl:h-[348px] xl:w-[232px]"
              >
                <PosterImage
                  poster={filmPosters[1]}
                  purpose="gallery"
                  loading="eager"
                  alt={`${filmPosters[1].title} (${filmPosters[1].year})`}
                  className="h-full w-full object-cover"
                />
              </Link>
            </div>
          ) : (
            <div className="relative flex h-full w-full items-end justify-center">
              <Link
                to="/poster/$id"
                params={{ id: filmPosters[0].id }}
                aria-label={`${filmPosters[0].title} by ${filmPosters[0].artist} — view poster`}
                className="absolute bottom-0 left-1/2 h-[216px] w-[144px] -translate-x-[106%] -rotate-[7deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-85 shadow-lg transition duration-300 ease-[var(--ease-out)] hover:opacity-100 sm:group-hover:-translate-x-[129%] lg:group-hover:-translate-x-[117%] xl:group-hover:-translate-x-[120%] sm:group-hover:-rotate-[10deg] lg:group-hover:-rotate-[10deg] xl:group-hover:-rotate-[10deg] sm:group-focus-visible:-translate-x-[129%] lg:group-focus-visible:-translate-x-[117%] xl:group-focus-visible:-translate-x-[120%] sm:group-focus-visible:-rotate-[10deg] lg:group-focus-visible:-rotate-[10deg] xl:group-focus-visible:-rotate-[10deg] sm:h-[252px] sm:w-[168px] sm:-translate-x-[119%] lg:h-[240px] lg:w-[160px] lg:-translate-x-[108%] xl:h-[282px] xl:w-[188px] xl:-translate-x-[111%]"
              >
                <PosterImage
                  poster={filmPosters[0]}
                  purpose="gallery"
                  loading="eager"
                  alt={`${filmPosters[0].title} (${filmPosters[0].year})`}
                  className="h-full w-full object-cover"
                />
              </Link>
              <Link
                to="/poster/$id"
                params={{ id: filmPosters[1].id }}
                aria-label={`${filmPosters[1].title} by ${filmPosters[1].artist} — view poster`}
                className="relative z-10 h-[264px] w-[176px] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-xl transition duration-200 ease-[var(--ease-out)] hover:border-white/20 group-hover:-translate-y-[3px] group-hover:scale-[1.015] group-focus-visible:-translate-y-[3px] group-focus-visible:scale-[1.015] sm:h-[304px] sm:w-[202px] lg:h-[312px] lg:w-[208px] xl:h-[348px] xl:w-[232px]"
              >
                <PosterImage
                  poster={filmPosters[1]}
                  purpose="gallery"
                  loading="eager"
                  alt={`${filmPosters[1].title} (${filmPosters[1].year})`}
                  className="h-full w-full object-cover"
                />
              </Link>
              <Link
                to="/poster/$id"
                params={{ id: filmPosters[2].id }}
                aria-label={`${filmPosters[2].title} by ${filmPosters[2].artist} — view poster`}
                className="absolute bottom-0 left-1/2 h-[216px] w-[144px] translate-x-[6%] rotate-[7deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-90 shadow-lg transition duration-300 ease-[var(--ease-out)] hover:opacity-100 sm:group-hover:translate-x-[29%] lg:group-hover:translate-x-[17%] xl:group-hover:translate-x-[19%] sm:group-hover:rotate-[10deg] lg:group-hover:rotate-[10deg] xl:group-hover:rotate-[10deg] sm:group-focus-visible:translate-x-[29%] lg:group-focus-visible:translate-x-[17%] xl:group-focus-visible:translate-x-[19%] sm:group-focus-visible:rotate-[10deg] lg:group-focus-visible:rotate-[10deg] xl:group-focus-visible:rotate-[10deg] sm:h-[252px] sm:w-[168px] sm:translate-x-[19%] lg:h-[240px] lg:w-[160px] lg:translate-x-[8%] xl:h-[282px] xl:w-[188px] xl:translate-x-[11%]"
              >
                <PosterImage
                  poster={filmPosters[2]}
                  purpose="gallery"
                  loading="eager"
                  alt={`${filmPosters[2].title} (${filmPosters[2].year})`}
                  className="h-full w-full object-cover"
                />
              </Link>
            </div>
          )}
        </div>
        <div className="mx-auto mt-4 flex max-w-[400px] flex-col items-center gap-1 border-t border-white/10 pt-3 text-center sm:max-w-[470px] lg:mr-0 lg:ml-auto lg:max-w-[470px]">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/35">
            {filmPosters.length} interpretation{filmPosters.length === 1 ? "" : "s"} · {filmYear}
          </span>
          <span className="max-w-[28ch] truncate font-heading text-sm font-medium text-white/80">
            {filmTitle}
          </span>
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
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-3 scrollbar-hide">
        {artists.map(({ name, count, covers }) => (
          <Link
            key={name}
            to="/artist/$slug"
            params={{ slug: slugifyArtist(name) }}
            aria-label={`${name}, ${count} poster${count === 1 ? "" : "s"}`}
            className={`group relative flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-white/12 bg-white/[0.06] transition duration-150 ease-[var(--ease-out)] hover:border-white/20 hover:bg-white/[0.08] active:scale-[0.98] sm:w-64 ${focusRing}`}
          >
            {/* Artwork zone — fan rises from behind the lower card */}
            <div className="relative flex h-[168px] items-end justify-center overflow-visible px-3 pt-4 sm:h-[184px]">
              <div className="relative flex items-end justify-center">
                {covers.length === 1 ? (
                  <div className="relative h-[132px] w-[88px] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-md transition duration-300 ease-[var(--ease-out)] group-hover:-translate-y-[2px] group-hover:scale-[1.01] group-focus-visible:-translate-y-[2px] group-focus-visible:scale-[1.01] sm:h-[144px] sm:w-[96px]">
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
                    <div className="absolute bottom-0 left-1/2 h-[124px] w-[84px] -translate-x-[62%] -rotate-[5deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-85 shadow-md transition duration-300 ease-[var(--ease-out)] group-hover:-translate-x-[70%] group-hover:-rotate-[8deg] group-focus-visible:-translate-x-[70%] group-focus-visible:-rotate-[8deg] sm:h-[136px] sm:w-[92px]">
                      <PosterImage
                        poster={covers[0]}
                        purpose="gallery"
                        loading="lazy"
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="relative z-10 h-[132px] w-[88px] translate-x-[14%] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-lg transition duration-200 ease-[var(--ease-out)] group-hover:-translate-y-[3px] group-focus-visible:-translate-y-[3px] sm:h-[144px] sm:w-[96px]">
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
                    <div className="absolute bottom-0 left-1/2 h-[120px] w-[80px] -translate-x-[108%] -rotate-[6deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-80 shadow-md transition duration-300 ease-[var(--ease-out)] group-hover:-translate-x-[118%] group-hover:-rotate-[9deg] group-focus-visible:-translate-x-[118%] group-focus-visible:-rotate-[9deg] sm:h-[132px] sm:w-[88px]">
                      <PosterImage
                        poster={covers[0]}
                        purpose="gallery"
                        loading="lazy"
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="relative z-10 h-[132px] w-[88px] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-xl transition duration-200 ease-[var(--ease-out)] group-hover:-translate-y-[2px] group-hover:scale-[1.01] group-focus-visible:-translate-y-[2px] group-focus-visible:scale-[1.01] sm:h-[144px] sm:w-[96px]">
                      <PosterImage
                        poster={covers[1]}
                        purpose="gallery"
                        loading="lazy"
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="absolute bottom-0 left-1/2 h-[120px] w-[80px] translate-x-[8%] rotate-[6deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-90 shadow-md transition duration-300 ease-[var(--ease-out)] group-hover:translate-x-[16%] group-hover:rotate-[9deg] group-focus-visible:translate-x-[16%] group-focus-visible:rotate-[9deg] sm:h-[132px] sm:w-[88px]">
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
