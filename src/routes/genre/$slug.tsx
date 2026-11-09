import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo } from "react";
import { fetchNotionPosters } from "@/lib/notion";
import { pageHead, robotsMeta } from "@/lib/seo";
import { GENRE_DIMENSION, resolveTaxonomySlug, type TaxonomyEntry } from "@/lib/taxonomy";
import { buildFilmGroups, MIN_FILM_POSTERS } from "@/lib/films";
import type { Poster } from "@/lib/posters";
import { getPosterSeoImageUrl } from "@/lib/poster-images";
import { breadcrumbEntity, webpageEntity, withJsonLd } from "@/lib/structured-data";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { TaxonomyDetail, type RelatedFilm } from "../-components/taxonomy-detail";

function relatedFilms(
  group: { posterIds: string[] },
  posters: Poster[],
): Array<{ name: string; slug: string | null; count: number }> {
  const ids = new Set(group.posterIds);
  return buildFilmGroups(posters)
    .map((film) => {
      const count = film.posterIds.filter((id) => ids.has(id)).length;
      return { film, count };
    })
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count || (a.film.title < b.film.title ? -1 : 1))
    .slice(0, 6)
    .map(({ film, count }) => ({
      name: film.title,
      slug: count >= MIN_FILM_POSTERS ? film.slug : null,
      count,
    }));
}

function genreCopy(
  group: TaxonomyEntry<Poster>,
  posters: Poster[],
): { heading: string; title: string; description: string } {
  const heading = `Alternative ${group.name} Movie Posters`;
  const names = relatedFilms(group, posters)
    .map((f) => f.name)
    .slice(0, 3);
  const filmsPart =
    names.length === 0
      ? ""
      : names.length === 1
        ? `, featuring a different interpretation of ${names[0]}`
        : `, featuring different interpretations of ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    heading,
    title: `${heading} — CinePrint Gallery`,
    description: `Explore ${group.posterIds.length} alternative ${group.name} movie posters by independent artists${filmsPart} in the CinePrint archive.`,
  };
}

export const Route = createFileRoute("/genre/$slug")({
  loader: async ({ params }) => {
    // Same catalogue path as every other discovery route: one shared cached
    // query, no per-genre Firestore reads. Unknown or thin categories are
    // genuine 404s, consistent with M0/M4/M7.
    const posters = await fetchNotionPosters();
    const group = resolveTaxonomySlug(posters, GENRE_DIMENSION, params.slug);
    if (!group) {
      throw notFound();
    }
    return { group, posters };
  },
  head: ({ loaderData }) => {
    const group = loaderData?.group;
    if (!group) {
      return {
        meta: [{ title: "Genre Not Found — CinePrint" }, robotsMeta("noindex")],
      };
    }
    const copy = genreCopy(group, loaderData.posters);
    return withJsonLd(
      pageHead({
        path: `/genre/${group.slug}`,
        title: copy.title,
        description: copy.description,
        image: getPosterSeoImageUrl(group.representative),
      }),
      [
        webpageEntity(`/genre/${group.slug}`, copy.title, copy.description),
        breadcrumbEntity([
          { name: "Home", url: "https://cineprint.click" },
          { name: "Genres", url: "https://cineprint.click/genres" },
          { name: group.name, url: `https://cineprint.click/genre/${group.slug}` },
        ]),
      ],
    );
  },
  notFoundComponent: GenreNotFound,
  component: GenreDetailPage,
});

function GenreNotFound() {
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
          <h1 className="mt-2 text-2xl font-semibold font-heading">Genre Not Found</h1>
          <p className="mt-2 text-sm text-white/60">
            This genre collection doesn’t exist or doesn’t have enough posters yet.
          </p>
          <Link
            to="/genres"
            preload="intent"
            className="mt-6 inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full bg-[#FF6B6B] px-5 text-sm font-semibold text-[#121212] transition hover:bg-[#FF8585]"
          >
            Browse genres
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

function GenreDetailPage() {
  const { group, posters } = Route.useLoaderData();

  const related: RelatedFilm[] = useMemo(() => relatedFilms(group, posters), [group, posters]);

  const copy = genreCopy(group, posters);
  const span = yearSpan(group.posters.map((p) => p.year ?? 0));

  return (
    <div
      className="min-h-screen flex flex-col min-w-0 max-w-full overflow-x-clip"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} />
      <main className="flex-grow flex items-start justify-center">
        <TaxonomyDetail
          eyebrow="Movie genre"
          heading={copy.heading}
          meta={[
            { label: "Posters", value: `${group.posterIds.length} posters` },
            ...(span ? [{ label: "Years", value: span }] : []),
          ]}
          description={copy.description}
          relatedTitle="Featured films"
          related={related}
          posters={group.posters}
          basePath="/genre"
          title={group.name}
        />
      </main>
      <Footer />
    </div>
  );
}
