import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { Clapperboard } from "lucide-react";
import { Header } from "@/components/Header";
import { PosterGrid } from "@/components/PosterGrid";
import { GalleryErrorBoundary } from "@/components/GalleryErrorBoundary";
import { Footer } from "@/components/Footer";
import { EmptyState } from "@/components/states";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { fetchNotionPosters } from "@/lib/notion";
import { artistHeadMeta } from "@/lib/seo";
import { artistPageEntities, withJsonLd } from "@/lib/structured-data";
import { ArtistHero } from "@/routes/-components/artist-hero";
import { ArtistBreadcrumb } from "@/routes/-components/artist-breadcrumb";

const primaryPill =
  "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full bg-[#FF6B6B] px-5 text-sm font-semibold text-[#121212] shadow-md shadow-[#FF6B6B]/15 transition duration-150 ease-[var(--ease-out)] hover:bg-[#FF8585] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

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
          {
            name: "description",
            content: "Explore the alternative movie posters and minimalist film art on CinePrint.",
          },
        ],
      };
    }
    return withJsonLd(
      artistHeadMeta(loaderData.posters, loaderData.slug),
      artistPageEntities(loaderData.posters, loaderData.slug),
    );
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
      const names = p.artists && p.artists.length > 0 ? p.artists.map((a) => a.name) : [p.artist];
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
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} onFeelingLucky={handleFeelingLucky} />

      <main className="flex-grow flex flex-col">
        <div className="page-shell w-full max-w-6xl pt-10">
          <ArtistBreadcrumb slug={slug} name={artistName} />
        </div>
        <ArtistHero
          slug={slug}
          artistName={artistName}
          artistUrl={artistUrl}
          posters={artistPosters}
        />

        {/* Poster Grid */}
        <div className="page-shell flex-grow pb-16">
          {artistPosters.length === 0 ? (
            <EmptyState
              icon={Clapperboard}
              title="No Posters Found"
              body="We couldn't find any posters for this artist."
            >
              <Link to="/" preload="intent" className={primaryPill}>
                Browse the Archive
              </Link>
            </EmptyState>
          ) : (
            <GalleryErrorBoundary>
              <PosterGrid posters={artistPosters} />
            </GalleryErrorBoundary>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
