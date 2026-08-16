import type { CinePrintDraft } from "./shared/cineprint-draft";

export type RaindropBookmark = {
  _id?: number;
  type?: string;
  tags?: string[];
  link?: string;
  note?: string;
  file?: { name?: string; size?: number; type?: string };
};

export type ValidationError = {
  field: string;
  message: string;
};

export type ParseResult =
  | { ok: true; draft: CinePrintDraft }
  | { ok: false; errors: ValidationError[] };

const MEDIA_TAG_PATTERN = /^(movie|show):(.*)$/i;
const ARTIST_TAG_PATTERN = /^artist:(.*)$/i;
const YEAR_PATTERN = /^\d{4}$/;
const RAINDROP_FILE_URL = "https://api.raindrop.io/v2/raindrop";

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function getImageUrl(bookmark: RaindropBookmark) {
  if (bookmark._id !== undefined && bookmark.file?.type) {
    return `${RAINDROP_FILE_URL}/${bookmark._id}/file?type=${bookmark.file.type}`;
  }

  if (bookmark.link?.includes("/file?")) {
    return bookmark.link;
  }

  if (bookmark.type === "image") {
    return bookmark.link;
  }

  return undefined;
}

export function getSourceUrl(bookmark: RaindropBookmark) {
  const note = bookmark.note ? normalizeWhitespace(bookmark.note) : "";
  return note || bookmark.link;
}

export function parseBookmark(bookmark: RaindropBookmark): ParseResult {
  const errors: ValidationError[] = [];
  const tags = Array.isArray(bookmark.tags) ? bookmark.tags.map(normalizeWhitespace) : [];

  let mediaType: "movie" | "show" | undefined;
  let title: string | undefined;
  let year: number | undefined;
  let hasInvalidYear = false;
  const artists: string[] = [];

  for (const tag of tags) {
    const mediaMatch = MEDIA_TAG_PATTERN.exec(tag);

    if (mediaMatch && mediaType === undefined) {
      mediaType = mediaMatch[1].toLowerCase() as "movie" | "show";
      const parts = mediaMatch[2].split("|").map(normalizeWhitespace);

      title = parts[0];
      const yearPart = parts[1];

      if (yearPart !== undefined && yearPart !== "") {
        if (YEAR_PATTERN.test(yearPart)) {
          year = Number(yearPart);
        } else {
          hasInvalidYear = true;
          errors.push({
            field: "year",
            message: `Year "${yearPart}" is not a valid year`,
          });
        }
      }

      continue;
    }

    const artistMatch = ARTIST_TAG_PATTERN.exec(tag);

    if (artistMatch) {
      const artist = normalizeWhitespace(artistMatch[1]);

      if (artist && !artists.includes(artist)) {
        artists.push(artist);
      }

      continue;
    }
  }

  if (mediaType === undefined) {
    errors.push({ field: "mediaType", message: "movie or show tag is missing" });
  }

  if (!title) {
    errors.push({ field: "title", message: "Title is missing" });
  }

  if (year === undefined && !hasInvalidYear) {
    errors.push({ field: "year", message: "Year is missing" });
  }

  if (artists.length === 0) {
    errors.push({ field: "artists", message: "At least one artist tag is required" });
  }

  const imageUrl = getImageUrl(bookmark);

  if (!imageUrl) {
    errors.push({ field: "imageUrl", message: "Image URL is missing" });
  }

  const sourceUrl = getSourceUrl(bookmark);

  if (!sourceUrl) {
    errors.push({ field: "sourceUrl", message: "Source URL is missing" });
  }

  const raindropId = bookmark._id !== undefined ? String(bookmark._id) : undefined;

  if (!raindropId) {
    errors.push({ field: "raindropId", message: "Raindrop ID is missing" });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    draft: {
      raindropId: raindropId!,
      title: title!,
      year: year!,
      mediaType: mediaType!,
      artists,
      imageUrl: imageUrl!,
      sourceUrl: sourceUrl!,
    },
  };
}
