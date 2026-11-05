/**
 * M5 sitemap generator (build-time).
 *
 * Lifecycle: runs in `prebuild` (package.json) on every build, including
 * Vercel deployments. It queries the authoritative Firestore catalogue
 * (published posters, public read), derives poster + artist URLs with the
 * pure builders in src/lib/sitemap.ts, and writes:
 *   public/sitemap.xml           — sitemap index (canonical entry point)
 *   public/sitemap-static.xml    — /, /about, /artists, /submit, /constellation
 *   public/sitemap-posters.xml   — one URL per valid poster (+ image entries)
 *   public/sitemap-artists.xml   — one URL per valid artist slug
 *   public/sitemap-films.xml     — one URL per eligible film/show (≥3 posters)
 *   public/robots.txt            — points at the index (unchanged policy)
 *
 * Catalogue changes become visible on the next deployment (same cadence as
 * the code that renders those pages). Firestore credentials: the public
 * client config (FIREBASE_* / VITE_FIREBASE_*) already required at runtime —
 * reads use the public `allow read` rule, no admin privileges.
 *
 * Failure policy: any fetch/build/validation error exits non-zero BEFORE any
 * file is replaced, so a failed prebuild fails the deployment instead of
 * publishing a silent partial sitemap. All XML is built in memory, written
 * to temp files, validated, then renamed over the targets.
 */
import { writeFileSync, renameSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import {
  STATIC_PATHS,
  SITEMAP_INDEX_FILE,
  SITEMAP_STATIC_FILE,
  SITEMAP_POSTERS_FILE,
  SITEMAP_ARTISTS_FILE,
  SITEMAP_FILMS_FILE,
  SITEMAP_GENRES_FILE,
  SITEMAP_STYLES_FILE,
  staticUrlEntries,
  posterUrlEntries,
  artistUrlEntries,
  buildUrlsetXml,
  buildSitemapIndexXml,
  buildRobotsTxt,
  assertSitemapLimits,
  collectAllPages,
  type RawPosterRow,
} from "../src/lib/sitemap.ts";
import { eligibleFilmGroups, filmInputFromRow, filmUrlEntries } from "../src/lib/films.ts";
import {
  GENRE_DIMENSION,
  STYLE_DIMENSION,
  eligibleTaxonomy,
  taxonomyInputFromRow,
  taxonomyUrlEntries,
} from "../src/lib/taxonomy.ts";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local") });
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "public");

const PAGE_SIZE = 500;

function readEnv(key: string): string | undefined {
  return process.env[key] || process.env[`VITE_${key}`];
}

function tmp(name: string): string {
  return resolve(outDir, `${name}.tmp`);
}

