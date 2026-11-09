import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { fetchNotionPosters } from "@/lib/notion";
import { pageHead, SITE_DEFAULT_IMAGE } from "@/lib/seo";
import { STYLE_DIMENSION, eligibleTaxonomy } from "@/lib/taxonomy";
import { getPosterSeoImageUrl } from "@/lib/poster-images";
import { breadcrumbEntity, webpageEntity, withJsonLd } from "@/lib/structured-data";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { TaxonomyDirectory } from "./-components/taxonomy-directory";

const TITLE = "Poster Styles — CinePrint Gallery";
const DESCRIPTION =
  "Browse the archive by visual style — explore how independent artists reimagine film art, from minimalist compositions to vintage illustration.";

export const Route = createFileRoute("/styles")({
  loader: async () => {
    const posters = await fetchNotionPosters();
    return { posters };
  },
  head: ({ loaderData }) => {
    const entries = eligibleTaxonomy(loaderData?.posters ?? [], STYLE_DIMENSION);
    const image = entries[0]
      ? getPosterSeoImageUrl(entries[0].representative)
      : SITE_DEFAULT_IMAGE;
    return withJsonLd(
      pageHead({ path: "/styles", title: TITLE, description: DESCRIPTION, image }),
      [
        webpageEntity("/styles", TITLE, DESCRIPTION),
        breadcrumbEntity([
          { name: "Home", url: "https://cineprint.click" },
          { name: "Styles", url: "https://cineprint.click/styles" },
        ]),
      ],
    );
  },
  component: StylesPage,
});

function StylesPage() {
  const { posters } = Route.useLoaderData();
  const entries = useMemo(() => eligibleTaxonomy(posters, STYLE_DIMENSION), [posters]);
  return (
    <div
      className="min-h-screen flex flex-col min-w-0 max-w-full overflow-x-clip"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} />
      <main className="flex-grow flex items-start justify-center">
        <TaxonomyDirectory
          eyebrow="Browse the archive"
          heading="Poster Styles"
          lede={DESCRIPTION}
          searchLabel="Search styles"
          searchPlaceholder="Try “Minimalist”…"
          emptyTitle="No styles yet"
          emptyBody="The archive doesn't have any style collections to show right now."
          entries={entries}
          basePath="/style"
        />
      </main>
      <Footer />
    </div>
  );
}
