export type PosterStyle = string;
export type PosterGenre = string;

export interface Poster {
  id: string;
  title: string;
  year: number;
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

