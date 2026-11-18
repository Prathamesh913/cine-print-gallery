import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Globe } from "lucide-react";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { FeaturedFan } from "@/components/FeaturedFan";
import { buildGlowBackground } from "@/lib/collection-hero";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

interface ArtistHeroProps {
  slug: string;
  artistName: string;
  artistUrl?: string;
  posters: Poster[];
}

export function ArtistHero({ slug, artistName, artistUrl, posters }: ArtistHeroProps) {
  /** Other artists credited across these posters — honest co-credit navigation only. */
  const coArtists = useMemo(() => {
    const seen = new Map<string, string>();
    for (const poster of posters) {
      for (const artist of poster.artists ?? []) {
        const name = artist.name.trim();
        const nameSlug = slugifyArtist(name);
        if (
          !name ||
          nameSlug === "unknown" ||
          nameSlug === slug ||
          name.toLowerCase() === "unknown"
        ) {
          continue;
        }
        if (!seen.has(nameSlug)) seen.set(nameSlug, name);
      }
    }
    return [...seen.entries()].map(([coSlug, name]) => ({ slug: coSlug, name }));
  }, [posters, slug]);

  /** "{n} posters · styles" where styles vary → top ≤3 by frequency, else the single style. */
  const metaSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const poster of posters) {
      const style = (poster.style ?? "").trim();
      if (!style) continue;
      counts.set(style, (counts.get(style) ?? 0) + 1);
    }
    if (counts.size === 0) return "";
    if (counts.size === 1) return [...counts.keys()][0];
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([style]) => style)
      .join(", ");
  }, [posters]);

  const glowBackground = useMemo(() => buildGlowBackground(posters), [posters]);

  return (
    <section className="relative">
      {/* Palette hero band — pure CSS from already-bundled palette data; zero network requests */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[220px] overflow-hidden rounded-b-3xl sm:h-[280px]"
      >
        <div className="absolute inset-0" style={{ background: glowBackground }} />
        {/* Scrim keeping the left text column dark for readability */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 42%, rgba(0,0,0,0) 78%)",
          }}
        />
        {/* Bottom fade melting into the page's pure-black background */}
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
              Artist Showcase
            </p>
            <h1 className="mt-3 break-words font-display text-5xl uppercase leading-none text-[#F5F5F5] sm:text-6xl lg:text-7xl">
              {artistName}
            </h1>

            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.25em] tabular-nums text-white/55">
              {posters.length} poster{posters.length !== 1 ? "s" : ""}
              {metaSummary ? ` · ${metaSummary}` : ""}
            </p>

            {artistUrl && (
              <div className="mt-6">
                <a
                  href={artistUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-5 text-sm text-[#F5F5F5] transition duration-150 ease-[var(--ease-out)] hover:border-white/25 hover:bg-white/10 active:scale-95 ${focusRing}`}
                >
                  <Globe size={14} />
                  <span>Visit Portfolio</span>
                </a>
              </div>
            )}

            {coArtists.length > 0 && (
              <div className="mt-7">
                <p className="font-mono text-[10px] uppercase tracking-widest text-white/55">
                  Frequently paired with
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {coArtists.map((coArtist) => (
                    <Link
                      key={coArtist.slug}
                      to="/artist/$slug"
                      params={{ slug: coArtist.slug }}
                      preload="intent"
                      className={`inline-flex min-h-11 items-center gap-2.5 rounded-full border border-white/15 bg-white/5 px-4 text-sm text-[#F5F5F5] transition duration-150 ease-[var(--ease-out)] hover:border-white/25 hover:bg-white/10 ${focusRing}`}
                    >
                      <span
                        aria-hidden
                        className="font-display text-base leading-none text-[#FF6B6B]"
                      >
                        {coArtist.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="max-w-36 truncate">{coArtist.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          <FeaturedFan posters={posters} />
        </div>
      </div>
    </section>
  );
}
