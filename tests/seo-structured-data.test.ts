import { describe, it, expect } from "vitest";
import {
  artistPageEntities,
  breadcrumbEntity,
  jsonLdScriptTag,
  organizationEntity,
  personEntity,
  posterPageEntities,
  visualArtworkEntity,
  webpageEntity,
  websiteEntity,
  withJsonLd,
} from "../src/lib/structured-data";
import { pageHead, posterHeadMeta, utilityHeadMeta } from "../src/lib/seo";
import type { Poster } from "../src/lib/posters";

/**
 * M6 — structured data.
 *
 * Calls the real entity builders with representative fixtures and asserts
 * literal parsed values. JSON round-trips prove the output is valid,
 * serializable JSON-LD rather than string templates.
 */

function fixturePoster(overrides: Partial<Poster> & { id: string }): Poster {
  return {
    title: "Dune",
    year: 2021,
    artists: [{ name: "Olly Moss" }],
    artist: "Olly Moss",
    artistUrl: undefined,
    source: "Test",
    sourceUrl: "",
    image: "https://example.com/dune.jpg",
    style: "Minimalist",
    genre: ["Sci-Fi"],
    tags: [],
    note: undefined,
    mediaType: "movie",
    tmdbId: undefined,
    imdbId: undefined,
    seasonNumber: undefined,
    collectionName: undefined,
    posterImageUrl: undefined,
    backgroundUrl: undefined,
    libraryNames: undefined,
    slug: "dune",
    ...overrides,
  } as Poster;
}

const COMPLETE = fixturePoster({
  id: "dune-part-two",
  title: "Dune: Part Two",
  note: "A sweeping desert epic.",
});
const SPARSE = fixturePoster({
  id: "mystery-print",
  title: "Mystery Print",
  year: 0,
  artists: undefined,
  artist: "Unknown",
  genre: [],
  mediaType: "show",
});
const ROWS = [COMPLETE, SPARSE];

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function walk(value: unknown, visit: (v: unknown) => void): void {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) walk(item, visit);
  }
}

/** No undefined, NaN, or empty-string leaves anywhere in the entity. */
function expectCleanJsonLd(entity: unknown): void {
  walk(entity, (v) => {
    expect(v).not.toBeUndefined();
    if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
    if (typeof v === "string" && (v === "" || v.trim() !== v)) {
      throw new Error(`dirty string leaf: ${JSON.stringify(v)}`);
    }
  });
}

describe("homepage entities", () => {
  it("emits a valid WebSite entity with a stable identifier", () => {
    expect(roundTrip(websiteEntity())).toEqual({
      "@type": "WebSite",
      "@id": "https://cineprint.click/#website",
      url: "https://cineprint.click",
      name: "CinePrint",
      description: expect.stringContaining("alternative movie posters"),
      publisher: { "@id": "https://cineprint.click/#organization" },
    });
  });

  it("emits a minimal Organization with no invented attributes", () => {
    const org = roundTrip(organizationEntity());
    expect(org["@type"]).toBe("Organization");
    expect(org["@id"]).toBe("https://cineprint.click/#organization");
    expect(org["name"]).toBe("CinePrint");
    for (const invented of ["sameAs", "logo", "address", "foundingDate", "contactPoint"]) {
      expect(org).not.toHaveProperty(invented);
    }
  });

  it("links WebSite publisher to the Organization identifier", () => {
    const site = websiteEntity() as Record<string, unknown>;
    const org = organizationEntity() as Record<string, unknown>;
    expect((site.publisher as Record<string, unknown>)["@id"]).toBe(org["@id"]);
  });
});

describe("poster VisualArtwork", () => {
  it("uses real poster data with stable canonical identifiers", () => {
    expect(roundTrip(visualArtworkEntity(COMPLETE))).toEqual({
      "@type": "VisualArtwork",
      "@id": "https://cineprint.click/poster/dune-part-two",
      url: "https://cineprint.click/poster/dune-part-two",
      name: "Dune: Part Two",
      description: "A sweeping desert epic.",
      image: "https://example.com/dune.jpg",
      artform: "Poster",
      genre: ["Sci-Fi"],
      dateCreated: "2021",
      creator: {
        "@type": "Person",
        "@id": "https://cineprint.click/artist/olly-moss",
        name: "Olly Moss",
        url: "https://cineprint.click/artist/olly-moss",
      },
      about: { "@type": "Movie", name: "Dune: Part Two" },
      isPartOf: { "@id": "https://cineprint.click/#website" },
    });
  });

  it("omits the creator when the artist is unknown", () => {
    const art = visualArtworkEntity(SPARSE) as Record<string, unknown>;
    expect(art).not.toHaveProperty("creator");
    expect(art["@type"]).toBe("VisualArtwork");
  });

  it("omits optional fields when catalogue data is missing", () => {
    const art = visualArtworkEntity(SPARSE) as Record<string, unknown>;
    for (const key of ["description", "genre", "dateCreated"]) {
      expect(art).not.toHaveProperty(key);
    }
  });

  it("uses TVSeries for shows and emits no invented film URLs", () => {
    const art = visualArtworkEntity(SPARSE) as Record<string, unknown>;
    expect((art.about as Record<string, unknown>)["@type"]).toBe("TVSeries");
    expect(art.about).not.toHaveProperty("url");
    expect(art.about).not.toHaveProperty("sameAs");
  });
});

