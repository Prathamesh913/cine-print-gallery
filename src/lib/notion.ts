import { createServerFn } from "@tanstack/react-start";
import { type Poster } from "./posters";
import { collection, getDocs, query, where, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

let cachedPosters: Poster[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes in-memory cache

export const fetchNotionPosters = createServerFn({ method: "POST" })
  .handler(async (): Promise<Poster[]> => {
    if (!db) {
      console.warn("Firebase Firestore db is not initialized. Make sure FIREBASE_PROJECT_ID, etc. are set in your .env file.");
      return [];
    }

    const now = Date.now();
    if (cachedPosters && (now - lastFetchTime < CACHE_TTL)) {
      return cachedPosters;
    }

    try {
      const postersRef = collection(db, "posters");
      const q = query(postersRef, where("status", "==", "published"));
      const querySnapshot = await getDocs(q);

      const posters: Poster[] = [];
      querySnapshot.forEach((doc) => {
        const { createdAt, ...data } = doc.data();
        posters.push({
          id: doc.id,
          ...data,
        } as Poster);
      });

      // Sort by creation date if needed, or leave order as fetched
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
        host.startsWith("169.254."); // Block cloud metadata addresses

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
  .validator((data: {
    role: "fan" | "artist";
    title: string;
    artistName: string;
    image: string;
    source: string;
    portfolio: string;
    socials: string;
    note: string;
    isCopyrightConfirmed: boolean;
  }) => data)
  .handler(async ({ data }): Promise<{ success: boolean; pageId: string }> => {
    if (!db) {
      throw new Error("Firebase Firestore db is not initialized. Make sure your environment variables are configured.");
    }

    try {
      const cleanSlug = data.title.toLowerCase().trim().replace(/\s+/g, "-");
      const docRef = await addDoc(collection(db, "posters"), {
        title: data.title,
        artist: data.artistName || "Unknown",
        artists: [{ name: data.artistName || "Unknown", url: data.role === "artist" ? data.portfolio || null : null }],
        image: data.image,
        source: data.role === "fan" ? data.source : "Artist Submission",
        sourceUrl: data.role === "fan" ? data.source : data.portfolio,
        note: data.note,
        status: "review",
        createdAt: serverTimestamp(),
        year: 0,
        artistUrl: data.role === "artist" ? data.portfolio || null : null,
        style: "Minimalist",
        genre: [],
        tags: [],
        mediaType: null,
        tmdbId: null,
        imdbId: null,
        seasonNumber: null,
        collectionName: null,
        posterImageUrl: data.image,
        backgroundUrl: null,
        libraryNames: [],
        slug: cleanSlug
      });

      return { success: true, pageId: docRef.id };
    } catch (err: any) {
      console.error("Failed inserting submission into Firestore:", err);
      throw new Error(`Failed all insertion attempts. Error: ${err.message}`);
    }
  });
