/**
 * Scoped, versioned R2 poster image repair.
 *
 * This module deliberately does not touch the migration manifest, migration
 * state, static R2 map, exporter or 58-poster baseline. It reuses the ingestion
 * image preparation, key planner and R2 publisher, then attaches the resulting
 * verified reference to one existing published Firestore document.
 */

import { planR2Keys, type PublishableImage, type R2ImagePublisher } from "../ingestion/r2-images";
import type { DownloadedSourceImage } from "../ingestion/download";
import type { PreparedImage } from "../ingestion/image";
import { stableStringify } from "../ingestion/identity";
import { isPublishedStatus, statusName } from "../ingestion/notion-pages";
import { R2_CACHE_CONTROL } from "../migration/r2";
import type { OptimizerIdentity } from "../migration/versioning";
import type { R2ObjectExpectation, R2Store } from "../migration/types";
import { validateR2ImageReference, type R2ImageReference } from "../../src/lib/r2-image-reference";
import { imageUrlsFromPage, type IdentityRecord } from "../../scripts/poster-identity.js";
import { RepairError } from "./errors";
import type { RepairTarget } from "./targets";

export { RepairError } from "./errors";

export interface FirestorePosterSnapshot {
  id: string;
  data: Record<string, unknown>;
}

export interface RepairFirestore {
  getPoster(id: string): Promise<FirestorePosterSnapshot | null>;
  /** Update-only. Must never create a document. */
  updateR2Image(id: string, reference: R2ImageReference): Promise<void>;
}

export interface RepairNotionPage {
  id: string;
  properties: Record<string, unknown>;
}

export interface RepairNotionIdentityInput {
  target: RepairTarget;
  groupingPageId: string;
  imageUrl: string;
  verifiedAt: string;
}

export interface RepairNotion {
  getPage(pageId: string): Promise<RepairNotionPage>;
  listIdentityRecords(): Promise<IdentityRecord[]>;
  createIdentityRecord(input: RepairNotionIdentityInput): Promise<string>;
  getIdentityRecord(recordId: string): Promise<IdentityRecord>;
}

export interface RepairAudit {
  record(event: Record<string, unknown>): void;
}

export interface RepairDependencies {
  download(url: string): Promise<DownloadedSourceImage>;
  prepare(downloaded: DownloadedSourceImage): Promise<PreparedImage>;
  optimizer: OptimizerIdentity;
  r2: Pick<R2Store, "head" | "verifyOrigin">;
  publisher: Pick<R2ImagePublisher, "publish">;
  firestore: RepairFirestore;
  notion: RepairNotion;
  now(): Date;
  audit: RepairAudit;
}

export type R2RepairAction = "upload" | "reuse";
export type FirestoreRepairAction = "already" | "update";
export type NotionRepairAction = "already" | "create";

export interface RepairPlan {
  target: RepairTarget;
  downloaded: DownloadedSourceImage;
  prepared: PreparedImage;
  keys: ReturnType<typeof planR2Keys>;
  reference: R2ImageReference;
  r2: { original: R2RepairAction; optimized: R2RepairAction };
  firestore: {
    action: FirestoreRepairAction;
    current: FirestorePosterSnapshot;
  };
  notion: {
    action: NotionRepairAction;
    pageStatus: string;
    identityRecordId: string | null;
  };
}

export interface RepairExecution {
  target: RepairTarget;
  reference: R2ImageReference;
  firestoreAction: FirestoreRepairAction;
  notionAction: NotionRepairAction;
  r2: { original: R2RepairAction; optimized: R2RepairAction };
}

function assertSourceUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RepairError(`${label} is not a valid URL`);
  }
  if (url.protocol !== "https:") throw new RepairError(`${label} must use HTTPS`);
  if (url.hostname !== "pbs.twimg.com") {
    throw new RepairError(`${label} host must be pbs.twimg.com, found ${url.hostname}`);
  }
  return url;
}

