import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Header } from "@/components/Header";
import { PosterGrid } from "@/components/PosterGrid";
import { Lightbox } from "@/components/Lightbox";
import { Footer } from "@/components/Footer";
import { type Poster } from "@/lib/posters";
import { fetchNotionPosters } from "@/lib/notion";
import { useSaved } from "@/lib/saved";

export const Route = createFileRoute("/saved")({
  loader: () => fetchNotionPosters(),
  head: () => ({
    meta: [
      { title: "Saved — CinePrint" },
      { name: "description", content: "Posters you've pinned on CinePrint." },
    ],
  }),
  component: SavedPage,
});

function SavedPage() {
  const postersList = Route.useLoaderData();
  const { saved } = useSaved();
  const [open, setOpen] = useState<Poster | null>(null);
  const posters = useMemo(() => postersList.filter((p) => saved.includes(p.id)), [postersList, saved]);

  const handleFeelingLucky = () => {
    if (posters.length === 0) return;
    const randomIndex = Math.floor(Math.random() * posters.length);
    setOpen(posters[randomIndex]);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
      <Header showSearch={false} onFeelingLucky={handleFeelingLucky} />
      <main className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">
        <h1 style={{ fontFamily: "Poppins, sans-serif" }} className="mb-6 text-2xl font-semibold">
          Pinned
        </h1>
        {posters.length > 0 && (
          <div className="mb-6 text-[10px] sm:text-xs tracking-widest font-mono text-white/40 uppercase">
            Showing {posters.length} poster{posters.length !== 1 && "s"}
          </div>
        )}
        {posters.length === 0 ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
            <p className="text-white/60">Nothing pinned yet. Start discovering posters you love.</p>
            <Link to="/" className="rounded-full border border-white/15 px-4 py-2 text-sm hover:border-[#FF6B6B] hover:text-[#FF6B6B]">
              Browse the gallery
            </Link>
          </div>
        ) : (
          <PosterGrid posters={posters} onOpen={setOpen} />
        )}
      </main>
      <Footer />
      <Lightbox poster={open} posters={posters} onNavigate={setOpen} onClose={() => setOpen(null)} />
    </div>
  );
}
