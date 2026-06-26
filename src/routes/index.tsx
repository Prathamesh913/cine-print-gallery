import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Header } from "@/components/Header";
import { FilterBar } from "@/components/FilterBar";
import { PosterGrid } from "@/components/PosterGrid";
import { Lightbox } from "@/components/Lightbox";
import { Footer } from "@/components/Footer";
import { POSTERS, type Poster, type PosterStyle, type PosterGenre } from "@/lib/posters";

export const Route = createFileRoute("/")({
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
  const [query, setQuery] = useState("");
  const dq = useDebounced(query, 300);
  const [style, setStyle] = useState<PosterStyle | "All">("All");
  const [genre, setGenre] = useState<PosterGenre | "All">("All");
  const [open, setOpen] = useState<Poster | null>(null);

  const filtered = useMemo(() => {
    const q = dq.trim().toLowerCase();
    return POSTERS.filter((p) => {
      if (style !== "All" && p.style !== style) return false;
      if (genre !== "All" && !p.genre.includes(genre)) return false;
      if (!q) return true;
      const hay = [p.title, p.artist, ...p.genre, ...p.tags, p.style].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [dq, style, genre]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
      <Header query={query} onQueryChange={setQuery} />
      <FilterBar style={style} genre={genre} onStyle={setStyle} onGenre={setGenre} />
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        <h1 className="sr-only">CinePrint gallery</h1>
        <PosterGrid posters={filtered} onOpen={setOpen} />
      </main>
      <Footer />
      <Lightbox poster={open} onClose={() => setOpen(null)} />
    </div>
  );
}
