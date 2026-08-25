import { createServerFn } from "@tanstack/react-start";
import { type Poster } from "./posters";
// Public path: reads go through the CLIENT Firestore SDK. Firestore rules grant
// public read on /posters/* (`allow read: if true`), so no Admin privileges are
// needed — keeping firebase-admin off the homepage request graph entirely.
import { db } from "./firebase";
import { getAdminDb } from "../server/firebase/admin";

let cachedPosters: Poster[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes in-memory cache

/**
 * Safe public error for poster-fetch failures. Never includes stack traces,
 * credentials, or internal stage names — those stay in server logs only.
 */
export class PosterFetchError extends Error {
  constructor(message = "Couldn't load posters right now. Please try again.") {
    super(message);
    this.name = "PosterFetchError";
  }
}

function toPlainPoster(id: string, raw: Record<string, unknown>): Poster {
  let artists = Array.isArray(raw.artists)
    ? raw.artists.map((a: any) => ({
        name: String(a?.name || "Unknown").trim(),
        url: a?.url ? String(a.url).trim() : undefined,
      }))
    : undefined;

  // Fall back to the legacy flat `artist` field when no `artists` array exists.
  if (!artists && raw.artist) {
    artists = [
      {
        name: String(raw.artist).trim(),
        url: raw.artistUrl ? String(raw.artistUrl).trim() : undefined,
      },
    ];
  }

  const title = String(raw.title || "Untitled").trim();
  const slug =
    (raw.slug ? String(raw.slug).trim() : undefined) ||
    title.toLowerCase().trim().replace(/\s+/g, "-") ||
    "untitled";

  return {
    id,
    title,
    year: typeof raw.year === "number" ? raw.year : Number(raw.year) || 0,
    artists,
    artist: String(raw.artist || artists?.[0]?.name || "Unknown").trim(),
    artistUrl: raw.artistUrl ? String(raw.artistUrl).trim() : artists?.[0]?.url,
    source: String(raw.source || "Unknown").trim(),
    sourceUrl: String(raw.sourceUrl || "").trim(),
    image: String(raw.image || raw.posterImageUrl || "").trim(),
    style: String(raw.style || "Minimalist").trim(),
    genre: Array.isArray(raw.genre) ? raw.genre.map((g) => String(g).trim()) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()) : [],
    note: raw.note ? String(raw.note).trim() : undefined,
    mediaType: raw.mediaType ? String(raw.mediaType).trim() : undefined,
    tmdbId: raw.tmdbId ? String(raw.tmdbId).trim() : undefined,
    imdbId: raw.imdbId ? String(raw.imdbId).trim() : undefined,
    seasonNumber: typeof raw.seasonNumber === "number" ? raw.seasonNumber : undefined,
    collectionName: raw.collectionName ? String(raw.collectionName).trim() : undefined,
    posterImageUrl: raw.posterImageUrl ? String(raw.posterImageUrl).trim() : undefined,
    backgroundUrl: raw.backgroundUrl ? String(raw.backgroundUrl).trim() : undefined,
    libraryNames: Array.isArray(raw.libraryNames)
      ? raw.libraryNames.map((l) => String(l).trim())
      : undefined,
    slug,
  };
}

/**
 * Core poster load used by the server function. Exported for focused unit tests
 * so infrastructure-vs-empty regressions do not depend on createServerFn wiring.
 *
 * Public path only: client Firestore SDK + security rules (`allow read: if true`
 * on /posters/*). No Firebase Admin involved.
 *
 * - Success with zero published rows → `[]` (genuine empty catalog).
 * - Any Firestore / configuration / unexpected failure → `PosterFetchError`
 *   (never `[]`).
 */
