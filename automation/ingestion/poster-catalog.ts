/**
 * Firestore catalogue access for the publishing sync.
 *
 * The catalogue remains the single source of published posters. This module
 * only adds the create/update primitives the pipeline needs; reads keep the
 * existing document shape used by `src/lib/notion.ts`.
 */

export interface PosterDocument {
  id: string;
  data: Record<string, unknown>;
}

/** A document that must already exist for an update was deleted or never created. */
export class PosterDocumentMissingError extends Error {
  constructor(readonly posterId: string) {
    super(`Firestore poster document ${posterId} does not exist; refusing to recreate it`);
    this.name = "PosterDocumentMissingError";
  }
}

export interface PosterCatalog {
  get(id: string): Promise<PosterDocument | null>;
  /** All catalogue documents, used for status down-sync on unpublished pages. */
  listAll(): Promise<PosterDocument[]>;
  /** Existing documents associated with a Notion page, used to preserve legacy IDs. */
  listByNotionPageId(pageId: string): Promise<PosterDocument[]>;
  create(id: string, data: Record<string, unknown>): Promise<void>;
  update(id: string, data: Record<string, unknown>): Promise<void>;
}

export class InMemoryPosterCatalog implements PosterCatalog {
  readonly documents = new Map<string, Record<string, unknown>>();
  readonly writes: Array<{ kind: "create" | "update"; id: string }> = [];

  constructor(seed: Array<{ id: string; data: Record<string, unknown> }> = []) {
    for (const document of seed) this.documents.set(document.id, { ...document.data });
  }

  async get(id: string): Promise<PosterDocument | null> {
    const data = this.documents.get(id);
    return data ? { id, data: { ...data } } : null;
  }

  async listAll(): Promise<PosterDocument[]> {
    return [...this.documents.entries()].map(([id, data]) => ({ id, data: { ...data } }));
  }

  async listByNotionPageId(pageId: string): Promise<PosterDocument[]> {
    return [...this.documents.entries()]
      .filter(([, data]) => data.notionPageId === pageId)
      .map(([id, data]) => ({ id, data: { ...data } }));
  }

  async create(id: string, data: Record<string, unknown>): Promise<void> {
    this.documents.set(id, { ...data });
    this.writes.push({ kind: "create", id });
  }

  async update(id: string, data: Record<string, unknown>): Promise<void> {
    const existing = this.documents.get(id);
    if (!existing) throw new PosterDocumentMissingError(id);
    this.documents.set(id, { ...existing, ...data });
    this.writes.push({ kind: "update", id });
  }
}
