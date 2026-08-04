import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const notionKey = process.env.NOTION_KEY || process.env.NOTION_API_KEY || "";
const databaseId = process.env.NOTION_DATABASE_ID || "";
const dryRun = process.argv.includes("--dry-run");
const prune = process.argv.includes("--prune");

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

function imageUrlsFromProp(prop) {
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
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "review";
  if (s === "published") return "published";
  if (s === "review" || s === "in review") return "review";
  if (s === "draft") return "draft";
  if (s === "archived" || s === "rejected") return "archived";
  return s;
}

function parsePage(page) {
  const props = page.properties || {};
  const imageUrls = imageUrlsFromProp(props["Image URL"]);
  if (imageUrls.length === 0) return [];

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

  const title =
    textProp(props.Name) || textProp(props.Title) || "Untitled";
  const year = typeof props.Year?.number === "number" ? props.Year.number : 0;
  const style = props.Style?.select?.name || "Minimalist";
  const genre = multiSelect(props.Genre);
  const tags = multiSelect(props.Tags);
  const note = textProp(props.Note) || null;
  const status = normalizeStatus(selectName(props.Status) || "Published");

  const rawSlug = textProp(props.Slug);
  const baseSlug = rawSlug
    ? rawSlug.trim().toLowerCase().replace(/\s+/g, "-")
    : slugify(title);

  const mediaType = textProp(props["Media Type"]) || textProp(props.MediaType) || null;
  const tmdbId = textProp(props["TMDB ID"]) || textProp(props.tmdbId) || null;
  const imdbId =
    textProp(props["IMDb ID"]) ||
    textProp(props["IMDB ID"]) ||
    textProp(props.imdbId) ||
    null;
  const seasonNumber =
    typeof props["Season Number"]?.number === "number"
      ? props["Season Number"].number
      : typeof props.Season?.number === "number"
        ? props.Season.number
        : null;
  const collectionName =
    textProp(props.Collection) || textProp(props["Collection Name"]) || null;
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

    let id;
    if (baseSlug) {
      id = imageUrls.length > 1 ? `${baseSlug}-${index + 1}` : baseSlug;
    } else {
      id = index === 0 ? page.id : `${page.id}-${index}`;
    }

    return {
      id,
      notionPageId: page.id,
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
      slug: id,
    };
  });
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

function initAdmin() {
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

async function main() {
  console.log("--- Notion → Firestore poster sync ---");
  if (dryRun) console.log("Mode: dry-run (no writes)");
  if (prune) console.log("Mode: prune unpublished Notion-sourced docs");

  if (!notionKey || !databaseId) {
    throw new Error("NOTION_KEY and NOTION_DATABASE_ID are required");
  }

  const notion = new Client({ auth: notionKey });
  console.log("Fetching Notion pages...");
  const pages = await fetchAllNotionPages(notion);
  console.log(`Fetched ${pages.length} Notion pages`);

  const posters = pages.flatMap(parsePage);
  console.log(`Parsed ${posters.length} poster records`);

  const byStatus = posters.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});
  console.log("By status:", byStatus);

  if (dryRun) {
    console.log("Sample (first 3):");
    console.log(JSON.stringify(posters.slice(0, 3), null, 2));
    return;
  }

  const db = initAdmin();
  const col = db.collection("posters");
  const BATCH_LIMIT = 400;

  let written = 0;
  for (let i = 0; i < posters.length; i += BATCH_LIMIT) {
    const chunk = posters.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const poster of chunk) {
      const { id, ...data } = poster;
      const ref = col.doc(id);
      batch.set(
        ref,
        {
          ...data,
          syncedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
    written += chunk.length;
    console.log(`Upserted ${written}/${posters.length}`);
  }

  if (prune) {
    const notionIds = new Set(posters.map((p) => p.id));
    const snap = await col.where("notionPageId", "!=", null).get();
    let pruned = 0;
    let batch = db.batch();
    let ops = 0;

    for (const doc of snap.docs) {
      if (notionIds.has(doc.id)) continue;
      const status = doc.data().status;
      if (status === "archived") continue;
      batch.set(
        doc.ref,
        {
          status: "archived",
          syncedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      pruned++;
      ops++;
      if (ops >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();
    console.log(`Pruned (archived) ${pruned} stale Notion-sourced docs`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
