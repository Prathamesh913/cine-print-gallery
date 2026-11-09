/**
 * Canonical poster identity resolution for the Notion -> Firestore sync.
 *
 * This module is intentionally dependency-free and side-effect-free. It does
 * not import Notion, Firestore, Blob or R2 clients. Callers pass plain objects
 * and receive explicit result objects; expected unresolved/conflict states are
 * reported, not thrown.
 *
 * Identity invariants:
 * - The canonical poster ID is the existing Firestore document ID.
 * - IDs are never derived from title, slug, image URL or array position.
 * - Reordering, inserting, removing or replacing images never changes an ID.
 * - A new image without identity is unresolved; a duplicate/unknown/mismatched
 *   identity is a conflict. Both fail closed before any write.
 */

export const IDENTITY_MODES = Object.freeze(["legacy", "transition", "canonical"]);

const POSTER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CANONICAL_ID_PROPERTY = "CinePrint Poster ID";
const IDENTITY_STATUSES = new Set(["active", "superseded", "unresolved"]);

function splitUrls(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function richTextValue(prop) {
  if (!prop) return "";
  if (prop.type === "title") {
    return (prop.title || []).map((part) => part?.plain_text || "").join("");
  }
  if (prop.type === "rich_text") {
    return (prop.rich_text || []).map((part) => part?.plain_text || "").join("");
  }
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "status") return prop.status?.name || "";
  if (prop.type === "number") return prop.number ?? "";
  return "";
}

function selectValue(prop) {
  if (!prop) return "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "status") return prop.status?.name || "";
  return richTextValue(prop);
}

export function normalizePosterId(value) {
  if (typeof value !== "string") {
    return { ok: false, reason: "NOT_A_STRING" };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, reason: "EMPTY" };
  if (!POSTER_ID_PATTERN.test(trimmed)) {
    return { ok: false, reason: "INVALID_FORMAT" };
  }
  return { ok: true, id: trimmed, hadWhitespace: trimmed !== value };
}

export function canonicalPosterIdFromPage(page) {
  const props = page?.properties || {};
  if (!Object.prototype.hasOwnProperty.call(props, CANONICAL_ID_PROPERTY)) {
    return { status: "absent" };
  }
  const prop = props[CANONICAL_ID_PROPERTY];
  if (prop?.type !== "rich_text") {
    return {
      status: "invalid",
      reason: "INVALID_PROPERTY_TYPE",
      propertyType: prop?.type ?? "unknown",
    };
  }
  const raw = richTextValue(prop);
  const trimmed = raw.trim();
  if (!trimmed) return { status: "empty", raw };
  const normalized = normalizePosterId(trimmed);
  if (!normalized.ok) {
    return { status: "invalid", raw, reason: normalized.reason };
  }
  return {
    status: "present",
    posterId: normalized.id,
    raw,
    hadWhitespace: raw !== trimmed,
  };
}

export function imageUrlsFromPage(page) {
  const prop = page?.properties?.["Image URL"];
  if (!prop) return [];
  if (prop.type === "url") return splitUrls(prop.url);
  if (prop.type === "rich_text") return splitUrls(richTextValue(prop));
  if (prop.type === "files") {
    return (prop.files || [])
      .map((file) => file?.file?.url || file?.external?.url || "")
      .filter(Boolean);
  }
  return [];
}

/**
 * Map proposed `Poster Identities` data-source rows into plain identity records.
 * The adapter accepts either a Notion relation (`Grouping Page`) or a text
 * fallback (`Grouping Page ID`). The data source does not exist in live Notion
 * yet; this is the isolated adapter for fixtures and the future 7C schema.
 */
