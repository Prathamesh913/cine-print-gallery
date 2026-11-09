import { describe, expect, it } from "vitest";
import {
  buildIdentityBackfillPlan,
  type BackfillPlanInput,
} from "../../scripts/plan-identity-backfill";
import { buildSyncPlan, type IdentityRecord } from "../../scripts/poster-identity.js";
import { parsePageData } from "../../scripts/sync-notion-to-firestore.js";
import {
  buildPreBackfillFixture,
  buildProposedBackfillFixture,
  richText,
  title,
  url,
} from "./fixtures";

const STRANGER_PAGE = "38c890a5-f3e2-80fa-bf29-e86e56cd77a2";
const BUGONIA_PAGE = "3ab890a5-f3e2-80cc-a499-f1d4aa68ab07";
const BACKROOMS_PAGE = "38d890a5-f3e2-8002-bd6d-d95cf0f42567";

function fixture() {
  return structuredClone(buildPreBackfillFixture());
}

function planFor(f: ReturnType<typeof fixture>, overrides: Partial<BackfillPlanInput> = {}) {
  return buildIdentityBackfillPlan({
    pages: f.pages,
    firestoreDocuments: f.firestoreDocuments,
    manifest: f.manifest,
    knownPosterIds: f.knownPosterIds,
    identityRecords: f.identityRecords,
    ...overrides,
  });
}

function pageOf(f: ReturnType<typeof fixture>, pageId: string) {
  const page = f.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`Missing fixture page ${pageId}`);
  return page;
}

function setCanonical(page: ReturnType<typeof pageOf>, value: string) {
  page.properties["CinePrint Poster ID"] = richText(value);
}

