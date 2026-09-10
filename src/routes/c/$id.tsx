import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Globe,
  Link2,
  Lock,
  Loader2,
  Image as ImageIcon,
  MoreHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PosterGrid } from "@/components/PosterGrid";
import { PosterImage } from "@/components/PosterImage";
import { EditCollectionModal } from "@/components/EditCollectionModal";
import { CollectionHero } from "@/routes/-components/collection-hero";
import { getPosterImageUrl } from "@/lib/poster-images";
import { type Poster } from "@/lib/posters";
import { fetchNotionPosters } from "@/lib/notion";
import { getCollection, type UserCollection, type CollectionVisibility } from "@/lib/collections";
import { useAuth } from "@/lib/auth";
import { useCollections } from "@/hooks/use-collections";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/c/$id")({
  loader: async ({ params }) => {
    const [posters, preview] = await Promise.all([
      fetchNotionPosters(),
      // Public/unlisted preview only (no token) for OG tags
      getCollection({ data: { id: params.id } })
        .then((res) => (res.ok ? res.data : null))
        .catch(() => null),
    ]);
    return { posters, id: params.id, preview };
  },
  head: ({ loaderData }) => {
    const col = loaderData?.preview;
    const posters = loaderData?.posters || [];
    if (!col) {
      return {
        meta: [{ title: "Collection — CinePrint" }, { name: "robots", content: "noindex" }],
      };
    }
    const cover =
      posters.find((p) => p.id === col.coverPosterId) ||
      posters.find((p) => col.posterIds.includes(p.id));
    const desc =
      col.description ||
      `${col.posterIds.length} poster${col.posterIds.length === 1 ? "" : "s"} on CinePrint`;
    return {
      meta: [
        { title: `${col.name} — CinePrint` },
        { name: "description", content: desc },
        { property: "og:title", content: `${col.name} — CinePrint` },
        { property: "og:description", content: desc },
        ...(cover?.image
          ? [{ property: "og:image", content: getPosterImageUrl(cover, "detail") }]
          : []),
        { property: "og:type", content: "website" },
        ...(col.visibility === "private" ? [{ name: "robots", content: "noindex" }] : []),
      ],
    };
  },
  component: CollectionPage,
});

const visMeta: Record<CollectionVisibility, { label: string; icon: typeof Lock }> = {
  private: { label: "Private", icon: Lock },
  unlisted: { label: "Unlisted", icon: Link2 },
  public: { label: "Public", icon: Globe },
};

