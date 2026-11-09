export type IdentityMode = "legacy" | "transition" | "canonical";

export type IdentitySource =
  "notion_property" | "per_image_relation" | "legacy_slug" | "legacy_raindrop";

export interface ResolvedPosterIdentity {
  posterId: string;
  identitySource: IdentitySource;
  groupingPageId: string;
  identityRecordId: string | null;
  imageUrl: string;
  orphaned?: boolean;
  sourceRevision?: number;
  sourceProvider?: string | null;
  sourceRaindropId?: string | null;
}

export interface UnresolvedIdentity {
  reason: string;
  detail: string;
  pageId?: string;
  imageUrl?: string;
  recordId?: string;
}

export interface IdentityConflict {
  kind: string;
  detail: string;
  posterId?: string;
  pageId?: string;
  recordId?: string;
  otherPageId?: string;
  firestorePageId?: string;
  reason?: string;
}

export interface OrphanedIdentity {
  posterId: string | null;
  groupingPageId: string;
  identityRecordId: string | null;
  reason: string;
}

export interface IdentityRecord {
  identityRecordId: string;
  posterId: string;
  groupingPageId: string | null;
  groupingPageIds: string[];
  imageUrl: string;
  raindropId: string | null;
  provider: string | null;
  sha256: string | null;
  revision: number;
  status: string;
}

export interface IdentityResolution {
  mode: IdentityMode;
  allowLegacy: boolean;
  resolved: ResolvedPosterIdentity[];
  unresolved: UnresolvedIdentity[];
  conflicts: IdentityConflict[];
  orphaned: OrphanedIdentity[];
  orphanedFirestoreDocuments: Array<{
    posterId: string;
    notionPageId: string;
    reason: string;
  }>;
  warnings: string[];
  ignoredPages: string[];
  summary: Record<string, unknown>;
}

export interface SyncPlanRecord {
  id: string;
  data: Record<string, unknown>;
  identity: ResolvedPosterIdentity;
}

export interface SyncPlan {
  mode: IdentityMode;
  allowLegacy: boolean;
  ok: boolean;
  resolution: IdentityResolution;
  records: SyncPlanRecord[];
  conflicts: IdentityConflict[];
  unresolved: UnresolvedIdentity[];
  orphaned: OrphanedIdentity[];
  orphanedFirestoreDocuments: Array<{
    posterId: string;
    notionPageId: string;
    reason: string;
  }>;
  warnings: string[];
  ignoredPages: string[];
  firestore: {
    existing: number;
    resolvedExisting: number;
    missing: string[];
    potentialCreates: number;
    potentialUpdates: number;
  };
  prune: {
    requested: boolean;
    allowed: boolean;
    candidates: Array<{ posterId: string; notionPageId: string }>;
  };
  summary: Record<string, unknown>;
}

export const IDENTITY_MODES: readonly IdentityMode[];

export function richTextValue(prop: unknown): string;
export function normalizePosterId(value: unknown): {
  ok: boolean;
  id?: string;
  reason?: string;
  hadWhitespace?: boolean;
};
export function canonicalPosterIdFromPage(page: unknown): {
  status: "absent" | "empty" | "invalid" | "present";
  posterId?: string;
  raw?: string;
  reason?: string;
  propertyType?: string;
  hadWhitespace?: boolean;
};
export function imageUrlsFromPage(page: unknown): string[];
export function identityRecordsFromNotion(rows: unknown[]): IdentityRecord[];
export function resolveNotionIdentities(input: {
  pages?: unknown[];
  firestoreDocuments?: Array<{
    id: string;
    notionPageId?: string | null;
    image?: string | null;
    status?: string | null;
  }>;
  identityRecords?: IdentityRecord[];
  knownPosterIds?: string[];
  mode?: IdentityMode;
  allowLegacy?: boolean;
}): IdentityResolution;
export function buildSyncPlan(input: {
  pages?: unknown[];
  firestoreDocuments?: Array<{
    id: string;
    notionPageId?: string | null;
    image?: string | null;
    status?: string | null;
  }>;
  identityRecords?: IdentityRecord[];
  knownPosterIds?: string[];
  mode?: IdentityMode;
  allowLegacy?: boolean;
  prune?: boolean;
  pruneAllowed?: boolean;
  parsePage: (
    page: unknown,
  ) => Array<Record<string, unknown> & { image: string; notionPageId: string }>;
}): SyncPlan;
export function applySyncPlan(
  plan: SyncPlan,
  adapter: {
    write: (records: SyncPlanRecord[]) => Promise<void>;
    prune?: (candidates: Array<{ posterId: string; notionPageId: string }>) => Promise<void>;
  },
): Promise<{
  ok: boolean;
  wrote: number;
  pruned: number;
  reason: string | null;
}>;
