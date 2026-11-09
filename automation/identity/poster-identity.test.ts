import { describe, expect, it, vi } from "vitest";
import {
  applySyncPlan,
  buildSyncPlan,
  canonicalPosterIdFromPage,
  identityRecordsFromNotion,
  normalizePosterId,
  resolveNotionIdentities,
  richTextValue,
} from "../../scripts/poster-identity.js";
import { parsePage, parsePageData } from "../../scripts/sync-notion-to-firestore.js";
import { buildPostBackfillFixture, loadManifest, relation, richText, url } from "./fixtures";

const STRANGER_PAGE = "38c890a5-f3e2-80fa-bf29-e86e56cd77a2";
const BACKROOMS_PAGE = "38d890a5-f3e2-8002-bd6d-d95cf0f42567";
const BUGONIA_PAGE = "3ab890a5-f3e2-80cc-a499-f1d4aa68ab07";

function fixture() {
  return structuredClone(buildPostBackfillFixture());
}

function planFor(f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  return buildSyncPlan({
    ...f,
    ...overrides,
    parsePage: parsePageData,
    mode: (overrides.mode as "legacy" | "transition" | "canonical" | undefined) ?? "canonical",
    allowLegacy: (overrides.allowLegacy as boolean) ?? false,
    prune: (overrides.prune as boolean) ?? false,
    pruneAllowed: (overrides.pruneAllowed as boolean) ?? false,
  });
}

function idsOf(plan: ReturnType<typeof planFor>) {
  return plan.records.map((record) => record.id).sort();
}

function pageOf(f: ReturnType<typeof fixture>, pageId: string) {
  const page = f.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`Missing fixture page ${pageId}`);
  return page;
}

