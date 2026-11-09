import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { fetchNotionPosters } from "@/lib/notion";
import { pageHead, SITE_DEFAULT_IMAGE } from "@/lib/seo";
import { GENRE_DIMENSION, eligibleTaxonomy } from "@/lib/taxonomy";
import { getPosterSeoImageUrl } from "@/lib/poster-images";
import { breadcrumbEntity, webpageEntity, withJsonLd } from "@/lib/structured-data";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { TaxonomyDirectory } from "./-components/taxonomy-directory";

const TITLE = "Movie Genres — CinePrint Gallery";
const DESCRIPTION =
  "Browse the archive by cinematic genre — from horror to romance, explore how independent artists reinterpret every kind of film.";

export const Route = createFileRoute("/genres")({
  loader: async () => {
    // Same catalogue path as every other discovery route: one shared cached
    // query, no per-genre reads.
    const posters = await fetchNotionPosters();
    return { posters };
  },
  head: ({ loaderData }) => {
    const entries = eligibleTaxonomy(loaderData?.posters ?? [], GENRE_DIMENSION);
    const image = entries[0]
      ? getPosterSeoImageUrl(entries[0].representative)
      : SITE_DEFAULT_IMAGE;
    return withJsonLd(
      pageHead({ path: "/genres", title: TITLE, description: DESCRIPTION, image }),
      [
        webpageEntity("/genres", TITLE, DESCRIPTION),
        breadcrumbEntity([
          { name: "Home", url: "https://cineprint.click" },
          { name: "Genres", url: "https://cineprint.click/genres" },
        ]),
      ],
    );
  },
  component: GenresPage,
});

function GenresPage() {
  const { posters } = Route.useLoaderData();
  const entries = useMemo(() => eligibleTaxonomy(posters, GENRE_DIMENSION), [posters]);
  return (
    <div
      className="min-h-screen flex flex-col min-w-0 max-w-full overflow-x-clip"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} />
      <main className="flex-grow flex items-start justify-center">
        <TaxonomyDirectory
          eyebrow="Browse the archive"
          heading="Movie Genres"
          lede={DESCRIPTION}
          searchLabel="Search genres"
          searchPlaceholder="Try “Horror”…"
          emptyTitle="No genres yet"
          emptyBody="The archive doesn't have any genre collections to show right now."
          entries={entries}
          basePath="/genre"
        />
      </main>
      <Footer />
    </div>
  );
}
