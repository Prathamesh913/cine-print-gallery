import { createServerFn } from "@tanstack/react-start";
import { type Poster } from "./posters";
import { getAdminDb, db } from "./firebase";

let cachedPosters: Poster[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes in-memory cache

function toPlainPoster(id: string, raw: Record<string, unknown>): Poster {
  const artists = Array.isArray(raw.artists)
    ? raw.artists.map((a: any) => ({
        name: String(a?.name || "Unknown"),
        url: a?.url ? String(a.url) : undefined,
      }))
    : undefined;

  return {
    id,
    title: String(raw.title || "Untitled"),
    year: typeof raw.year === "number" ? raw.year : Number(raw.year) || 0,
    artists,
    artist: String(raw.artist || artists?.[0]?.name || "Unknown"),
    artistUrl: raw.artistUrl ? String(raw.artistUrl) : artists?.[0]?.url,
    source: String(raw.source || "Unknown"),
    sourceUrl: String(raw.sourceUrl || ""),
    image: String(raw.image || raw.posterImageUrl || ""),
    style: String(raw.style || "Minimalist"),
    genre: Array.isArray(raw.genre) ? raw.genre.map(String) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    note: raw.note ? String(raw.note) : undefined,
    mediaType: raw.mediaType ? String(raw.mediaType) : undefined,
    tmdbId: raw.tmdbId ? String(raw.tmdbId) : undefined,
    imdbId: raw.imdbId ? String(raw.imdbId) : undefined,
    seasonNumber: typeof raw.seasonNumber === "number" ? raw.seasonNumber : undefined,
    collectionName: raw.collectionName ? String(raw.collectionName) : undefined,
    posterImageUrl: raw.posterImageUrl ? String(raw.posterImageUrl) : undefined,
    backgroundUrl: raw.backgroundUrl ? String(raw.backgroundUrl) : undefined,
    libraryNames: Array.isArray(raw.libraryNames) ? raw.libraryNames.map(String) : undefined,
    slug: raw.slug ? String(raw.slug) : undefined,
  };
}

export const fetchNotionPosters = createServerFn({ method: "POST" })
  .handler(async (): Promise<Poster[]> => {
    const now = Date.now();
    if (cachedPosters && now - lastFetchTime < CACHE_TTL) {
      return cachedPosters;
    }

    try {
      const { db: adminDb, isAdmin } = await getAdminDb();
      const firestore = adminDb || db;

      if (!firestore) {
        console.warn(
          "Firebase Firestore db is not initialized. Make sure FIREBASE_PROJECT_ID (or firebase-admin-key.json) is configured.",
        );
        return [];
      }

      let rows: { id: string; data: Record<string, unknown> }[] = [];

      if (isAdmin) {
        const snap = await firestore
          .collection("posters")
          .where("status", "==", "published")
          .get();
        rows = snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({
          id: doc.id,
          data: doc.data(),
        }));
      } else {
        const { collection, getDocs, query, where } = await import("firebase/firestore");
        const q = query(collection(firestore, "posters"), where("status", "==", "published"));
        const snap = await getDocs(q);
        rows = snap.docs.map((doc) => ({
          id: doc.id,
          data: doc.data() as Record<string, unknown>,
        }));
      }

      const posters = rows
        .map(({ id, data }) => toPlainPoster(id, data))
        .filter((p) => Boolean(p.image));

      cachedPosters = posters;
      lastFetchTime = now;
      return posters;
    } catch (error) {
      console.error("Failed fetching from Firestore:", error);
      return [];
    }
  });

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
