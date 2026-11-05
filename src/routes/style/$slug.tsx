import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { fetchNotionPosters } from "@/lib/notion";
import { pageHead, robotsMeta } from "@/lib/seo";
import { STYLE_DIMENSION, resolveTaxonomySlug } from "@/lib/taxonomy";
import { getPosterImageUrl } from "@/lib/poster-images";
import { breadcrumbEntity, webpageEntity, withJsonLd } from "@/lib/structured-data";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { TaxonomyDetail } from "../-components/taxonomy-detail";

function styleCopy(
  name: string,
  count: number,
): { heading: string; title: string; description: string } {
  const heading = `Alternative ${name} Movie Posters`;
  return {
    heading,
    title: `${heading} — CinePrint Gallery`,
    description: `Browse ${count} alternative movie posters in the ${name} style from the CinePrint archive — every piece is an independent artist's take on cinema.`,
  };
}

export const Route = createFileRoute("/style/$slug")({
  loader: async ({ params }) => {
    const posters = await fetchNotionPosters();
    const group = resolveTaxonomySlug(posters, STYLE_DIMENSION, params.slug);
    if (!group) {
      throw notFound();
    }
    return { group };
  },
  head: ({ loaderData }) => {
    const group = loaderData?.group;
    if (!group) {
      return {
        meta: [{ title: "Style Not Found — CinePrint" }, robotsMeta("noindex")],
      };
    }
    const copy = styleCopy(group.name, group.posterIds.length);
    return withJsonLd(
      pageHead({
        path: `/style/${group.slug}`,
        title: copy.title,
        description: copy.description,
        image: getPosterImageUrl(group.representative, "detail"),
      }),
      [
        webpageEntity(`/style/${group.slug}`, copy.title, copy.description),
        breadcrumbEntity([
          { name: "Home", url: "https://cineprint.click" },
          { name: "Styles", url: "https://cineprint.click/styles" },
          { name: group.name, url: `https://cineprint.click/style/${group.slug}` },
        ]),
      ],
    );
  },
  notFoundComponent: StyleNotFound,
  component: StyleDetailPage,
});

function StyleNotFound() {
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
          <h1 className="mt-2 text-2xl font-semibold font-heading">Style Not Found</h1>
          <p className="mt-2 text-sm text-white/60">
            This visual style collection doesn’t exist or doesn’t have enough posters yet.
          </p>
          <Link
            to="/styles"
            preload="intent"
            className="mt-6 inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full bg-[#FF6B6B] px-5 text-sm font-semibold text-[#121212] transition hover:bg-[#FF8585]"
          >
            Browse styles
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function yearSpan(years: number[]): string | undefined {
  const known = years.filter((y) => y > 0);
  if (known.length === 0) return undefined;
  const min = Math.min(...known);
  const max = Math.max(...known);
  return min === max ? String(min) : `${min} – ${max}`;
}

function StyleDetailPage() {
  const { group } = Route.useLoaderData();
  const copy = styleCopy(group.name, group.posterIds.length);
  const span = yearSpan(group.posters.map((p) => p.year ?? 0));

  return (
    <div
      className="min-h-screen flex flex-col min-w-0 max-w-full overflow-x-clip"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} />
      <main className="flex-grow flex items-start justify-center">
        <TaxonomyDetail
          eyebrow="Visual style"
          heading={copy.heading}
          meta={[
            { label: "Posters", value: `${group.posterIds.length} posters` },
            ...(span ? [{ label: "Years", value: span }] : []),
          ]}
          description={copy.description}
          posters={group.posters}
          basePath="/style"
          title={group.name}
        />
      </main>
      <Footer />
    </div>
  );
}
