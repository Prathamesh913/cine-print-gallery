import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Globe,
  Link2,
  Lock,
  Loader2,
  MoreHorizontal,
  Trash2,
  Image as ImageIcon,
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PosterGrid } from "@/components/PosterGrid";
import { PosterImage } from "@/components/PosterImage";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/c/$id")({
  loader: async ({ params }) => {
    const [posters, preview] = await Promise.all([
      fetchNotionPosters(),
      // Public/unlisted preview only (no requester) for OG tags
      getCollection({ data: { id: params.id, requesterUid: null } }).catch(() => null),
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
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const currentUser = user;
      const token = currentUser ? await currentUser.getIdToken().catch(() => null) : null;
      const requesterUid = currentUser && token ? currentUser.uid : null;
      const col = await getCollection({
        data: { id, token: token ?? null, requesterUid },
      });
      setCollection(col);
      if (col) {
        setName(col.name);
        setDescription(col.description);
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

  const saveMeta = async () => {
    if (!collection || !isOwner || saving) return;
    setSaving(true);
    const updated = await update(collection.id, {
      name,
      description,
    });
    setSaving(false);
    if (updated) {
      setCollection(updated);
      setEditing(false);
      toast.success("Collection updated");
    }
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
          <h1 style={{ fontFamily: "Poppins, sans-serif" }} className="text-xl font-semibold">
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

  const VisIcon = visMeta[collection.visibility].icon;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#000000", color: "#F5F5F5" }}>
      <Header showSearch={false} />
      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
        <Link
          to="/saved"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-white/55 transition-colors hoverable:hover:text-white/70"
        >
          <ArrowLeft size={14} />
          Saved
        </Link>

        <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-1 gap-4">
            <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-white/5 sm:h-36 sm:w-24">
              {cover ? (
                <PosterImage
                  poster={cover}
                  purpose="gallery"
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full place-items-center text-white/30">
                  <ImageIcon size={20} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {editing && isOwner ? (
                <div className="space-y-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xl font-semibold focus:border-[#FF6B6B] focus:outline-none"
                    style={{ fontFamily: "Poppins, sans-serif" }}
                    maxLength={80}
                  />
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="Optional description"
                    className="w-full resize-none rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 focus:border-[#FF6B6B] focus:outline-none"
                    maxLength={500}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditing(false);
                        setName(collection.name);
                        setDescription(collection.description);
                      }}
                      className="rounded-full border border-white/15 px-3 py-1.5 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveMeta}
                      disabled={saving}
                      className="rounded-full bg-[#FF6B6B] px-3 py-1.5 text-xs font-medium text-[#121212] disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h1
                    style={{ fontFamily: "Poppins, sans-serif" }}
                    className="truncate text-2xl font-semibold sm:text-3xl"
                  >
                    {collection.name}
                  </h1>
                  {collection.description ? (
                    <p className="mt-2 max-w-xl text-sm text-white/70">{collection.description}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-white/55">
                    <span className="inline-flex items-center gap-1">
                      <VisIcon size={11} />
                      {visMeta[collection.visibility].label}
                    </span>
                    <span>·</span>
                    <span>
                      {posters.length} poster{posters.length === 1 ? "" : "s"}
                    </span>
                    {collection.ownerName ? (
                      <>
                        <span>·</span>
                        <span>by {collection.ownerName}</span>
                      </>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(collection.visibility === "public" ||
              collection.visibility === "unlisted" ||
              isOwner) && (
              <button
                onClick={copyShareLink}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-sm transition-colors hoverable:hover:border-white/30"
              >
                <Copy size={14} />
                Copy link
              </button>
            )}

            {isOwner && (
              <AlertDialog>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-sm hoverable:hover:border-white/30">
                      <MoreHorizontal size={14} />
                      Manage
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={8}>
                    <DropdownMenuItem onClick={() => setEditing(true)}>
                      Rename / edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setVisibility("private")}>
                      <Lock size={14} /> Private
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setVisibility("unlisted")}>
                      <Link2 size={14} /> Unlisted
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setVisibility("public")}>
                      <Globe size={14} /> Public
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem className="text-red-400 focus:text-red-400">
                        <Trash2 size={14} /> Delete collection
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                  </DropdownMenuContent>
                </DropdownMenu>

                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete collection?</AlertDialogTitle>
                    <AlertDialogDescription>
                      “{collection.name}” will be permanently deleted. Posters stay in your Pins and
                      other collections.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-full border border-white/15 px-4 py-2 text-sm">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={deleteCol}
                      className="rounded-full bg-red-500 px-4 py-2 text-sm font-medium text-white"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

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
  if (!isOwner) {
    return <PosterGrid posters={posters} onOpen={onOpen} />;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {posters.map((p) => (
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
                className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white opacity-100 backdrop-blur-sm sm:opacity-0 sm:group-hover:opacity-100"
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
                className="text-red-400 focus:text-red-400"
                onClick={() => onRemove(p.id)}
              >
                <Trash2 size={14} /> Remove from collection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
  );
}
