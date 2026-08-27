import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Clapperboard, SearchX } from "lucide-react";
import { Header } from "@/components/Header";
import { FilterBar } from "@/components/FilterBar";
import { PosterGrid } from "@/components/PosterGrid";
import { GalleryErrorBoundary } from "@/components/GalleryErrorBoundary";
import { EmptyState } from "@/components/states";
import { Footer } from "@/components/Footer";
import { type Poster, type PosterStyle, type PosterGenre } from "@/lib/posters";
import { fetchNotionPosters } from "@/lib/notion";
import { DailySpotlight, ArtistRail, type RailArtist } from "./-components/home-discovery";

/**
 * Deterministic, dependency-free PRNG plumbing backing the homepage "daily cut".
 * Everything derives from the UTC date string (identical on server and client
 * within a given day), so SSR output and client hydration always agree — no
 * Math.random() ever enters the render path.
 */

/** FNV-1a 32-bit string hash → unsigned int seed. */
function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 LCG — tiny, fast, deterministic per seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UTC calendar date (YYYY-MM-DD) — the shared seed key for the day. */
function getUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Non-mutating Fisher–Yates driven by the supplied rand. */
function deterministicShuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const Route = createFileRoute("/")({
  // Ordering happens here — deterministic per UTC date — so SSR and client
  // hydration render the identical "daily cut" with no post-hydration reflow.
  loader: async () => {
    const list = await fetchNotionPosters();
    return {
      posters: deterministicShuffle(list, mulberry32(hashString(getUtcDateString()))),
    };
  },
  head: () => ({
    meta: [
      { property: "og:url", content: "https://cineprint.click/" },
      { property: "og:image", content: "https://cineprint.click/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content: "CinePrint curated alternative movie and TV poster gallery",
      },
      { name: "twitter:title", content: "CinePrint — Alternative Movie & TV Posters Gallery" },
      {
        name: "twitter:description",
        content: "Curated gallery of custom alternative movie posters and minimalist film art.",
      },
      { name: "twitter:image", content: "https://cineprint.click/og-image.png" },
      {
        name: "twitter:image:alt",
        content: "CinePrint curated alternative movie and TV poster gallery",
      },
    ],
    links: [{ rel: "canonical", href: "https://cineprint.click/" }],
  }),
  component: Home,
});

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Minimum catalog size for the discovery chrome (spotlight + rail) to earn its place. */
const DISCOVERY_MIN_POSTERS = 8;

