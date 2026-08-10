import type { EnrichedDraft } from "../tmdb/types";

export const TITLE_PROPERTY = "Name";
export const YEAR_PROPERTY = "Year";
export const MEDIA_TYPE_PROPERTY = "Media Type";
export const GENRE_PROPERTY = "Genre";
export const IMDB_ID_PROPERTY = "IMDb ID";
export const TMDB_ID_PROPERTY = "TMDB ID";
export const LIBRARY_PROPERTY = "Library Names";
export const SLUG_PROPERTY = "Slug";
export const ARTIST_PROPERTY = "Artist";
export const IMAGE_URL_PROPERTY = "Image URL";
export const SOURCE_URL_PROPERTY = "Source URL";
export const RAINDROP_ID_PROPERTY = "Raindrop ID";
export const STATUS_PROPERTY = "Status";
export const DRAFT_STATUS = "Draft";

export type EnrichedDraftWithTmdb = EnrichedDraft & {
  tmdb: NonNullable<EnrichedDraft["tmdb"]>;
};

interface FieldMapping {
  property: string;
  build: (draft: EnrichedDraftWithTmdb) => unknown;
  value: (draft: EnrichedDraftWithTmdb) => unknown;
}

function textProperty(content: string) {
  return [{ text: { content } }];
}

function sorted(values: string[]) {
  return [...values].sort();
}

const FIELD_MAPPINGS: FieldMapping[] = [
  {
    property: TITLE_PROPERTY,
    build: (draft) => ({ title: textProperty(draft.title) }),
    value: (draft) => draft.title,
  },
  {
    property: YEAR_PROPERTY,
    build: (draft) => ({ number: draft.year }),
    value: (draft) => draft.year,
  },
  {
    property: MEDIA_TYPE_PROPERTY,
    build: (draft) => ({ select: { name: draft.mediaType } }),
    value: (draft) => draft.mediaType,
  },
  {
    property: GENRE_PROPERTY,
    build: (draft) => ({
      multi_select: draft.tmdb.genres.map((genre) => ({ name: genre })),
    }),
    value: (draft) => sorted(draft.tmdb.genres),
  },
  {
    property: IMDB_ID_PROPERTY,
    build: (draft) => ({ rich_text: textProperty(draft.tmdb.imdbId) }),
    value: (draft) => draft.tmdb.imdbId,
  },
  {
    property: TMDB_ID_PROPERTY,
    build: (draft) => ({ rich_text: textProperty(String(draft.tmdb.id)) }),
    value: (draft) => String(draft.tmdb.id),
  },
  {
    property: LIBRARY_PROPERTY,
    build: (draft) => ({
      multi_select: [{ name: draft.tmdb.libraryName }],
    }),
    value: (draft) => [draft.tmdb.libraryName],
  },
  {
    property: SLUG_PROPERTY,
    build: (draft) => ({ rich_text: textProperty(draft.tmdb.slug) }),
    value: (draft) => draft.tmdb.slug,
  },
  {
    property: ARTIST_PROPERTY,
    build: (draft) => ({ rich_text: textProperty(draft.artists.join("|")) }),
    value: (draft) => draft.artists.join("|"),
  },
  {
    property: IMAGE_URL_PROPERTY,
    build: (draft) => ({ url: draft.imageUrl }),
    value: (draft) => draft.imageUrl,
  },
  {
    property: SOURCE_URL_PROPERTY,
    build: (draft) => ({ url: draft.sourceUrl }),
    value: (draft) => draft.sourceUrl,
  },
  {
    property: RAINDROP_ID_PROPERTY,
    build: (draft) => ({ rich_text: textProperty(draft.raindropId) }),
    value: (draft) => draft.raindropId,
  },
];

function requireTmdb(draft: EnrichedDraft): EnrichedDraftWithTmdb {
  if (!draft.tmdb) {
    throw new Error(`Draft has no TMDB metadata: ${draft.title}`);
  }
  return draft as EnrichedDraftWithTmdb;
}

export const MAPPED_PROPERTIES = FIELD_MAPPINGS.map((mapping) => mapping.property);

export function buildCreateProperties(draft: EnrichedDraft) {
  const enriched = requireTmdb(draft);
  const properties: Record<string, unknown> = {};

  for (const mapping of FIELD_MAPPINGS) {
    properties[mapping.property] = mapping.build(enriched);
  }

  properties[STATUS_PROPERTY] = { select: { name: DRAFT_STATUS } };

  return properties;
}

export function buildUpdateProperties(draft: EnrichedDraft) {
  const properties = buildCreateProperties(draft);
  delete properties[STATUS_PROPERTY];
  return properties;
}

export function mappedPropertyValue(draft: EnrichedDraft, property: string): unknown {
  const mapping = FIELD_MAPPINGS.find((candidate) => candidate.property === property);

  return mapping ? mapping.value(requireTmdb(draft)) : null;
}

export function propertyToValue(prop: unknown): string | number | string[] | null {
  if (!prop || typeof prop !== "object") {
    return null;
  }

  const value = prop as {
    type?: string;
    title?: Array<{ plain_text?: string }>;
    rich_text?: Array<{ plain_text?: string }>;
    url?: string | null;
    number?: number | null;
    select?: { name?: string } | null;
    multi_select?: Array<{ name?: string }>;
  };

  switch (value.type) {
    case "title":
    case "rich_text":
      return (value.title ?? value.rich_text ?? []).map((part) => part.plain_text ?? "").join("");
    case "url":
      return value.url ?? "";
    case "number":
      return value.number ?? null;
    case "select":
      return value.select?.name ?? null;
    case "multi_select":
      return sorted((value.multi_select ?? []).map((option) => option.name));
    default:
      return null;
  }
}

export function requestPropertyValue(prop: unknown): string | number | string[] | null {
  if (!prop || typeof prop !== "object") {
    return null;
  }

  const value = prop as {
    title?: Array<{ text?: { content?: string } }>;
    rich_text?: Array<{ text?: { content?: string } }>;
    url?: string | null;
    number?: number | null;
    select?: { name?: string } | null;
    multi_select?: Array<{ name?: string }>;
  };

  if (value.title) {
    return value.title.map((part) => part.text?.content ?? "").join("");
  }
  if (value.rich_text) {
    return value.rich_text.map((part) => part.text?.content ?? "").join("");
  }
  if (value.url !== undefined) {
    return value.url ?? "";
  }
  if (value.number !== undefined) {
    return value.number ?? null;
  }
  if (value.select) {
    return value.select.name ?? null;
  }
  if (value.multi_select) {
    return sorted(value.multi_select.map((option) => option.name));
  }

  return null;
}

export function changedFields(
  draft: EnrichedDraft,
  existingProperties: Record<string, unknown>,
): string[] {
  return FIELD_MAPPINGS.filter((mapping) => {
    const current = propertyToValue(existingProperties[mapping.property]);
    const next = mappedPropertyValue(draft, mapping.property);

    return JSON.stringify(current) !== JSON.stringify(next);
  }).map((mapping) => mapping.property);
}
