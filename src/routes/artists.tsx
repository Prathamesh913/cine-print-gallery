import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { fetchNotionPosters } from "@/lib/notion";
import { pageHead, SITE_DEFAULT_IMAGE } from "@/lib/seo";
import { buildArtistDirectory } from "@/lib/artists";
import { getPosterSeoImageUrl } from "@/lib/poster-images";
import { breadcrumbEntity, webpageEntity, withJsonLd } from "@/lib/structured-data";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ArtistsDirectory } from "./-components/artists-directory";

const TITLE = "Poster Artists — CinePrint Gallery";
const DESCRIPTION =
  "Discover the independent artists behind CinePrint's alternative movie posters — explore every artist's posters in one place.";

export const Route = createFileRoute("/artists")({
  loader: async () => {
    // Same catalogue path as every other discovery route: one shared cached
    // query, no per-artist Firestore reads.
    const posters = await fetchNotionPosters();
    return { posters };
  },
  head: ({ loaderData }) => {
    const entries = buildArtistDirectory(loaderData?.posters ?? []);
    const image = entries[0]
      ? getPosterSeoImageUrl(entries[0].representative)
      : SITE_DEFAULT_IMAGE;
    return withJsonLd(
      pageHead({ path: "/artists", title: TITLE, description: DESCRIPTION, image }),
      [
        webpageEntity("/artists", TITLE, DESCRIPTION),
        breadcrumbEntity([
          { name: "Home", url: "https://cineprint.click" },
          { name: "Artists", url: "https://cineprint.click/artists" },
        ]),
      ],
    );
  },
  component: ArtistsPage,
});

function ArtistsPage() {
  const { posters } = Route.useLoaderData();
  const entries = useMemo(() => buildArtistDirectory(posters), [posters]);
  return (
    <div
      className="min-h-screen flex flex-col min-w-0 max-w-full overflow-x-clip"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} />
      <main className="flex-grow flex items-start justify-center">
        <ArtistsDirectory entries={entries} />
      </main>
      <Footer />
    </div>
  );
}
