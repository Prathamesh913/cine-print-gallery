import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { fetchNotionPosters } from "@/lib/notion";
import { pageHead, robotsMeta } from "@/lib/seo";
import { resolveFilmSlug } from "@/lib/films";
import { getPosterSeoImageUrl } from "@/lib/poster-images";
import { breadcrumbEntity, collectionPageEntity, withJsonLd } from "@/lib/structured-data";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { FilmArticle } from "../-components/film-article";

function filmCopy(group: { title: string; isShow: boolean }) {
  const kind = group.isShow ? "TV" : "Movie";
  const kindLower = group.isShow ? "tv" : "movie";
  return {
    heading: `Alternative Posters for ${group.title}`,
    title: `Alternative ${group.title} ${kind} Posters — CinePrint Gallery`,
    description: `Explore alternative ${group.title} ${kindLower} posters by independent artists — different interpretations of ${group.title}'s visual world.`,
  };
}

export const Route = createFileRoute("/film/$slug")({
  loader: async ({ params }) => {
    // Same catalogue path as poster/artist routes: one shared cached query,
    // no per-page Firestore reads and no second query for the same data.
    // Unknown or thin (fewer than MIN_FILM_POSTERS) slugs are genuine 404s.
    const posters = await fetchNotionPosters();
    const group = resolveFilmSlug(posters, params.slug);
    if (!group) {
      throw notFound();
    }
    return { group };
  },
  head: ({ loaderData }) => {
    const group = loaderData?.group;
    if (!group) {
      return {
        meta: [{ title: "Film Not Found — CinePrint" }, robotsMeta("noindex")],
      };
    }
    const copy = filmCopy(group);
    return withJsonLd(
      pageHead({
        path: `/film/${group.slug}`,
        title: copy.title,
        description: copy.description,
        image: getPosterSeoImageUrl(group.representative),
      }),
      [
        collectionPageEntity({
          slug: group.slug,
          name: copy.heading,
          description: copy.description,
          image: getPosterSeoImageUrl(group.representative),
          aboutType: group.isShow ? "TVSeries" : "Movie",
          aboutName: group.title,
        }),
        breadcrumbEntity([
          { name: "Home", url: "https://cineprint.click" },
          { name: group.title, url: `https://cineprint.click/film/${group.slug}` },
        ]),
      ],
    );
  },
  notFoundComponent: FilmNotFound,
  component: FilmDetailPage,
});

function FilmNotFound() {
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
          <h1 className="mt-2 text-2xl font-semibold font-heading">Film Not Found</h1>
          <p className="mt-2 text-sm text-white/60">
            This film collection doesn’t exist or doesn’t have enough posters yet.
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

function FilmDetailPage() {
  const { group } = Route.useLoaderData();
  const copy = filmCopy(group);
  const genres = Array.from(new Set(group.posters.flatMap((p) => p.genre ?? []))).sort();
  return (
    <div
      className="min-h-screen flex flex-col min-w-0 max-w-full overflow-x-clip"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} />
      <main className="flex-grow flex items-start justify-center">
        <FilmArticle
          title={group.title}
          year={group.year}
          isShow={group.isShow}
          genres={genres}
          description={copy.description}
          posters={group.posters}
        />
      </main>
      <Footer />
    </div>
  );
}