async function fetchPosterRows(): Promise<RawPosterRow[]> {
  const { initializeApp, getApps, getApp } = await import("firebase/app");
  const { getFirestore, collection, getDocs, query, where, orderBy, limit, startAfter } =
    await import("firebase/firestore");

  const firebaseConfig = {
    apiKey: readEnv("FIREBASE_API_KEY"),
    authDomain: readEnv("FIREBASE_AUTH_DOMAIN"),
    projectId: readEnv("FIREBASE_PROJECT_ID"),
    storageBucket: readEnv("FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: readEnv("FIREBASE_MESSAGING_SENDER_ID"),
    appId: readEnv("FIREBASE_APP_ID"),
  };
  if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
    throw new Error(
      "Firebase client config is missing (FIREBASE_PROJECT_ID / FIREBASE_API_KEY). " +
        "Refusing to generate a sitemap without catalogue access.",
    );
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const posters = collection(db, "posters");

  return collectAllPages(async (cursor) => {
    let q = query(
      posters,
      where("status", "==", "published"),
      orderBy("__name__"),
      limit(PAGE_SIZE),
    );
    if (cursor !== null) {
      const { doc, getDoc } = await import("firebase/firestore");
      const cursorSnap = await getDoc(doc(posters, cursor));
      if (!cursorSnap.exists()) {
        throw new Error(`Pagination cursor no longer exists: ${cursor}`);
      }
      q = query(
        posters,
        where("status", "==", "published"),
        orderBy("__name__"),
        startAfter(cursorSnap),
        limit(PAGE_SIZE),
      );
    }
    const snap = await getDocs(q);
    const rows = snap.docs.map((d) => ({
      id: d.id,
      data: d.data() as Record<string, unknown>,
    }));
    const last = snap.docs[snap.docs.length - 1];
    return {
      rows,
      nextCursor: snap.docs.length === PAGE_SIZE && last ? last.id : null,
    };
  });
}

function countUrls(xml: string): number {
  return xml.split("<url>").length - 1;
}

async function main(): Promise<void> {
  const rows = await fetchPosterRows();

  const staticEntries = staticUrlEntries();
  const posterEntries = posterUrlEntries(rows);
  const artistEntries = artistUrlEntries(rows);
  const filmInputs = rows
    .map((row) => filmInputFromRow(row))
    .filter((input): input is NonNullable<typeof input> => input !== null);
  const filmEntries = filmUrlEntries(eligibleFilmGroups(filmInputs));
  const taxonomyInputs = rows
    .map((row) => taxonomyInputFromRow(row))
    .filter((input): input is NonNullable<typeof input> => input !== null);
  const genreEntries = taxonomyUrlEntries(
    eligibleTaxonomy(taxonomyInputs, GENRE_DIMENSION),
    GENRE_DIMENSION,
  );
  const styleEntries = taxonomyUrlEntries(
    eligibleTaxonomy(taxonomyInputs, STYLE_DIMENSION),
    STYLE_DIMENSION,
  );

  const staticXml = buildUrlsetXml(staticEntries);
  const postersXml = buildUrlsetXml(posterEntries, true);
  const artistsXml = buildUrlsetXml(artistEntries);
  const filmsXml = buildUrlsetXml(filmEntries);
  const genresXml = buildUrlsetXml(genreEntries);
  const stylesXml = buildUrlsetXml(styleEntries);
  const indexXml = buildSitemapIndexXml([
    SITEMAP_STATIC_FILE,
    SITEMAP_POSTERS_FILE,
    SITEMAP_ARTISTS_FILE,
    SITEMAP_FILMS_FILE,
    SITEMAP_GENRES_FILE,
    SITEMAP_STYLES_FILE,
  ]);
  const robotsTxt = buildRobotsTxt();

  for (const [name, xml] of [
    [SITEMAP_STATIC_FILE, staticXml],
    [SITEMAP_POSTERS_FILE, postersXml],
    [SITEMAP_ARTISTS_FILE, artistsXml],
    [SITEMAP_FILMS_FILE, filmsXml],
    [SITEMAP_GENRES_FILE, genresXml],
    [SITEMAP_STYLES_FILE, stylesXml],
    [SITEMAP_INDEX_FILE, indexXml],
  ] as const) {
    const urlCount = name === SITEMAP_INDEX_FILE ? 0 : countUrls(xml);
    assertSitemapLimits(urlCount, Buffer.byteLength(xml, "utf8"));
  }

  if (staticEntries.length !== STATIC_PATHS.length) {
    throw new Error("Static sitemap lost an entry during generation");
  }

  mkdirSync(outDir, { recursive: true });
  const targets: Array<[string, string]> = [
    [SITEMAP_STATIC_FILE, staticXml],
    [SITEMAP_POSTERS_FILE, postersXml],
    [SITEMAP_ARTISTS_FILE, artistsXml],
    [SITEMAP_FILMS_FILE, filmsXml],
    [SITEMAP_GENRES_FILE, genresXml],
    [SITEMAP_STYLES_FILE, stylesXml],
    [SITEMAP_INDEX_FILE, indexXml],
    ["robots.txt", robotsTxt],
  ];
  for (const [name, content] of targets) {
    writeFileSync(tmp(name), content, "utf8");
  }
  for (const [name] of targets) {
    renameSync(tmp(name), resolve(outDir, name));
  }

  console.log(
    `✓ sitemap index + ${targets.length - 1} files generated in ${outDir} ` +
      `(static: ${staticEntries.length}, posters: ${posterEntries.length}, artists: ${artistEntries.length}, films: ${filmEntries.length}, genres: ${genreEntries.length}, styles: ${styleEntries.length})`,
  );
}

main().catch((error) => {
  console.error(`sitemap generation failed; existing artifacts left untouched: ${error}`);
  process.exit(1);
});
