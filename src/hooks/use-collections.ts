import { useCallback, useEffect, useMemo, useReducer } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getAuthToken } from "@/lib/auth-token";
import { readStateIdle } from "@/lib/read-state";
import { COLLECTIONS_LOAD_ERROR, collectionsReducer } from "@/lib/collections-read-state";
import {
  type UserCollection,
  type CollectionVisibility,
  listMyCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  addPosterToCollection,
  removePosterFromCollection,
} from "@/lib/collections";

// Lightweight cross-instance dedup: concurrent fetches for the same UID share a
// single in-flight request instead of each useCollections() instance firing one.
const inflightByUid = new Map<string, Promise<UserCollection[]>>();

function fetchMyCollections(uid: string, token: string): Promise<UserCollection[]> {
  const existing = inflightByUid.get(uid);
  if (existing) return existing;
  const request = listMyCollections({ data: { token, uid } }).finally(() => {
    if (inflightByUid.get(uid) === request) inflightByUid.delete(uid);
  });
  inflightByUid.set(uid, request);
  return request;
}

export function useCollections({ enabled = true }: { enabled?: boolean } = {}) {
  const { user } = useAuth();
  const [state, dispatch] = useReducer(collectionsReducer, readStateIdle<UserCollection[]>([]));

  const collections = useMemo(() => state.data ?? [], [state.data]);
  const loading = state.loading;
  const error = state.error;

  const refresh = useCallback(async () => {
    if (!user) {
      dispatch({ type: "SUCCESS", data: [] });
      return;
    }
    // Avoid fetching while the consuming surface is closed (e.g. a dialog).
    if (!enabled) return;
    dispatch({ type: "START" });
    try {
      const token = await getAuthToken(user);
      if (!token) {
        dispatch({ type: "FAIL", error: COLLECTIONS_LOAD_ERROR });
        return;
      }
      const list = await fetchMyCollections(user.uid, token);
      dispatch({ type: "SUCCESS", data: list });
    } catch (err) {
      console.error("Failed to load collections:", err);
      // Preserve any existing collection list; surface the error.
      dispatch({ type: "FAIL", error: COLLECTIONS_LOAD_ERROR });
    }
  }, [user, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: {
      name: string;
      description?: string;
      visibility?: CollectionVisibility;
      posterId?: string | null;
    }) => {
      if (!user) {
        toast.error("Sign in to create a collection");
        return null;
      }
      try {
        const token = await getAuthToken(user);
        if (!token) {
          toast.error("Authentication required. Please sign in again.");
          return null;
        }
        const col = await createCollection({
          data: {
            token,
            uid: user.uid,
            ownerName: user.displayName,
            name: input.name,
            description: input.description,
            visibility: input.visibility,
            posterId: input.posterId,
          },
        });
        dispatch({
          type: "SET",
          data: [col, ...(state.data ?? []).filter((c) => c.id !== col.id)],
        });
        toast.success(`Created “${col.name}”`);
        return col;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to create collection");
        return null;
      }
    },
    [user, state.data],
  );

  const update = useCallback(
    async (
      id: string,
      patch: {
        name?: string;
        description?: string;
        visibility?: CollectionVisibility;
        coverPosterId?: string | null;
        posterIds?: string[];
      },
    ) => {
      if (!user) return null;
      try {
        const token = await getAuthToken(user);
        if (!token) return null;
        const col = await updateCollection({
          data: { token, uid: user.uid, id, ...patch },
        });
        dispatch({
          type: "SET",
          data: (state.data ?? []).map((c) => (c.id === id ? col : c)),
        });
        return col;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update collection");
        return null;
      }
    },
    [user, state.data],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!user) return false;
      try {
        const token = await getAuthToken(user);
        if (!token) return false;
        await deleteCollection({ data: { token, uid: user.uid, id } });
        dispatch({
          type: "SET",
          data: (state.data ?? []).filter((c) => c.id !== id),
        });
        toast.success("Collection deleted");
        return true;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to delete collection");
        return false;
      }
    },
    [user, state.data],
  );

  const addPoster = useCallback(
    async (collectionId: string, posterId: string) => {
      if (!user) {
        toast.error("Sign in to add to a collection");
        return null;
      }
      try {
        const token = await getAuthToken(user);
        if (!token) {
          toast.error("Authentication required. Please sign in again.");
          return null;
        }
        const col = await addPosterToCollection({
          data: { token, uid: user.uid, collectionId, posterId },
        });
        dispatch({
          type: "SET",
          data: (state.data ?? []).map((c) => (c.id === collectionId ? col : c)),
        });
        return col;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to add poster");
        return null;
      }
    },
    [user, state.data],
  );

  const removePoster = useCallback(
    async (collectionId: string, posterId: string) => {
      if (!user) return null;
      try {
        const token = await getAuthToken(user);
        if (!token) return null;
        const col = await removePosterFromCollection({
          data: { token, uid: user.uid, collectionId, posterId },
        });
        dispatch({
          type: "SET",
          data: (state.data ?? []).map((c) => (c.id === collectionId ? col : c)),
        });
        return col;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to remove poster");
        return null;
      }
    },
    [user, state.data],
  );

  const isInCollection = useCallback(
    (collectionId: string, posterId: string) => {
      const col = collections.find((c) => c.id === collectionId);
      return col ? col.posterIds.includes(posterId) : false;
    },
    [collections],
  );

  return {
    collections,
    loading,
    error,
    refresh,
    retry: refresh,
    create,
    update,
    remove,
    addPoster,
    removePoster,
    isInCollection,
  };
}
