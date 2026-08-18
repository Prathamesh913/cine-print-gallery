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

// Rapid-toggle coalescing state: the latest intended saved-state per poster,
// plus the last server-confirmed state so we never send a contradictory toggle.
const desiredStates = new Map<string, boolean>();
const serverStates = new Map<string, boolean>();
const inFlightSyncs = new Set<string>();

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
    serverStates.clear();
    for (const id of result.data) serverStates.set(id, true);
    setSnapshot(loadSuccess(snapshot, result.data));
  } else {
    // Preserve any previously valid state; surface the error for the UI.
    setSnapshot(loadFailure(snapshot, result.error));
  }
}

/**
 * Drains queued desired states for a single poster, serializing server requests
 * so a burst of rapid toggles ends with the server matching the user's final
 * intent without issuing contradictory requests.
 */
export async function drainSavedSync(uid: string, token: string, id: string) {
  if (inFlightSyncs.has(id)) return;
  inFlightSyncs.add(id);
  try {
    while (desiredStates.has(id)) {
      const desired = desiredStates.get(id)!;
      desiredStates.delete(id);

      // If the server already reflects the desired state, no request is needed
      // (e.g. rapid add → remove → add coalesces to the final intent).
      const current = serverStates.get(id) ?? false;
      if (current === desired) continue;

      try {
        await toggleUserLike({ data: { token, uid, posterId: id } });
        serverStates.set(id, desired);
        if (snapshot.error) {
          setSnapshot(loadSuccess(snapshot, snapshot.data ?? []));
        }
      } catch (err) {
        console.error("Failed to sync like:", err);
        toast.error("Failed to save. Please try again.");
        // Restore the true server state.
        await loadForUser(uid, token, []);
        return;
      }
    }
  } finally {
    inFlightSyncs.delete(id);
  }
}

/**
 * Records the user's final intended saved-state for a poster and drives the
 * serialized sync. Used by `useSaved`; exported for tests.
 */
export function syncSavedForUser(uid: string, token: string, id: string, desired: boolean) {
  desiredStates.set(id, desired);
  void drainSavedSync(uid, token, id);
}

export function useSaved() {
  const { user, loading: authLoading } = useAuth();
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
      serverStates.clear();
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

  // While auth is resolving, or after sign-in before the account list arrives,
  // treat the state as loading rather than showing the anonymous/empty list.
  const pendingAuthed =
    !!user && loadedForUid !== user.uid && snapshot.error === null && !snapshot.loading;
  const loading = snapshot.loading || authLoading || pendingAuthed;

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

      // Optimistic update; server sync is serialized/coalesced below.
      setSnapshot(loadSuccess(snapshot, next));

      if (user) {
        getAuthToken(user)
          .then((token) => {
            if (!token) throw new Error("No auth token");
            syncSavedForUser(user.uid, token, id, next.includes(id));
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
    loading,
    retry,
  };
}
