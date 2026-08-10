import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAuth } from "./auth";
import { getUserProfile, updateBio, type UserProfile } from "./user-likes";

const CACHE_KEY = "cineprint:user-profile";

type CacheEntry = UserProfile & { uid: string };

let cached: CacheEntry | null = null;
let inflightUid: string | null = null;
let inflight: Promise<UserProfile | null> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function readSession(uid: string): UserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed?.uid !== uid) return null;
    return { createdAt: parsed.createdAt, bio: parsed.bio || "" };
  } catch {
    return null;
  }
}

function writeSession(uid: string, profile: UserProfile) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ uid, ...profile }));
  } catch {
    // ignore quota errors
  }
}

function setCache(uid: string, profile: UserProfile) {
  cached = { uid, ...profile };
  writeSession(uid, profile);
  emit();
}

function clearCache() {
  if (cached === null) return;
  cached = null;
  inflightUid = null;
  inflight = null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(CACHE_KEY);
    } catch {
      // ignore
    }
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): CacheEntry | null {
  return cached;
}

function getServerSnapshot(): CacheEntry | null {
  return null;
}

export async function prefetchUserProfile(uid: string, fallbackCreatedAt?: string | null) {
  if (inflight && inflightUid === uid) return inflight;

  if (cached?.uid !== uid) {
    const session = readSession(uid);
    if (session) {
      cached = { uid, ...session };
      emit();
    } else if (fallbackCreatedAt) {
      // Instant paint from Firebase auth metadata while network loads
      cached = { uid, createdAt: fallbackCreatedAt, bio: "" };
      emit();
    }
  }

  inflightUid = uid;
  inflight = getUserProfile({ data: uid })
    .then((profile) => {
      setCache(uid, profile);
      return profile;
    })
    .catch((err) => {
      console.error("Failed to load user profile:", err);
      return cached?.uid === uid ? cached : null;
    })
    .finally(() => {
      if (inflightUid === uid) {
        inflight = null;
        inflightUid = null;
      }
    });

  return inflight;
}

export function useUserProfile() {
  const { user } = useAuth();
  const entry = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!user) {
      clearCache();
      return;
    }

    void prefetchUserProfile(user.uid, user.metadata?.creationTime ?? null);
  }, [user?.uid, user?.metadata?.creationTime]);

  const profile: UserProfile | null =
    user && entry?.uid === user.uid
      ? { createdAt: entry.createdAt, bio: entry.bio }
      : null;

  const saveBio = useCallback(
    async (bio: string) => {
      if (!user) return;
      await updateBio({ data: { uid: user.uid, bio } });
      setCache(user.uid, {
        createdAt: cached?.uid === user.uid ? cached.createdAt : null,
        bio,
      });
    },
    [user],
  );

  return { profile, saveBio };
}
