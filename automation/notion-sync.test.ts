import { describe, expect, it } from "vitest";
import { computeConflicts, parsePage } from "../scripts/sync-notion-to-firestore.js";

function textProp(content) {
  return { type: "rich_text", rich_text: [{ plain_text: content }] };
}

function titleProp(content) {
  return { type: "title", title: [{ plain_text: content }] };
}

function urlProp(url) {
  return { type: "url", url };
}

function selectProp(name) {
  return { type: "select", select: { name } };
}

function numberProp(value) {
  return { type: "number", number: value };
}

function multiSelectProp(names) {
  return { type: "multi_select", multi_select: names.map((name) => ({ name })) };
}

function automatedPage(overrides = {}) {
  return {
    id: "page-automated-1",
    properties: {
      Name: titleProp("BlacKkKlansman"),
      Slug: textProp("blackkklansman-2018"),
      "Raindrop ID": textProp("1812274995"),
      "Image URL": urlProp(
        "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.png",
      ),
      "TMDB ID": textProp("487558"),
      "IMDb ID": textProp("tt7349662"),
      Artist: textProp("Eileen Steinbach"),
      "Source URL": urlProp("https://x.com/sg_posters/status/2074969264499392888?s=46"),
      Status: selectProp("Published"),
      Year: numberProp(2018),
      "Media Type": selectProp("movie"),
      Genre: multiSelectProp(["Crime", "Drama"]),
      "Library Names": multiSelectProp(["Movies"]),
      ...overrides,
    },
  };
}

function legacyBackroomsPage() {
  return {
    id: "page-backrooms",
    properties: {
      Name: titleProp("Backrooms"),
      Slug: textProp("backrooms"),
      "Image URL": urlProp(
        "https://api.raindrop.io/v2/raindrop/1779301125/file?type=image/png, https://api.raindrop.io/v2/raindrop/1779304223/file?type=image/png, https://api.raindrop.io/v2/raindrop/1786274036/file?type=image/png",
      ),
      "TMDB ID": textProp("1083381"),
      Artist: textProp("Artist A|Artist B|Artist C"),
      Status: selectProp("Published"),
      Year: numberProp(2022),
      "Media Type": selectProp("movie"),
      Genre: multiSelectProp(["Horror"]),
    },
  };
}

describe("sync-notion-to-firestore identity", () => {
  it("uses artwork-{raindropId} as the Firebase ID for new automated records", () => {
    const [poster] = parsePage(automatedPage());
    expect(poster.id).toBe("artwork-1812274995");
  });

  it("produces the same Firebase ID across repeated parses", () => {
    const first = parsePage(automatedPage());
    const second = parsePage(automatedPage());
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toBe("artwork-1812274995");
  });

  it("keeps the same Firebase ID when the same page is updated", () => {
    const before = parsePage(automatedPage({ Name: titleProp("Old Title") }));
    const after = parsePage(automatedPage({ Name: titleProp("BlacKkKlansman") }));
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].id).toBe("artwork-1812274995");
  });

  it("produces different Firebase IDs for different Raindrop IDs", () => {
    const [first] = parsePage(automatedPage({ "Raindrop ID": textProp("1812274995") }));
    const [second] = parsePage(automatedPage({ "Raindrop ID": textProp("1813721087") }));
    expect(first.id).toBe("artwork-1812274995");
    expect(second.id).toBe("artwork-1813721087");
    expect(first.id).not.toBe(second.id);
  });

  it("detects two Notion records with the same Raindrop ID as a conflict", () => {
    const pageA = parsePage({ ...automatedPage(), id: "page-a" });
    const pageB = parsePage({ ...automatedPage(), id: "page-b" });
    const { uniquePosters, conflicts } = computeConflicts([...pageA, ...pageB]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      id: "artwork-1812274995",
      title: "BlacKkKlansman",
    });
    expect(conflicts[0].notionPageIds.sort()).toEqual(["page-a", "page-b"]);
    expect(uniquePosters).toHaveLength(0);
  });

  it("uses legacy slug identity for records without a Raindrop ID", () => {
    const page = automatedPage({
      "Raindrop ID": textProp(""),
      Slug: textProp("inception"),
      "Image URL": urlProp("https://example.com/inception.jpg"),
    });
    const [poster] = parsePage(page);
    expect(poster.id).toBe("inception");
    expect(poster.artworkId).toBeNull();
  });

  it("keeps legacy positional identity for multi-image pages", () => {
    const posters = parsePage(legacyBackroomsPage());
    expect(posters.map((p) => p.id)).toEqual(["backrooms-1", "backrooms-2", "backrooms-3"]);
    expect(posters.every((p) => p.artworkId === null)).toBe(true);
  });

  it("stores the required data fields on new automated records", () => {
    const [poster] = parsePage(automatedPage());
    expect(poster).toMatchObject({
      id: "artwork-1812274995",
      artworkId: "1812274995",
      raindropId: "1812274995",
      titleId: "487558",
      slug: "blackkklansman-2018",
      notionPageId: "page-automated-1",
      title: "BlacKkKlansman",
      year: 2018,
      mediaType: "movie",
      tmdbId: "487558",
      imdbId: "tt7349662",
      artist: "Eileen Steinbach",
      image: "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.png",
      posterImageUrl: "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.png",
      sourceUrl: "https://x.com/sg_posters/status/2074969264499392888?s=46",
      status: "published",
      genre: ["Crime", "Drama"],
      libraryNames: ["Movies"],
    });
    expect(poster.artists).toEqual([{ name: "Eileen Steinbach", url: null }]);
  });
});
