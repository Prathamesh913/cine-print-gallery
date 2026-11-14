import { describe, expect, it } from "vitest";
import { R2ImagePublisher } from "../ingestion/r2-images";
import { planR2Keys } from "../ingestion/r2-images";
import type { DownloadedSourceImage } from "../ingestion/download";
import type { PreparedImage } from "../ingestion/image";
import type { R2Store } from "../migration/types";
import type { R2ImageReference } from "../../src/lib/r2-image-reference";
import { validateR2ImageReference } from "../../src/lib/r2-image-reference";
import {
  assertConfirmedSource,
  buildRepairPlan,
  buildRepairReference,
  executeRepairPlan,
  RepairError,
  type RepairDependencies,
} from "./repair";
import type { IdentityRecord } from "../../scripts/poster-identity.js";
import { REPAIR_TARGETS } from "./targets";

const OPTIMIZER = { name: "sharp", version: "0.35.3", libvipsVersion: "8.18.3" };
const NOW = "2026-11-14T00:00:00.000Z";
const TARGET = REPAIR_TARGETS["the-substance-2"];

function downloadedForTarget(
  target = TARGET,
  overrides: Partial<DownloadedSourceImage> = {},
): DownloadedSourceImage {
  return {
    buffer: Buffer.from("source-bytes"),
    contentType: "image/jpeg",
    finalUrl: target.sourceUrl,
    sha256: target.expectedSha256,
    sizeBytes: target.expectedSizeBytes,
    ...overrides,
  };
}

function downloadedFor(overrides: Partial<DownloadedSourceImage> = {}): DownloadedSourceImage {
  return downloadedForTarget(TARGET, overrides);
}

function preparedForTarget(
  target = TARGET,
  overrides: {
    sha256?: string;
    width?: number;
    height?: number;
    sizeBytes?: number;
    contentType?: string;
  } = {},
): PreparedImage {
  const sha256 = overrides.sha256 ?? target.expectedSha256;
  const width = overrides.width ?? target.expectedDimensions.width;
  const height = overrides.height ?? target.expectedDimensions.height;
  const sizeBytes = overrides.sizeBytes ?? target.expectedSizeBytes;
  return {
    original: {
      buffer: Buffer.from("source-bytes"),
      contentType: overrides.contentType ?? "image/jpeg",
      sha256,
      sizeBytes,
      width,
      height,
      extension: "jpg",
    },
    optimized: {
      buffer: Buffer.from("webp-bytes"),
      contentType: "image/webp",
      sha256: "b".repeat(64),
      sizeBytes: 4_000,
      width,
      height,
    },
    optimizer: OPTIMIZER,
    sourceWidth: width,
    sourceHeight: height,
  };
}

function preparedFor(
  overrides: {
    sha256?: string;
    width?: number;
    height?: number;
    sizeBytes?: number;
    contentType?: string;
  } = {},
): PreparedImage {
  return preparedForTarget(TARGET, overrides);
}

function referenceFor(target = TARGET, prepared = preparedFor()): R2ImageReference {
  const keys = planR2Keys(target.posterId, prepared, OPTIMIZER);
  return buildRepairReference(target, prepared, keys, NOW);
}

function referenceWithDifferentSource(target = TARGET): R2ImageReference {
  const prepared = preparedFor({
    sha256: "c".repeat(64),
    sizeBytes: target.expectedSizeBytes,
  });
  return referenceFor(target, prepared);
}

function identityRecord(target = TARGET, overrides: Partial<IdentityRecord> = {}): IdentityRecord {
  return {
    identityRecordId: "identity-1",
    posterId: target.posterId,
    groupingPageId: target.notionPageId,
    groupingPageIds: [target.notionPageId],
    imageUrl: target.existingImageUrl,
    raindropId: target.raindropId,
    provider: "pbs-twimg",
    sha256: target.expectedSha256,
    revision: 1,
    status: "active",
    ...overrides,
  };
}

function pageFor(target = TARGET, status = "Published") {
  return {
    id: target.notionPageId,
    properties: {
      Status: { type: "status", status: { name: status } },
      "Image URL": { type: "url", url: target.existingImageUrl },
    },
  };
}

function documentFor(
  target = TARGET,
  overrides: Record<string, unknown> = {},
): { id: string; data: Record<string, unknown> } {
  return {
    id: target.posterId,
    data: {
      status: "published",
      notionPageId: target.notionPageId,
      image: target.existingImageUrl,
      posterImageUrl: target.existingImageUrl,
      title: "Confirmed poster",
      ...overrides,
    },
  };
}

