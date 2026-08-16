import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAuth } from "./auth";
import { getAuthToken } from "./auth-token";
import { getUserProfile, updateBio, type UserProfile } from "./user-likes";
import {
  type LoadResult,
  type ReadState,
  readStateIdle,
  loadStart,
  loadSuccess,
  loadFailure,
} from "./read-state";

const CACHE_KEY = "cineprint:user-profile";

type CacheEntry = UserProfile & { uid: string };

export const PROFILE_LOAD_ERROR = "Couldn't load your profile.";

let snapshot: ReadState<CacheEntry | null> = readStateIdle<CacheEntry | null>(null);
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

function setSnapshot(next: ReadState<CacheEntry | null>) {
  snapshot = next;
  emit();
}

function clearSnapshot() {
  setSnapshot(readStateIdle<CacheEntry | null>(null));
  inflightUid = null;
  inflight = null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(CACHE_KEY);
    } catch {
      // ignore
    }
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadState<CacheEntry | null> {
  return snapshot;
}

function getServerSnapshot(): ReadState<CacheEntry | null> {
  return readStateIdle<CacheEntry | null>(null);
}

/**
 * Loads a user's profile and returns a typed result (never throws).
 */
export async function loadUserProfile(
  uid: string,
  token: string,
): Promise<LoadResult<UserProfile>> {
  try {
    const profile = await getUserProfile({ data: { token, uid } });
    return { ok: true, data: profile };
  } catch (err) {
    console.error("Failed to load user profile:", err);
    return { ok: false, error: PROFILE_LOAD_ERROR };
  }
}

export async function prefetchUserProfile(
  uid: string,
  token: string | null,
  fallbackCreatedAt?: string | null,
) {
  if (inflight && inflightUid === uid) return inflight;

  const existing = snapshot.data;
  if (existing?.uid !== uid) {
    const session = readSession(uid);
    if (session) {
      setSnapshot(loadStart(readStateIdle<CacheEntry | null>({ uid, ...session })));
    } else if (fallbackCreatedAt) {
      // Instant paint from Firebase auth metadata while the network loads.
      setSnapshot(
        loadStart(readStateIdle<CacheEntry | null>({ uid, createdAt: fallbackCreatedAt, bio: "" })),
      );
    } else {
      setSnapshot(loadStart(readStateIdle<CacheEntry | null>(null)));
    }
  } else {
    setSnapshot(loadStart(snapshot));
  }

  inflightUid = uid;
  inflight = loadUserProfile(uid, token ?? "")
    .then((result) => {
      if (result.ok) {
        const entry: CacheEntry = { uid, ...result.data };
        setSnapshot(loadSuccess(snapshot, entry));
        writeSession(uid, result.data);
        return result.data;
      }
      // Preserve valid cached/session data and expose the error.
      setSnapshot(loadFailure(snapshot, result.error));
      return snapshot.data?.uid === uid ? snapshot.data : null;
    })
    .catch((err) => {
      console.error("Failed to load user profile:", err);
      setSnapshot(loadFailure(snapshot, PROFILE_LOAD_ERROR));
      return snapshot.data?.uid === uid ? snapshot.data : null;
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
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!user) {
      clearSnapshot();
      return;
    }

    getAuthToken(user).then((token) => {
      if (token) {
        void prefetchUserProfile(user.uid, token, user.metadata?.creationTime ?? null);
      }
    });
  }, [user?.uid, user?.metadata?.creationTime]);

  const profile: UserProfile | null =
    state.data && state.data.uid === user?.uid
      ? { createdAt: state.data.createdAt, bio: state.data.bio }
      : null;

  const retry = useCallback(() => {
    if (!user) return;
    getAuthToken(user).then((token) => {
      if (token) {
        void prefetchUserProfile(user.uid, token, user.metadata?.creationTime ?? null);
      }
    });
  }, [user]);

  const saveBio = useCallback(
    async (bio: string) => {
      if (!user) return;
      const token = await getAuthToken(user);
      if (!token) throw new Error("No auth token");
      await updateBio({ data: { token, uid: user.uid, bio } });
      const entry: CacheEntry = {
        uid: user.uid,
        createdAt: snapshot.data?.uid === user.uid ? snapshot.data.createdAt : null,
        bio,
      };
      setSnapshot(loadSuccess(snapshot, entry));
      writeSession(user.uid, { createdAt: entry.createdAt, bio });
    },
    [user],
  );

  return { profile, saveBio, error: state.error, loading: state.loading, retry };
}