describe("identity backfill planner", () => {
  it("produces the expected pre-backfill counts", () => {
    const plan = planFor(fixture());
    expect(plan.counts).toMatchObject({
      singlePages: 51,
      singleAdd: 51,
      singleKeep: 0,
      singleBlocked: 0,
      multiPages: 5,
      multiIdentities: 12,
      multiHigh: 10,
      multiMedium: 2,
      multiAdd: 10,
      multiKeep: 0,
      multiBlocked: 0,
      totalPosterIdentities: 63,
      autoBackfillable: 61,
      unresolved: 2,
      duplicateIds: 0,
      unknownIds: 0,
      conflictingAssignments: 0,
      newIds: 0,
      identityChanges: 0,
    });
    expect(plan.validation.ok).toBe(true);
    expect(plan.validation.issues).toEqual([]);
    expect(plan.validation.missingProposedIds).toEqual([]);
  });

  it("proposes 51 single-page property assignments", () => {
    const plan = planFor(fixture());
    expect(plan.singlePosterAssignments).toHaveLength(51);
    for (const assignment of plan.singlePosterAssignments) {
      expect(assignment.operation).toBe("UPDATE_PAGE_PROPERTY");
      expect(assignment.property).toBe("CinePrint Poster ID");
      expect(assignment.action).toBe("ADD");
      expect(assignment.currentValue).toBeNull();
      expect(assignment.proposedValue).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(assignment.firestoreImageUrl).toMatch(/^https:\/\//);
    }
  });

  it("proposes exactly ten high-confidence multi-image identity records", () => {
    const plan = planFor(fixture());
    expect(plan.multiIdentityAssignments).toHaveLength(10);
    for (const assignment of plan.multiIdentityAssignments) {
      expect(assignment.operation).toBe("CREATE_DATA_SOURCE_PAGE");
      expect(assignment.action).toBe("ADD");
      expect(assignment.confidence).toBe("high");
      expect(assignment.record.status).toBe("active");
      expect(assignment.record.groupingPageId).toBe(assignment.target.groupingPageId);
      expect(assignment.record.imageUrl).toMatch(/^https:\/\//);
    }
  });

  it("leaves the two medium-confidence identities blocked with human decisions", () => {
    const plan = planFor(fixture());
    const blockedIds = plan.blocked.map((entry) => entry.posterId).sort();
    expect(blockedIds).toEqual(["stranger-things-2", "the-substance-2"]);
    for (const entry of plan.blocked) {
      expect(entry.reason).toBe("HUMAN_REVIEW_REQUIRED");
      expect(entry.confidence).toBe("medium");
      expect(entry.requiredDecision).toBeTruthy();
      expect(entry.evidence.some((line) => line.startsWith("image="))).toBe(true);
    }
    expect(
      plan.multiIdentityAssignments.some(
        (assignment) =>
          assignment.record.posterId === "stranger-things-2" ||
          assignment.record.posterId === "the-substance-2",
      ),
    ).toBe(false);
  });

  it("covers exactly the 63 existing IDs and preserves the three canaries", () => {
    const f = fixture();
    const plan = planFor(f);
    const covered = new Set([
      ...plan.singlePosterAssignments.map((assignment) => assignment.proposedValue),
      ...plan.multiIdentityAssignments.map((assignment) => assignment.record.posterId),
      ...plan.blocked.map((entry) => entry.posterId).filter(Boolean),
    ]);
    expect(covered.size).toBe(63);
    expect([...covered].sort()).toEqual([...f.knownPosterIds].sort());
    for (const canary of ["2001-a-space-odyssey", "bugonia", "artwork-1824607248"]) {
      expect(covered.has(canary)).toBe(true);
    }
  });

  it("is idempotent for unchanged inputs", () => {
    const first = planFor(fixture());
    const second = planFor(fixture());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("keeps an existing matching property value", () => {
    const f = fixture();
    const page = pageOf(f, BUGONIA_PAGE);
    setCanonical(page, "bugonia");
    const plan = planFor(f);
    expect(plan.counts.singleKeep).toBe(1);
    expect(plan.counts.singleAdd).toBe(50);
    expect(
      plan.singlePosterAssignments.find((assignment) => assignment.pageId === BUGONIA_PAGE)?.action,
    ).toBe("KEEP");
    expect(plan.validation.ok).toBe(true);
  });

  it("treats an empty property value as ADD", () => {
    const f = fixture();
    const page = pageOf(f, BUGONIA_PAGE);
    page.properties["CinePrint Poster ID"] = { type: "rich_text", rich_text: [] };
    const plan = planFor(f);
    expect(plan.counts.singleAdd).toBe(51);
    expect(
      plan.singlePosterAssignments.find((assignment) => assignment.pageId === BUGONIA_PAGE)?.action,
    ).toBe("ADD");
    expect(
      plan.singlePosterAssignments.find((assignment) => assignment.pageId === BUGONIA_PAGE)
        ?.currentValue,
    ).toBeNull();
    expect(plan.validation.ok).toBe(true);
  });

  it("blocks an existing conflicting property value", () => {
    const f = fixture();
    const page = pageOf(f, BUGONIA_PAGE);
    setCanonical(page, "her");
    const plan = planFor(f);
    expect(plan.counts.singleBlocked).toBe(1);
    expect(plan.validation.ok).toBe(false);
    expect(plan.counts.identityChanges).toBe(1);
    expect(
      plan.singlePosterAssignments.find((assignment) => assignment.pageId === BUGONIA_PAGE)?.action,
    ).toBe("BLOCK");
  });

  it("blocks an unknown proposed ID", () => {
    const f = fixture();
    const doc = f.firestoreDocuments.find((entry) => entry.id === "bugonia")!;
    doc.id = "unknown-999";
    const plan = planFor(f);
    expect(plan.validation.ok).toBe(false);
    expect(plan.counts.unknownIds).toBeGreaterThan(0);
    expect(
      plan.singlePosterAssignments.find((assignment) => assignment.pageId === BUGONIA_PAGE)?.action,
    ).toBe("BLOCK");
  });

  it("blocks a manifest/page mismatch", () => {
    const f = fixture();
    const entry = f.manifest.entries.find(
      (candidate) => candidate.cineprintPosterId === "bugonia",
    )!;
    entry.notionPageId = STRANGER_PAGE;
    const plan = planFor(f);
    expect(plan.validation.ok).toBe(false);
    expect(
      plan.singlePosterAssignments.find((assignment) => assignment.pageId === BUGONIA_PAGE)?.action,
    ).toBe("BLOCK");
  });

  it("blocks a page image with no Firestore document", () => {
    const f = fixture();
    const page = pageOf(f, BUGONIA_PAGE);
    (page.properties["Image URL"] as { url: string }).url = "https://example.invalid/missing.jpg";
    const plan = planFor(f);
    expect(plan.validation.ok).toBe(false);
    expect(
      plan.blocked.some(
        (entry) =>
          entry.groupingPageId === BUGONIA_PAGE && entry.reason === "NO_FIRESTORE_DOCUMENT",
      ),
    ).toBe(true);
  });

  it("keeps an existing matching identity record", () => {
    const f = fixture();
    const record: IdentityRecord = {
      identityRecordId: "identity-stranger-1",
      posterId: "stranger-things-1",
      groupingPageId: STRANGER_PAGE,
      groupingPageIds: [STRANGER_PAGE],
      imageUrl:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1532498759.png",
      raindropId: "1532498759",
      provider: "raindrop-file",
      sha256: null,
      revision: 1,
      status: "active",
    };
    f.identityRecords.push(record);
    const plan = planFor(f);
    expect(plan.counts.multiKeep).toBe(1);
    expect(plan.counts.multiAdd).toBe(9);
    expect(
      plan.multiIdentityAssignments.find(
        (assignment) => assignment.record.posterId === "stranger-things-1",
      )?.action,
    ).toBe("KEEP");
    expect(plan.validation.ok).toBe(true);
  });

  it("blocks a conflicting existing identity record", () => {
    const f = fixture();
    f.identityRecords.push({
      identityRecordId: "identity-conflict",
      posterId: "stranger-things-1",
      groupingPageId: STRANGER_PAGE,
      groupingPageIds: [STRANGER_PAGE],
      imageUrl: "https://example.invalid/other.jpg",
      raindropId: null,
      provider: "other",
      sha256: null,
      revision: 1,
      status: "active",
    });
    const plan = planFor(f);
    expect(plan.validation.ok).toBe(false);
    expect(
      plan.multiIdentityAssignments.find(
        (assignment) => assignment.record.posterId === "stranger-things-1",
      )?.action,
    ).toBe("BLOCK");
  });

  it("blocks duplicate proposed IDs", () => {
    const f = fixture();
    const bugonia = f.firestoreDocuments.find((doc) => doc.id === "bugonia")!;
    f.pages.push({
      id: "duplicate-page",
      properties: {
        Name: title("Duplicate"),
        "Image URL": url(bugonia.image),
      },
    });
    f.firestoreDocuments.push({ ...bugonia, notionPageId: "duplicate-page" });
    const plan = planFor(f);
    expect(plan.validation.ok).toBe(false);
    expect(plan.counts.duplicateIds).toBeGreaterThan(0);
  });

  it("detects orphaned identity records", () => {
    const f = fixture();
    f.identityRecords.push({
      identityRecordId: "orphan-record",
      posterId: "bugonia",
      groupingPageId: STRANGER_PAGE,
      groupingPageIds: [STRANGER_PAGE],
      imageUrl: "https://example.invalid/orphan.jpg",
      raindropId: null,
      provider: "other",
      sha256: null,
      revision: 1,
      status: "active",
    });
    const plan = planFor(f);
    expect(plan.validation.ok).toBe(false);
    expect(plan.counts.orphanedIdentityRecords).toBe(1);
    expect(plan.orphanedIdentityRecords[0]).toMatchObject({
      identityRecordId: "orphan-record",
      reason: "IMAGE_NOT_ON_PAGE",
    });
  });

  it("detects orphaned Firestore documents", () => {
    const f = fixture();
    f.firestoreDocuments.push({
      id: "orphan-doc",
      notionPageId: "missing-page",
      image: "https://example.invalid/orphan.jpg",
      title: "Orphan",
      status: "published",
    });
    const plan = planFor(f);
    expect(plan.orphanedFirestoreDocuments.some((doc) => doc.posterId === "orphan-doc")).toBe(true);
    expect(plan.validation.ok).toBe(false);
    expect(plan.validation.missingProposedIds).toContain("orphan-doc");
  });

  it("resolves 61 high-confidence identities and leaves the two medium entries unresolved", () => {
    const fixture = buildProposedBackfillFixture();
    const plan = buildSyncPlan({
      ...fixture,
      parsePage: parsePageData,
      mode: "canonical",
      allowLegacy: false,
    });
    expect(plan.records).toHaveLength(61);
    expect(plan.resolution.resolved).toHaveLength(61);
    expect(plan.unresolved).toHaveLength(2);
    expect(plan.unresolved.map((entry) => entry.reason).sort()).toEqual([
      "NEW_IMAGE_WITHOUT_IDENTITY",
      "NEW_IMAGE_WITHOUT_IDENTITY",
    ]);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.firestore.potentialCreates).toBe(0);
    expect(
      plan.records.every((record) => record.identity.identitySource !== "legacy_position"),
    ).toBe(true);
  });

  it("blocks a non-active existing identity record", () => {
    const f = fixture();
    f.identityRecords.push({
      identityRecordId: "identity-superseded",
      posterId: "stranger-things-1",
      groupingPageId: STRANGER_PAGE,
      groupingPageIds: [STRANGER_PAGE],
      imageUrl:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1532498759.png",
      raindropId: "1532498759",
      provider: "raindrop-file",
      sha256: null,
      revision: 1,
      status: "superseded",
    });
    const plan = planFor(f);
    expect(plan.validation.ok).toBe(false);
    expect(
      plan.multiIdentityAssignments.find(
        (assignment) => assignment.record.posterId === "stranger-things-1",
      )?.action,
    ).toBe("BLOCK");
  });

  it("does not invent IDs or extra records", () => {
    const f = fixture();
    const plan = planFor(f);
    const known = new Set(f.knownPosterIds);
    for (const assignment of plan.singlePosterAssignments) {
      expect(known.has(assignment.proposedValue)).toBe(true);
    }
    for (const assignment of plan.multiIdentityAssignments) {
      expect(known.has(assignment.record.posterId)).toBe(true);
    }
    expect(plan.validation.extraProposedIds).toEqual([]);
    expect(plan.validation.missingProposedIds).toEqual([]);
  });
});