describe("artist Person", () => {
  it("emits a stable identity with the real slug and artwork image", () => {
    expect(
      roundTrip(personEntity("Olly Moss", "olly-moss", "https://example.com/dune.jpg")),
    ).toEqual({
      "@type": "Person",
      "@id": "https://cineprint.click/artist/olly-moss",
      url: "https://cineprint.click/artist/olly-moss",
      name: "Olly Moss",
      image: "https://example.com/dune.jpg",
      isPartOf: { "@id": "https://cineprint.click/#website" },
    });
  });

  it("artist pages resolve the person and breadcrumb from catalogue rows", () => {
    const entities = artistPageEntities(ROWS, "olly-moss");
    const [person, crumbs] = roundTrip(entities);
    expect((person as Record<string, unknown>)["@type"]).toBe("Person");
    expect((person as Record<string, unknown>)["name"]).toBe("Olly Moss");
    expect((crumbs as Record<string, unknown>)["@type"]).toBe("BreadcrumbList");
  });

  it("unknown slugs emit no Person and no invented biography", () => {
    const entities = artistPageEntities(ROWS, "nobody-here");
    expect(entities).toHaveLength(1);
    expect((entities[0] as Record<string, unknown>)["@type"]).toBe("BreadcrumbList");
  });
});

describe("breadcrumbs", () => {
  it("uses positions from 1 with absolute canonical URLs", () => {
    const crumbs = roundTrip(
      breadcrumbEntity([
        { name: "Home", url: "https://cineprint.click" },
        { name: "Dune: Part Two", url: "https://cineprint.click/poster/dune-part-two" },
      ]),
    ) as Record<string, unknown>;
    expect(crumbs).toEqual({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://cineprint.click" },
        {
          "@type": "ListItem",
          position: 2,
          name: "Dune: Part Two",
          item: "https://cineprint.click/poster/dune-part-two",
        },
      ],
    });
  });

  it("poster pages link Home and the poster with no fake film URL", () => {
    const [, crumbs] = posterPageEntities(COMPLETE);
    const items = (crumbs as Record<string, unknown>).itemListElement as Array<
      Record<string, unknown>
    >;
    expect(items.map((i) => i.item)).toEqual([
      "https://cineprint.click",
      "https://cineprint.click/poster/dune-part-two",
    ]);
  });
});

describe("script wrapping and safety", () => {
  it("wraps entities in a single @graph script block", () => {
    const tag = jsonLdScriptTag([websiteEntity(), organizationEntity()]);
    const script = tag["script:ld+json"] as Record<string, unknown>;
    expect(script["@context"]).toBe("https://schema.org");
    expect(script["@graph"]).toHaveLength(2);
  });

  it("withJsonLd adds exactly one script block and preserves head content", () => {
    const base = pageHead({ path: "/submit", title: "T", description: "D" });
    const head = withJsonLd(base, [
      { "@type": "WebPage", "@id": "https://cineprint.click/submit" },
    ]);
    const scripts = head.meta.filter((t) => t["script:ld+json"] !== undefined);
    expect(scripts).toHaveLength(1);
    expect(head.links).toEqual(base.links);
    expect(head.meta.length).toBe(base.meta.length + 1);
  });

  it("withJsonLd leaves heads untouched when there are no entities", () => {
    const base = pageHead({ path: "/submit", title: "T", description: "D" });
    expect(withJsonLd(base, [])).toBe(base);
  });

  it("survives hostile catalogue strings through a JSON round-trip", () => {
    const hostile = fixturePoster({
      id: "x",
      title: `A&B <C> "D" 'E' </script><script>alert(1)</script> émoticône 🎬`,
      note: "Line1\nLine2\tTabbed",
    });
    const parsed = roundTrip(visualArtworkEntity(hostile)) as Record<string, unknown>;
    expect(parsed["name"]).toBe(hostile.title);
    expect(parsed["description"]).toBe(hostile.note);
    expectCleanJsonLd(parsed);
  });

  it("emits no undefined, NaN, or empty leaves across all builders", () => {
    for (const entity of [
      websiteEntity(),
      organizationEntity(),
      visualArtworkEntity(COMPLETE),
      visualArtworkEntity(SPARSE),
      personEntity("Olly Moss", "olly-moss"),
      ...posterPageEntities(COMPLETE),
      ...artistPageEntities(ROWS, "olly-moss"),
    ]) {
      expectCleanJsonLd(entity);
    }
  });
});

describe("indexing policy preservation", () => {
  function scriptTags(meta: Array<Record<string, unknown>>): unknown[] {
    return meta.filter((t) => t["script:ld+json"] !== undefined);
  }

  it("utility pages carry no structured data", () => {
    for (const title of ["Saved", "Sign In", "Profile"]) {
      expect(scriptTags(utilityHeadMeta(title, "D").meta)).toEqual([]);
    }
  });

  it("invalid poster pages carry no structured data", () => {
    expect(scriptTags(posterHeadMeta(null).meta)).toEqual([]);
  });

  it("submit WebPage uses real route content", () => {
    const page = roundTrip(
      webpageEntity("/submit", "Submit Poster Artwork — CinePrint Gallery", "Submit desc."),
    );
    expect(page).toEqual({
      "@type": "WebPage",
      "@id": "https://cineprint.click/submit",
      url: "https://cineprint.click/submit",
      name: "Submit Poster Artwork — CinePrint Gallery",
      description: "Submit desc.",
      isPartOf: { "@id": "https://cineprint.click/#website" },
    });
  });
});
