import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Film, Search } from "lucide-react";
import { Header } from "@/components/Header";
import { FilterBar } from "@/components/FilterBar";
import { PosterGrid } from "@/components/PosterGrid";
import { Lightbox } from "@/components/Lightbox";
import { Footer } from "@/components/Footer";
import { type Poster, type PosterStyle, type PosterGenre } from "@/lib/posters";
import { fetchNotionPosters } from "@/lib/notion";

export const Route = createFileRoute("/")({
  loader: () => fetchNotionPosters(),
  head: () => ({
    meta: [
      { title: "CinePrint — Alternative Movie & TV Posters" },
      { name: "description", content: "A curated gallery of fan-made alternative posters for films and TV." },
      { property: "og:title", content: "CinePrint" },
      { property: "og:description", content: "A curated gallery of fan-made alternative posters." },
    ],
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

function Home() {
  const posters = Route.useLoaderData();
  const [query, setQuery] = useState("");
  const dq = useDebounced(query, 300);
  const [style, setStyle] = useState<PosterStyle | "All">("All");
  const [genre, setGenre] = useState<PosterGenre | "All">("All");
  const [decade, setDecade] = useState<string | "All">("All");
  const [open, setOpen] = useState<Poster | null>(null);

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

  const [shuffledPosters, setShuffledPosters] = useState<Poster[]>(posters);

  useEffect(() => {
    if (posters.length === 0) return;
    const arr = [...posters];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    setShuffledPosters(arr);
  }, [posters]);

  const filtered = useMemo(() => {
    const q = dq.trim().toLowerCase();
    return shuffledPosters.filter((p) => {
      if (style !== "All" && p.style !== style) return false;
      if (genre !== "All" && !p.genre.includes(genre)) return false;
      if (decade !== "All") {
        const dec = Math.floor(p.year / 10) * 10;
        if (`${dec}s` !== decade) return false;
      }
      if (!q) return true;
      const hay = [p.title, p.artist, ...p.genre, ...p.tags, p.style].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [shuffledPosters, dq, style, genre, decade]);

  if (posters.length === 0) {
    return (
      <div className="min-h-screen flex flex-col justify-between" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
        <Header query={query} onQueryChange={setQuery} showSearch={false} />
        <main className="mx-auto max-w-[1600px] px-4 py-20 sm:px-6 flex-grow flex items-center justify-center">
          <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-xl backdrop-blur-md">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#FF6B6B]/10 text-[#FF6B6B] mb-4">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 style={{ fontFamily: "Poppins, sans-serif" }} className="text-xl font-semibold mb-2">No posters found</h2>
            <p className="text-white/60 text-sm mb-6">
              We couldn't load any posters from your Notion database. Make sure you have:
            </p>
            <ul className="text-left text-xs space-y-3 text-white/50 mb-2 max-w-xs mx-auto list-disc pl-5">
              <li>Configured <code className="bg-white/10 px-1 py-0.5 rounded text-white/80 font-mono">NOTION_KEY</code> and <code className="bg-white/10 px-1 py-0.5 rounded text-white/80 font-mono">NOTION_DATABASE_ID</code> in your <code className="bg-white/10 px-1 py-0.5 rounded">.env</code>.</li>
              <li>Shared your Notion database page with your Integration.</li>
              <li>Set at least one poster's Status select to <span className="text-[#FF6B6B] font-semibold">"Published"</span>.</li>
            </ul>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
      <Header query={query} onQueryChange={setQuery} showSearch={false} />
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        style={style}
        genre={genre}
        decade={decade}
        styles={styles}
        genres={genres}
        decades={decades}
        onStyle={setStyle}
        onGenre={setGenre}
        onDecade={setDecade}
      />
      <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 flex-grow flex flex-col justify-center">
        <h1 className="sr-only">CinePrint gallery</h1>
        {filtered.length === 0 ? (
          <div className="flex w-full min-h-[50vh] flex-col items-center justify-center py-12 text-center">
            <div className="relative mb-6 text-white/20 animate-pulse">
              <Film size={64} strokeWidth={1} />
              <div className="absolute -bottom-2 -right-2 text-[#FF6B6B]">
                <Search size={24} strokeWidth={2.5} />
              </div>
            </div>
            <h2 
              style={{ fontFamily: "Poppins, sans-serif" }} 
              className="text-2xl font-bold tracking-tight text-[#F5F5F5] mb-2"
            >
              Plot Twist: No Matches Found!
            </h2>
            <p className="max-w-md text-white/50 text-sm mb-8 leading-relaxed">
              We searched the entire archive but couldn't find any posters matching{" "}
              <span className="text-[#FF6B6B] font-semibold">
                {query ? `"${query}"` : "the selected filters"}
              </span>
              . Maybe it's in the director's cut, or we haven't printed it yet!
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="rounded-full bg-white/5 border border-white/10 px-5 py-2 text-sm font-medium text-[#F5F5F5] hover:bg-white/10 transition"
                >
                  Clear Search
                </button>
              )}
              {(style !== "All" || genre !== "All" || decade !== "All") && (
                <button
                  onClick={() => {
                    setStyle("All");
                    setGenre("All");
                    setDecade("All");
                  }}
                  className="rounded-full bg-[#FF6B6B] px-5 py-2 text-sm font-medium text-[#121212] hover:bg-[#FF8585] transition"
                >
                  Reset Filters
                </button>
              )}
            </div>
          </div>
        ) : (
          <PosterGrid posters={filtered} onOpen={setOpen} />
        )}
      </main>
      <Footer />
      <Lightbox poster={open} onClose={() => setOpen(null)} />
    </div>
  );
}
