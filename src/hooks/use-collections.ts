import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getAuthToken } from "@/lib/auth-token";
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

export function useCollections() {
  const { user } = useAuth();
  const [collections, setCollections] = useState<UserCollection[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setCollections([]);
      return;
    }
    setLoading(true);
    try {
      const token = await getAuthToken(user);
      if (!token) return;
      const list = await listMyCollections({ data: { token, uid: user.uid } });
      setCollections(list);
    } catch (err) {
      console.error("Failed to load collections:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

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
        setCollections((prev) => [col, ...prev.filter((c) => c.id !== col.id)]);
        toast.success(`Created “${col.name}”`);
        return col;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to create collection");
        return null;
      }
    },
    [user],
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
        setCollections((prev) => prev.map((c) => (c.id === id ? col : c)));
        return col;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update collection");
        return null;
      }
    },
    [user],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!user) return false;
      try {
        const token = await getAuthToken(user);
        if (!token) return false;
        await deleteCollection({ data: { token, uid: user.uid, id } });
        setCollections((prev) => prev.filter((c) => c.id !== id));
        toast.success("Collection deleted");
        return true;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to delete collection");
        return false;
      }
    },
    [user],
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
        setCollections((prev) => prev.map((c) => (c.id === collectionId ? col : c)));
        return col;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to add poster");
        return null;
      }
    },
    [user],
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
        setCollections((prev) => prev.map((c) => (c.id === collectionId ? col : c)));
        return col;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to remove poster");
        return null;
      }
    },
    [user],
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
    refresh,
    create,
    update,
    remove,
    addPoster,
    removePoster,
    isInCollection,
  };
}