function createHarness(
  options: {
    target?: typeof TARGET;
    prepared?: PreparedImage;
    doc?: ReturnType<typeof documentFor> | null;
    page?: ReturnType<typeof pageFor>;
    records?: IdentityRecord[];
    existingR2?: boolean;
    r2Verification?: { ok: boolean; reason?: string | null };
    publishFailsOnce?: boolean;
    breakReadBack?: boolean;
  } = {},
) {
  const target = options.target ?? TARGET;
  const prepared = options.prepared ?? preparedForTarget(target);
  const doc = options.doc === null ? null : (options.doc ?? documentFor(target));
  const records = options.records ?? [];
  const calls = {
    publish: 0,
    update: 0,
    create: 0,
    updates: [] as R2ImageReference[],
  };
  let created: IdentityRecord | null = null;
  let publishAttempts = 0;

  const deps: RepairDependencies = {
    download: async () => downloadedForTarget(target),
    prepare: async () => prepared,
    optimizer: OPTIMIZER,
    r2: {
      head: async (key: string) =>
        options.existingR2
          ? ({
              key,
              size: prepared.original.sizeBytes,
              contentType: prepared.original.contentType,
              cacheControl: null,
              metadataSha256: null,
              checksumSha256: null,
              metadata: {},
            } as never)
          : null,
      verifyOrigin: async () =>
        ({
          ok: options.r2Verification?.ok ?? true,
          exists: true,
          checksumOk: options.r2Verification?.ok ?? true,
          metadataOk: true,
          sizeOk: true,
          metadata: null,
          sha256: prepared.original.sha256,
          sizeBytes: prepared.original.sizeBytes,
          reason: options.r2Verification?.reason ?? null,
        }) as never,
    } as never,
    publisher: {
      publish: async (_posterId, image) => {
        calls.publish += 1;
        publishAttempts += 1;
        if (options.publishFailsOnce && publishAttempts === 1) {
          throw new RepairError("simulated partial upload");
        }
        const keys = planR2Keys(target.posterId, image, OPTIMIZER);
        return buildRepairReference(target, image, keys, NOW) as never;
      },
    },
    firestore: {
      getPoster: async (id: string) => {
        if (!doc) return null;
        return { id, data: JSON.parse(JSON.stringify(doc.data)) as Record<string, unknown> };
      },
      updateR2Image: async (id: string, reference: R2ImageReference) => {
        calls.update += 1;
        calls.updates.push(reference);
        if (!doc || doc.id !== id) throw new RepairError("missing document");
        doc.data.r2Image = options.breakReadBack ? { nonsense: true } : reference;
      },
    },
    notion: {
      getPage: async () => options.page ?? pageFor(target),
      listIdentityRecords: async () => records,
      createIdentityRecord: async () => {
        calls.create += 1;
        created = identityRecord(target);
        return created.identityRecordId;
      },
      getIdentityRecord: async (recordId: string) => {
        if (created && created.identityRecordId === recordId) return created;
        const record = records.find((entry) => entry.identityRecordId === recordId);
        if (!record) throw new RepairError("identity record missing");
        return record;
      },
    },
    now: () => new Date(NOW),
    audit: { record: () => undefined },
  };

  return {
    target,
    prepared,
    doc,
    deps,
    calls,
    get created() {
      return created;
    },
  };
}

