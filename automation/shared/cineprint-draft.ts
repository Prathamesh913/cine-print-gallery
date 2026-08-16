export interface CinePrintDraft {
  raindropId: string;
  title: string;
  year: number;
  mediaType: "movie" | "show";
  artists: string[];
  imageUrl: string;
  sourceUrl: string;
}