function imageUrls(page: ReturnType<typeof pageOf>) {
  const prop = page.properties["Image URL"] as { url: string };
  return prop.url
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function setImageUrls(page: ReturnType<typeof pageOf>, urls: string[]) {
  (page.properties["Image URL"] as { url: string }).url = urls.join(", ");
}

function richTextOf(page: ReturnType<typeof pageOf>, property: string): string {
  const prop = page.properties[property] as
    { rich_text?: Array<{ plain_text?: string }> } | undefined;
  return (prop?.rich_text ?? []).map((part) => part.plain_text ?? "").join("");
}

describe("poster identity primitives", () => {
  it("joins every rich-text segment", () => {
    expect(
      richTextValue({
        type: "rich_text",
        rich_text: [{ plain_text: "bug" }, { plain_text: "onia" }],
      }),
    ).toBe("bugonia");
  });

  it("trims whitespace and accepts a valid ID", () => {
    expect(normalizePosterId("  bugonia  ")).toMatchObject({
      ok: true,
      id: "bugonia",
      hadWhitespace: true,
    });
  });

  it("rejects empty and invalid IDs", () => {
    expect(normalizePosterId("   ")).toMatchObject({ ok: false, reason: "EMPTY" });
    expect(normalizePosterId("Bugonia")).toMatchObject({
      ok: false,
      reason: "INVALID_FORMAT",
    });
    expect(normalizePosterId("bad_id")).toMatchObject({
      ok: false,
      reason: "INVALID_FORMAT",
    });
  });

  it("trims surrounding whitespace in the canonical property", () => {
    const result = canonicalPosterIdFromPage({
      properties: {
        "CinePrint Poster ID": {
          type: "rich_text",
          rich_text: [{ plain_text: "  bugonia  " }],
        },
      },
    });
    expect(result).toMatchObject({
      status: "present",
      posterId: "bugonia",
      hadWhitespace: true,
    });
  });

  it("parses multiple rich-text segments from the canonical property", () => {
    const result = canonicalPosterIdFromPage({
      properties: {
        "CinePrint Poster ID": {
          type: "rich_text",
          rich_text: [{ plain_text: "bug" }, { plain_text: "onia" }],
        },
      },
    });
    expect(result).toMatchObject({ status: "present", posterId: "bugonia" });
  });

  it("distinguishes absent, empty, invalid and present canonical properties", () => {
    expect(canonicalPosterIdFromPage({ properties: {} })).toEqual({
      status: "absent",
    });
    expect(
      canonicalPosterIdFromPage({
        properties: { "CinePrint Poster ID": { type: "rich_text", rich_text: [] } },
      }),
    ).toMatchObject({ status: "empty" });
    expect(
      canonicalPosterIdFromPage({
        properties: {
          "CinePrint Poster ID": { type: "rich_text", rich_text: [{ plain_text: "Bad ID" }] },
        },
      }),
    ).toMatchObject({ status: "invalid", reason: "INVALID_FORMAT" });
    expect(
      canonicalPosterIdFromPage({
        properties: { "CinePrint Poster ID": { type: "url", url: "bugonia" } },
      }),
    ).toMatchObject({ status: "invalid", reason: "INVALID_PROPERTY_TYPE" });
  });

  it("reports conflicting relation and text fallback targets", () => {
    const [record] = identityRecordsFromNotion([
      {
        id: "identity-conflict",
        properties: {
          "Poster ID": richText("bugonia"),
          "Grouping Page": relation([BUGONIA_PAGE]),
          "Grouping Page ID": richText(STRANGER_PAGE),
          "Image URL": url("https://example.com/bugonia.jpg"),
        },
      },
    ]);
    expect(record.groupingPageIds).toEqual([BUGONIA_PAGE, STRANGER_PAGE]);
  });

  it("maps relation and text fallback identity records", () => {
    const [viaRelation] = identityRecordsFromNotion([
      {
        id: "identity-1",
        properties: {
          "Poster ID": richText("bugonia"),
          "Grouping Page": relation([BUGONIA_PAGE]),
          "Image URL": url("https://example.com/bugonia.jpg"),
          "Raindrop ID": richText("1791459718"),
          "Source Provider": { type: "select", select: { name: "pbs-twimg" } },
          "Source Revision": { type: "number", number: 2 },
          Status: { type: "select", select: { name: "active" } },
        },
      },
    ]);
    expect(viaRelation).toMatchObject({
      posterId: "bugonia",
      groupingPageId: BUGONIA_PAGE,
      groupingPageIds: [BUGONIA_PAGE],
      imageUrl: "https://example.com/bugonia.jpg",
      raindropId: "1791459718",
      provider: "pbs-twimg",
      revision: 2,
      status: "active",
    });

    const [viaFallback] = identityRecordsFromNotion([
      {
        id: "identity-2",
        properties: {
          "Poster ID": richText("bugonia"),
          "Grouping Page ID": richText(BUGONIA_PAGE),
          "Image URL": url("https://example.com/bugonia.jpg"),
        },
      },
    ]);
    expect(viaFallback).toMatchObject({
      groupingPageId: BUGONIA_PAGE,
      revision: 1,
      status: "active",
    });
  });
});

describe("canonical identity resolution", () => {
  it("resolves all 63 existing IDs with the post-backfill fixture", () => {
    const plan = planFor(fixture());
    expect(plan.ok).toBe(true);
    expect(plan.records).toHaveLength(63);
    expect(new Set(plan.records.map((record) => record.id)).size).toBe(63);
    expect(plan.summary.identity.notionProperty).toBe(51);
    expect(plan.summary.identity.perImageRelation).toBe(12);
    const groups = new Map<string, number>();
    for (const identity of plan.resolution.resolved) {
      groups.set(identity.groupingPageId, (groups.get(identity.groupingPageId) || 0) + 1);
    }
    expect([...groups.values()].filter((count) => count > 1)).toHaveLength(5);
    expect(plan.firestore.potentialCreates).toBe(0);
    expect(plan.firestore.potentialUpdates).toBe(63);
    expect(plan.records[0].data).not.toHaveProperty("id");
  });

  it("preserves the exact 63 manifest IDs and the three canaries", () => {
    const plan = planFor(fixture());
    const manifest = loadManifest();
    const manifestIds = manifest.entries.map((entry) => entry.cineprintPosterId).sort();
    expect(idsOf(plan)).toEqual(manifestIds);
    for (const canary of ["2001-a-space-odyssey", "bugonia", "artwork-1824607248"]) {
      expect(idsOf(plan)).toContain(canary);
    }
  });

  it("reverses image ordering without changing any ID", () => {
    const f = fixture();
    for (const page of f.pages) {
      const urls = imageUrls(page);
      if (urls.length > 1) setImageUrls(page, [...urls].reverse());
    }
    const baseline = planFor(fixture());
    const reversed = planFor(f);
    expect(reversed.ok).toBe(true);
    expect(idsOf(reversed)).toEqual(idsOf(baseline));
  });

  it("inserts a new image without shifting existing IDs and reports it unresolved", () => {
    const f = fixture();
    const page = pageOf(f, STRANGER_PAGE);
    setImageUrls(page, ["https://example.invalid/new.jpg", ...imageUrls(page)]);
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.unresolved.some((entry) => entry.reason === "NEW_IMAGE_WITHOUT_IDENTITY")).toBe(
      true,
    );
    const ids = plan.resolution.resolved
      .filter((entry) => entry.groupingPageId === STRANGER_PAGE)
      .map((entry) => entry.posterId)
      .sort();
    expect(ids).toEqual(["stranger-things-1", "stranger-things-2", "stranger-things-3"]);
  });

  it("removes an image without renaming the remaining IDs and reports the removed identity orphaned", () => {
    const f = fixture();
    const page = pageOf(f, STRANGER_PAGE);
    const urls = imageUrls(page);
    const removed = urls[1];
    setImageUrls(
      page,
      urls.filter((_, index) => index !== 1),
    );
    const plan = planFor(f);
    expect(plan.ok).toBe(true);
    expect(plan.orphaned.some((entry) => entry.posterId === "stranger-things-2")).toBe(true);
    const ids = plan.resolution.resolved
      .filter((entry) => entry.groupingPageId === STRANGER_PAGE)
      .map((entry) => entry.posterId)
      .sort();
    expect(ids).toEqual(["stranger-things-1", "stranger-things-2", "stranger-things-3"]);
    expect(plan.records.some((record) => record.id === "stranger-things-2")).toBe(false);
    expect(plan.records).toHaveLength(62);
    expect(removed).toContain("stranger-things-2.jpg");
  });

  it("moves a poster between groups without changing its ID when the association is explicit", () => {
    const f = fixture();
    const source = pageOf(f, STRANGER_PAGE);
    const target = pageOf(f, BACKROOMS_PAGE);
    const record = f.identityRecords.find((entry) => entry.posterId === "stranger-things-2")!;
    setImageUrls(
      source,
      imageUrls(source).filter((entry) => entry !== record.imageUrl),
    );
    setImageUrls(target, [...imageUrls(target), record.imageUrl]);
    record.groupingPageId = BACKROOMS_PAGE;
    record.groupingPageIds = [BACKROOMS_PAGE];
    const doc = f.firestoreDocuments.find((entry) => entry.id === "stranger-things-2")!;
    doc.notionPageId = BACKROOMS_PAGE;
    const plan = planFor(f);
    expect(plan.ok).toBe(true);
    expect(
      plan.records.find((entry) => entry.id === "stranger-things-2")?.identity.groupingPageId,
    ).toBe(BACKROOMS_PAGE);
  });

  it("fails closed when a move is not reflected in Firestore", () => {
    const f = fixture();
    const source = pageOf(f, STRANGER_PAGE);
    const target = pageOf(f, BACKROOMS_PAGE);
    const record = f.identityRecords.find((entry) => entry.posterId === "stranger-things-2")!;
    setImageUrls(
      source,
      imageUrls(source).filter((entry) => entry !== record.imageUrl),
    );
    setImageUrls(target, [...imageUrls(target), record.imageUrl]);
    record.groupingPageId = BACKROOMS_PAGE;
    record.groupingPageIds = [BACKROOMS_PAGE];
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.conflicts.some((entry) => entry.kind === "PAGE_MISMATCH")).toBe(true);
  });

  it("changes an image URL without changing the poster ID", () => {
    const f = fixture();
    const page = pageOf(f, BUGONIA_PAGE);
    setImageUrls(page, ["https://example.invalid/bugonia-v2.jpg"]);
    const plan = planFor(f);
    expect(plan.ok).toBe(true);
    expect(plan.records.find((entry) => entry.id === "bugonia")?.identity.imageUrl).toBe(
      "https://example.invalid/bugonia-v2.jpg",
    );
  });

  it("changes a source revision without changing the poster ID", () => {
    const f = fixture();
    const page = pageOf(f, STRANGER_PAGE);
    const record = f.identityRecords.find((entry) => entry.posterId === "stranger-things-2")!;
    const newUrl = "https://example.invalid/stranger-2-v2.jpg";
    setImageUrls(
      page,
      imageUrls(page).map((entry) => (entry === record.imageUrl ? newUrl : entry)),
    );
    record.imageUrl = newUrl;
    record.revision = 2;
    const plan = planFor(f);
    expect(plan.ok).toBe(true);
    expect(
      plan.records.find((entry) => entry.id === "stranger-things-2")?.identity.sourceRevision,
    ).toBe(2);
  });

  it("replaces a Raindrop source ID without changing the poster ID", () => {
    const f = fixture();
    const record = f.identityRecords.find((entry) => entry.posterId === "stranger-things-2")!;
    record.raindropId = "9999999999";
    const plan = planFor(f);
    expect(plan.ok).toBe(true);
    expect(
      plan.records.find((entry) => entry.id === "stranger-things-2")?.identity.sourceRaindropId,
    ).toBe("9999999999");
  });

  it("never uses the legacy positional IDs in the canonical write path", () => {
    const f = fixture();
    const page = pageOf(f, STRANGER_PAGE);
    const legacyIds = parsePage(page).map((record) => record.id);
    expect(legacyIds).toEqual([
      "stranger-things-1-1",
      "stranger-things-1-2",
      "stranger-things-1-3",
    ]);
    const plan = planFor(f);
    const canonicalIds = plan.records
      .filter((record) => record.identity.groupingPageId === STRANGER_PAGE)
      .map((record) => record.id)
      .sort();
    expect(canonicalIds).toEqual(["stranger-things-1", "stranger-things-2", "stranger-things-3"]);
  });

  it("fails closed when a page has identity but no image", () => {
    const f = fixture();
    const page = pageOf(f, BUGONIA_PAGE);
    setImageUrls(page, []);
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.unresolved.some((entry) => entry.reason === "MISSING_PAGE_IMAGE")).toBe(true);
  });

  it("fails closed on an invalid identity status", () => {
    const f = fixture();
    f.identityRecords[0].status = "bogus";
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.conflicts.some((entry) => entry.kind === "INVALID_IDENTITY_STATUS")).toBe(true);
  });

  it("treats an empty canonical property on a multi-image page as absent", () => {
    const f = fixture();
    const page = pageOf(f, STRANGER_PAGE);
    page.properties["CinePrint Poster ID"] = { type: "rich_text", rich_text: [] };
    const plan = planFor(f);
    expect(plan.ok).toBe(true);
    expect(plan.conflicts).toEqual([]);
    expect(plan.records).toHaveLength(63);
  });

  it("treats an empty canonical property on a single page as missing", () => {
    const f = fixture();
    const page = pageOf(f, BUGONIA_PAGE);
    page.properties["CinePrint Poster ID"] = { type: "rich_text", rich_text: [] };
    const plan = planFor(f, { mode: "canonical" });
    expect(plan.ok).toBe(false);
    expect(plan.conflicts).toEqual([]);
    expect(plan.unresolved.some((entry) => entry.reason === "MISSING_CANONICAL_ID")).toBe(true);
  });

  it("ignores an empty canonical property on a page with no images", () => {
    const f = fixture();
    f.pages.push({
      id: "empty-page",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Empty" }] },
        "CinePrint Poster ID": { type: "rich_text", rich_text: [] },
        "Image URL": url(""),
      },
    });
    const plan = planFor(f);
    expect(plan.ignoredPages).toContain("empty-page");
    expect(
      plan.unresolved.some(
        (entry) => entry.pageId === "empty-page" && entry.reason === "MISSING_PAGE_IMAGE",
      ),
    ).toBe(false);
  });

  it("reports missing identity records for an empty-property multi page", () => {
    const f = fixture();
    const page = pageOf(f, STRANGER_PAGE);
    page.properties["CinePrint Poster ID"] = { type: "rich_text", rich_text: [] };
    f.identityRecords = f.identityRecords.filter(
      (record) => record.groupingPageId !== STRANGER_PAGE,
    );
    const plan = planFor(f);
    expect(plan.conflicts).toEqual([]);
    expect(plan.unresolved.some((entry) => entry.reason === "MISSING_IDENTITY_RECORDS")).toBe(true);
  });

  it("fails closed on a duplicate canonical ID", () => {
    const f = fixture();
    const page = pageOf(f, STRANGER_PAGE);
    const original = f.identityRecords.find((entry) => entry.posterId === "stranger-things-1")!;
    f.identityRecords.push({
      ...structuredClone(original),
      identityRecordId: "identity-duplicate-stranger-1",
    });
    setImageUrls(page, imageUrls(page));
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.conflicts.some((entry) => entry.kind === "DUPLICATE_ID")).toBe(true);
  });

  it("fails closed when the canonical property is removed", () => {
    const f = fixture();
    const page = pageOf(f, BUGONIA_PAGE);
    delete page.properties["CinePrint Poster ID"];
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.unresolved.some((entry) => entry.reason === "MISSING_CANONICAL_ID")).toBe(true);
  });

  it("permits a unique explicit-slug legacy match only in transition mode", () => {
    const f = fixture();
    const page = pageOf(f, BUGONIA_PAGE);
    delete page.properties["CinePrint Poster ID"];
    const transition = planFor(f, { mode: "transition", allowLegacy: true });
    expect(transition.ok).toBe(true);
    expect(
      transition.records.find((entry) => entry.id === "bugonia")?.identity.identitySource,
    ).toBe("legacy_slug");
    expect(transition.warnings.some((entry) => entry.includes("Legacy legacy_slug"))).toBe(true);

    const disabled = planFor(f, { mode: "transition", allowLegacy: false });
    expect(disabled.ok).toBe(false);
    expect(disabled.unresolved.some((entry) => entry.reason === "MISSING_CANONICAL_ID")).toBe(true);
  });

  it("fails closed on an unknown canonical ID", () => {
    const f = fixture();
    const record = f.identityRecords.find((entry) => entry.posterId === "stranger-things-2")!;
    record.posterId = "unknown-999";
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.conflicts.some((entry) => entry.kind === "UNKNOWN_ID")).toBe(true);
  });

  it("fails closed when a Firestore document is missing", () => {
    const f = fixture();
    f.firestoreDocuments = f.firestoreDocuments.filter((doc) => doc.id !== "bugonia");
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.conflicts.some((entry) => entry.kind === "MISSING_FIRESTORE_DOCUMENT")).toBe(true);
    expect(plan.firestore.potentialCreates).toBe(0);
  });

  it("fails closed on a conflicting grouping page association", () => {
    const f = fixture();
    const doc = f.firestoreDocuments.find((entry) => entry.id === "bugonia")!;
    doc.notionPageId = STRANGER_PAGE;
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.conflicts.some((entry) => entry.kind === "PAGE_MISMATCH")).toBe(true);
  });

  it("warns on duplicate image URLs without changing identity", () => {
    const f = fixture();
    const bugonia = pageOf(f, BUGONIA_PAGE);
    const her = f.pages.find((page) => richTextOf(page, "Slug") === "her")!;
    const shared = imageUrls(bugonia)[0];
    setImageUrls(her, [shared]);
    const plan = planFor(f);
    expect(plan.ok).toBe(true);
    expect(plan.warnings.some((entry) => entry.includes("Duplicate image URL"))).toBe(true);
  });

  it("warns on duplicate source IDs without changing identity", () => {
    const f = fixture();
    const a = f.identityRecords.find((entry) => entry.posterId === "stranger-things-1")!;
    const b = f.identityRecords.find((entry) => entry.posterId === "stranger-things-3")!;
    b.raindropId = a.raindropId;
    const plan = planFor(f);
    expect(plan.ok).toBe(true);
    expect(plan.warnings.some((entry) => entry.includes("Duplicate source ID"))).toBe(true);
  });

  it("reports a missing identity data source as unresolved", () => {
    const f = fixture();
    f.identityRecords = f.identityRecords.filter((entry) => entry.groupingPageId !== STRANGER_PAGE);
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.unresolved.some((entry) => entry.reason === "MISSING_IDENTITY_RECORDS")).toBe(true);
  });

  it("fails closed on a missing relation", () => {
    const f = fixture();
    const record = f.identityRecords[0];
    record.groupingPageId = null;
    record.groupingPageIds = [];
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.conflicts.some((entry) => entry.kind === "MISSING_RELATION")).toBe(true);
  });

  it("fails closed when an identity record has multiple grouping pages", () => {
    const f = fixture();
    const record = f.identityRecords[0];
    record.groupingPageIds = [record.groupingPageId!, BACKROOMS_PAGE];
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.conflicts.some((entry) => entry.kind === "MULTIPLE_GROUPING_PAGES")).toBe(true);
  });

  it("fails closed on an invalid relation target", () => {
    const f = fixture();
    const record = f.identityRecords[0];
    record.groupingPageId = "not-a-page";
    record.groupingPageIds = ["not-a-page"];
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(plan.conflicts.some((entry) => entry.kind === "INVALID_RELATION_TARGET")).toBe(true);
  });

  it("is idempotent for identical inputs", () => {
    const first = planFor(fixture());
    const second = planFor(fixture());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("sync plan write safety", () => {
  it("does not call the writer when the plan has a conflict", async () => {
    const f = fixture();
    const record = f.identityRecords.find((entry) => entry.posterId === "stranger-things-2")!;
    record.posterId = "unknown-999";
    const plan = planFor(f);
    const write = vi.fn(async () => undefined);
    const prune = vi.fn(async () => undefined);
    const result = await applySyncPlan(plan, { write, prune });
    expect(result).toMatchObject({ ok: false, wrote: 0, pruned: 0, reason: "PLAN_NOT_OK" });
    expect(write).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
  });

  it("does not write or prune when prune is requested but not allowed", async () => {
    const f = fixture();
    const page = pageOf(f, STRANGER_PAGE);
    setImageUrls(page, ["https://example.invalid/new.jpg", ...imageUrls(page)]);
    const plan = planFor(f, { prune: true, pruneAllowed: true });
    const write = vi.fn(async () => undefined);
    const prune = vi.fn(async () => undefined);
    const result = await applySyncPlan(plan, { write, prune });
    expect(result).toMatchObject({ ok: false, wrote: 0, pruned: 0 });
    expect(write).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
  });

  it("writes only existing records and never creates documents", async () => {
    const f = fixture();
    f.firestoreDocuments = f.firestoreDocuments.filter((doc) => doc.id !== "bugonia");
    const plan = planFor(f);
    const write = vi.fn(async () => undefined);
    const prune = vi.fn(async () => undefined);
    const result = await applySyncPlan(plan, { write, prune });
    expect(result.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("prunes only a fully validated canonical set", async () => {
    const f = fixture();
    f.firestoreDocuments.push({
      id: "orphan-doc",
      notionPageId: "orphan-page",
      image: "https://example.invalid/orphan.jpg",
      title: "Orphan",
      status: "published",
    });
    const plan = planFor(f, { prune: true, pruneAllowed: true });
    expect(plan.ok).toBe(true);
    expect(plan.prune.allowed).toBe(true);
    expect(plan.prune.candidates).toEqual([
      { posterId: "orphan-doc", notionPageId: "orphan-page" },
    ]);
    const write = vi.fn(async () => undefined);
    const prune = vi.fn(async () => undefined);
    const result = await applySyncPlan(plan, { write, prune });
    expect(result).toMatchObject({ ok: true, wrote: 63, pruned: 1 });
    expect(prune).toHaveBeenCalledWith([{ posterId: "orphan-doc", notionPageId: "orphan-page" }]);
  });

  it("blocks prune when an identity record is orphaned", async () => {
    const f = fixture();
    const page = pageOf(f, STRANGER_PAGE);
    setImageUrls(
      page,
      imageUrls(page).filter((entry) => !entry.includes("stranger-things-2.jpg")),
    );
    const plan = planFor(f, { prune: true, pruneAllowed: true });
    expect(plan.ok).toBe(true);
    expect(plan.orphaned.some((entry) => entry.posterId === "stranger-things-2")).toBe(true);
    expect(plan.prune.allowed).toBe(false);
  });

  it("blocks prune unless the explicit opt-in is present", async () => {
    const plan = planFor(fixture(), { prune: true, pruneAllowed: false });
    expect(plan.ok).toBe(true);
    expect(plan.prune.allowed).toBe(false);
    const write = vi.fn(async () => undefined);
    const prune = vi.fn(async () => undefined);
    const result = await applySyncPlan(plan, { write, prune });
    expect(result).toMatchObject({ ok: false, wrote: 0, pruned: 0, reason: "PRUNE_NOT_ALLOWED" });
    expect(write).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
  });

  it("fails closed on duplicate records across two Notion pages", () => {
    const f = fixture();
    const source = pageOf(f, STRANGER_PAGE);
    const target = pageOf(f, BACKROOMS_PAGE);
    const record = f.identityRecords.find((entry) => entry.posterId === "stranger-things-2")!;
    setImageUrls(target, [...imageUrls(target), record.imageUrl]);
    f.identityRecords.push({
      ...structuredClone(record),
      identityRecordId: "identity-cross-page-duplicate",
      groupingPageId: BACKROOMS_PAGE,
      groupingPageIds: [BACKROOMS_PAGE],
    });
    const plan = planFor(f);
    expect(plan.ok).toBe(false);
    expect(
      plan.conflicts.some(
        (entry) => entry.kind === "DUPLICATE_ID" || entry.kind === "PAGE_MISMATCH",
      ),
    ).toBe(true);
  });

  it("writes 63 existing records on a valid plan", async () => {
    const plan = planFor(fixture());
    const write = vi.fn(async () => undefined);
    const prune = vi.fn(async () => undefined);
    const result = await applySyncPlan(plan, { write, prune });
    expect(result).toMatchObject({ ok: true, wrote: 63, pruned: 0 });
    expect(write).toHaveBeenCalledTimes(1);
    expect(prune).not.toHaveBeenCalled();
  });
});
