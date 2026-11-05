import { Link } from "@tanstack/react-router";
import type { Poster } from "@/lib/posters";
import { isKnownArtistName, slugifyArtist } from "@/lib/posters";
import { filmSlugForPoster } from "@/lib/films";
import { PosterImage } from "@/components/PosterImage";

interface Props {
  poster: Poster;
  posters: Poster[];
}

function primaryArtistName(poster: Poster): string | null {
  const first =
    poster.artists && poster.artists.length > 0 ? poster.artists[0].name : poster.artist;
  return isKnownArtistName(first) ? first.trim() : null;
}

/**
 * Server-rendered poster detail content. This is the meaningful underlying
 * route content for crawlers and no-JS visitors; the client-side Lightbox
 * overlay preserves the existing interactive experience on top of it.
 * Built only from real catalogue fields — missing data omits its row.
 */
export function PosterArticle({ poster, posters }: Props) {
  const isShow = poster.mediaType === "show";
  const kind = isShow ? "TV" : "Movie";
  const artist = primaryArtistName(poster);
  const artistSlug = artist ? slugifyArtist(artist) : null;
  // Link the film title only when an eligible landing page exists.
  const filmSlug = filmSlugForPoster(posters, poster.id);

  const sameFilm = posters.filter((p) => p.id !== poster.id && p.title === poster.title);
  const byArtist = artist
    ? posters.filter((p) => {
        if (p.id === poster.id) return false;
        const names = p.artists && p.artists.length > 0 ? p.artists.map((a) => a.name) : [p.artist];
        return names.some((n) => isKnownArtistName(n) && slugifyArtist(n) === artistSlug);
      })
    : [];

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
          <li className="min-w-0 max-w-[40ch] truncate text-white/65">
            {filmSlug ? (
              <Link
                to="/film/$slug"
                params={{ slug: filmSlug }}
                preload="intent"
                className="transition-colors hover:text-white/80"
              >
                {poster.title}
              </Link>
            ) : (
              poster.title
            )}
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-white/85">
            Poster
          </li>
        </ol>
      </nav>

      <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-10">
        <div>
          <div
            className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-[#1E1E1E]"
            style={{ aspectRatio: "2 / 3" }}
          >
            <PosterImage
              poster={poster}
              purpose="detail"
              alt={`${poster.title} (${poster.year}) by ${poster.artist} — alternative ${kind.toLowerCase()} poster artwork`}
              loading="eager"
              fetchPriority="high"
              className="h-full w-full object-contain"
            />
          </div>
        </div>

        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-widest text-white/45 sm:text-xs">
            Alternative {kind} Poster
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-[#F5F5F5] font-heading sm:text-4xl">
            {poster.title} — Alternative {kind} Poster
          </h1>

          <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-white/70">
            <span className="font-medium text-white/85">{poster.year}</span>
            {poster.seasonNumber !== undefined && poster.seasonNumber !== null && (
              <>
                <span className="text-white/30">•</span>
                <span>Season {poster.seasonNumber}</span>
              </>
            )}
            {poster.collectionName && (
              <>
                <span className="text-white/30">•</span>
                <span>{poster.collectionName}</span>
              </>
            )}
            {poster.mediaType && (
              <>
                <span className="text-white/30">•</span>
                <span className="capitalize">{poster.mediaType}</span>
              </>
            )}
            <span className="text-white/30">•</span>
            <span>{poster.style}</span>
            {poster.genre.map((g) => (
              <span key={g} className="inline-flex items-center">
                <span className="mx-1 text-white/30">/</span>
                {g}
              </span>
            ))}
          </p>

          <dl className="mt-6 rounded-xl border border-white/5 bg-white/[0.05] px-4 py-1 flex flex-col divide-y divide-white/5">
            {artist && artistSlug && (
              <div className="grid grid-cols-[85px_1fr] items-center gap-4 py-3">
                <dt className="text-[10px] font-mono uppercase tracking-wider text-white/45">
                  Artist
                </dt>
                <dd className="text-sm text-white/85">
                  {poster.artists && poster.artists.length > 0 ? (
                    poster.artists
                      .filter((a) => isKnownArtistName(a.name))
                      .map((a, idx) => (
                        <span key={idx} className="inline-flex items-center flex-wrap">
                          {idx > 0 && <span className="mx-1 text-white/55">&</span>}
                          <Link
                            to="/artist/$slug"
                            params={{ slug: slugifyArtist(a.name) }}
                            preload="intent"
                            className="font-medium text-[#F5F5F5] underline underline-offset-4 hover:text-[#FF6B6B] transition-colors duration-150"
                          >
                            {a.name}
                          </Link>
                        </span>
                      ))
                  ) : (
                    <Link
                      to="/artist/$slug"
                      params={{ slug: artistSlug }}
                      preload="intent"
                      className="font-medium text-[#F5F5F5] underline underline-offset-4 hover:text-[#FF6B6B] transition-colors duration-150"
                    >
                      {artist}
                    </Link>
                  )}
                </dd>
              </div>
            )}

            {(isKnownArtistName(poster.source) || poster.sourceUrl) && (
              <div className="grid grid-cols-[85px_1fr] items-center gap-4 py-3">
                <dt className="text-[10px] font-mono uppercase tracking-wider text-white/45">
                  Source
                </dt>
                <dd className="text-sm text-white/85">
                  {poster.sourceUrl ? (
                    <a
                      href={poster.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-[#F5F5F5] underline underline-offset-4 hover:text-[#FF6B6B] transition-colors duration-150"
                    >
                      {isKnownArtistName(poster.source) ? poster.source : poster.sourceUrl}
                    </a>
                  ) : (
                    <span>{poster.source}</span>
                  )}
                </dd>
              </div>
            )}

            {(poster.imdbId || poster.tmdbId) && (
              <div className="grid grid-cols-[85px_1fr] items-center gap-4 py-3">
                <dt className="text-[10px] font-mono uppercase tracking-wider text-white/45">
                  View On
                </dt>
                <dd className="flex flex-wrap gap-2 text-sm">
                  {poster.imdbId && (
                    <a
                      href={`https://www.imdb.com/title/${poster.imdbId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4 hover:text-[#FF6B6B] transition-colors duration-150"
                    >
                      IMDb
                    </a>
                  )}
                  {poster.tmdbId && (
                    <a
                      href={
                        isShow
                          ? `https://www.themoviedb.org/tv/${poster.tmdbId}`
                          : `https://www.themoviedb.org/movie/${poster.tmdbId}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4 hover:text-[#FF6B6B] transition-colors duration-150"
                    >
                      TMDb
                    </a>
                  )}
                </dd>
              </div>
            )}

            {poster.libraryNames && poster.libraryNames.length > 0 && (
              <div className="grid grid-cols-[85px_1fr] items-center gap-4 py-3">
                <dt className="text-[10px] font-mono uppercase tracking-wider text-white/45">
                  Libraries
                </dt>
                <dd className="flex flex-wrap gap-1.5">
                  {poster.libraryNames.map((lib) => (
                    <span
                      key={lib}
                      className="rounded bg-[#FF6B6B]/5 border border-[#FF6B6B]/25 px-2 py-0.5 text-[10px] font-medium text-[#FF6B6B]/90"
                    >
                      {lib}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          {poster.note && (
            <p className="mt-4 border-l-2 border-white/15 pl-3.5 italic text-sm text-white/65 leading-relaxed">
              &ldquo;{poster.note}&rdquo;
            </p>
          )}
        </div>
      </div>

      {sameFilm.length > 0 && (
        <section aria-label={`More interpretations of ${poster.title}`} className="mt-12">
          <h2 className="text-lg font-semibold font-heading">
            More interpretations of {poster.title}
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {sameFilm.slice(0, 4).map((p) => (
              <li key={p.id}>
                <Link
                  to="/poster/$id"
                  params={{ id: p.id }}
                  preload="intent"
                  className="group block overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E]"
                >
                  <span className="block w-full" style={{ aspectRatio: "2 / 3" }}>
                    <PosterImage
                      poster={p}
                      purpose="gallery"
                      alt={`${p.title} (${p.year}) by ${p.artist}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </span>
                  <span className="block truncate px-2 py-1.5 text-xs text-white/70">
                    by {p.artist}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {byArtist.length > 0 && (
        <section aria-label={`More posters by ${artist}`} className="mt-12">
          <h2 className="text-lg font-semibold font-heading">More by {artist}</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {byArtist.slice(0, 4).map((p) => (
              <li key={p.id}>
                <Link
                  to="/poster/$id"
                  params={{ id: p.id }}
                  preload="intent"
                  className="group block overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E]"
                >
                  <span className="block w-full" style={{ aspectRatio: "2 / 3" }}>
                    <PosterImage
                      poster={p}
                      purpose="gallery"
                      alt={`${p.title} (${p.year}) by ${p.artist}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </span>
                  <span className="block truncate px-2 py-1.5 text-xs text-white/70">
                    {p.title} ({p.year})
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
