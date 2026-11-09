import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import {
  canonicalPosterIdFromPage,
  identityRecordsFromNotion,
  imageUrlsFromPage,
  normalizePosterId,
  richTextValue,
  type IdentityRecord,
} from "./poster-identity.js";

export type IdentityConfidence = "high" | "medium" | "low" | "none";
export type AssignmentAction = "ADD" | "KEEP" | "BLOCK";

export interface FirestoreIdentityDoc {
  id: string;
  notionPageId: string;
  image: string;
  title?: string;
  status?: string;
}

export interface ManifestIdentityEntry {
  cineprintPosterId: string;
  notionPageId: string;
  identityConfidence: IdentityConfidence;
  raindropId: string | null;
  raindropBookmarkTitle?: string | null;
  sourceProvider: string;
  sourceSha256: string | null;
  sourceMimeType?: string | null;
  sourceDimensions?: { width: number; height: number } | null;
  sourceSizeBytes?: number | null;
  currentImageUrl?: string;
  currentImageObjectKey?: string | null;
}

export interface ManifestIdentityFile {
  entries: ManifestIdentityEntry[];
}

export interface SinglePosterAssignment {
  operation: "UPDATE_PAGE_PROPERTY";
  target: { pageId: string; dataSource: "Poster Library" };
  property: "CinePrint Poster ID";
  pageId: string;
  pageTitle: string;
  currentValue: string | null;
  proposedValue: string;
  firestoreImageUrl: string;
  manifestId: string;
  confidence: IdentityConfidence;
  action: AssignmentAction;
  validation: { ok: boolean; reasons: string[] };
  evidence: string[];
}

export interface MultiIdentityAssignment {
  operation: "CREATE_DATA_SOURCE_PAGE";
  target: { dataSource: "Poster Identities"; groupingPageId: string };
  record: {
    posterId: string;
    groupingPageId: string;
    imageUrl: string;
    raindropId: string | null;
    sourceProvider: string;
    sourceSha256: string | null;
    sourceRevision: number;
    status: "active";
    verifiedAt: string | null;
  };
  groupingPageTitle: string;
  currentValue: IdentityRecord | null;
  proposedValue: string;
  confidence: IdentityConfidence;
  action: AssignmentAction;
  validation: { ok: boolean; reasons: string[] };
  evidence: string[];
}

export interface BlockedIdentity {
  posterId: string;
  groupingPageId: string;
  groupingPageTitle: string;
  imageUrl: string;
  raindropId: string | null;
  confidence: IdentityConfidence;
  reason:
    | "HUMAN_REVIEW_REQUIRED"
    | "LOW_CONFIDENCE"
    | "NO_FIRESTORE_DOCUMENT"
    | "AMBIGUOUS_IMAGE_MATCH"
    | "PAGE_MISMATCH"
    | "MISSING_MANIFEST_ENTRY"
    | "CONFLICTING_IDENTITY_RECORD"
    | "NEW_IMAGE_WITHOUT_IDENTITY";
  requiredDecision: string | null;
  evidence: string[];
}

export interface OrphanedIdentityRecord {
  identityRecordId: string;
  posterId: string;
  groupingPageId: string | null;
  reason: "MISSING_GROUPING_PAGE" | "INVALID_GROUPING_PAGE" | "IMAGE_NOT_ON_PAGE";
}

export interface BackfillIssue {
  kind: string;
  posterId?: string;
  pageId?: string;
  detail: string;
}

