export interface CinePrintDraft {
  raindropId: string;
  title: string;
  year: number;
  mediaType: "movie" | "show";
  artists: string[];
  imageUrl: string;
  sourceUrl: string;
  /**
   * Canonical catalogue identity. Set by the automated ingestion pipeline so a
   * new Notion draft resolves deterministically during publishing. Omitted by
   * the legacy manual import, whose behaviour must stay unchanged.
   */
  posterId?: string;
}