/** Fail closed unless the downloaded bytes and prepared image match the target. */
export function assertConfirmedSource(
  target: RepairTarget,
  downloaded: DownloadedSourceImage,
  prepared: PreparedImage,
): void {
  assertSourceUrl(target.sourceUrl, "target.sourceUrl");
  assertSourceUrl(downloaded.finalUrl, "downloaded.finalUrl");

  if (downloaded.contentType !== target.expectedContentType) {
    throw new RepairError(
      `Source Content-Type changed: expected ${target.expectedContentType}, received ${downloaded.contentType}`,
    );
  }
  if (downloaded.sha256 !== target.expectedSha256) {
    throw new RepairError(
      `Source checksum changed: expected ${target.expectedSha256}, received ${downloaded.sha256}`,
    );
  }
  if (downloaded.sizeBytes !== target.expectedSizeBytes) {
    throw new RepairError(
      `Source size changed: expected ${target.expectedSizeBytes}, received ${downloaded.sizeBytes}`,
    );
  }
  if (prepared.original.contentType !== target.expectedContentType) {
    throw new RepairError(
      `Prepared original Content-Type changed: expected ${target.expectedContentType}, received ${prepared.original.contentType}`,
    );
  }
  if (
    prepared.original.sha256 !== target.expectedSha256 ||
    prepared.original.sizeBytes !== target.expectedSizeBytes
  ) {
    throw new RepairError("Prepared original bytes do not match the target metadata");
  }
  if (
    prepared.original.width !== target.expectedDimensions.width ||
    prepared.original.height !== target.expectedDimensions.height
  ) {
    throw new RepairError(
      `Source dimensions changed: expected ${target.expectedDimensions.width}x${target.expectedDimensions.height}, received ${prepared.original.width}x${prepared.original.height}`,
    );
  }
  if (prepared.optimized.contentType !== "image/webp") {
    throw new RepairError("Optimized image must be image/webp");
  }
  if (!/^[a-f0-9]{64}$/.test(prepared.optimized.sha256)) {
    throw new RepairError("Optimized image SHA-256 is invalid");
  }
  if (!Number.isInteger(prepared.optimized.sizeBytes) || prepared.optimized.sizeBytes <= 0) {
    throw new RepairError("Optimized image size is invalid");
  }
}

export function buildRepairReference(
  target: RepairTarget,
  prepared: Pick<PreparedImage, "original" | "optimized">,
  keys: ReturnType<typeof planR2Keys>,
  verifiedAt: string,
): R2ImageReference {
  const candidate: R2ImageReference = {
    blobImageUrl: target.existingImageUrl,
    sourceSha256: keys.sourceSha256,
    original: {
      key: keys.originalKey,
      url: keys.originalUrl,
      sha256: prepared.original.sha256,
      sizeBytes: prepared.original.sizeBytes,
      contentType: prepared.original.contentType,
    },
    optimized: {
      key: keys.optimizedKey,
      url: keys.optimizedUrl,
      sha256: prepared.optimized.sha256,
      sizeBytes: prepared.optimized.sizeBytes,
      contentType: "image/webp",
    },
    verifiedAt,
  };

  const validation = validateR2ImageReference(candidate, target.posterId);
  if (!validation.ok) {
    throw new RepairError(`Generated r2Image is invalid: ${validation.reason}`);
  }
  return validation.value;
}

function sameReferenceCore(left: R2ImageReference, right: R2ImageReference): boolean {
  return (
    left.sourceSha256 === right.sourceSha256 &&
    left.original.key === right.original.key &&
    left.original.url === right.original.url &&
    left.original.sha256 === right.original.sha256 &&
    left.original.sizeBytes === right.original.sizeBytes &&
    left.original.contentType === right.original.contentType &&
    left.optimized.key === right.optimized.key &&
    left.optimized.url === right.optimized.url &&
    left.optimized.sha256 === right.optimized.sha256 &&
    left.optimized.sizeBytes === right.optimized.sizeBytes &&
    left.optimized.contentType === right.optimized.contentType
  );
}

function expectation(
  target: RepairTarget,
  image: Pick<PublishableImage, "original" | "optimized">,
  role: "original" | "optimized",
): R2ObjectExpectation {
  return role === "original"
    ? {
        sha256: image.original.sha256,
        sizeBytes: image.original.sizeBytes,
        contentType: image.original.contentType,
        cacheControl: R2_CACHE_CONTROL,
        userMetadata: {
          sha256: image.original.sha256,
          posterid: target.posterId,
          raindropid: target.raindropId,
          role,
        },
      }
    : {
        sha256: image.optimized.sha256,
        sizeBytes: image.optimized.sizeBytes,
        contentType: image.optimized.contentType,
        cacheControl: R2_CACHE_CONTROL,
        userMetadata: {
          sha256: image.optimized.sha256,
          posterid: target.posterId,
          raindropid: target.raindropId,
          role,
        },
      };
}

async function planObject(
  deps: Pick<RepairDependencies, "r2">,
  key: string,
  expected: R2ObjectExpectation,
): Promise<R2RepairAction> {
  const existing = await deps.r2.head(key);
  if (!existing) return "upload";

  const verification = await deps.r2.verifyOrigin(key, expected);
  if (!verification.ok) {
    throw new RepairError(
      `Existing R2 object ${key} does not match the expected bytes or metadata: ${
        verification.reason ?? "unknown reason"
      }`,
    );
  }
  return "reuse";
}

