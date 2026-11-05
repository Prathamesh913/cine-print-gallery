import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { fetchNotionPosters } from "@/lib/notion";
import { loadPosterRoute, posterHeadMeta } from "@/lib/seo";
import { filmGroupForPoster } from "@/lib/films";
import { posterPageEntities, withJsonLd } from "@/lib/structured-data";
import { type Poster } from "@/lib/posters";
import { Lightbox } from "@/components/Lightbox";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PosterArticle } from "../-components/poster-article";

export const Route = createFileRoute("/poster/$id")({
  loader: async ({ params }) => {
    // Catalogue load failures (Firebase/network) reject here and surface via
    // the error boundary — they must never be mistaken for a missing poster.
    const resolution = await loadPosterRoute(fetchNotionPosters, params.id);
    if (resolution.status === "not-found") {
      throw notFound();
    }
    return resolution;
  },
  head: ({ loaderData }) => {
    const poster = loaderData?.poster ?? null;
    if (!poster) return posterHeadMeta(null);
    const film = loaderData ? filmGroupForPoster(loaderData.posters, poster.id) : null;
    return withJsonLd(
      posterHeadMeta(poster),
      posterPageEntities(poster, film ? { slug: film.slug, title: poster.title } : null),
    );
  },
  notFoundComponent: PosterNotFound,
  component: PosterDetailPage,
});

function PosterNotFound() {
  return (
    <div
      className="min-h-screen flex flex-col min-w-0 max-w-full overflow-x-clip"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} />
      <main className="flex-grow flex items-center justify-center px-6 py-16">
        <div className="text-center">
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/55 sm:text-xs">
            Missing reel
          </p>
          <h1 className="mt-2 text-2xl font-semibold font-heading">Poster Not Found</h1>
          <p className="mt-2 text-sm text-white/60">
            This poster doesn’t exist or was removed from the gallery.
          </p>
          <Link
            to="/"
            preload="intent"
            className="mt-6 inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full bg-[#FF6B6B] px-5 text-sm font-semibold text-[#121212] transition hover:bg-[#FF8585]"
          >
            Back to gallery
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}

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
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} />
      <main className="flex-grow flex items-start justify-center">
        <PosterArticle poster={poster} posters={posters} />
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
