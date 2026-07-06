import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { fetchNotionPosters } from "@/lib/notion";
import { type Poster } from "@/lib/posters";
import { Lightbox } from "@/components/Lightbox";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/poster/$id")({
  loader: async ({ params }) => {
    const posters = await fetchNotionPosters();
    const poster = posters.find((p) => p.id === params.id) || null;
    return { poster, posters };
  },
  head: ({ loaderData }) => {
    const poster = loaderData?.poster;
    if (!poster) {
      return {
        meta: [{ title: "Poster Not Found — CinePrint" }],
      };
    }
    return {
      meta: [
        { title: `${poster.title} by ${poster.artist} — CinePrint Gallery` },
        { name: "description", content: `Minimalist alternative movie poster for ${poster.title} (${poster.year}) by ${poster.artist}.` },
        { property: "og:title", content: `${poster.title} by ${poster.artist} — CinePrint` },
        { property: "og:description", content: `Alternative movie poster for ${poster.title}.` },
        { property: "og:image", content: poster.image },
        { property: "og:type", content: "website" },
      ],
    };
  },
  component: PosterDetailPage,
});

function PosterDetailPage() {
  const { poster, posters } = Route.useLoaderData();
  const navigate = useNavigate();

  const handleClose = () => {
    navigate({ to: "/" });
  };

  const handleNavigate = (nextPoster: Poster) => {
    navigate({ to: "/poster/$id", params: { id: nextPoster.id } });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
      <Header showSearch={false} />
      <main className="flex-grow flex items-center justify-center">
        <div className="text-center text-white/40 font-mono text-xs">
          Loading poster detail view...
        </div>
      </main>
      <Footer />
      <Lightbox
        poster={poster}
        posters={posters}
        onNavigate={handleNavigate}
        onClose={handleClose}
      />
    </div>
  );
}