describe("scoped repair planning", () => {
  it("builds exact versioned keys and a valid reference", async () => {
    const harness = createHarness();
    const plan = await buildRepairPlan(harness.target, harness.deps);

    expect(plan.keys.originalKey).toBe(
      `cineprint/versions/original/the-substance-2/${TARGET.expectedSha256}.jpg`,
    );
    expect(plan.keys.optimizedKey).toBe(
      `cineprint/versions/optimized/the-substance-2/${TARGET.expectedSha256}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
    );
    expect(plan.reference.sourceSha256).toBe(TARGET.expectedSha256);
    expect(validateR2ImageReference(plan.reference, TARGET.posterId).ok).toBe(true);
    expect(plan.r2).toEqual({ original: "upload", optimized: "upload" });
    expect(plan.firestore.action).toBe("update");
    expect(plan.notion.action).toBe("create");
    expect(harness.calls).toMatchObject({ publish: 0, update: 0, create: 0 });
  });

  it("builds the exact plan for stranger-things-2", async () => {
    const target = REPAIR_TARGETS["stranger-things-2"];
    const harness = createHarness({ target });
    const plan = await buildRepairPlan(target, harness.deps);

    expect(plan.keys.originalKey).toBe(
      `cineprint/versions/original/stranger-things-2/${target.expectedSha256}.jpg`,
    );
    expect(plan.keys.optimizedKey).toBe(
      `cineprint/versions/optimized/stranger-things-2/${target.expectedSha256}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
    );
    expect(plan.reference.sourceSha256).toBe(target.expectedSha256);
    expect(validateR2ImageReference(plan.reference, target.posterId).ok).toBe(true);
    expect(plan.firestore.action).toBe("update");
    expect(plan.notion.action).toBe("create");
  });

  it("does not write during dry-run planning", async () => {
    const harness = createHarness();
    await buildRepairPlan(harness.target, harness.deps);
    expect(harness.calls.publish).toBe(0);
    expect(harness.calls.update).toBe(0);
    expect(harness.calls.create).toBe(0);
  });

  it("rejects a SHA, size, dimension, MIME or host mismatch", async () => {
    expect(() =>
      assertConfirmedSource(TARGET, downloadedFor({ sha256: "d".repeat(64) }), preparedFor()),
    ).toThrow(/checksum changed/);

    expect(() =>
      assertConfirmedSource(
        TARGET,
        downloadedFor({ sizeBytes: TARGET.expectedSizeBytes + 1 }),
        preparedFor(),
      ),
    ).toThrow(/size changed/);

    expect(() =>
      assertConfirmedSource(TARGET, downloadedFor(), preparedFor({ width: 691 })),
    ).toThrow(/dimensions changed/);

    expect(() =>
      assertConfirmedSource(
        TARGET,
        downloadedFor({ contentType: "image/png" }),
        preparedFor({ contentType: "image/png" }),
      ),
    ).toThrow(/Content-Type changed/);

    expect(() =>
      assertConfirmedSource(
        TARGET,
        downloadedFor({ finalUrl: "https://evil.example/image.jpg" }),
        preparedFor(),
      ),
    ).toThrow(/host must be pbs.twimg.com/);
  });

  it("rejects a missing or mismatched Firestore document", async () => {
    await expect(buildRepairPlan(TARGET, createHarness({ doc: null }).deps)).rejects.toThrow(
      /does not exist/,
    );

    await expect(
      buildRepairPlan(
        TARGET,
        createHarness({ doc: documentFor(TARGET, { status: "draft" }) }).deps,
      ),
    ).rejects.toThrow(/not published/);

    await expect(
      buildRepairPlan(
        TARGET,
        createHarness({ doc: documentFor(TARGET, { image: "https://example.com/other.jpg" }) })
          .deps,
      ),
    ).rejects.toThrow(/image does not match/);
  });

  it("reuses an existing verified R2 object and refuses a conflicting one", async () => {
    const reuse = createHarness({ existingR2: true });
    await expect(buildRepairPlan(TARGET, reuse.deps)).resolves.toMatchObject({
      r2: { original: "reuse", optimized: "reuse" },
    });

    const conflict = createHarness({
      existingR2: true,
      r2Verification: { ok: false, reason: "checksum mismatch" },
    });
    await expect(buildRepairPlan(TARGET, conflict.deps)).rejects.toThrow(/does not match/);
  });

  it("treats an identical valid Firestore r2Image as already repaired", async () => {
    const harness = createHarness({
      doc: documentFor(TARGET, { r2Image: referenceFor() }),
    });
    const plan = await buildRepairPlan(TARGET, harness.deps);
    expect(plan.firestore.action).toBe("already");
  });

  it("refuses to replace a different valid Firestore r2Image", async () => {
    const harness = createHarness({
      doc: documentFor(TARGET, { r2Image: referenceWithDifferentSource() }),
    });
    await expect(buildRepairPlan(TARGET, harness.deps)).rejects.toThrow(/different valid r2Image/);
  });

  it("plans an update for an invalid Firestore r2Image", async () => {
    const harness = createHarness({
      doc: documentFor(TARGET, { r2Image: { nonsense: true } }),
    });
    const plan = await buildRepairPlan(TARGET, harness.deps);
    expect(plan.firestore.action).toBe("update");
  });

  it("preserves Published status and refuses Draft", async () => {
    const draft = createHarness({ page: pageFor(TARGET, "Draft") });
    await expect(buildRepairPlan(TARGET, draft.deps)).rejects.toThrow(/not Published/);
    expect(draft.calls.create).toBe(0);

    const published = createHarness({ page: pageFor(TARGET, "Published") });
    await expect(buildRepairPlan(TARGET, published.deps)).resolves.toMatchObject({
      notion: { pageStatus: "Published", action: "create" },
    });
  });

  it("is idempotent when the Notion identity row already matches", async () => {
    const harness = createHarness({ records: [identityRecord()] });
    const plan = await buildRepairPlan(TARGET, harness.deps);
    expect(plan.notion.action).toBe("already");
    expect(plan.notion.identityRecordId).toBe("identity-1");
  });

  it("fails closed on a mismatched or duplicate Notion identity row", async () => {
    await expect(
      buildRepairPlan(
        TARGET,
        createHarness({ records: [identityRecord(TARGET, { sha256: "e".repeat(64) })] }).deps,
      ),
    ).rejects.toThrow(/does not match/);

    await expect(
      buildRepairPlan(
        TARGET,
        createHarness({
          records: [
            identityRecord(TARGET, { identityRecordId: "one" }),
            identityRecord(TARGET, { identityRecordId: "two" }),
          ],
        }).deps,
      ),
    ).rejects.toThrow(/Multiple Notion identity records/);
  });
});

