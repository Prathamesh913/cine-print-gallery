import fs from "node:fs";
import path from "node:path";

export interface FirestoreFixtureDoc {
  id: string;
  notionPageId: string;
  image: string;
  title: string;
  status: string;
  posterImageUrl?: string;
}

export interface FixturePage {
  id: string;
  properties: Record<string, unknown>;
}

export interface FixtureIdentityRecord {
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

export interface ManifestFixture {
  entries: Array<{
    cineprintPosterId: string;
    notionPageId: string;
    identityConfidence: "high" | "medium" | "low" | "none";
    raindropId: string | null;
    sourceProvider: string;
    sourceSha256: string | null;
    sourceMimeType?: string | null;
    sourceDimensions?: { width: number; height: number } | null;
    sourceSizeBytes?: number | null;
    currentImageUrl?: string;
    currentImageObjectKey?: string | null;
  }>;
}

export interface R2MapFixture {
  entries: Record<
    string,
    {
      posterId: string;
      blobImageUrl: string;
      original: { key: string; url: string };
      optimized: { key: string; url: string };
    }
  >;
}

export interface MigrationStateFixture {
  entries: Record<string, { state: string }>;
}

export interface PostBackfillFixture {
  pages: FixturePage[];
  identityRecords: FixtureIdentityRecord[];
  firestoreDocuments: FirestoreFixtureDoc[];
  knownPosterIds: string[];
  manifest: ManifestFixture;
}

const ROOT = process.cwd();

export function richText(value: string) {
  return { type: "rich_text", rich_text: [{ plain_text: value }] };
}

export function title(value: string) {
  return { type: "title", title: [{ plain_text: value }] };
}

export function url(value: string) {
  return { type: "url", url: value };
}

export function relation(ids: string[]) {
  return { type: "relation", relation: ids.map((id) => ({ id })) };
}

export function numberValue(value: number) {
  return { type: "number", number: value };
}

export function select(value: string) {
  return { type: "select", select: { name: value } };
}

export function loadFirestoreSnapshot(): {
  count: number;
  documents: FirestoreFixtureDoc[];
} {
  const snapshotPath = path.join(ROOT, "migration", "firestore-identities.json");
  return JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
}

export function loadManifest(): ManifestFixture {
  const manifestPath = path.join(ROOT, "migration", "poster-manifest.json");
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export function loadR2Map(): R2MapFixture {
  const mapPath = path.join(ROOT, "migration", "r2-image-map.json");
  return JSON.parse(fs.readFileSync(mapPath, "utf8"));
}

export function loadMigrationState(): MigrationStateFixture {
  const statePath = path.join(ROOT, "migration", "migration-state.json");
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

/**
 * Build a post-backfill fixture from the real 63-document Firestore snapshot.
 * Single-poster pages receive the proposed `CinePrint Poster ID` property;
 * multi-image pages receive proposed per-poster identity records. No IDs are
 * invented and no Notion/Firestore write occurs.
 */
export function buildPostBackfillFixture(): PostBackfillFixture {
  const snapshot = loadFirestoreSnapshot();
  const manifest = loadManifest();
  const manifestById = new Map(manifest.entries.map((entry) => [entry.cineprintPosterId, entry]));

  const docsByPage = new Map<string, FirestoreFixtureDoc[]>();
  for (const doc of snapshot.documents) {
    const pageId = String(doc.notionPageId);
    if (!docsByPage.has(pageId)) docsByPage.set(pageId, []);
    docsByPage.get(pageId)!.push(doc);
  }

  const pages: FixturePage[] = [];
  const identityRecords: FixtureIdentityRecord[] = [];

  for (const [pageId, docs] of docsByPage) {
    const images = docs.map((doc) => doc.image);
    const properties: Record<string, unknown> = {
      Name: title(docs[0].title),
      Slug: richText(docs[0].id),
      "Image URL": url(images.join(", ")),
    };

    if (docs.length === 1) {
      properties["CinePrint Poster ID"] = richText(docs[0].id);
    } else {
      for (const doc of docs) {
        const entry = manifestById.get(doc.id);
        identityRecords.push({
          identityRecordId: `identity-${doc.id}`,
          posterId: doc.id,
          groupingPageId: pageId,
          groupingPageIds: [pageId],
          imageUrl: doc.image,
          raindropId: entry?.raindropId ?? null,
          provider: entry?.sourceProvider ?? null,
          sha256: entry?.sourceSha256 ?? null,
          revision: 1,
          status: "active",
        });
      }
    }

    pages.push({ id: pageId, properties });
  }

  return {
    pages,
    identityRecords,
    firestoreDocuments: snapshot.documents,
    knownPosterIds: snapshot.documents.map((doc) => doc.id),
    manifest,
  };
}

/**
 * Current live-state fixture before the 7C backfill: the real pages and images
 * from the Firestore snapshot, with no `CinePrint Poster ID` property and no
 * per-image identity records. This is the planner's pre-backfill input.
 */
export function buildPreBackfillFixture(): PostBackfillFixture {
  const fixture = buildPostBackfillFixture();
  for (const page of fixture.pages) {
    delete page.properties["CinePrint Poster ID"];
  }
  return { ...fixture, identityRecords: [] };
}

/**
 * Proposed 7C backfill model: 51 single-page properties and the 10
 * high-confidence per-image identity records. The two medium-confidence rows
 * are deliberately absent so the canonical resolver reports them unresolved.
 */
export function buildProposedBackfillFixture(): PostBackfillFixture {
  const fixture = buildPostBackfillFixture();
  fixture.identityRecords = fixture.identityRecords.filter(
    (record) => record.posterId !== "stranger-things-2" && record.posterId !== "the-substance-2",
  );
  return fixture;
}
