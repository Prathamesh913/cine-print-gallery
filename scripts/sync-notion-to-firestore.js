import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  IDENTITY_MODES,
  applySyncPlan,
  buildSyncPlan,
  identityRecordsFromNotion,
} from "./poster-identity.js";

dotenv.config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const notionKey = process.env.NOTION_KEY || process.env.NOTION_API_KEY || "";
const databaseId = process.env.NOTION_DATABASE_ID || "";
const identityDataSourceId = process.env.NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID?.trim() || "";

function textProp(prop) {
  if (!prop) return "";
  if (prop.type === "title") return prop.title?.[0]?.plain_text || "";
  if (prop.type === "rich_text") return prop.rich_text?.[0]?.plain_text || "";
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "number") return prop.number ?? "";
  return "";
}

function multiSelect(prop) {
  if (!prop || prop.type !== "multi_select") return [];
  return (prop.multi_select || []).map((t) => t.name).filter(Boolean);
}

function selectName(prop) {
  if (!prop) return "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "status") return prop.status?.name || "";
  return textProp(prop);
}

function urlOrText(prop) {
  if (!prop) return "";
  if (prop.type === "url" && prop.url) return prop.url;
  if (prop.type === "rich_text" && prop.rich_text?.length) {
    return prop.rich_text.map((t) => t.plain_text || "").join("");
  }
  return "";
}

export function imageUrlsFromProp(prop) {
  if (!prop) return [];
  if (prop.type === "url" && prop.url) {
    return prop.url
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
  }
  if (prop.type === "rich_text" && prop.rich_text?.length > 0) {
    const text = prop.rich_text.map((t) => t.plain_text || "").join("\n");
    return text
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
  }
  if (prop.type === "files" && prop.files?.length > 0) {
    return prop.files.map((f) => f.file?.url || f.external?.url || "").filter(Boolean);
  }
  return [];
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

function normalizeStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return "review";
  if (s === "published") return "published";
  if (s === "review" || s === "in review") return "review";
  if (s === "draft") return "draft";
  if (s === "archived" || s === "rejected") return "archived";
  return s;
}

/**
 * Legacy parser retained for the read-only migration manifest builder and
 * legacy dry-runs. Its generated `id` is NOT authoritative for writes; the
 * canonical sync path resolves identity through scripts/poster-identity.js and
 * uses `parsePageData`, which omits legacy ID generation entirely.
 */