describe("scoped repair execution", () => {
  it("uploads R2, creates the identity row, then updates Firestore update-only", async () => {
    const harness = createHarness();
    const plan = await buildRepairPlan(harness.target, harness.deps);
    const result = await executeRepairPlan(plan, harness.deps);

    expect(harness.calls.publish).toBe(1);
    expect(harness.calls.create).toBe(1);
    expect(harness.calls.update).toBe(1);
    expect(harness.calls.updates).toHaveLength(1);
    expect(validateR2ImageReference(harness.calls.updates[0], TARGET.posterId).ok).toBe(true);
    expect(result).toMatchObject({
      firestoreAction: "update",
      notionAction: "create",
    });
    expect(harness.doc?.data.title).toBe("Confirmed poster");
    expect(harness.doc?.data.r2Image).toEqual(harness.calls.updates[0]);
  });

  it("does not update Firestore when the reference is already present", async () => {
    const harness = createHarness({
      doc: documentFor(TARGET, { r2Image: referenceFor() }),
      records: [identityRecord()],
    });
    const plan = await buildRepairPlan(TARGET, harness.deps);
    const result = await executeRepairPlan(plan, harness.deps);

    expect(result.firestoreAction).toBe("already");
    expect(result.notionAction).toBe("already");
    expect(harness.calls.update).toBe(0);
    expect(harness.calls.create).toBe(0);
  });

  it("stops before Notion and Firestore after a partial R2 failure and retries safely", async () => {
    const harness = createHarness({ publishFailsOnce: true });
    const firstPlan = await buildRepairPlan(TARGET, harness.deps);
    await expect(executeRepairPlan(firstPlan, harness.deps)).rejects.toThrow(/partial upload/);

    expect(harness.calls.create).toBe(0);
    expect(harness.calls.update).toBe(0);

    const retryPlan = await buildRepairPlan(TARGET, harness.deps);
    const result = await executeRepairPlan(retryPlan, harness.deps);

    expect(result.firestoreAction).toBe("update");
    expect(harness.calls.create).toBe(1);
    expect(harness.calls.update).toBe(1);
  });

  it("fails closed when Firestore read-back does not match", async () => {
    const harness = createHarness({ breakReadBack: true });
    const plan = await buildRepairPlan(TARGET, harness.deps);
    await expect(executeRepairPlan(plan, harness.deps)).rejects.toThrow(/did not read back/);
  });
});

describe("R2 publisher overwrite protection", () => {
  it("never calls put when an existing object fails verification", async () => {
    let putCalls = 0;
    const store = {
      head: async (key: string) => ({ key }) as never,
      verify: async () => ({ ok: false, metadata: null, reason: "checksum mismatch" }) as never,
      put: async () => {
        putCalls += 1;
      },
      verifyOrigin: async () => ({ ok: false, reason: "checksum mismatch" }) as never,
      publicVerify: async () => ({ ok: false, reason: "not used" }) as never,
    } as unknown as R2Store;

    const publisher = new R2ImagePublisher({ store, optimizer: OPTIMIZER });
    await expect(
      publisher.publish(TARGET.posterId, preparedFor(), TARGET.raindropId),
    ).rejects.toThrow(/does not match/);
    expect(putCalls).toBe(0);
  });
});
