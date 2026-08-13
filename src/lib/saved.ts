import { useEffect, useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useAuth } from "./auth";
import { getAuthToken } from "./auth-token";
import { getUserLikedIds, toggleUserLike, mergeLikedPosters } from "./user-likes";
import {
  type LoadResult,
  type ReadState,
  readStateIdle,
  loadStart,
  loadSuccess,
  loadFailure,
} from "./read-state";

const KEY = "cineprint:saved";

export const SAVED_LOAD_ERROR = "Couldn't load your saved posters.";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Shared in-memory store so every useSaved() sees the same state immediately.
let snapshot: ReadState<string[]> = readStateIdle<string[]>(
  typeof window !== "undefined" ? read() : [],
);
let loadedForUid: string | null | undefined = undefined;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("cineprint:saved-changed"));
  }
}

function setSnapshot(next: ReadState<string[]>) {
  snapshot = next;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot(): ReadState<string[]> {
  return readStateIdle<string[]>([]);
}

/**
 * Pure-ish loader used by the authenticated branch of `useSaved`.
 * Only clears anonymous localStorage after BOTH the merge and the read succeed,
 * so a Firestore read failure never destroys local data.
 */
export async function loadSaved(
  uid: string,
  token: string,
  localIds: string[],
): Promise<LoadResult<string[]>> {
  try {
    if (localIds.length > 0) {
      await mergeLikedPosters({ data: { token, uid, posterIds: localIds } });
    }
    const ids = await getUserLikedIds({ data: { token, uid } });
    if (localIds.length > 0 && typeof window !== "undefined") {
      localStorage.removeItem(KEY);
    }
    return { ok: true, data: ids };
  } catch (err) {
    console.error("Failed to load liked posters:", err);
    return { ok: false, error: SAVED_LOAD_ERROR };
  }
}

async function loadForUser(uid: string, token: string, localIds: string[]) {
  if (snapshot.loading) return; // avoid concurrent loads / retries
  setSnapshot(loadStart(snapshot));
  const result = await loadSaved(uid, token, localIds);
  if (result.ok) {
    loadedForUid = uid;
    setSnapshot(loadSuccess(snapshot, result.data));
  } else {
    // Preserve any previously valid state; surface the error for the UI.
    setSnapshot(loadFailure(snapshot, result.error));
  }
}

export function useSaved() {
  const { user } = useAuth();
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (user) {
      const uid = user.uid;
      if (loadedForUid === uid && snapshot.error === null) return;

      getAuthToken(user)
        .then((token) => {
          if (!token) {
            setSnapshot(loadFailure(snapshot, SAVED_LOAD_ERROR));
            return;
          }
          return loadForUser(uid, token, read());
        })
        .catch((err) => {
          console.error("Failed to load liked posters:", err);
          setSnapshot(loadFailure(snapshot, SAVED_LOAD_ERROR));
        });
    } else {
      loadedForUid = null;
      setSnapshot(readStateIdle<string[]>(read()));
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) setSnapshot(readStateIdle<string[]>(read()));
      };
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener("storage", onStorage);
      };
    }
  }, [user?.uid]);

  const retry = useCallback(() => {
    if (!user) return;
    getAuthToken(user)
      .then((token) => {
        if (!token) return;
        return loadForUser(user.uid, token, read());
      })
      .catch(() => {});
  }, [user]);

  const toggle = useCallback(
    (id: string) => {
      const prev = snapshot.data ?? [];
      const wasSaved = prev.includes(id);
      const next = wasSaved ? prev.filter((x) => x !== id) : [...prev, id];

      // Optimistic update; roll back if the sync fails.
      setSnapshot(loadSuccess(snapshot, next));

      if (user) {
        getAuthToken(user)
          .then((token) => {
            if (!token) throw new Error("No auth token");
            return toggleUserLike({ data: { token, uid: user.uid, posterId: id } });
          })
          .catch((err) => {
            console.error("Failed to sync like:", err);
            setSnapshot(loadSuccess(snapshot, prev));
            toast.error("Failed to save. Please try again.");
          });
      } else {
        localStorage.setItem(KEY, JSON.stringify(next));
      }
    },
    [user],
  );

  return {
    saved: state.data ?? [],
    toggle,
    isSaved: (id: string) => (state.data ?? []).includes(id),
    error: state.error,
    loading: state.loading,
    retry,
  };
}