function requirePublishedTargetDocument(
  target: RepairTarget,
  current: FirestorePosterSnapshot | null,
): FirestorePosterSnapshot {
  if (!current) {
    throw new RepairError(
      `Firestore poster ${target.posterId} does not exist; refusing to create it`,
    );
  }
  const status = String(current.data.status ?? "").toLowerCase();
  if (status !== "published") {
    throw new RepairError(
      `Firestore poster ${target.posterId} is not published (status=${status})`,
    );
  }
  if (current.data.notionPageId !== target.notionPageId) {
    throw new RepairError(
      `Firestore poster ${target.posterId} notionPageId does not match the confirmed target`,
    );
  }
  if (current.data.image !== target.existingImageUrl) {
    throw new RepairError(
      `Firestore poster ${target.posterId} image does not match the confirmed legacy source`,
    );
  }
  if (
    current.data.posterImageUrl !== undefined &&
    current.data.posterImageUrl !== target.existingImageUrl
  ) {
    throw new RepairError(
      `Firestore poster ${target.posterId} posterImageUrl does not match the confirmed legacy source`,
    );
  }
  return current;
}

function planFirestore(
  target: RepairTarget,
  current: FirestorePosterSnapshot,
  reference: R2ImageReference,
): FirestoreRepairAction {
  const existing = current.data.r2Image;
  if (existing === undefined || existing === null) return "update";

  const validation = validateR2ImageReference(existing, target.posterId);
  if (!validation.ok) return "update";

  if (!sameReferenceCore(validation.value, reference)) {
    throw new RepairError(
      `Firestore poster ${target.posterId} already has a different valid r2Image; refusing to replace it`,
    );
  }
  return "already";
}

function identityMatches(record: IdentityRecord, target: RepairTarget, pageId: string): boolean {
  return (
    record.posterId === target.posterId &&
    record.status === "active" &&
    record.groupingPageId === pageId &&
    record.imageUrl === target.existingImageUrl &&
    record.provider === target.sourceProvider &&
    record.sha256 === target.expectedSha256 &&
    record.raindropId === target.raindropId
  );
}

async function planNotion(
  target: RepairTarget,
  deps: Pick<RepairDependencies, "notion">,
): Promise<RepairPlan["notion"]> {
  const page = await deps.notion.getPage(target.notionPageId);
  const pageStatus = statusName(page.properties.Status);
  if (!isPublishedStatus(pageStatus)) {
    throw new RepairError(
      `Notion page ${target.notionPageId} is not Published (status=${pageStatus || "missing"}); refusing to change editorial status`,
    );
  }

  const images = imageUrlsFromPage(page);
  const matches = images.filter((url) => url === target.existingImageUrl);
  if (matches.length !== 1) {
    throw new RepairError(
      `Notion page ${target.notionPageId} must contain the confirmed image URL exactly once; found ${matches.length}`,
    );
  }

  const records = await deps.notion.listIdentityRecords();
  const byPoster = records.filter((record) => record.posterId === target.posterId);
  if (byPoster.length > 1) {
    throw new RepairError(
      `Multiple Notion identity records claim poster ${target.posterId}; refusing to guess`,
    );
  }
  if (byPoster.length === 1) {
    if (!identityMatches(byPoster[0], target, target.notionPageId)) {
      throw new RepairError(
        `Notion identity record ${byPoster[0].identityRecordId} for ${target.posterId} does not match the confirmed target`,
      );
    }
    return {
      action: "already",
      pageStatus,
      identityRecordId: byPoster[0].identityRecordId,
    };
  }

  const duplicate = records.find(
    (record) =>
      record.status === "active" &&
      record.groupingPageId === target.notionPageId &&
      record.imageUrl === target.existingImageUrl,
  );
  if (duplicate) {
    throw new RepairError(
      `Notion image ${target.existingImageUrl} on page ${target.notionPageId} is already claimed by ${duplicate.posterId}`,
    );
  }

  return { action: "create", pageStatus, identityRecordId: null };
}

/**
 * Build a complete read-only plan. This downloads and prepares the source to
 * validate it, but never uploads, updates Firestore or writes Notion.
 */
