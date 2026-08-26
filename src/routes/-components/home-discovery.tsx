import { Link } from "@tanstack/react-router";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { PosterImage } from "@/components/PosterImage";

/** Single-line poster card recipe reused by the grid; kept local for brevity. */
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

interface DailySpotlightProps {
  poster: Poster;
  /** How many posters in the catalog are by this artist (>1 enables the outline CTA). */
  artistCount: number;
}

/** "Fresh Focus" — date-seeded featured poster module above the wall. */
export function DailySpotlight({ poster, artistCount }: DailySpotlightProps) {
  const artistName =
    poster.artists && poster.artists.length > 0
      ? (poster.artists[0]?.name ?? poster.artist)
      : poster.artist;
  const hasArtist = Boolean(artistName) && artistName !== "Unknown";
  const slug = hasArtist ? slugifyArtist(artistName) : undefined;

  return (
    <section
      aria-label="Fresh Focus — daily pick"
      className="grid items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:grid-cols-[minmax(0,280px)_1fr] sm:p-6"
    >
      <div
        className="overflow-hidden rounded-2xl"
        style={{ aspectRatio: "2 / 3", backgroundColor: "#1E1E1E" }}
      >
        {/* LCP candidate for the day's cut — load eagerly. */}
        <PosterImage
          poster={poster}
          purpose="gallery"
          loading="eager"
          alt={`${poster.title} (${poster.year}) by ${poster.artist}`}
          className="h-full w-full object-cover"
        />
      </div>

      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/55">
          Fresh Focus · Daily Pick
        </p>
        <h2 className="mt-2 line-clamp-2 font-display text-4xl uppercase leading-none sm:text-5xl">
          {poster.title}
        </h2>
        <p className="mt-3 text-sm text-white/65">
          {poster.year} · {poster.genre.join(" / ")}
        </p>

        {hasArtist ? (
          <Link
            to="/artist/$slug"
            params={{ slug: slug! }}
            className={`mt-2 inline-flex min-h-11 items-center font-mono text-[11px] uppercase tracking-[0.25em] text-white/55 transition-colors hover:text-[#FF6B6B] ${focusRing}`}
          >
            By {artistName}
          </Link>
        ) : (
          <p className="mt-2 inline-flex min-h-11 items-center font-mono text-[11px] uppercase tracking-[0.25em] text-white/55">
            By {poster.artist || "Unknown Artist"}
          </p>
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

export interface RailArtist {
  name: string;
  count: number;
}

/** "Explore Artists" — horizontal-scroll strip of the most prolific artists. */
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
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 scrollbar-hide">
        {artists.map(({ name, count }) => (
          <Link
            key={name}
            to="/artist/$slug"
            params={{ slug: slugifyArtist(name) }}
            className={`flex w-28 shrink-0 flex-col items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.06] p-4 transition hover:border-white/25 ${focusRing}`}
          >
            <span aria-hidden className="font-display text-3xl leading-none text-[#FF6B6B]">
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="w-full line-clamp-1 text-center text-xs text-[#F5F5F5]">{name}</span>
            <span className="text-[11px] tabular-nums text-white/50">
              {count} poster{count !== 1 ? "s" : ""}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
