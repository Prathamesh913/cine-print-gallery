import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { Header } from "@/components/Header";
import { PosterGrid } from "@/components/PosterGrid";
import { Lightbox } from "@/components/Lightbox";
import { Footer } from "@/components/Footer";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { fetchNotionPosters } from "@/lib/notion";
import { Globe, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/artist/$slug")({
  loader: async ({ params }) => {
    const posters = await fetchNotionPosters();
    return {
      posters,
      slug: params.slug,
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Artist Showcase — CinePrint Gallery" },
          { name: "description", content: "Explore the alternative movie posters and minimalist film art on CinePrint." },
        ],
      };
    }
    const { posters, slug } = loaderData;
    const matchingPoster = posters.find((p: Poster) => {
      const names = p.artists && p.artists.length > 0
        ? p.artists.map((a) => a.name)
        : [p.artist];
      return names.some((n: string) => slugifyArtist(n) === slug);
    });
    const artistName = matchingPoster
      ? (matchingPoster.artists?.find((a) => slugifyArtist(a.name) === slug)?.name || matchingPoster.artist)
      : "Artist";

    return {
      meta: [
        { title: `${artistName} — CinePrint Gallery` },
        { name: "description", content: `Explore the alternative movie posters and minimalist film art curated for ${artistName} on CinePrint.` },
      ],
    };
  },
  component: ArtistPage,
});

function ArtistPage() {
  const { posters: allPosters = [], slug = "" } = Route.useLoaderData() || {};
  const navigate = useNavigate();

  const handleOpen = (p: Poster) => {
    navigate({ to: "/poster/$id", params: { id: p.id } });
  };

  const { artistName, artistUrl, artistPosters } = useMemo(() => {
    const filtered = allPosters.filter((p) => {
      const names = p.artists && p.artists.length > 0
        ? p.artists.map((a) => a.name)
        : [p.artist];
      return names.some((n) => slugifyArtist(n) === slug);
    });

    let name = "Artist";
    let url: string | undefined = undefined;

    if (filtered.length > 0) {
      const first = filtered[0];
      if (first.artists && first.artists.length > 0) {
        const found = first.artists.find((a) => slugifyArtist(a.name) === slug);
        if (found) {
          name = found.name;
          url = found.url;
        }
      } else if (slugifyArtist(first.artist) === slug) {
        name = first.artist;
        url = first.artistUrl;
      }
    }

    return {
      artistName: name,
      artistUrl: url,
      artistPosters: filtered,
    };
  }, [allPosters, slug]);

  const handleFeelingLucky = () => {
    if (artistPosters.length === 0) return;
    const randomIndex = Math.floor(Math.random() * artistPosters.length);
    handleOpen(artistPosters[randomIndex]);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
      <Header showSearch={false} onFeelingLucky={handleFeelingLucky} />

      <main className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 flex-grow flex flex-col justify-center">
        {/* Back Link */}
        <div className="mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 font-mono text-[10px] sm:text-xs tracking-widest text-white/50 uppercase hover:text-[#FF6B6B] transition-colors"
          >
            <ArrowLeft size={12} />
            <span>Back to Gallery</span>
          </Link>
        </div>

        {/* Artist Header Info */}
        <div className="mb-8 border-b border-white/5 pb-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <span style={{ fontFamily: "Bebas Neue, sans-serif", color: "#FF6B6B" }} className="text-xs tracking-[0.2em] uppercase">
                ARTIST SHOWCASE
              </span>
              <h1 style={{ fontFamily: "Poppins, sans-serif" }} className="text-3xl font-semibold tracking-tight text-[#F5F5F5] mt-1">
                {artistName}
              </h1>
            </div>

            {artistUrl && (
              <a
                href={artistUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 self-start md:self-auto rounded-full bg-white/5 border border-white/10 px-4 py-2 text-xs font-medium text-white/70 hover:bg-[#FF6B6B] hover:text-[#121212] transition"
              >
                <Globe size={14} />
                <span>Visit Portfolio</span>
              </a>
            )}
          </div>

          <div className="mt-6 text-[10px] sm:text-xs tracking-widest font-mono text-white/40 uppercase">
            Showing {artistPosters.length} poster{artistPosters.length !== 1 && "s"}
          </div>
        </div>

        {/* Poster Grid */}
        {artistPosters.length === 0 ? (
          <div className="flex w-full min-h-[40vh] flex-col items-center justify-center py-12 text-center">
            <h2 style={{ fontFamily: "Poppins, sans-serif" }} className="text-xl font-semibold mb-2">No Posters Found</h2>
            <p className="text-white/50 text-sm">We couldn't find any posters for this artist.</p>
          </div>
        ) : (
          <PosterGrid posters={artistPosters} onOpen={handleOpen} />
        )}
      </main>

      <Footer />
    </div>
  );
}