export async function loadPublishedPosters(): Promise<Poster[]> {
  const now = Date.now();
  if (cachedPosters && now - lastFetchTime < CACHE_TTL) {
    return cachedPosters;
  }

  try {
    if (!db) {
      // Misconfiguration is an infrastructure failure, not an empty catalog.
      console.error(
        "Firebase Firestore db is not initialized. Make sure the public FIREBASE_* client config is set.",
      );
      throw new PosterFetchError();
    }

    const { collection, getDocs, query, where } = await import("firebase/firestore");
    const q = query(collection(db, "posters"), where("status", "==", "published"));
    const snap = await getDocs(q);
    const rows = snap.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));

    const posters = rows
      .map(({ id, data }) => toPlainPoster(id, data))
      .filter((p) => Boolean(p.image));

    cachedPosters = posters;
    lastFetchTime = now;
    return posters;
  } catch (error) {
    // Infrastructure failures must NOT become an empty array — the gallery UI
    // interprets [] as "no published posters".
    console.error("Failed fetching from Firestore:", error);
    if (error instanceof PosterFetchError) throw error;
    throw new PosterFetchError();
  }
}

/** Test-only: clear the in-memory poster cache between tests. */
export function _resetPosterCacheForTests(): void {
  cachedPosters = null;
  lastFetchTime = 0;
}

export const fetchNotionPosters = createServerFn({ method: "POST" }).handler(
  async (): Promise<Poster[]> => loadPublishedPosters(),
);

export const getBase64Image = createServerFn({ method: "POST" })
  .validator((url: string) => url)
  .handler(async ({ data: url }): Promise<string> => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Invalid protocol. Only http/https images are permitted.");
      }

      const host = parsed.hostname.toLowerCase();
      const isPrivateOrLoopback =
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host.startsWith("192.168.") ||
        host.startsWith("10.") ||
        host.startsWith("172.16.") ||
        host.startsWith("169.254.");

      if (isPrivateOrLoopback) {
        throw new Error("Invalid request host.");
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const contentType = response.headers.get("content-type") || "image/jpeg";
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      console.error("Failed to proxy image:", error);
      throw new Error("Unable to load specified image path.");
    }
  });

export const submitPosterToNotion = createServerFn({ method: "POST" })
  .validator(
    (data: {
      role: "fan" | "artist";
      title: string;
      artistName: string;
      image: string;
      source: string;
      portfolio: string;
      socials: string;
      note: string;
      isCopyrightConfirmed: boolean;
    }) => data,
  )
  .handler(async ({ data }): Promise<{ success: boolean; pageId: string }> => {
    try {
      const { db: adminDb, isAdmin } = await getAdminDb();
      const cleanSlug = data.title.toLowerCase().trim().replace(/\s+/g, "-");
      const payload = {
        title: data.title,
        artist: data.artistName || "Unknown",
        artists: [
          {
            name: data.artistName || "Unknown",
            url: data.role === "artist" ? data.portfolio || null : null,
          },
        ],
        image: data.image,
        source: data.role === "fan" ? data.source : "Artist Submission",
        sourceUrl: data.role === "fan" ? data.source : data.portfolio,
        note: data.note,
        status: "review",
        year: 0,
        artistUrl: data.role === "artist" ? data.portfolio || null : null,
        style: "Minimalist",
        genre: [] as string[],
        tags: [] as string[],
        mediaType: null as string | null,
        tmdbId: null as string | null,
        imdbId: null as string | null,
        seasonNumber: null as number | null,
        collectionName: null as string | null,
        posterImageUrl: data.image,
        backgroundUrl: null as string | null,
        libraryNames: [] as string[],
        slug: cleanSlug,
      };

      if (isAdmin && adminDb) {
        const ref = await adminDb.collection("posters").add({
          ...payload,
          createdAt: new Date(),
        });
        return { success: true, pageId: ref.id };
      }

      if (!db) {
        throw new Error(
          "Firebase Firestore db is not initialized. Make sure your environment variables are configured.",
        );
      }

      const { collection, addDoc, serverTimestamp } = await import("firebase/firestore");
      const docRef = await addDoc(collection(db, "posters"), {
        ...payload,
        createdAt: serverTimestamp(),
      });
      return { success: true, pageId: docRef.id };
    } catch (err: any) {
      console.error("Failed inserting submission into Firestore:", err);
      throw new Error(`Failed all insertion attempts. Error: ${err.message}`);
    }
  });