export interface BackfillPlan {
  schemaVersion: 1;
  source: {
    notionPages: number;
    firestoreDocuments: number;
    manifestEntries: number;
    identityRecords: number;
  };
  counts: {
    singlePages: number;
    singleAdd: number;
    singleKeep: number;
    singleBlocked: number;
    multiPages: number;
    multiIdentities: number;
    multiHigh: number;
    multiMedium: number;
    multiAdd: number;
    multiKeep: number;
    multiBlocked: number;
    totalPosterIdentities: number;
    autoBackfillable: number;
    unresolved: number;
    duplicateIds: number;
    unknownIds: number;
    conflictingAssignments: number;
    newIds: number;
    identityChanges: number;
    orphanedIdentityRecords: number;
  };
  singlePosterAssignments: SinglePosterAssignment[];
  multiIdentityAssignments: MultiIdentityAssignment[];
  blocked: BlockedIdentity[];
  orphanedIdentityRecords: OrphanedIdentityRecord[];
  orphanedFirestoreDocuments: Array<{
    posterId: string;
    notionPageId: string;
    reason: string;
  }>;
  validation: {
    ok: boolean;
    issues: BackfillIssue[];
    missingProposedIds: string[];
    extraProposedIds: string[];
  };
}

export interface BackfillPlanInput {
  pages: Array<{ id: string; properties?: Record<string, unknown> }>;
  firestoreDocuments: FirestoreIdentityDoc[];
  manifest: ManifestIdentityFile;
  knownPosterIds: string[];
  identityRecords?: IdentityRecord[];
}

function pageTitle(page: { properties?: Record<string, unknown> }): string {
  return richTextValue(page.properties?.Name) || richTextValue(page.properties?.Title) || "";
}

function mediumDecision(
  posterId: string,
  manifestEntry: ManifestIdentityEntry | undefined,
): string {
  if (posterId === "stranger-things-2") {
    return "Visually confirm https://pbs.twimg.com/media/G9gZV6dWEAAOjjU?format=jpg&name=4096x4096 is the Butcher Billy Stranger Things poster for image 2/3; confirm Raindrop bookmark 1521167165 (title typo GgZVdWEAAOjjU) is the intended source.";
  }
  if (posterId === "the-substance-2") {
    return "Visually confirm https://pbs.twimg.com/media/HMtwlGHXgAAYt0L?format=jpg&name=medium is the Eileen Steinbach The Substance poster for image 2/2; decide whether the 690x1024 source is acceptable or re-source a higher-resolution original.";
  }
  return "Visually confirm the source image and source quality before creating this identity row.";
}

function sourceEvidence(manifestEntry: ManifestIdentityEntry | undefined): string[] {
  if (!manifestEntry) return [];
  const dimensions = manifestEntry.sourceDimensions
    ? `${manifestEntry.sourceDimensions.width}x${manifestEntry.sourceDimensions.height}`
    : "unknown";
  return [
    `source=${manifestEntry.sourceMimeType || "unknown"} ${dimensions} ${manifestEntry.sourceSizeBytes ?? "unknown"} bytes`,
    `sourceSha256=${manifestEntry.sourceSha256 || "unknown"}`,
    `bookmarkTitle=${manifestEntry.raindropBookmarkTitle || "none"}`,
  ];
}

function sortBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function buildIdentityBackfillPlan(input: BackfillPlanInput): BackfillPlan {
  const pages = input.pages || [];
  const firestoreDocuments = input.firestoreDocuments || [];
  const manifest = input.manifest || { entries: [] };
  const identityRecords = input.identityRecords || [];
  const knownPosterIds = new Set(input.knownPosterIds || []);

  const manifestById = new Map(manifest.entries.map((entry) => [entry.cineprintPosterId, entry]));
  const docsById = new Map(firestoreDocuments.map((doc) => [doc.id, doc]));
  const docsByPage = new Map<string, FirestoreIdentityDoc[]>();
  for (const doc of firestoreDocuments) {
    if (!doc.notionPageId) continue;
    if (!docsByPage.has(doc.notionPageId)) docsByPage.set(doc.notionPageId, []);
    docsByPage.get(doc.notionPageId)!.push(doc);
  }

  const recordsByPage = new Map<string, IdentityRecord[]>();
  for (const record of identityRecords) {
    if (!record.groupingPageId) continue;
    if (!recordsByPage.has(record.groupingPageId)) {
      recordsByPage.set(record.groupingPageId, []);
    }
    recordsByPage.get(record.groupingPageId)!.push(record);
  }

  const singlePosterAssignments: SinglePosterAssignment[] = [];
  const multiIdentityAssignments: MultiIdentityAssignment[] = [];
  const blocked: BlockedIdentity[] = [];
  const issues: BackfillIssue[] = [];
  const duplicateIds: BackfillIssue[] = [];
  const unknownIds: BackfillIssue[] = [];
  const newIds: BackfillIssue[] = [];
  const identityChanges: BackfillIssue[] = [];
  const proposedIds = new Map<string, string>();

  const addProposal = (posterId: string, location: string): boolean => {
    const normalized = normalizePosterId(posterId);
    if (!normalized.ok) {
      issues.push({
        kind: "INVALID_ID",
        posterId,
        detail: `${location} proposes an invalid poster ID (${normalized.reason})`,
      });
      return false;
    }
    if (!knownPosterIds.has(normalized.id)) {
      unknownIds.push({
        kind: "UNKNOWN_ID",
        posterId: normalized.id,
        detail: `${location} proposes an ID outside the 63-ID baseline`,
      });
      return false;
    }
    if (!docsById.has(normalized.id)) {
      unknownIds.push({
        kind: "MISSING_FIRESTORE_DOCUMENT",
        posterId: normalized.id,
        detail: `${location} proposes an ID with no Firestore document`,
      });
      return false;
    }
    if (proposedIds.has(normalized.id)) {
      duplicateIds.push({
        kind: "DUPLICATE_ID",
        posterId: normalized.id,
        detail: `${location} duplicates ${proposedIds.get(normalized.id)}`,
      });
      return false;
    }
    proposedIds.set(normalized.id, location);
    return true;
  };

  for (const page of pages) {
    const pageId = String(page.id);
    const images = imageUrlsFromPage(page);
    if (images.length === 0) continue;
    const title = pageTitle(page);

    if (images.length === 1) {
      const matches = (docsByPage.get(pageId) || []).filter((doc) => doc.image === images[0]);
      const canonical = canonicalPosterIdFromPage(page);
      const currentValue =
        canonical.status === "present"
          ? canonical.posterId!
          : canonical.status === "invalid"
            ? (canonical.raw ?? null)
            : null;

      if (matches.length !== 1) {
        const reason = matches.length === 0 ? "NO_FIRESTORE_DOCUMENT" : "AMBIGUOUS_IMAGE_MATCH";
        issues.push({
          kind: reason,
          pageId,
          detail: `${title || pageId} has ${matches.length} Firestore document(s) for its single image`,
        });
        blocked.push({
          posterId: matches[0]?.id ?? "",
          groupingPageId: pageId,
          groupingPageTitle: title,
          imageUrl: images[0],
          raindropId: null,
          confidence: "none",
          reason,
          requiredDecision:
            "Resolve the Firestore/image association before assigning a canonical ID.",
          evidence: [`page=${pageId}`, `image=${images[0]}`],
        });
        continue;
      }

      const doc = matches[0];
      const manifestEntry = manifestById.get(doc.id);
      const reasons: string[] = [];
      if (!manifestEntry) {
        reasons.push("No manifest entry for the Firestore document");
        issues.push({
          kind: "MISSING_MANIFEST_ENTRY",
          posterId: doc.id,
          pageId,
          detail: "No manifest entry for the Firestore document",
        });
      } else if (manifestEntry.notionPageId !== pageId) {
        reasons.push("Manifest notionPageId differs from the page");
        issues.push({
          kind: "PAGE_MISMATCH",
          posterId: doc.id,
          pageId,
          detail: `Manifest page ${manifestEntry.notionPageId} differs from ${pageId}`,
        });
      }

      let action: AssignmentAction = reasons.length > 0 ? "BLOCK" : "ADD";
      if (canonical.status === "present") {
        if (canonical.posterId !== doc.id) {
          action = "BLOCK";
          reasons.push("Existing CinePrint Poster ID conflicts with the proposed ID");
          identityChanges.push({
            kind: "IDENTITY_CHANGE",
            posterId: doc.id,
            pageId,
            detail: `Existing value ${canonical.posterId} differs from ${doc.id}`,
          });
        } else {
          action = "KEEP";
        }
      } else if (canonical.status === "invalid") {
        action = "BLOCK";
        reasons.push("Existing property is invalid");
      }

      if (!addProposal(doc.id, pageId)) {
        action = "BLOCK";
        reasons.push("Proposal failed identity validation");
      }

      singlePosterAssignments.push({
        operation: "UPDATE_PAGE_PROPERTY",
        target: { pageId, dataSource: "Poster Library" },
        property: "CinePrint Poster ID",
        pageId,
        pageTitle: title,
        currentValue,
        proposedValue: doc.id,
        firestoreImageUrl: doc.image,
        manifestId: manifestEntry?.cineprintPosterId ?? "",
        confidence: manifestEntry?.identityConfidence ?? "none",
        action,
        validation: { ok: action !== "BLOCK", reasons },
        evidence: [
          `page=${pageId}`,
          `firestore=${doc.id}`,
          `image=${doc.image}`,
          `manifestConfidence=${manifestEntry?.identityConfidence ?? "none"}`,
        ],
      });
      continue;
    }

    for (const imageUrl of images) {
      const matches = (docsByPage.get(pageId) || []).filter((doc) => doc.image === imageUrl);
      if (matches.length !== 1) {
        const reason =
          matches.length === 0 ? "NEW_IMAGE_WITHOUT_IDENTITY" : "AMBIGUOUS_IMAGE_MATCH";
        issues.push({
          kind: reason,
          pageId,
          detail: `${title || pageId} has ${matches.length} Firestore document(s) for an image`,
        });
        blocked.push({
          posterId: matches[0]?.id ?? "",
          groupingPageId: pageId,
          groupingPageTitle: title,
          imageUrl,
          raindropId: null,
          confidence: "none",
          reason,
          requiredDecision: "Resolve the image identity before creating a Poster Identities row.",
          evidence: [`page=${pageId}`, `image=${imageUrl}`],
        });
        continue;
      }

      const doc = matches[0];
      const manifestEntry = manifestById.get(doc.id);
      const confidence = manifestEntry?.identityConfidence ?? "none";
      const existingRecords = recordsByPage.get(pageId) || [];
      const matchingRecords = existingRecords.filter(
        (record) => record.posterId === doc.id || record.imageUrl === imageUrl,
      );
      const activeRecords = matchingRecords.filter(
        (record) => (record.status || "active") === "active",
      );

      if (confidence !== "high") {
        blocked.push({
          posterId: doc.id,
          groupingPageId: pageId,
          groupingPageTitle: title,
          imageUrl,
          raindropId: manifestEntry?.raindropId ?? null,
          confidence,
          reason: confidence === "medium" ? "HUMAN_REVIEW_REQUIRED" : "LOW_CONFIDENCE",
          requiredDecision:
            confidence === "medium"
              ? mediumDecision(doc.id, manifestEntry)
              : "Resolve the low-confidence identity before creating this row.",
          evidence: [
            `page=${pageId}`,
            `firestore=${doc.id}`,
            `image=${imageUrl}`,
            `raindrop=${manifestEntry?.raindropId ?? "none"}`,
            `confidence=${confidence}`,
            ...sourceEvidence(manifestEntry),
          ],
        });
        continue;
      }

      const reasons: string[] = [];
      if (!manifestEntry) {
        reasons.push("No manifest entry for the Firestore document");
        issues.push({
          kind: "MISSING_MANIFEST_ENTRY",
          posterId: doc.id,
          pageId,
          detail: "No manifest entry for the Firestore document",
        });
      } else if (manifestEntry.notionPageId !== pageId) {
        reasons.push("Manifest notionPageId differs from the page");
        issues.push({
          kind: "PAGE_MISMATCH",
          posterId: doc.id,
          pageId,
          detail: `Manifest page ${manifestEntry.notionPageId} differs from ${pageId}`,
        });
      }

      let action: AssignmentAction = reasons.length > 0 ? "BLOCK" : "ADD";
      let currentRecord: IdentityRecord | null = null;
      if (activeRecords.length > 1) {
        action = "BLOCK";
        reasons.push("Multiple active identity records match this poster/image");
      } else if (activeRecords.length === 0 && matchingRecords.length > 0) {
        action = "BLOCK";
        reasons.push("Existing identity record is not active");
      } else if (activeRecords.length === 1) {
        currentRecord = activeRecords[0];
        if (
          currentRecord.posterId === doc.id &&
          currentRecord.groupingPageId === pageId &&
          currentRecord.imageUrl === imageUrl
        ) {
          action = "KEEP";
        } else {
          action = "BLOCK";
          reasons.push("Existing identity record conflicts with the proposed record");
        }
      }

      if (!addProposal(doc.id, pageId)) {
        action = "BLOCK";
        reasons.push("Proposal failed identity validation");
      }

      multiIdentityAssignments.push({
        operation: "CREATE_DATA_SOURCE_PAGE",
        target: { dataSource: "Poster Identities", groupingPageId: pageId },
        record: {
          posterId: doc.id,
          groupingPageId: pageId,
          imageUrl,
          raindropId: manifestEntry?.raindropId ?? null,
          sourceProvider: manifestEntry?.sourceProvider ?? "unknown",
          sourceSha256: manifestEntry?.sourceSha256 ?? null,
          sourceRevision: 1,
          status: "active",
          verifiedAt: null,
        },
        groupingPageTitle: title,
        currentValue: currentRecord,
        proposedValue: doc.id,
        confidence,
        action,
        validation: { ok: action !== "BLOCK", reasons },
        evidence: [
          `page=${pageId}`,
          `firestore=${doc.id}`,
          `image=${imageUrl}`,
          `raindrop=${manifestEntry?.raindropId ?? "none"}`,
          `confidence=${confidence}`,
        ],
      });
    }
  }

  const pageIds = new Set(pages.map((page) => String(page.id)));
  const pageImages = new Map(
    pages.map((page) => [String(page.id), new Set(imageUrlsFromPage(page))]),
  );
  const orphanedIdentityRecords: OrphanedIdentityRecord[] = [];
  for (const record of identityRecords) {
    if (!record.groupingPageId) {
      orphanedIdentityRecords.push({
        identityRecordId: record.identityRecordId,
        posterId: record.posterId,
        groupingPageId: null,
        reason: "MISSING_GROUPING_PAGE",
      });
      continue;
    }
    if (!pageIds.has(record.groupingPageId)) {
      orphanedIdentityRecords.push({
        identityRecordId: record.identityRecordId,
        posterId: record.posterId,
        groupingPageId: record.groupingPageId,
        reason: "INVALID_GROUPING_PAGE",
      });
      continue;
    }
    if (!pageImages.get(record.groupingPageId)?.has(record.imageUrl)) {
      orphanedIdentityRecords.push({
        identityRecordId: record.identityRecordId,
        posterId: record.posterId,
        groupingPageId: record.groupingPageId,
        reason: "IMAGE_NOT_ON_PAGE",
      });
    }
  }

  const orphanedFirestoreDocuments = firestoreDocuments
    .filter((doc) => !doc.notionPageId || !pageIds.has(doc.notionPageId))
    .map((doc) => ({
      posterId: doc.id,
      notionPageId: doc.notionPageId,
      reason: doc.notionPageId ? "NOTION_PAGE_MISSING" : "NO_NOTION_PAGE_ASSOCIATION",
    }));

  const coveredIds = new Set([
    ...singlePosterAssignments.map((assignment) => assignment.proposedValue),
    ...multiIdentityAssignments.map((assignment) => assignment.record.posterId),
    ...blocked.map((entry) => entry.posterId).filter(Boolean),
  ]);
  const missingProposedIds = firestoreDocuments
    .map((doc) => doc.id)
    .filter((id) => !coveredIds.has(id));
  const extraProposedIds = [...proposedIds.keys()].filter((id) => !knownPosterIds.has(id));

  const conflictingAssignments = [
    ...singlePosterAssignments.filter((assignment) => assignment.action === "BLOCK"),
    ...multiIdentityAssignments.filter((assignment) => assignment.action === "BLOCK"),
  ];
  const singleAdd = singlePosterAssignments.filter((a) => a.action === "ADD").length;
  const singleKeep = singlePosterAssignments.filter((a) => a.action === "KEEP").length;
  const singleBlocked = singlePosterAssignments.filter((a) => a.action === "BLOCK").length;
  const multiAdd = multiIdentityAssignments.filter((a) => a.action === "ADD").length;
  const multiKeep = multiIdentityAssignments.filter((a) => a.action === "KEEP").length;
  const multiBlocked = multiIdentityAssignments.filter((a) => a.action === "BLOCK").length;
  const multiHigh = multiIdentityAssignments.filter((a) => a.confidence === "high").length;
  const multiMedium = blocked.filter((b) => b.reason === "HUMAN_REVIEW_REQUIRED").length;
  const multiPages = unique(
    multiIdentityAssignments
      .map((a) => a.record.groupingPageId)
      .concat(blocked.map((b) => b.groupingPageId)),
  ).length;

  const allIssues = sortBy(
    [...issues, ...duplicateIds, ...unknownIds, ...newIds, ...identityChanges],
    (issue) => `${issue.kind}|${issue.posterId ?? ""}|${issue.pageId ?? ""}|${issue.detail}`,
  );
  const validationOk =
    issues.length === 0 &&
    duplicateIds.length === 0 &&
    unknownIds.length === 0 &&
    newIds.length === 0 &&
    conflictingAssignments.length === 0 &&
    identityChanges.length === 0 &&
    orphanedIdentityRecords.length === 0 &&
    missingProposedIds.length === 0;

  return {
    schemaVersion: 1,
    source: {
      notionPages: pages.length,
      firestoreDocuments: firestoreDocuments.length,
      manifestEntries: manifest.entries.length,
      identityRecords: identityRecords.length,
    },
    counts: {
      singlePages: singlePosterAssignments.length,
      singleAdd,
      singleKeep,
      singleBlocked,
      multiPages,
      multiIdentities: multiIdentityAssignments.length + blocked.length,
      multiHigh,
      multiMedium,
      multiAdd,
      multiKeep,
      multiBlocked,
      totalPosterIdentities:
        singlePosterAssignments.length + multiIdentityAssignments.length + blocked.length,
      autoBackfillable: singleAdd + singleKeep + multiAdd + multiKeep,
      unresolved: blocked.length,
      duplicateIds: duplicateIds.length,
      unknownIds: unknownIds.length,
      conflictingAssignments: conflictingAssignments.length,
      newIds: newIds.length,
      identityChanges: identityChanges.length,
      orphanedIdentityRecords: orphanedIdentityRecords.length,
    },
    singlePosterAssignments: sortBy(singlePosterAssignments, (a) => a.pageId),
    multiIdentityAssignments: sortBy(
      multiIdentityAssignments,
      (a) => `${a.record.groupingPageId}|${a.record.posterId}`,
    ),
    blocked: sortBy(blocked, (b) => `${b.groupingPageId}|${b.posterId}`),
    orphanedIdentityRecords: sortBy(
      orphanedIdentityRecords,
      (record) => `${record.groupingPageId || ""}|${record.posterId}|${record.reason}`,
    ),
    orphanedFirestoreDocuments: sortBy(orphanedFirestoreDocuments, (doc) => doc.posterId),
    validation: {
      ok: validationOk,
      issues: allIssues,
      missingProposedIds: [...missingProposedIds].sort(),
      extraProposedIds: [...extraProposedIds].sort(),
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

interface NotionPageLike {
  id: string;
  properties?: Record<string, unknown>;
}

interface NotionQueryLike {
  results?: NotionPageLike[];
  has_more?: boolean;
  next_cursor?: string | null;
}

interface NotionDatabaseLike {
  data_sources?: Array<{ id: string }>;
}

async function fetchAllNotionPages(notion: Client, databaseId: string) {
  const database = (await notion.databases.retrieve({
    database_id: databaseId,
  })) as unknown as NotionDatabaseLike;
  const dataSourceId = database.data_sources?.[0]?.id;
  const pages: NotionPageLike[] = [];
  let cursor: string | undefined;
  do {
    const response = (dataSourceId
      ? await notion.dataSources.query({
          data_source_id: dataSourceId,
          start_cursor: cursor,
          page_size: 100,
        })
      : await notion.databases.query({
          database_id: databaseId,
          start_cursor: cursor,
          page_size: 100,
        })) as unknown as NotionQueryLike;
    pages.push(...(response.results || []));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return pages;
}

async function fetchIdentityRecords(notion: Client): Promise<IdentityRecord[]> {
  const dataSourceId = process.env.NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID?.trim();
  if (!dataSourceId) return [];
  const rows: NotionPageLike[] = [];
  let cursor: string | undefined;
  do {
    const response = (await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    })) as unknown as NotionQueryLike;
    rows.push(...(response.results || []));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return identityRecordsFromNotion(rows);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function printSummary(plan: BackfillPlan) {
  console.log("Identity backfill preflight summary:");
  console.log(JSON.stringify(plan.counts, null, 2));
  if (plan.blocked.length > 0) {
    console.log("Blocked identities:");
    for (const entry of plan.blocked) {
      console.log(
        `- ${entry.posterId || "(no id)"} | ${entry.groupingPageTitle || entry.groupingPageId} | ${entry.reason} | confidence=${entry.confidence}`,
      );
      if (entry.requiredDecision) console.log(`  decision: ${entry.requiredDecision}`);
    }
  }
  if (!plan.validation.ok) {
    console.log("Validation issues:");
    for (const issue of plan.validation.issues) {
      console.log(`- ${issue.kind} | ${issue.posterId || ""} | ${issue.detail}`);
    }
    if (plan.validation.missingProposedIds.length) {
      console.log(`- Missing proposed IDs: ${plan.validation.missingProposedIds.join(", ")}`);
    }
    if (plan.validation.extraProposedIds.length) {
      console.log(`- Extra proposed IDs: ${plan.validation.extraProposedIds.join(", ")}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const unknown = args.filter((arg) => !["--json", "--dry-run"].includes(arg));
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  if (!dryRun && !json) {
    // The planner is dry-run only; no write flag exists.
    console.log("Planner is read-only. No Notion or Firestore writes are available.");
  }

  dotenv.config({ quiet: true });
  const notionKey = process.env.NOTION_KEY || process.env.NOTION_API_KEY || "";
  const databaseId = process.env.NOTION_DATABASE_ID || "";
  if (!notionKey || !databaseId) {
    throw new Error("NOTION_KEY and NOTION_DATABASE_ID are required");
  }

  const notion = new Client({ auth: notionKey });
  const pages = await fetchAllNotionPages(notion, databaseId);
  const identityRecords = await fetchIdentityRecords(notion);
  const snapshot = readJson<{ documents: FirestoreIdentityDoc[] }>(
    path.join(process.cwd(), "migration", "firestore-identities.json"),
  );
  const manifest = readJson<ManifestIdentityFile>(
    path.join(process.cwd(), "migration", "poster-manifest.json"),
  );

  const plan = buildIdentityBackfillPlan({
    pages,
    firestoreDocuments: snapshot.documents,
    manifest,
    knownPosterIds: snapshot.documents.map((doc) => doc.id),
    identityRecords,
  });

  if (json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    printSummary(plan);
    console.log("No Notion or Firestore writes performed.");
  }

  if (!plan.validation.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error("Identity backfill planning failed:", error);
    process.exit(1);
  });
}