export async function buildRepairPlan(
  target: RepairTarget,
  deps: RepairDependencies,
): Promise<RepairPlan> {
  const downloaded = await deps.download(target.sourceUrl);
  const prepared = await deps.prepare(downloaded);
  assertConfirmedSource(target, downloaded, prepared);

  const keys = planR2Keys(target.posterId, prepared, deps.optimizer);
  const reference = buildRepairReference(target, prepared, keys, deps.now().toISOString());

  const expectedOriginal = expectation(target, prepared, "original");
  const expectedOptimized = expectation(target, prepared, "optimized");
  const [original, optimized] = await Promise.all([
    planObject(deps, keys.originalKey, expectedOriginal),
    planObject(deps, keys.optimizedKey, expectedOptimized),
  ]);

  const current = requirePublishedTargetDocument(
    target,
    await deps.firestore.getPoster(target.posterId),
  );
  const firestoreAction = planFirestore(target, current, reference);
  const notion = await planNotion(target, deps);

  return {
    target,
    downloaded,
    prepared,
    keys,
    reference,
    r2: { original, optimized },
    firestore: { action: firestoreAction, current },
    notion,
  };
}

function assertReadBack(
  target: RepairTarget,
  before: FirestorePosterSnapshot,
  after: FirestorePosterSnapshot | null,
  expected: R2ImageReference,
): void {
  if (!after) {
    throw new RepairError(`Firestore poster ${target.posterId} disappeared after update`);
  }
  if (after.data.notionPageId !== target.notionPageId) {
    throw new RepairError(`Firestore poster ${target.posterId} notionPageId changed unexpectedly`);
  }
  if (after.data.image !== target.existingImageUrl) {
    throw new RepairError(`Firestore poster ${target.posterId} image changed unexpectedly`);
  }
  if (String(after.data.status ?? "").toLowerCase() !== "published") {
    throw new RepairError(`Firestore poster ${target.posterId} status changed unexpectedly`);
  }

  const validation = validateR2ImageReference(after.data.r2Image, target.posterId);
  if (!validation.ok || !sameReferenceCore(validation.value, expected)) {
    throw new RepairError(
      `Firestore poster ${target.posterId} r2Image did not read back as the expected reference`,
    );
  }

  const beforeWithoutReference = { ...before.data };
  const afterWithoutReference = { ...after.data };
  delete beforeWithoutReference.r2Image;
  delete afterWithoutReference.r2Image;
  if (stableStringify(beforeWithoutReference) !== stableStringify(afterWithoutReference)) {
    throw new RepairError(
      `Firestore poster ${target.posterId} unrelated fields changed during the repair`,
    );
  }
}

/** Execute a previously built plan. R2 first, then Notion, then Firestore. */
export async function executeRepairPlan(
  plan: RepairPlan,
  deps: RepairDependencies,
): Promise<RepairExecution> {
  const { target, prepared, keys } = plan;

  deps.audit.record({ event: "repair.execute.started", posterId: target.posterId });

  const published = await deps.publisher.publish(target.posterId, prepared, target.raindropId);
  const reference = buildRepairReference(target, prepared, keys, published.verifiedAt);
  if (!sameReferenceCore(reference, published)) {
    throw new RepairError("Published R2 reference does not match the planned keys");
  }
  deps.audit.record({
    event: "repair.r2.verified",
    posterId: target.posterId,
    originalKey: reference.original.key,
    optimizedKey: reference.optimized.key,
    sourceSha256: reference.sourceSha256,
  });

  const current = requirePublishedTargetDocument(
    target,
    await deps.firestore.getPoster(target.posterId),
  );
  const firestoreAction = planFirestore(target, current, reference);

  const notion = await planNotion(target, deps);
  if (notion.action === "create") {
    const recordId = await deps.notion.createIdentityRecord({
      target,
      groupingPageId: target.notionPageId,
      imageUrl: target.existingImageUrl,
      verifiedAt: deps.now().toISOString(),
    });
    const created = await deps.notion.getIdentityRecord(recordId);
    if (!identityMatches(created, target, target.notionPageId)) {
      throw new RepairError(
        `Notion identity record ${recordId} did not read back as the confirmed target`,
      );
    }
    deps.audit.record({
      event: "repair.notion.identity_created",
      posterId: target.posterId,
      identityRecordId: recordId,
    });
  } else {
    deps.audit.record({
      event: "repair.notion.identity_present",
      posterId: target.posterId,
      identityRecordId: notion.identityRecordId,
    });
  }

  if (firestoreAction === "update") {
    await deps.firestore.updateR2Image(target.posterId, reference);
    const after = await deps.firestore.getPoster(target.posterId);
    assertReadBack(target, current, after, reference);
    deps.audit.record({
      event: "repair.firestore.reference_updated",
      posterId: target.posterId,
    });
  } else {
    deps.audit.record({
      event: "repair.firestore.reference_present",
      posterId: target.posterId,
    });
  }

  deps.audit.record({ event: "repair.execute.completed", posterId: target.posterId });

  return {
    target,
    reference,
    firestoreAction,
    notionAction: notion.action,
    r2: plan.r2,
  };
}
