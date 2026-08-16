import type { EnrichedDraft } from "../tmdb/types";
import type { NotionClient } from "./client";
import { buildCreateProperties, buildUpdateProperties, changedFields } from "./mapper";

export type SyncOutcome =
  | {
      kind: "created";
      draft: EnrichedDraft;
      pageId: string;
      properties?: Record<string, unknown>;
    }
  | {
      kind: "updated";
      draft: EnrichedDraft;
      pageId: string;
      changed: boolean;
      changedFields?: string[];
      properties?: Record<string, unknown>;
    }
  | { kind: "skipped"; draft: EnrichedDraft; reason: string }
  | { kind: "failed"; draft: EnrichedDraft; error: string };

export interface SyncOptions {
  dryRun?: boolean;
}

export class NotionDraftSync {
  constructor(private readonly client: NotionClient) {}

  async syncMany(drafts: EnrichedDraft[], options: SyncOptions = {}): Promise<SyncOutcome[]> {
    const outcomes: SyncOutcome[] = [];

    for (const draft of drafts) {
      outcomes.push(await this.syncOne(draft, options));
    }

    return outcomes;
  }

  async syncOne(draft: EnrichedDraft, options: SyncOptions = {}): Promise<SyncOutcome> {
    if (draft.status !== "enriched") {
      return { kind: "skipped", draft, reason: draft.reason ?? draft.status };
    }

    try {
      const existing = await this.client.findByRaindropId(draft.raindropId);

      if (existing) {
        return this.updateExisting(draft, existing, options);
      }

      return this.createNew(draft, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "failed", draft, error: message };
    }
  }

  private async createNew(draft: EnrichedDraft, options: SyncOptions): Promise<SyncOutcome> {
    const properties = buildCreateProperties(draft);

    if (options.dryRun) {
      return { kind: "created", draft, pageId: "(dry-run)", properties };
    }

    const pageId = await this.client.createPage(properties);
    return { kind: "created", draft, pageId };
  }

  private async updateExisting(
    draft: EnrichedDraft,
    existing: { id: string; properties: Record<string, unknown> },
    options: SyncOptions,
  ): Promise<SyncOutcome> {
    const fields = changedFields(draft, existing.properties);

    if (fields.length === 0) {
      return { kind: "updated", draft, pageId: existing.id, changed: false };
    }

    const properties = buildUpdateProperties(draft);
    const onlyChanged: Record<string, unknown> = {};

    for (const field of fields) {
      onlyChanged[field] = properties[field];
    }

    if (options.dryRun) {
      return {
        kind: "updated",
        draft,
        pageId: existing.id,
        changed: true,
        changedFields: fields,
        properties: onlyChanged,
      };
    }

    await this.client.updatePage(existing.id, onlyChanged);
    return {
      kind: "updated",
      draft,
      pageId: existing.id,
      changed: true,
      changedFields: fields,
    };
  }
}
