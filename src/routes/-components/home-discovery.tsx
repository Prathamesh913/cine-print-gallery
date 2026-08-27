import { Link } from "@tanstack/react-router";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { PosterImage } from "@/components/PosterImage";
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

interface DailySpotlightProps {
  poster: Poster;
  totalPosters: number;
  totalArtists: number;
}

/** Manifesto-led hero — identity first, poster as proof. */
export function DailySpotlight({ poster, totalPosters, totalArtists }: DailySpotlightProps) {
  const artistName =
    poster.artists && poster.artists.length > 0
      ? (poster.artists[0]?.name ?? poster.artist)
      : poster.artist;
  const hasArtist = Boolean(artistName) && artistName !== "Unknown";
  const slug = hasArtist ? slugifyArtist(artistName) : undefined;

  return (
    <section
      aria-label="CinePrint manifesto"
      className="mx-auto grid max-w-[1600px] grid-cols-12 gap-6 border-b border-white/10 px-4 pb-8 pt-6 sm:gap-8 sm:px-6 sm:pt-8 lg:gap-10 lg:pb-12"
    >
      {/* Left: manifesto */}
      <div className="col-span-12 lg:col-span-7">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
          Independent Print Archive — Est. 2024
        </p>
        <h1 className="mt-3 font-display text-[clamp(44px,7vw,110px)] uppercase leading-[0.85] tracking-[0.01em]">
          Every Film
          <br />
          Deserves
          <br />
          <span className="text-[#FF6B6B]">Another Poster.</span>
        </h1>
        <p className="mt-5 max-w-[42ch] text-sm leading-relaxed text-white/60 sm:text-[15px]">
          Discover cinema through
          <br className="hidden sm:block" />
          the work of independent artists.
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

      {/* Right: featured poster as physical print */}
      <div className="col-span-12 lg:col-span-5 lg:pt-2">
        <Link
          to="/poster/$id"
          params={{ id: poster.id }}
          aria-label={`${poster.title} by ${artistName} — view poster`}
          className={`group mx-auto block max-w-[320px] rotate-[0.6deg] border border-white/10 bg-[#0A0A0A] p-2 pb-8 shadow-[0_20px_48px_rgba(0,0,0,0.8),0_4px_12px_rgba(0,0,0,0.5)] transition duration-200 hover:border-white/20 sm:max-w-[360px] lg:ml-auto lg:mr-0 ${focusRing} rounded-sm`}
        >
          <div className="aspect-[2/3] overflow-hidden bg-[#1E1E1E]">
            <PosterImage
              poster={poster}
              purpose="gallery"
              loading="eager"
              alt={`${poster.title} (${poster.year}) by ${poster.artist}`}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex items-center justify-between pt-2 font-mono text-[10px] uppercase tracking-wide text-white/40">
            <span>Featured</span>
            <span className="tabular-nums">{poster.year}</span>
          </div>
        </Link>
        <div className="mx-auto mt-3 flex max-w-[320px] items-center justify-between gap-3 border-t border-white/10 pt-3 sm:max-w-[360px] lg:ml-auto lg:mr-0">
          <span className="min-w-0 truncate font-mono text-[11px] text-white/60">
            {poster.title}
          </span>
          {hasArtist ? (
            <Link
              to="/artist/$slug"
              params={{ slug: slug! }}
              className={`shrink-0 font-mono text-[11px] uppercase tracking-wide text-white/45 transition-colors hover:text-[#FF6B6B] ${focusRing}`}
            >
              By {artistName} →
            </Link>
          ) : (
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-white/45">
              {poster.artist}
            </span>
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
