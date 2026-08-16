import type { MediaType, TMDBMetadata } from "./types";

export interface TMDBCache {
  get(key: string): TMDBMetadata | undefined;
  set(key: string, value: TMDBMetadata): void;
  has(key: string): boolean;
  readonly size: number;
}

export function buildCacheKey(mediaType: MediaType, title: string, year: number): string {
  const prefix = mediaType === "movie" ? "movie" : "show";
  return `${prefix}:${title.trim()}|${year}`;
}

export class InMemoryTMDBCache implements TMDBCache {
  private readonly store = new Map<string, TMDBMetadata>();

  get(key: string): TMDBMetadata | undefined {
    return this.store.get(key);
  }

  set(key: string, value: TMDBMetadata): void {
    this.store.set(key, value);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
