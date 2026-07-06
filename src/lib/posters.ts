export type PosterStyle = string;
export type PosterGenre = string;

export interface ArtistInfo {
  name: string;
  url?: string;
}

export interface Poster {
  id: string;
  title: string;
  year: number;
  artists?: ArtistInfo[];
  artist: string;
  artistUrl?: string;
  source: string;
  sourceUrl: string;
  image: string;
  style: PosterStyle;
  genre: PosterGenre[];
  tags: string[];
  note?: string;
}

export function slugifyArtist(name: string): string {
  if (!name || typeof name !== "string") return "unknown";
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