export function identityRecordsFromNotion(rows) {
  return (rows || []).map((row) => {
    const props = row?.properties || {};
    const relation = props["Grouping Page"];
    const relationIds =
      relation?.type === "relation"
        ? (relation.relation || []).map((item) => item?.id).filter(Boolean)
        : [];
    const fallback = richTextValue(props["Grouping Page ID"]).trim();
    const groupingPageIds = [...new Set([...relationIds, ...(fallback ? [fallback] : [])])];
    const statusRaw = selectValue(props.Status).trim().toLowerCase();
    return {
      identityRecordId: String(row?.id ?? ""),
      posterId: richTextValue(props["Poster ID"]).trim(),
      groupingPageId: groupingPageIds[0] ?? null,
      groupingPageIds,
      imageUrl: richTextValue(props["Image URL"]).trim(),
      raindropId: richTextValue(props["Raindrop ID"]).trim() || null,
      provider: selectValue(props["Source Provider"]).trim() || null,
      sha256: richTextValue(props["Source SHA-256"]).trim() || null,
      revision:
        typeof props["Source Revision"]?.number === "number" ? props["Source Revision"].number : 1,
      status: statusRaw || "active",
    };
  });
}

function legacyCandidate(page, firestoreById) {
  const props = page?.properties || {};
  const raindropId = richTextValue(props["Raindrop ID"]).trim();
  if (raindropId) {
    const id = `artwork-${raindropId}`;
    if (firestoreById.has(id)) {
      return { ok: true, posterId: id, source: "legacy_raindrop" };
    }
    return {
      ok: false,
      reason: "LEGACY_RAINDROP_NOT_FOUND",
      detail: `No existing Firestore document ${id} for Raindrop ID ${raindropId}`,
    };
  }
  // Deliberately do not derive a slug from the title. Only an explicit Slug
  // property may participate in the controlled legacy transition.
  const explicitSlug = richTextValue(props.Slug).trim().toLowerCase().replace(/\s+/g, "-");
  if (explicitSlug) {
    if (firestoreById.has(explicitSlug)) {
      return { ok: true, posterId: explicitSlug, source: "legacy_slug" };
    }
    return {
      ok: false,
      reason: "LEGACY_SLUG_NOT_FOUND",
      detail: `No existing Firestore document ${explicitSlug} for explicit Slug`,
    };
  }
  return {
    ok: false,
    reason: "MISSING_CANONICAL_ID",
    detail: "No CinePrint Poster ID, Raindrop ID, or explicit Slug",
  };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortBy(items, key) {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

export function resolveNotionIdentities(input = {}) {
  const pages = Array.isArray(input.pages) ? input.pages : [];
  const firestoreDocuments = Array.isArray(input.firestoreDocuments)
    ? input.firestoreDocuments
    : [];
  const identityRecords = Array.isArray(input.identityRecords) ? input.identityRecords : [];
  const mode = input.mode || "transition";
  if (!IDENTITY_MODES.includes(mode)) {
    throw new Error(`Unknown identity mode: ${mode}`);
  }
  if (mode === "canonical" && input.allowLegacy) {
    throw new Error("canonical mode cannot enable legacy identity fallback");
  }
  const allowLegacy = Boolean(input.allowLegacy) && (mode === "transition" || mode === "legacy");
  const firestoreById = new Map(firestoreDocuments.map((doc) => [String(doc.id), doc]));
  const known = new Set((input.knownPosterIds || [...firestoreById.keys()]).map(String));
  const pageById = new Map(pages.map((page) => [String(page.id), page]));

  const resolved = [];
  const unresolved = [];
  const conflicts = [];
  const orphaned = [];
  const warnings = [];
  const ignoredPages = [];
  const claims = new Map();

  const addConflict = (kind, detail, extra = {}) => conflicts.push({ kind, detail, ...extra });
  const addUnresolved = (reason, detail, extra = {}) =>
    unresolved.push({ reason, detail, ...extra });

  const claim = (posterId, pageId, source, identityRecordId) => {
    const existing = claims.get(posterId);
    if (existing) {
      addConflict(
        "DUPLICATE_ID",
        `Poster ID ${posterId} is claimed by both ${existing.pageId} and ${pageId}`,
        { posterId, pageId, otherPageId: existing.pageId },
      );
      return false;
    }
    claims.set(posterId, { pageId, source, identityRecordId });
    return true;
  };

  const validateTarget = (posterId, pageId) => {
    if (!known.has(posterId)) {
      addConflict("UNKNOWN_ID", `Unknown poster ID ${posterId}`, {
        posterId,
        pageId,
      });
      return false;
    }
    const doc = firestoreById.get(posterId);
    if (!doc) {
      addConflict("MISSING_FIRESTORE_DOCUMENT", `Firestore document ${posterId} is missing`, {
        posterId,
        pageId,
      });
      return false;
    }
    const docPageId = doc.notionPageId ? String(doc.notionPageId) : "";
    if (!docPageId) {
      addConflict(
        "MISSING_PAGE_ASSOCIATION",
        `Firestore document ${posterId} has no notionPageId`,
        { posterId, pageId },
      );
      return false;
    }
    if (docPageId !== pageId) {
      addConflict(
        "PAGE_MISMATCH",
        `Poster ${posterId} is associated with ${docPageId} but resolved from ${pageId}`,
        { posterId, pageId, firestorePageId: docPageId },
      );
      return false;
    }
    return true;
  };

  const accept = (posterId, pageId, source, identityRecordId, imageUrl, extra = {}) => {
    if (!validateTarget(posterId, pageId)) return false;
    if (!claim(posterId, pageId, source, identityRecordId)) return false;
    resolved.push({
      posterId,
      identitySource: source,
      groupingPageId: pageId,
      identityRecordId,
      imageUrl,
      ...extra,
    });
    return true;
  };

  // Records that cannot be attached to exactly one existing grouping page are
  // system-level identity conflicts; they are reported before any page loop.
  const invalidRecordIds = new Set();
  for (const record of identityRecords) {
    if (record.status && !IDENTITY_STATUSES.has(record.status)) {
      addConflict(
        "INVALID_IDENTITY_STATUS",
        `Identity record ${record.identityRecordId} has invalid status ${record.status}`,
        { recordId: record.identityRecordId },
      );
      invalidRecordIds.add(record.identityRecordId);
      continue;
    }
    if (!record.groupingPageId) {
      addConflict(
        "MISSING_RELATION",
        `Identity record ${record.identityRecordId} has no grouping page`,
        { recordId: record.identityRecordId },
      );
      invalidRecordIds.add(record.identityRecordId);
      continue;
    }
    if (Array.isArray(record.groupingPageIds) && record.groupingPageIds.length > 1) {
      addConflict(
        "MULTIPLE_GROUPING_PAGES",
        `Identity record ${record.identityRecordId} references multiple grouping pages`,
        { recordId: record.identityRecordId },
      );
      invalidRecordIds.add(record.identityRecordId);
      continue;
    }
    if (!pageById.has(String(record.groupingPageId))) {
      addConflict(
        "INVALID_RELATION_TARGET",
        `Identity record ${record.identityRecordId} targets unknown page ${record.groupingPageId}`,
        {
          recordId: record.identityRecordId,
          pageId: String(record.groupingPageId),
        },
      );
      invalidRecordIds.add(record.identityRecordId);
    }
  }

  const recordsByGroup = new Map();
  for (const record of identityRecords) {
    if (!record.groupingPageId || invalidRecordIds.has(record.identityRecordId)) continue;
    const groupId = String(record.groupingPageId);
    if (!recordsByGroup.has(groupId)) recordsByGroup.set(groupId, []);
    recordsByGroup.get(groupId).push(record);
  }

  for (const page of pages) {
    const pageId = String(page.id);
    const images = imageUrlsFromPage(page);
    const records = recordsByGroup.get(pageId) || [];
    const canonical = canonicalPosterIdFromPage(page);

    if (images.length === 0) {
      ignoredPages.push(pageId);
      if (canonical.status === "present" || canonical.status === "invalid" || records.length > 0) {
        addUnresolved("MISSING_PAGE_IMAGE", `Page ${pageId} has identity data but no Image URL`, {
          pageId,
        });
      }
      for (const record of records) {
        if ((record.status || "active") !== "active") continue;
        const normalized = normalizePosterId(record.posterId);
        if (!normalized.ok) {
          addConflict(
            "INVALID_CANONICAL_ID",
            `Identity record ${record.identityRecordId} has an invalid poster ID`,
            { pageId, recordId: record.identityRecordId, reason: normalized.reason },
          );
          continue;
        }
        if (!record.imageUrl) {
          addConflict(
            "MISSING_IMAGE_URL",
            `Identity record ${record.identityRecordId} has no image URL`,
            { posterId: normalized.id, pageId, recordId: record.identityRecordId },
          );
          continue;
        }
        if (
          accept(
            normalized.id,
            pageId,
            "per_image_relation",
            record.identityRecordId,
            record.imageUrl,
            {
              orphaned: true,
              sourceRevision: record.revision,
              sourceProvider: record.provider,
              sourceRaindropId: record.raindropId,
            },
          )
        ) {
          orphaned.push({
            posterId: normalized.id,
            groupingPageId: pageId,
            identityRecordId: record.identityRecordId,
            reason: "PAGE_HAS_NO_IMAGES",
          });
        }
      }
      continue;
    }

    if (images.length === 1) {
      if (records.length > 0) {
        addConflict(
          "AMBIGUOUS_IDENTITY_SOURCE",
          `Single-image page ${pageId} has per-image identity records`,
          { pageId },
        );
        continue;
      }
      if (canonical.status === "present") {
        if (canonical.hadWhitespace) {
          warnings.push(
            `Canonical poster ID on ${pageId} had surrounding whitespace and was trimmed`,
          );
        }
        accept(canonical.posterId, pageId, "notion_property", null, images[0], {
          sourceRevision: 1,
          sourceProvider: null,
          sourceRaindropId: null,
        });
        continue;
      }
      if (canonical.status === "invalid") {
        addConflict("INVALID_CANONICAL_ID", `Page ${pageId} has an invalid CinePrint Poster ID`, {
          pageId,
          reason: canonical.reason,
        });
        continue;
      }
      if (!allowLegacy) {
        addUnresolved("MISSING_CANONICAL_ID", `Page ${pageId} has no CinePrint Poster ID`, {
          pageId,
          imageUrl: images[0],
        });
        continue;
      }
      const legacy = legacyCandidate(page, firestoreById);
      if (!legacy.ok) {
        addUnresolved(legacy.reason, legacy.detail, {
          pageId,
          imageUrl: images[0],
        });
        continue;
      }
      if (
        accept(legacy.posterId, pageId, legacy.source, null, images[0], {
          sourceRevision: 1,
          sourceProvider: null,
          sourceRaindropId: null,
        })
      ) {
        warnings.push(
          `Legacy ${legacy.source} resolution used for ${pageId} -> ${legacy.posterId}`,
        );
      }
      continue;
    }

    // Multi-image pages must use per-image identity records. A page-level
    // canonical property is ambiguous, and positional fallback is prohibited.
    if (canonical.status === "present" || canonical.status === "invalid") {
      addConflict(
        "AMBIGUOUS_IDENTITY_SOURCE",
        `Multi-image page ${pageId} has a page-level CinePrint Poster ID`,
        { pageId },
      );
      continue;
    }
    if (records.length === 0) {
      addUnresolved(
        "MISSING_IDENTITY_RECORDS",
        `Multi-image page ${pageId} has no identity records`,
        { pageId },
      );
      continue;
    }

    const active = records.filter((record) => (record.status || "active") === "active");
    const inactive = records.filter((record) => (record.status || "active") !== "active");
    for (const record of inactive) {
      if (record.status === "unresolved") {
        addUnresolved(
          "UNRESOLVED_IDENTITY_RECORD",
          `Identity record ${record.identityRecordId} is marked unresolved`,
          { pageId, recordId: record.identityRecordId },
        );
      } else {
        orphaned.push({
          posterId: record.posterId || null,
          groupingPageId: pageId,
          identityRecordId: record.identityRecordId,
          reason: `STATUS_${String(record.status).toUpperCase()}`,
        });
      }
    }

    const imageSet = new Set(images);
    const activeImages = new Set();
    for (const record of active) {
      const normalized = normalizePosterId(record.posterId);
      if (!normalized.ok) {
        addConflict(
          "INVALID_CANONICAL_ID",
          `Identity record ${record.identityRecordId} has an invalid poster ID`,
          { pageId, recordId: record.identityRecordId, reason: normalized.reason },
        );
        continue;
      }
      if (!record.imageUrl) {
        addConflict(
          "MISSING_IMAGE_URL",
          `Identity record ${record.identityRecordId} has no image URL`,
          {
            posterId: normalized.id,
            pageId,
            recordId: record.identityRecordId,
          },
        );
        continue;
      }
      activeImages.add(record.imageUrl);
      if (!imageSet.has(record.imageUrl)) {
        if (
          accept(
            normalized.id,
            pageId,
            "per_image_relation",
            record.identityRecordId,
            record.imageUrl,
            {
              orphaned: true,
              sourceRevision: record.revision,
              sourceProvider: record.provider,
              sourceRaindropId: record.raindropId,
            },
          )
        ) {
          orphaned.push({
            posterId: normalized.id,
            groupingPageId: pageId,
            identityRecordId: record.identityRecordId,
            reason: "IMAGE_NOT_ON_PAGE",
          });
        }
        continue;
      }
      accept(
        normalized.id,
        pageId,
        "per_image_relation",
        record.identityRecordId,
        record.imageUrl,
        {
          sourceRevision: record.revision,
          sourceProvider: record.provider,
          sourceRaindropId: record.raindropId,
        },
      );
    }

    for (const imageUrl of images) {
      if (!activeImages.has(imageUrl)) {
        addUnresolved(
          "NEW_IMAGE_WITHOUT_IDENTITY",
          `Page ${pageId} has an image with no identity record`,
          { pageId, imageUrl },
        );
      }
    }
  }

  const byImage = new Map();
  for (const identity of resolved) {
    if (!identity.imageUrl) continue;
    if (!byImage.has(identity.imageUrl)) byImage.set(identity.imageUrl, new Set());
    byImage.get(identity.imageUrl).add(identity.posterId);
  }
  for (const [imageUrl, ids] of byImage) {
    if (ids.size > 1) {
      warnings.push(`Duplicate image URL used by ${[...ids].sort().join(", ")}: ${imageUrl}`);
    }
  }

  const bySource = new Map();
  for (const record of identityRecords) {
    if (!record.raindropId || (record.status || "active") !== "active") continue;
    if (!bySource.has(record.raindropId)) bySource.set(record.raindropId, new Set());
    bySource.get(record.raindropId).add(record.posterId);
  }
  for (const [sourceId, ids] of bySource) {
    if (ids.size > 1) {
      warnings.push(`Duplicate source ID used by ${[...ids].sort().join(", ")}: ${sourceId}`);
    }
  }

  const resolvedIds = new Set(resolved.map((identity) => identity.posterId));
  const orphanedFirestoreDocuments = firestoreDocuments
    .filter((doc) => doc.notionPageId && !resolvedIds.has(String(doc.id)))
    .map((doc) => ({
      posterId: String(doc.id),
      notionPageId: String(doc.notionPageId),
      reason: "NO_NOTION_IDENTITY",
    }));

  const result = {
    mode,
    allowLegacy,
    resolved: sortBy(resolved, (identity) => `${identity.groupingPageId}|${identity.posterId}`),
    unresolved: sortBy(
      dedupe(unresolved),
      (entry) => `${entry.pageId || ""}|${entry.imageUrl || ""}|${entry.reason}`,
    ),
    conflicts: sortBy(
      dedupe(conflicts),
      (entry) => `${entry.pageId || ""}|${entry.posterId || ""}|${entry.kind}|${entry.detail}`,
    ),
    orphaned: sortBy(
      dedupe(orphaned),
      (entry) => `${entry.groupingPageId}|${entry.posterId || ""}|${entry.reason}`,
    ),
    orphanedFirestoreDocuments: sortBy(orphanedFirestoreDocuments, (entry) => entry.posterId),
    warnings: [...new Set(warnings)].sort(),
    ignoredPages: [...new Set(ignoredPages)].sort(),
  };

  result.summary = {
    mode,
    allowLegacy,
    resolved: result.resolved.length,
    notionProperty: result.resolved.filter(
      (identity) => identity.identitySource === "notion_property",
    ).length,
    perImageRelation: result.resolved.filter(
      (identity) => identity.identitySource === "per_image_relation",
    ).length,
    legacySlug: result.resolved.filter((identity) => identity.identitySource === "legacy_slug")
      .length,
    legacyRaindrop: result.resolved.filter(
      (identity) => identity.identitySource === "legacy_raindrop",
    ).length,
    unresolved: result.unresolved.length,
    conflicts: result.conflicts.length,
    orphaned: result.orphaned.length + result.orphanedFirestoreDocuments.length,
    warnings: result.warnings.length,
    ignoredPages: result.ignoredPages.length,
  };
  return result;
}

export function buildSyncPlan(input = {}) {
  const parsePage = input.parsePage;
  if (typeof parsePage !== "function") {
    throw new Error("buildSyncPlan requires a parsePage function");
  }
  const pages = Array.isArray(input.pages) ? input.pages : [];
  const firestoreDocuments = Array.isArray(input.firestoreDocuments)
    ? input.firestoreDocuments
    : [];
  const resolution = resolveNotionIdentities(input);
  const pageById = new Map(pages.map((page) => [String(page.id), page]));
  const firestoreById = new Map(firestoreDocuments.map((doc) => [String(doc.id), doc]));

  const dataConflicts = [];
  const records = [];
  for (const identity of resolution.resolved) {
    // Orphaned identities are preserved but not written; the existing document
    // is left untouched until a human reattaches or archives it.
    if (identity.orphaned) continue;
    const page = pageById.get(identity.groupingPageId);
    if (!page) {
      dataConflicts.push({
        kind: "INVALID_RELATION_TARGET",
        detail: `No grouping page ${identity.groupingPageId}`,
        posterId: identity.posterId,
        pageId: identity.groupingPageId,
      });
      continue;
    }
    const pageRecords = parsePage(page);
    const matches = pageRecords.filter((record) => record.image === identity.imageUrl);
    if (matches.length === 0) {
      dataConflicts.push({
        kind: "MISSING_PAGE_IMAGE",
        detail: `No parsed record for ${identity.imageUrl}`,
        posterId: identity.posterId,
        pageId: identity.groupingPageId,
      });
      continue;
    }
    if (matches.length > 1) {
      dataConflicts.push({
        kind: "AMBIGUOUS_PAGE_IMAGE",
        detail: `Multiple parsed records for ${identity.imageUrl}`,
        posterId: identity.posterId,
        pageId: identity.groupingPageId,
      });
      continue;
    }
    const data = matches[0];
    if (String(data.notionPageId) !== identity.groupingPageId) {
      dataConflicts.push({
        kind: "PAGE_MISMATCH",
        detail: `Parsed record page ${data.notionPageId} differs from ${identity.groupingPageId}`,
        posterId: identity.posterId,
        pageId: identity.groupingPageId,
      });
      continue;
    }
    const { id: _legacyId, ...dataWithoutId } = data;
    records.push({
      id: identity.posterId,
      data: dataWithoutId,
      identity,
    });
  }

  const conflicts = sortBy(
    dedupe([...resolution.conflicts, ...dataConflicts]),
    (entry) => `${entry.pageId || ""}|${entry.posterId || ""}|${entry.kind}|${entry.detail}`,
  );
  const unresolved = resolution.unresolved;
  const orphaned = resolution.orphaned;
  const resolvedIds = new Set(resolution.resolved.map((identity) => identity.posterId));
  const existingIds = new Set(firestoreById.keys());
  const missing = [...resolvedIds].filter((id) => !existingIds.has(id));
  const potentialCreates = missing.length;
  const potentialUpdates = records.filter((record) => existingIds.has(record.id)).length;
  const pruneCandidates = input.prune
    ? firestoreDocuments
        .filter(
          (doc) =>
            doc.notionPageId && doc.status !== "archived" && !resolvedIds.has(String(doc.id)),
        )
        .map((doc) => ({
          posterId: String(doc.id),
          notionPageId: String(doc.notionPageId),
        }))
    : [];
  const pruneAllowed = Boolean(
    input.prune &&
    input.pruneAllowed &&
    conflicts.length === 0 &&
    unresolved.length === 0 &&
    orphaned.length === 0 &&
    potentialCreates === 0,
  );
  const ok = conflicts.length === 0 && unresolved.length === 0 && potentialCreates === 0;

  const summary = {
    mode: resolution.mode,
    allowLegacy: resolution.allowLegacy,
    ok,
    pages: {
      total: pages.length,
      withImages: pages.filter((page) => imageUrlsFromPage(page).length > 0).length,
      ignored: resolution.ignoredPages.length,
    },
    identity: {
      resolved: resolution.resolved.length,
      notionProperty: resolution.summary.notionProperty,
      perImageRelation: resolution.summary.perImageRelation,
      legacySlug: resolution.summary.legacySlug,
      legacyRaindrop: resolution.summary.legacyRaindrop,
    },
    unresolved: unresolved.length,
    conflicts: conflicts.length,
    orphaned: orphaned.length + resolution.orphanedFirestoreDocuments.length,
    warnings: resolution.warnings.length,
    firestore: {
      existing: existingIds.size,
      resolvedExisting: potentialUpdates,
      missing,
      potentialCreates,
      potentialUpdates,
    },
    prune: {
      requested: Boolean(input.prune),
      allowed: pruneAllowed,
      candidates: pruneCandidates.length,
    },
  };

  return {
    mode: resolution.mode,
    allowLegacy: resolution.allowLegacy,
    ok,
    resolution,
    records,
    conflicts,
    unresolved,
    orphaned,
    orphanedFirestoreDocuments: resolution.orphanedFirestoreDocuments,
    warnings: resolution.warnings,
    ignoredPages: resolution.ignoredPages,
    firestore: summary.firestore,
    prune: {
      requested: Boolean(input.prune),
      allowed: pruneAllowed,
      candidates: pruneCandidates,
    },
    summary,
  };
}

/**
 * Execute a validated plan through an injected adapter. Any validation failure
 * or blocked prune returns before the adapter is touched, guaranteeing zero
 * writes on failure.
 */
export async function applySyncPlan(plan, adapter) {
  if (!plan?.ok) {
    return { ok: false, wrote: 0, pruned: 0, reason: "PLAN_NOT_OK" };
  }
  if (plan.prune?.requested && !plan.prune.allowed) {
    return { ok: false, wrote: 0, pruned: 0, reason: "PRUNE_NOT_ALLOWED" };
  }
  if (typeof adapter?.write !== "function") {
    throw new Error("applySyncPlan requires an adapter.write function");
  }
  await adapter.write(plan.records);
  let pruned = 0;
  if (plan.prune?.allowed && plan.prune.candidates.length > 0) {
    if (typeof adapter?.prune !== "function") {
      throw new Error("applySyncPlan requires an adapter.prune function for prune");
    }
    await adapter.prune(plan.prune.candidates);
    pruned = plan.prune.candidates.length;
  }
  return { ok: true, wrote: plan.records.length, pruned, reason: null };
}
