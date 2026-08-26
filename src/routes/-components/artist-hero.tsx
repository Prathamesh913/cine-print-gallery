import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Globe } from "lucide-react";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { PosterImage } from "@/components/PosterImage";
import posterPalettesRaw from "@/lib/poster-palettes.json";

/** Typed representation of the prebuilt palette data — mirrors constellation.tsx. */
const posterPalettes = posterPalettesRaw as Record<
  string,
  { palette: string[]; primary: string; hsl: { h: number; s: number; l: number } }
>;

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

/** Fallback tint when a poster id is missing from the build-time palette data. */
const FALLBACK_PRIMARY = { hex: "#FF6B6B", rgb: [255, 107, 107] as const };

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    const [r, g, b] = FALLBACK_PRIMARY.rgb;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * Collect up to 4 distinct primary hexes from the artist's posters' palette
 * entries — deduped case-insensitive, ordered by frequency then saturation.
 * Falls back to the brand accent so the hero never renders empty/broken.
 */
function collectPrimaries(posters: Poster[]): string[] {
  const seen = new Map<string, { hex: string; count: number; sat: number }>();

  for (const poster of posters) {
    const entry = posterPalettes[poster.id];
    if (!entry?.primary) continue;
    const key = entry.primary.toLowerCase();
    const found = seen.get(key);
    if (found) {
      found.count += 1;
      // Keep the most saturated variant seen for tie-breaking.
      if ((entry.hsl?.s ?? 0) > found.sat) found.sat = entry.hsl.s;
    } else {
      seen.set(key, { hex: entry.primary.toUpperCase(), count: 1, sat: entry.hsl?.s ?? 0 });
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.count - a.count || b.sat - a.sat)
    .slice(0, 4)
    .map((entry) => entry.hex);
}

/**
 * Static decorative CSS: one radial-gradient per primary at low alpha on black.
 * The heaviest glow sits top-right / far right so left-aligned text keeps an AA
 * dark backdrop (reinforced by the horizontal scrim layer).
 */
function buildGlowBackground(colors: string[]): string {
  const spots = ["82% 20%", "60% 85%", "98% 65%", "40% 0%"];
  const alphas = [0.28, 0.18, 0.14, 0.1];

  return colors
    .map((hex, i) => {
      const rx = `${34 + i * 8}rem`;
      const ry = `${22 + i * 5}rem`;
      return `radial-gradient(${rx} ${ry} at ${spots[i % spots.length]}, ${hexToRgba(
        hex,
        alphas[i] ?? 0.08,
      )} 0%, transparent 68%)`;
    })
    .join(", ");
}

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

  const coverPosters = posters.slice(0, 3);
  const showCovers = posters.length >= 2 && coverPosters.length >= 2;

  const glowBackground = useMemo(() => buildGlowBackground(collectPrimaries(posters)), [posters]);

  // Fan layout: [-6°, 0°, +6°]; with only two covers use the outer rotations.
  const fanLayouts =
    coverPosters.length === 2
      ? [
          { rotate: "-rotate-6", height: "h-40", extra: "" },
          { rotate: "rotate-6", height: "h-40", extra: "-ml-10" },
        ]
      : [
          { rotate: "-rotate-6", height: "h-40", extra: "" },
          { rotate: "", height: "h-44", extra: "-mx-7 z-10" },
          { rotate: "rotate-6", height: "h-40", extra: "-ml-10" },
        ];

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

          {/* Featured covers fan — decorative duplicates of grid artwork, desktop only */}
          {showCovers && (
            <div aria-hidden className="hidden shrink-0 items-center py-2 pr-2 sm:flex">
              {coverPosters.map((poster, i) => (
                <PosterImage
                  key={poster.id}
                  poster={poster}
                  purpose="gallery"
                  loading="lazy"
                  alt=""
                  decoding="async"
                  className={`relative rounded-lg border border-white/15 object-cover shadow-xl aspect-[2/3] w-auto ${fanLayouts[i].height} ${fanLayouts[i].rotate} ${fanLayouts[i].extra}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
