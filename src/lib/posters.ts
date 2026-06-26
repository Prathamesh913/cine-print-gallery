export type PosterStyle = "Minimalist" | "Illustrated" | "Retro" | "Typographic" | "Vintage";
export type PosterGenre = "Sci-Fi" | "Horror" | "Comedy" | "Drama" | "TV Show";

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

const img = (seed: string) => `https://picsum.photos/seed/${encodeURIComponent(seed)}/600/900`;

export const POSTERS: Poster[] = [
  { id: "p1", title: "Blade Runner 2049", year: 2017, artist: "Lena Marsh", artistUrl: "https://example.com/lena", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("blade-runner"), style: "Minimalist", genre: ["Sci-Fi"], tags: ["neon","noir"], note: "Rain, neon, and silhouettes." },
  { id: "p2", title: "The Shining", year: 1980, artist: "Owen Reyes", source: "Behance", sourceUrl: "https://behance.net", image: img("shining"), style: "Typographic", genre: ["Horror"], tags: ["kubrick"], note: "All work and no play." },
  { id: "p3", title: "Pulp Fiction", year: 1994, artist: "Mika Tanaka", artistUrl: "https://example.com/mika", source: "Dribbble", sourceUrl: "https://dribbble.com", image: img("pulp"), style: "Retro", genre: ["Drama"], tags: ["tarantino"] },
  { id: "p4", title: "Stranger Things", year: 2016, artist: "Jules Verne", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("stranger"), style: "Illustrated", genre: ["TV Show","Sci-Fi"], tags: ["80s"], note: "Upside down vibes." },
  { id: "p5", title: "Hereditary", year: 2018, artist: "Sasha Kim", source: "Behance", sourceUrl: "https://behance.net", image: img("hereditary"), style: "Minimalist", genre: ["Horror"], tags: ["ari aster"] },
  { id: "p6", title: "Grand Budapest Hotel", year: 2014, artist: "Etienne Roux", artistUrl: "https://example.com/etienne", source: "Dribbble", sourceUrl: "https://dribbble.com", image: img("budapest"), style: "Illustrated", genre: ["Comedy","Drama"], tags: ["wes anderson"], note: "Symmetry obsessed." },
  { id: "p7", title: "Dune", year: 2021, artist: "Noor Hassan", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("dune"), style: "Minimalist", genre: ["Sci-Fi"], tags: ["desert"] },
  { id: "p8", title: "The Office", year: 2005, artist: "Carla Bishop", source: "Behance", sourceUrl: "https://behance.net", image: img("office"), style: "Typographic", genre: ["TV Show","Comedy"], tags: ["sitcom"], note: "That's what she said." },
  { id: "p9", title: "Drive", year: 2011, artist: "Theo Lambert", artistUrl: "https://example.com/theo", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("drive"), style: "Retro", genre: ["Drama"], tags: ["synthwave"] },
  { id: "p10", title: "Akira", year: 1988, artist: "Yuki Nakamura", source: "Dribbble", sourceUrl: "https://dribbble.com", image: img("akira"), style: "Illustrated", genre: ["Sci-Fi"], tags: ["anime","neo tokyo"] },
  { id: "p11", title: "Twin Peaks", year: 1990, artist: "Margot Hayes", source: "Behance", sourceUrl: "https://behance.net", image: img("twinpeaks"), style: "Vintage", genre: ["TV Show","Drama"], tags: ["lynch"], note: "Damn fine coffee." },
  { id: "p12", title: "The Witch", year: 2015, artist: "Ivo Brandt", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("witch"), style: "Vintage", genre: ["Horror"], tags: ["folk"] },
  { id: "p13", title: "2001: A Space Odyssey", year: 1968, artist: "Lena Marsh", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("2001"), style: "Minimalist", genre: ["Sci-Fi"], tags: ["kubrick"] },
  { id: "p14", title: "Fargo", year: 1996, artist: "Owen Reyes", source: "Behance", sourceUrl: "https://behance.net", image: img("fargo"), style: "Typographic", genre: ["Drama"], tags: ["coen"] },
  { id: "p15", title: "Severance", year: 2022, artist: "Mika Tanaka", source: "Dribbble", sourceUrl: "https://dribbble.com", image: img("severance"), style: "Minimalist", genre: ["TV Show","Sci-Fi"], tags: ["corporate"] },
  { id: "p16", title: "Midsommar", year: 2019, artist: "Sasha Kim", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("midsommar"), style: "Illustrated", genre: ["Horror"], tags: ["folk","floral"] },
  { id: "p17", title: "Her", year: 2013, artist: "Etienne Roux", source: "Behance", sourceUrl: "https://behance.net", image: img("her"), style: "Minimalist", genre: ["Drama","Sci-Fi"], tags: ["warm"] },
  { id: "p18", title: "Superbad", year: 2007, artist: "Carla Bishop", source: "Dribbble", sourceUrl: "https://dribbble.com", image: img("superbad"), style: "Typographic", genre: ["Comedy"], tags: ["coming of age"] },
  { id: "p19", title: "Mad Max: Fury Road", year: 2015, artist: "Theo Lambert", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("madmax"), style: "Illustrated", genre: ["Sci-Fi"], tags: ["desert","chrome"] },
  { id: "p20", title: "Better Call Saul", year: 2015, artist: "Margot Hayes", source: "Behance", sourceUrl: "https://behance.net", image: img("saul"), style: "Retro", genre: ["TV Show","Drama"], tags: ["legal"] },
  { id: "p21", title: "Spirited Away", year: 2001, artist: "Yuki Nakamura", source: "Dribbble", sourceUrl: "https://dribbble.com", image: img("spirited"), style: "Illustrated", genre: ["Drama"], tags: ["ghibli","anime"] },
  { id: "p22", title: "The Thing", year: 1982, artist: "Ivo Brandt", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("thething"), style: "Vintage", genre: ["Horror","Sci-Fi"], tags: ["carpenter"] },
  { id: "p23", title: "Whiplash", year: 2014, artist: "Noor Hassan", source: "Behance", sourceUrl: "https://behance.net", image: img("whiplash"), style: "Typographic", genre: ["Drama"], tags: ["jazz"] },
  { id: "p24", title: "Chernobyl", year: 2019, artist: "Jules Verne", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("chernobyl"), style: "Minimalist", genre: ["TV Show","Drama"], tags: ["historical"] },
  { id: "p25", title: "Donnie Darko", year: 2001, artist: "Lena Marsh", source: "Dribbble", sourceUrl: "https://dribbble.com", image: img("donnie"), style: "Retro", genre: ["Sci-Fi","Drama"], tags: ["cult"] },
  { id: "p26", title: "Get Out", year: 2017, artist: "Owen Reyes", source: "Behance", sourceUrl: "https://behance.net", image: img("getout"), style: "Minimalist", genre: ["Horror"], tags: ["jordan peele"] },
  { id: "p27", title: "Arrival", year: 2016, artist: "Mika Tanaka", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("arrival"), style: "Minimalist", genre: ["Sci-Fi"], tags: ["villeneuve"] },
  { id: "p28", title: "Fleabag", year: 2016, artist: "Carla Bishop", source: "Behance", sourceUrl: "https://behance.net", image: img("fleabag"), style: "Typographic", genre: ["TV Show","Comedy"], tags: ["uk"] },
  { id: "p29", title: "Suspiria", year: 1977, artist: "Sasha Kim", source: "Dribbble", sourceUrl: "https://dribbble.com", image: img("suspiria"), style: "Vintage", genre: ["Horror"], tags: ["giallo"] },
  { id: "p30", title: "Inception", year: 2010, artist: "Theo Lambert", source: "PosterSpy", sourceUrl: "https://posterspy.com", image: img("inception"), style: "Illustrated", genre: ["Sci-Fi"], tags: ["nolan"] },
];

export const STYLES: PosterStyle[] = ["Minimalist","Illustrated","Retro","Typographic","Vintage"];
export const GENRES: PosterGenre[] = ["Sci-Fi","Horror","Comedy","Drama","TV Show"];