function CollectionPage() {
  const { posters: allPosters, id } = Route.useLoaderData();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { update, remove, removePoster } = useCollections();

  const [collection, setCollection] = useState<UserCollection | null | undefined>(undefined);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const load = async () => {
    try {
      const currentUser = user;
      const token = currentUser ? await currentUser.getIdToken().catch(() => null) : null;
      const res = await getCollection({
        data: { id, token: token ?? null },
      });
      // Migrated server fns resolve { ok:false } instead of rejecting; treat
      // that exactly like the RPC failures the catch below always handled.
      const col = res.ok ? res.data : null;
      setCollection(col);
      if (col) {
        document.title = `${col.name} — CinePrint`;
      }
    } catch {
      setCollection(null);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.uid, authLoading]);

  const isOwner = !!(user && collection && collection.ownerId === user.uid);

  const posters = useMemo(() => {
    if (!collection) return [] as Poster[];
    const map = new Map(allPosters.map((p) => [p.id, p]));
    return collection.posterIds.map((pid) => map.get(pid)).filter(Boolean) as Poster[];
  }, [collection, allPosters]);

  const cover = useMemo(() => {
    if (!collection) return null;
    if (collection.coverPosterId) {
      return allPosters.find((p) => p.id === collection.coverPosterId) || posters[0] || null;
    }
    return posters[0] || null;
  }, [collection, allPosters, posters]);

  const handleOpen = (p: Poster) => {
    navigate({ to: "/poster/$id", params: { id: p.id } });
  };

  const copyShareLink = async () => {
    if (!collection) return;
    if (collection.visibility === "private") {
      toast.error("Make this collection Unlisted or Public to share");
      return;
    }
    const url = `${window.location.origin}/c/${collection.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy link");
    }
  };

  const handleUpdateCollection = async (input: {
    name: string;
    description?: string;
    visibility: CollectionVisibility;
  }) => {
    if (!collection || !isOwner) return false;
    const updated = await update(collection.id, input);
    if (updated) {
      setCollection(updated);
      document.title = `${updated.name} — CinePrint`;
      toast.success("Collection updated");
      return true;
    }
    return false;
  };

  const setVisibility = async (visibility: CollectionVisibility) => {
    if (!collection || !isOwner) return;
    const updated = await update(collection.id, { visibility });
    if (updated) {
      setCollection(updated);
      toast.success(`Visibility: ${visMeta[visibility].label}`);
    }
  };

  const setCover = async (posterId: string) => {
    if (!collection || !isOwner) return;
    const updated = await update(collection.id, { coverPosterId: posterId });
    if (updated) {
      setCollection(updated);
      toast.success("Cover updated");
    }
  };

  const removeFromCollection = async (posterId: string) => {
    if (!collection || !isOwner) return;
    const updated = await removePoster(collection.id, posterId);
    if (updated) setCollection(updated);
  };

  const deleteCol = async () => {
    if (!collection || !isOwner) return;
    const ok = await remove(collection.id);
    if (ok) navigate({ to: "/saved" });
  };

  if (authLoading || collection === undefined) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "#000000", color: "#F5F5F5" }}>
        <Header showSearch={false} />
        <main className="mx-auto flex min-h-[50vh] max-w-[1600px] items-center justify-center px-4">
          <Loader2 className="animate-spin text-white/55" size={20} />
        </main>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "#000000", color: "#F5F5F5" }}>
        <Header showSearch={false} />
        <main className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
          <h1  className="text-xl font-semibold font-heading">
            Collection unavailable
          </h1>
          <p className="text-sm text-white/65">
            This collection is private, was deleted, or doesn’t exist.
          </p>
          <Link
            to="/saved"
            className="rounded-full border border-white/15 px-4 py-2 text-sm hoverable:hover:border-[#FF6B6B] hoverable:hover:text-[#FF6B6B]"
          >
            Back to Saved
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} />
      <main className="flex-grow flex flex-col">
        <CollectionHero
          collection={collection}
          posters={posters}
          cover={cover}
          isOwner={isOwner}
          copyShareLink={copyShareLink}
          onEdit={() => setEditModalOpen(true)}
          onSetVisibility={setVisibility}
          onDelete={deleteCol}
        />

        {isOwner && collection && (
          <EditCollectionModal
            open={editModalOpen}
            onOpenChange={setEditModalOpen}
            collection={collection}
            onSave={handleUpdateCollection}
          />
        )}

        <div className="page-shell flex-grow pb-16">
          {posters.length === 0 ? (
            <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center">
              <p className="text-white/65">This collection is empty.</p>
              {isOwner && (
                <Link
                  to="/"
                  className="rounded-full border border-white/15 px-4 py-2 text-sm hoverable:hover:border-[#FF6B6B] hoverable:hover:text-[#FF6B6B]"
                >
                  Browse gallery
                </Link>
              )}
            </div>
          ) : (
            <>
              {isOwner && (
                <p className="mb-4 text-[10px] font-mono uppercase tracking-wider text-white/45">
                  Tip: open a poster and use “Add to collection”, or set cover via the menu on each
                  card below (long-press manage).
                </p>
              )}
              <OwnerAwareGrid
                posters={posters}
                isOwner={isOwner}
                onOpen={handleOpen}
                onSetCover={setCover}
                onRemove={removeFromCollection}
              />
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function OwnerAwareGrid({
  posters,
  isOwner,
  onOpen,
  onSetCover,
  onRemove,
}: {
  posters: Poster[];
  isOwner: boolean;
  onOpen: (p: Poster) => void;
  onSetCover: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const pageSize = 24;
  const [count, setCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCount(pageSize);
  }, [posters]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setCount((c) => Math.min(c + pageSize, posters.length));
        }
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [posters.length]);

  if (!isOwner) {
    return <PosterGrid posters={posters} onOpen={onOpen} />;
  }

  const visible = posters.slice(0, count);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {visible.map((p) => (
          <div key={p.id} className="group relative">
            <button
              type="button"
              onClick={() => onOpen(p)}
              className="block w-full overflow-hidden rounded-lg border border-white/5 bg-white/[0.05] text-left"
            >
              <div className="relative w-full" style={{ aspectRatio: "2 / 3" }}>
                <PosterImage
                  poster={p}
                  purpose="gallery"
                  alt={p.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="p-2">
                <p className="truncate text-xs font-medium">{p.title}</p>
                <p className="truncate text-[10px] text-white/55">{p.year}</p>
              </div>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Manage ${p.title}`}
                  className="absolute right-1 top-1 grid min-h-11 min-w-11 place-items-center rounded-full bg-black/60 text-white opacity-100 backdrop-blur-sm sm:right-0 sm:top-0 sm:opacity-0 sm:group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSetCover(p.id)}>
                  <ImageIcon size={14} /> Set as cover
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  className="text-red-400 focus:bg-red-500 focus:text-white"
                  onClick={() => onRemove(p.id)}
                >
                  <Trash2 size={14} /> Remove from collection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
      <div ref={sentinelRef} className="h-10" />
    </>
  );
}