export function parsePage(page, options = {}) {
  const generateLegacyIds = options.generateLegacyIds !== false;
  const props = page.properties || {};
  const imageUrls = imageUrlsFromProp(props["Image URL"]);
  if (imageUrls.length === 0) return [];

  const raindropId = textProp(props["Raindrop ID"]) || null;
  const rawSlug = textProp(props.Slug);
  const baseSlug = rawSlug
    ? rawSlug.trim().toLowerCase().replace(/\s+/g, "-")
    : slugify(textProp(props.Name) || textProp(props.Title) || "");

  const tmdbId = textProp(props["TMDB ID"]) || textProp(props.tmdbId) || null;

  // Legacy positional identity: a single Notion page may hold several artwork
  // images in the "Image URL" property. The Firebase document ID is derived
  // from the slug plus the image's position in that list (backrooms-1, ...).
  // This identity is position-based and can drift if images are inserted,
  // deleted or reordered. New automated records (one Raindrop bookmark per
  // Notion page) must NOT use this strategy — they use artwork-{raindropId}.
  const isAutomatedArtwork = Boolean(raindropId) && imageUrls.length === 1;

  const artistRaw = textProp(props.Artist) || "Unknown";
  const artistParts = artistRaw.split("|").map((s) => s.trim());

  const artistUrlRaw = urlOrText(props["Artist URL"]);
  const artistUrlParts = artistUrlRaw.split("|").map((s) => s.trim());

  const sourceRaw = textProp(props.Source) || "Unknown";
  const sourceParts = sourceRaw.split("|").map((s) => s.trim());

  const sourceUrlRaw = urlOrText(props["Source URL"]);
  const sourceUrlParts = sourceUrlRaw
    .split(/[\n,|]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const title = textProp(props.Name) || textProp(props.Title) || "Untitled";
  const year = typeof props.Year?.number === "number" ? props.Year.number : 0;
  const style = props.Style?.select?.name || "Minimalist";
  const genre = multiSelect(props.Genre);
  const tags = multiSelect(props.Tags);
  const note = textProp(props.Note) || null;
  const status = normalizeStatus(selectName(props.Status) || "Published");

  const mediaType = textProp(props["Media Type"]) || textProp(props.MediaType) || null;
  const imdbId =
    textProp(props["IMDb ID"]) || textProp(props["IMDB ID"]) || textProp(props.imdbId) || null;
  const seasonNumber =
    typeof props["Season Number"]?.number === "number"
      ? props["Season Number"].number
      : typeof props.Season?.number === "number"
        ? props.Season.number
        : null;
  const collectionName = textProp(props.Collection) || textProp(props["Collection Name"]) || null;
  const backgroundUrl = urlOrText(props["Background URL"]) || null;
  const libraryNames = multiSelect(props.Library).length
    ? multiSelect(props.Library)
    : multiSelect(props["Library Names"]);

  return imageUrls.map((url, index) => {
    const posterArtistRaw = artistParts[index] || artistParts[0] || "Unknown";
    const posterArtistUrlRaw = artistUrlParts[index] || artistUrlParts[0] || "";

    const artistNames = posterArtistRaw
      .split(/[,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const artistUrls = posterArtistUrlRaw
      .split(/[,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const artists = artistNames.map((name, i) => ({
      name,
      url: artistUrls[i] || null,
    }));

    const artistNamesJoined = artistNames.join(" & ") || "Unknown";

    let legacyId;
    if (isAutomatedArtwork) {
      legacyId = `artwork-${raindropId}`;
    } else if (baseSlug) {
      legacyId = imageUrls.length > 1 ? `${baseSlug}-${index + 1}` : baseSlug;
    } else {
      legacyId = index === 0 ? page.id : `${page.id}-${index}`;
    }

    return {
      id: generateLegacyIds ? legacyId : null,
      notionPageId: page.id,
      artworkId: isAutomatedArtwork ? raindropId : null,
      raindropId: isAutomatedArtwork ? raindropId : null,
      titleId: tmdbId,
      title,
      year,
      artists,
      artist: artistNamesJoined,
      artistUrl: artists[0]?.url || null,
      source: sourceParts[index] || sourceParts[0] || "Unknown",
      sourceUrl: sourceUrlParts[index] || sourceUrlParts[0] || "",
      image: url,
      posterImageUrl: url,
      style,
      genre,
      tags,
      note,
      status,
      mediaType,
      tmdbId,
      imdbId,
      seasonNumber,
      collectionName,
      backgroundUrl,
      libraryNames,
      slug: isAutomatedArtwork ? baseSlug : legacyId,
    };
  });
}

/**
 * Data-only parser for the canonical write path. It deliberately does not
 * generate a positional legacy ID; buildSyncPlan supplies the canonical ID.
 */
export function parsePageData(page) {
  return parsePage(page, { generateLegacyIds: false });
}

async function fetchAllNotionPages(notion) {
  const db = await notion.databases.retrieve({ database_id: databaseId });
  const dataSources = db.data_sources;

  const pages = [];
  let cursor = undefined;

  const queryOnce = async (start_cursor) => {
    if (dataSources && dataSources.length > 0) {
      return notion.dataSources.query({
        data_source_id: dataSources[0].id,
        start_cursor,
        page_size: 100,
      });
    }
    return notion.databases.query({
      database_id: databaseId,
      start_cursor,
      page_size: 100,
    });
  };

  while (true) {
    const response = await queryOnce(cursor);
    pages.push(...(response.results || []));
    if (!response.has_more) break;
    cursor = response.next_cursor;
  }

  return pages;
}

export function initAdmin() {
  if (getApps().length > 0) return getFirestore();

  let serviceAccount = null;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    serviceAccount = JSON.parse(raw);
  } else {
    const keyPath = path.join(ROOT, "firebase-admin-key.json");
    if (fs.existsSync(keyPath)) {
      serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    }
  }

  if (!serviceAccount) {
    throw new Error(
      "Missing Firebase Admin credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON or add firebase-admin-key.json",
    );
  }

  initializeApp({ credential: cert(serviceAccount) });
  return getFirestore();
}

export function computeConflicts(posters) {
  const byId = new Map();
  const conflictingIds = new Set();

  for (const poster of posters) {
    if (byId.has(poster.id)) {
      conflictingIds.add(poster.id);
    } else {
      byId.set(poster.id, poster);
    }
  }

  const conflicts = [...conflictingIds].map((id) => {
    const pages = posters.filter((p) => p.id === id).map((p) => p.notionPageId);
    return { id, title: byId.get(id).title, notionPageIds: [...new Set(pages)] };
  });
  const uniquePosters = posters.filter((p) => !conflictingIds.has(p.id));

  return { uniquePosters, conflicts };
}

export function parseSyncFlags(argv) {
  const flags = {
    dryRun: false,
    prune: false,
    allowPrune: false,
    allowLegacy: null,
    identityMode: "transition",
    json: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--prune") {
      flags.prune = true;
    } else if (arg === "--allow-prune") {
      flags.allowPrune = true;
    } else if (arg === "--allow-legacy") {
      flags.allowLegacy = true;
    } else if (arg === "--no-legacy") {
      flags.allowLegacy = false;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--identity-mode") {
      const value = argv[++index];
      if (!value) throw new Error("--identity-mode requires a value");
      flags.identityMode = value;
    } else if (arg.startsWith("--identity-mode=")) {
      flags.identityMode = arg.slice("--identity-mode=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!IDENTITY_MODES.includes(flags.identityMode)) {
    throw new Error(
      `--identity-mode must be one of ${IDENTITY_MODES.join(", ")}; received ${flags.identityMode}`,
    );
  }
  if (flags.allowLegacy === null) {
    flags.allowLegacy = flags.identityMode !== "canonical";
  }
  if (flags.identityMode === "canonical" && flags.allowLegacy) {
    throw new Error("canonical identity mode cannot enable --allow-legacy");
  }
  if (flags.identityMode === "legacy" && !flags.dryRun) {
    throw new Error("legacy identity mode is dry-run only; use transition or canonical for writes");
  }
  return flags;
}

function hasAdminCredentials() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return true;
  return fs.existsSync(path.join(ROOT, "firebase-admin-key.json"));
}

async function readFirestoreDocuments(col) {
  const snap = await col.get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      notionPageId: data.notionPageId ?? null,
      image: data.image ?? null,
      status: data.status ?? null,
      data,
    };
  });
}

function loadKnownPosterIds() {
  const snapshotPath = path.join(ROOT, "migration", "firestore-identities.json");
  if (!fs.existsSync(snapshotPath)) return null;
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  return (snapshot.documents || []).map((doc) => doc.id);
}

function loadSnapshotDocuments() {
  const snapshotPath = path.join(ROOT, "migration", "firestore-identities.json");
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  return {
    source: `snapshot:${path.relative(ROOT, snapshotPath)}`,
    documents: (snapshot.documents || []).map((doc) => ({
      id: doc.id,
      notionPageId: doc.notionPageId ?? null,
      image: doc.image ?? null,
      status: doc.status ?? null,
      data: doc,
    })),
  };
}

async function fetchIdentityRecords(notion) {
  if (!identityDataSourceId) {
    return { configured: false, records: [], rawCount: 0 };
  }
  const rows = [];
  let cursor;
  do {
    const response = await notion.dataSources.query({
      data_source_id: identityDataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    rows.push(...(response.results || []));
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return {
    configured: true,
    records: identityRecordsFromNotion(rows),
    rawCount: rows.length,
  };
}

function printPlan(plan, flags) {
  if (flags.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log("Identity resolution summary:");
  console.log(JSON.stringify(plan.summary, null, 2));

  const sections = [
    ["Unresolved", plan.unresolved],
    ["Conflicts", plan.conflicts],
    ["Orphaned identities", plan.orphaned],
    ["Orphaned Firestore documents", plan.orphanedFirestoreDocuments],
    ["Warnings", plan.warnings],
  ];
  for (const [label, entries] of sections) {
    if (!entries || entries.length === 0) continue;
    console.log(`${label}:`);
    for (const entry of entries) {
      console.log(`- ${typeof entry === "string" ? entry : JSON.stringify(entry)}`);
    }
  }
}

export async function writeRecords(db, col, records) {
  const BATCH_LIMIT = 400;
  let written = 0;
  for (let index = 0; index < records.length; index += BATCH_LIMIT) {
    const chunk = records.slice(index, index + BATCH_LIMIT);
    const batch = db.batch();
    for (const record of chunk) {
      const { id, data } = record;
      // update() (not set/merge) is a second line of defense: if a document
      // disappeared after validation, the batch fails instead of recreating it.
      batch.update(col.doc(id), {
        ...data,
        syncedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`Upserted ${written}/${records.length}`);
  }
  return written;
}

export async function pruneRecords(db, col, candidates) {
  const BATCH_LIMIT = 400;
  let pruned = 0;
  for (let index = 0; index < candidates.length; index += BATCH_LIMIT) {
    const chunk = candidates.slice(index, index + BATCH_LIMIT);
    const batch = db.batch();
    for (const candidate of chunk) {
      batch.update(col.doc(candidate.posterId), {
        status: "archived",
        syncedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    pruned += chunk.length;
  }
  return pruned;
}

async function main() {
  const flags = parseSyncFlags(process.argv.slice(2));
  console.log("--- Notion → Firestore poster sync ---");
  console.log(
    `Identity mode: ${flags.identityMode}${flags.allowLegacy ? " (legacy fallback enabled)" : ""}`,
  );
  if (flags.dryRun) console.log("Mode: dry-run (no writes)");
  if (flags.prune) {
    console.log(
      `Mode: prune requested${flags.allowPrune ? "" : " (blocked: --allow-prune required)"}`,
    );
  }

  if (!notionKey || !databaseId) {
    throw new Error("NOTION_KEY and NOTION_DATABASE_ID are required");
  }

  const notion = new Client({ auth: notionKey });
  console.log("Fetching Notion pages...");
  const pages = await fetchAllNotionPages(notion);
  console.log(`Fetched ${pages.length} Notion pages`);

  const identityData = await fetchIdentityRecords(notion);
  console.log(
    `Identity records: ${identityData.records.length}${identityData.configured ? "" : " (identity data source not configured)"}`,
  );

  let db = null;
  let col = null;
  let firestoreDocuments;
  let firestoreSource;
  if (!flags.dryRun || hasAdminCredentials()) {
    db = initAdmin();
    col = db.collection("posters");
    firestoreDocuments = await readFirestoreDocuments(col);
    firestoreSource = "live";
  } else {
    const snapshot = loadSnapshotDocuments();
    firestoreDocuments = snapshot.documents;
    firestoreSource = snapshot.source;
  }
  console.log(`Firestore documents: ${firestoreDocuments.length} (${firestoreSource})`);

  const plan = buildSyncPlan({
    pages,
    firestoreDocuments,
    identityRecords: identityData.records,
    knownPosterIds: loadKnownPosterIds() || firestoreDocuments.map((doc) => doc.id),
    mode: flags.identityMode,
    allowLegacy: flags.allowLegacy,
    prune: flags.prune,
    pruneAllowed: flags.allowPrune,
    parsePage: parsePageData,
  });
  printPlan(plan, flags);

  if (!plan.ok) {
    console.error("Identity validation failed; no Firestore writes performed.");
    process.exitCode = 1;
    return;
  }
  if (flags.prune && !plan.prune.allowed) {
    console.error("Prune requested but not allowed; no Firestore writes performed.");
    process.exitCode = 1;
    return;
  }
  if (flags.dryRun) {
    console.log("Dry-run complete. No Firestore writes performed.");
    return;
  }
  if (!db || !col) {
    throw new Error("Firestore admin context is unavailable for a write run");
  }

  const result = await applySyncPlan(plan, {
    write: (records) => writeRecords(db, col, records),
    prune: (candidates) => pruneRecords(db, col, candidates),
  });
  if (!result.ok) {
    console.error(`Sync blocked: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Done. Upserted ${result.wrote} poster document(s); pruned ${result.pruned}.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  });
}