function Home() {
  const { posters } = Route.useLoaderData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const dq = useDebounced(query, 300);
  const [style, setStyle] = useState<PosterStyle | "All">("All");
  const [genre, setGenre] = useState<PosterGenre | "All">("All");
  const [decade, setDecade] = useState<string | "All">("All");
  const [artist, setArtist] = useState<string | "All">("All");

  const handleOpen = (p: Poster) => {
    navigate({ to: "/poster/$id", params: { id: p.id } });
  };

  const styles = useMemo(() => {
    const s = new Set<string>();
    posters.forEach((p) => p.style && s.add(p.style));
    return Array.from(s).sort();
  }, [posters]);

  const genres = useMemo(() => {
    const g = new Set<string>();
    posters.forEach((p) => p.genre.forEach((x) => g.add(x)));
    return Array.from(g).sort();
  }, [posters]);

  const decades = useMemo(() => {
    const decs = new Set<string>();
    posters.forEach((p) => {
      if (p.year) {
        const dec = Math.floor(p.year / 10) * 10;
        decs.add(`${dec}s`);
      }
    });
    return Array.from(decs).sort();
  }, [posters]);

  const artistCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (name?: string | null) => {
      if (!name || name === "Unknown") return;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    };
    posters.forEach((p) => {
      if (p.artists && p.artists.length > 0) {
        p.artists.forEach((a) => bump(a.name));
      } else if (p.artist) {
        bump(p.artist);
      }
    });
    return counts;
  }, [posters]);

  const artists = useMemo(() => Array.from(artistCounts.keys()).sort(), [artistCounts]);

  // Same seed as the loader's shuffle: index straight into the daily cut.
  const featured = useMemo(() => {
    if (posters.length < DISCOVERY_MIN_POSTERS) return null;
    const dayIndex = hashString(getUtcDateString()) % posters.length;
    return posters[dayIndex];
  }, [posters]);

  const railArtists = useMemo<RailArtist[]>(() => {
    // Group covers per artist for poster-as-identity cards.
    const groups = new Map<string, Poster[]>();
    for (const poster of posters) {
      const names =
        poster.artists && poster.artists.length > 0
          ? poster.artists.map((a) => a.name)
          : [poster.artist];
      for (const raw of names) {
        const name = (raw ?? "").trim();
        if (!name || name.toLowerCase() === "unknown") continue;
        if (!groups.has(name)) groups.set(name, []);
        const arr = groups.get(name)!;
        if (arr.length < 3) arr.push(poster);
      }
    }
    return Array.from(artistCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({ name, count, covers: groups.get(name) ?? [] }));
  }, [posters, artistCounts]);

  const filtered = useMemo(() => {
    const q = dq.trim().toLowerCase();
    return posters.filter((p) => {
      if (style !== "All" && p.style !== style) return false;
      if (genre !== "All" && !p.genre.includes(genre)) return false;
      if (decade !== "All") {
        const dec = Math.floor(p.year / 10) * 10;
        if (`${dec}s` !== decade) return false;
      }
      if (artist !== "All") {
        const hasArtist =
          p.artists && p.artists.length > 0
            ? p.artists.some((a) => a.name === artist)
            : p.artist === artist;
        if (!hasArtist) return false;
      }
      if (!q) return true;
      const hay = [p.title, p.artist, ...p.genre, ...p.tags, p.style].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [posters, dq, style, genre, decade, artist]);

  // Discovery modules are chrome for browsing — hide while search/filters drive results.
  const filtersActive = style !== "All" || genre !== "All" || decade !== "All" || artist !== "All";
  const anyFilterActive = filtersActive || dq.trim() !== "";
  const showDiscovery = !anyFilterActive;

  // Genuine empty catalog only — infrastructure failures throw PosterFetchError
  // from the loader and surface via the route error boundary instead.
  if (posters.length === 0) {
    return (
      <div
        className="min-h-screen flex flex-col justify-between"
        style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
      >
        <Header query={query} onQueryChange={setQuery} showSearch={false} />
        <main className="page-shell py-20 flex-grow flex items-center justify-center">
          <EmptyState
            icon={Clapperboard}
            title="No posters found"
            body="The gallery loaded successfully, but there are no published posters yet."
          >
            <ul className="w-full max-w-xs list-disc space-y-3 pl-5 text-left text-xs text-white/65">
              <li>
                Set at least one poster's Status to{" "}
                <span className="text-[#FF6B6B] font-semibold">"Published"</span>.
              </li>
              <li>Confirm the poster has an image URL.</li>
            </ul>
          </EmptyState>
        </main>
        <Footer />
      </div>
    );
  }

  const handleFeelingLucky = () => {
    if (filtered.length === 0) return;
    const randomIndex = Math.floor(Math.random() * filtered.length);
    handleOpen(filtered[randomIndex]);
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header
        query={query}
        onQueryChange={setQuery}
        showSearch={false}
        onFeelingLucky={handleFeelingLucky}
      />
      {featured && showDiscovery && (
        <DailySpotlight
          poster={featured}
          totalPosters={posters.length}
          totalArtists={artistCounts.size}
        />
      )}
      {railArtists.length >= 4 && showDiscovery && (
        <div id="artists" className="page-shell scroll-mt-24 pt-8 pb-2">
          <ArtistRail artists={railArtists} />
        </div>
      )}
      <div className="page-shell pb-3 pt-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/55">
          The Archive · Browse
        </p>
        <h2 className="mt-1 font-heading text-xl font-semibold">Explore the full collection</h2>
      </div>
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        style={style}
        genre={genre}
        decade={decade}
        artist={artist}
        styles={styles}
        genres={genres}
        decades={decades}
        artists={artists}
        onStyle={setStyle}
        onGenre={setGenre}
        onDecade={setDecade}
        onArtist={setArtist}
      />
      <main className="page-shell w-full py-6 flex-grow flex flex-col justify-center">
        <p className="sr-only">CinePrint — Curated Alternative Movie & TV Posters Gallery</p>
        {filtered.length > 0 && (
          <div className="mb-6 text-[10px] sm:text-xs tracking-widest font-mono text-white/55 uppercase tabular-nums">
            Showing {filtered.length} poster{filtered.length !== 1 && "s"}
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="flex w-full min-h-[50vh] items-center justify-center py-12">
            <EmptyState icon={SearchX} title="Plot Twist: No Matches Found!">
              <p className="w-full max-w-md text-sm leading-relaxed text-white/65">
                We searched the entire archive but couldn't find any posters matching{" "}
                <span className="text-[#FF6B6B] font-semibold">
                  {query ? `"${query}"` : "the selected filters"}
                </span>
                . Maybe it's in the director's cut, or we haven't printed it yet!
              </p>
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm font-medium text-[#F5F5F5] transition-all duration-150 hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]"
                >
                  Clear Search
                </button>
              )}
              {(style !== "All" || genre !== "All" || decade !== "All" || artist !== "All") && (
                <button
                  onClick={() => {
                    setStyle("All");
                    setGenre("All");
                    setDecade("All");
                    setArtist("All");
                  }}
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF6B6B] px-5 py-2 text-sm font-medium text-[#121212] transition-all duration-150 hover:bg-[#FF8585] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]"
                >
                  Reset Filters
                </button>
              )}
            </EmptyState>
          </div>
        ) : (
          <GalleryErrorBoundary>
            <PosterGrid posters={filtered} onOpen={handleOpen} />
          </GalleryErrorBoundary>
        )}
      </main>
      <Footer />
    </div>
  );
}
