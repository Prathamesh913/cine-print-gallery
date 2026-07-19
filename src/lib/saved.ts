import { useEffect, useState, useCallback } from "react";
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

export function useSaved() {
  const { user } = useAuth();
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    if (user) {
      const uid = user.uid;
      const localIds = read();

      if (localIds.length > 0) {
        mergeLikedPosters({ data: { uid, posterIds: localIds } })
          .then(() => {
            localStorage.removeItem(KEY);
            return getUserLikedIds({ data: uid }).then(setSaved);
          })
          .catch((err) => {
            console.error("Failed to load liked posters:", err);
          });
      } else {
        getUserLikedIds({ data: uid })
          .then(setSaved)
          .catch((err) => {
            console.error("Failed to load liked posters:", err);
          });
      }
    } else {
      setSaved(read());
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) setSaved(read());
      };
      const onCustom = () => setSaved(read());
      window.addEventListener("storage", onStorage);
      window.addEventListener("cineprint:saved-changed", onCustom);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("cineprint:saved-changed", onCustom);
      };
    }
  }, [user?.uid]);

  const toggle = useCallback(
    (id: string) => {
      setSaved((prev) => {
        const wasSaved = prev.includes(id);
        const next = wasSaved ? prev.filter((x) => x !== id) : [...prev, id];

        if (user) {
          toggleUserLike({ data: { uid: user.uid, posterId: id } }).catch((err) => {
            console.error("Failed to sync like:", err);
            toast.error("Failed to save. Please try again.");
          });
        } else {
          localStorage.setItem(KEY, JSON.stringify(next));
        }

        return next;
      });
      window.dispatchEvent(new Event("cineprint:saved-changed"));
    },
    [user],
  );

  return { saved, toggle, isSaved: (id: string) => saved.includes(id) };
}
