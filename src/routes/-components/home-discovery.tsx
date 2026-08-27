import { Link } from "@tanstack/react-router";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { PosterImage } from "@/components/PosterImage";
import posterPalettesRaw from "@/lib/poster-palettes.json";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

const posterPalettes = posterPalettesRaw as Record<
  string,
  { palette: string[]; primary: string; hsl: { h: number; s: number; l: number } }
>;

interface DailySpotlightProps {
  poster: Poster;
  artistCount: number;
}

/** "Fresh Focus" — compact editorial hero, denser and shorter than before. */
export function DailySpotlight({ poster, artistCount }: DailySpotlightProps) {
  const artistName =
    poster.artists && poster.artists.length > 0
      ? (poster.artists[0]?.name ?? poster.artist)
      : poster.artist;
  const hasArtist = Boolean(artistName) && artistName !== "Unknown";
  const slug = hasArtist ? slugifyArtist(artistName) : undefined;
  const palette = posterPalettes[poster.id]?.palette?.slice(0, 5) ?? null;
  const tags = poster.tags?.slice(0, 3) ?? [];

  return (
    <section
      aria-label="Fresh Focus — daily pick"
      className="grid items-stretch gap-5 rounded-xl border border-white/12 bg-white/[0.06] p-4 sm:grid-cols-[260px_1fr] sm:p-5"
    >
      <div
        className="overflow-hidden rounded-lg"
        style={{ aspectRatio: "2 / 3", backgroundColor: "#1E1E1E" }}
      >
        <PosterImage
          poster={poster}
          purpose="gallery"
          loading="eager"
          alt={`${poster.title} (${poster.year}) by ${poster.artist}`}
          className="h-full w-full object-cover"
        />
      </div>

      <div className="flex min-w-0 flex-col justify-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/55">
          Fresh Focus · Daily Pick
        </p>
        <h2 className="mt-2 line-clamp-2 font-display text-4xl uppercase leading-none sm:text-5xl">
          {poster.title}
        </h2>
        <p className="mt-2 text-sm text-white/65">
          {poster.year} · {poster.genre.join(" / ") || poster.style}
        </p>
        {(poster.style || tags.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {poster.style && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70">
                {poster.style}
              </span>
            )}
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/65"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {hasArtist ? (
          <Link
            to="/artist/$slug"
            params={{ slug: slug! }}
            className={`mt-3 inline-flex min-h-11 w-fit items-center font-mono text-[11px] uppercase tracking-[0.25em] text-white/55 transition-colors hover:text-[#FF6B6B] ${focusRing}`}
          >
            By {artistName}
          </Link>
        ) : (
          <p className="mt-3 inline-flex min-h-11 items-center font-mono text-[11px] uppercase tracking-[0.25em] text-white/55">
            By {poster.artist || "Unknown Artist"}
          </p>
        )}

        {palette && palette.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            {palette.map((color) => (
              <span
                key={color}
                aria-hidden
                className="h-5 w-5 rounded-full border border-white/10"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            to="/poster/$id"
            params={{ id: poster.id }}
            className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full bg-[#FF6B6B] px-5 text-sm font-semibold text-[#121212] shadow-md shadow-[#FF6B6B]/15 transition duration-150 ease-[var(--ease-out)] hover:bg-[#FF8585] active:scale-95 ${focusRing}`}
          >
            View Poster
          </Link>
          {hasArtist && artistCount > 1 && (
            <Link
              to="/artist/$slug"
              params={{ slug: slug! }}
              className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-5 text-sm text-[#F5F5F5] transition duration-150 ease-[var(--ease-out)] hover:border-white/25 hover:bg-white/10 active:scale-95 ${focusRing}`}
            >
              More by {artistName}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

// Poster discovery rail — dense horizontal scroll of real poster art right after hero.

interface PosterDiscoveryProps {
  posters: Poster[];
  onOpen: (p: Poster) => void;
}

export function PosterDiscoveryRail({ posters, onOpen }: PosterDiscoveryProps) {
  if (posters.length === 0) return null;
  return (
    <section aria-label="More to discover">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-white/55 sm:text-xs">
          More to Discover
        </p>
        <p className="font-mono text-[10px] tabular-nums tracking-widest text-white/45 sm:text-xs">
          {posters.length}
        </p>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 scrollbar-hide">
        {posters.map((poster) => (
          <button
            key={poster.id}
            type="button"
            onClick={() => onOpen(poster)}
            className={`group flex w-32 shrink-0 flex-col gap-2 sm:w-36 ${focusRing} rounded-xl text-left`}
          >
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/12 bg-[#1E1E1E] transition group-hover:border-white/22">
              <PosterImage
                poster={poster}
                purpose="gallery"
                loading="lazy"
                alt={`${poster.title} (${poster.year})`}
                className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
              />
            </div>
            <span className="line-clamp-1 text-xs font-medium leading-tight text-[#F5F5F5] group-hover:text-white">
              {poster.title}
            </span>
            <span className="text-[11px] tabular-nums text-white/50">
              {poster.year}
              {poster.genre[0] ? ` · ${poster.genre[0]}` : ""}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export interface RailArtist {
  name: string;
  count: number;
  covers: Poster[];
}

/** Radically redesigned ArtistRail — poster work is the card identity. */
export function ArtistRail({ artists }: { artists: RailArtist[] }) {
  if (artists.length < 4) return null;

  return (
    <section aria-label="Explore artists">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-white/55 sm:text-xs">
          Explore Artists
        </p>
        <p className="font-mono text-[10px] tabular-nums tracking-widest text-white/45 sm:text-xs">
          {artists.length}
        </p>
      </div>
      <div className="-mx-1 flex gap-3.5 overflow-x-auto px-1 pb-2 scrollbar-hide">
        {artists.map(({ name, count, covers }) => (
          <Link
            key={name}
            to="/artist/$slug"
            params={{ slug: slugifyArtist(name) }}
            className={`group flex w-36 shrink-0 flex-col gap-2.5 sm:w-40 ${focusRing} rounded-xl`}
          >
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/12 bg-[#1E1E1E] transition group-hover:border-white/22">
              {covers.length === 1 ? (
                <PosterImage
                  poster={covers[0]}
                  purpose="gallery"
                  loading="lazy"
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : covers.length === 2 ? (
                <>
                  <PosterImage
                    poster={covers[0]}
                    purpose="gallery"
                    loading="lazy"
                    alt=""
                    className="absolute inset-0 h-full w-full -rotate-[4deg] scale-[0.94] object-cover opacity-90"
                  />
                  <PosterImage
                    poster={covers[1]}
                    purpose="gallery"
                    loading="lazy"
                    alt=""
                    className="relative h-full w-full object-cover shadow-xl"
                  />
                </>
              ) : (
                <>
                  <PosterImage
                    poster={covers[0]}
                    purpose="gallery"
                    loading="lazy"
                    alt=""
                    className="absolute inset-0 h-full w-full -rotate-[5deg] scale-[0.96] object-cover opacity-90"
                  />
                  <PosterImage
                    poster={covers[1]}
                    purpose="gallery"
                    loading="lazy"
                    alt=""
                    className="absolute inset-0 left-[6%] right-[6%] h-full w-[88%] rotate-0 object-cover shadow-xl"
                  />
                  <PosterImage
                    poster={covers[2]}
                    purpose="gallery"
                    loading="lazy"
                    alt=""
                    className="absolute inset-0 left-[12%] h-full w-full rotate-[5deg] scale-[0.96] object-cover opacity-95"
                  />
                </>
              )}
              {count > 1 && (
                <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white/85 backdrop-blur">
                  ×{count}
                </span>
              )}
            </div>
            <span className="line-clamp-2 min-h-[2.2em] text-pretty text-left text-[13px] font-medium leading-tight text-[#F5F5F5] group-hover:text-white">
              {name}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
