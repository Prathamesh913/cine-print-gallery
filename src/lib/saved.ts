import { useEffect, useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useAuth } from "./auth";
import { getUserLikedIds, toggleUserLike, mergeLikedPosters } from "./user-likes";

const KEY = "cineprint:saved";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Shared in-memory store so every useSaved() sees the same list immediately
// (avoids ContextMenu flashing "Pin" while its own effect loads state).
let cachedSaved: string[] = typeof window !== "undefined" ? read() : [];
let loadedForUid: string | null | undefined = undefined;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("cineprint:saved-changed"));
  }
}

function setCached(next: string[]) {
  cachedSaved = next;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return cachedSaved;
}

function getServerSnapshot(): string[] {
  return [];
}

export function useSaved() {
  const { user } = useAuth();
  const saved = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (user) {
      const uid = user.uid;
      if (loadedForUid === uid) return;

      const localIds = read();

      if (localIds.length > 0) {
        mergeLikedPosters({ data: { uid, posterIds: localIds } })
          .then(() => {
            localStorage.removeItem(KEY);
            return getUserLikedIds({ data: uid });
          })
          .then((ids) => {
            loadedForUid = uid;
            setCached(ids);
          })
          .catch((err) => {
            console.error("Failed to load liked posters:", err);
          });
      } else {
        getUserLikedIds({ data: uid })
          .then((ids) => {
            loadedForUid = uid;
            setCached(ids);
          })
          .catch((err) => {
            console.error("Failed to load liked posters:", err);
          });
      }
    } else {
      loadedForUid = null;
      setCached(read());
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) setCached(read());
      };
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener("storage", onStorage);
      };
    }
  }, [user?.uid]);

  const toggle = useCallback(
    (id: string) => {
      const wasSaved = cachedSaved.includes(id);
      const next = wasSaved ? cachedSaved.filter((x) => x !== id) : [...cachedSaved, id];

      if (user) {
        toggleUserLike({ data: { uid: user.uid, posterId: id } }).catch((err) => {
          console.error("Failed to sync like:", err);
          toast.error("Failed to save. Please try again.");
        });
      } else {
        localStorage.setItem(KEY, JSON.stringify(next));
      }

      setCached(next);
    },
    [user],
  );

  return { saved, toggle, isSaved: (id: string) => saved.includes(id) };
}
