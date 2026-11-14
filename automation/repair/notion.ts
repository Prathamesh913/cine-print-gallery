/**
 * Minimal Notion adapter for the repair's Poster Identities row.
 *
 * The repair never edits the poster page or its editorial Status. It only
 * ensures the multi-image page has one active identity row for the repaired
 * image, so the publishing sync can keep resolving it.
 */

import { Client } from "@notionhq/client";
import { NotionDataSourceResolver, type NotionDataSourcePlan } from "../notion/data-sources";
import { identityRecordsFromNotion, type IdentityRecord } from "../../scripts/poster-identity.js";
import { RepairError } from "./errors";
import type { RepairNotion, RepairNotionIdentityInput, RepairNotionPage } from "./repair";

export interface NotionRepairClientOptions {
  apiKey: string;
  databaseId: string;
  posterDataSourceId?: string | null;
  identitiesDataSourceId?: string | null;
  client?: Client;
}

const DEFAULT_PAGE_SIZE = 100;

function statusOf(error: unknown): number | undefined {
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" ? value : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NotionRepairClient implements RepairNotion {
  private readonly client: Client;
  private readonly resolver: NotionDataSourceResolver;
  private plan: NotionDataSourcePlan | null = null;

  constructor(options: NotionRepairClientOptions) {
    if (!options.apiKey) throw new RepairError("NOTION_KEY is required");
    if (!options.databaseId) throw new RepairError("NOTION_DATABASE_ID is required");
    this.client = options.client ?? new Client({ auth: options.apiKey, timeoutMs: 30_000 });
    this.resolver = new NotionDataSourceResolver({
      client: this.client,
      request: (operation) => this.withRetry(operation),
      databaseId: options.databaseId,
      posterDataSourceId: options.posterDataSourceId,
      identitiesDataSourceId: options.identitiesDataSourceId,
    });
  }

  async preflight(): Promise<NotionDataSourcePlan> {
    if (this.plan) return this.plan;
    const plan = await this.resolver.resolve();
    if (!plan.identitiesDataSourceId) {
      throw new RepairError(
        "NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID is required for a consistent repair",
      );
    }
    this.plan = plan;
    return plan;
  }

  async getPage(pageId: string): Promise<RepairNotionPage> {
    const page = await this.withRetry(() => this.client.pages.retrieve({ page_id: pageId }));
    return {
      id: page.id,
      properties: (page as { properties?: Record<string, unknown> }).properties ?? {},
    };
  }

  async listIdentityRecords(): Promise<IdentityRecord[]> {
    const plan = await this.preflight();
    const dataSourceId = plan.identitiesDataSourceId!;
    const rows: unknown[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 20; page += 1) {
      const response = await this.withRetry(() =>
        this.client.dataSources.query({
          data_source_id: dataSourceId,
          page_size: DEFAULT_PAGE_SIZE,
          start_cursor: cursor,
        }),
      );
      rows.push(...response.results);
      if (!response.has_more || !response.next_cursor) break;
      cursor = response.next_cursor;
    }

    return identityRecordsFromNotion(rows);
  }

  async createIdentityRecord(input: RepairNotionIdentityInput): Promise<string> {
    const plan = await this.preflight();
    const page = await this.withRetry(() =>
      this.client.pages.create({
        parent: { type: "data_source_id", data_source_id: plan.identitiesDataSourceId! },
        properties: {
          "Poster ID": { title: [{ text: { content: input.target.posterId } }] },
          "Grouping Page": { relation: [{ id: input.groupingPageId }] },
          "Image URL": { url: input.imageUrl },
          "Raindrop ID": {
            rich_text: [{ text: { content: input.target.raindropId } }],
          },
          "Source Provider": { select: { name: input.target.sourceProvider } },
          "Source SHA-256": {
            rich_text: [{ text: { content: input.target.expectedSha256 } }],
          },
          "Source Revision": { number: 1 },
          Status: { select: { name: "active" } },
          "Verified At": { date: { start: input.verifiedAt } },
        },
      }),
    );
    return page.id;
  }

  async getIdentityRecord(recordId: string): Promise<IdentityRecord> {
    const page = await this.getPage(recordId);
    const [record] = identityRecordsFromNotion([page]);
    if (!record) {
      throw new RepairError(`Notion identity record ${recordId} could not be parsed`);
    }
    return record;
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        attempt += 1;
        if (statusOf(error) === 429 && attempt <= 3) {
          await sleep(attempt * 1_000);
          continue;
        }
        throw error;
      }
    }
  }
}
