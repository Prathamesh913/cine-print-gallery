import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, FolderPlus, Loader2, Lock, Globe, Link2, ArrowLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useCollections } from "@/hooks/use-collections";
import { CreateCollectionForm } from "./CreateCollectionForm";
import type { CollectionVisibility } from "@/lib/collections";
import { play } from "cuelume";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  posterId: string;
  posterTitle?: string;
}

const visibilityMeta: Record<
  CollectionVisibility,
  { label: string; icon: typeof Lock; hint: string }
> = {
  private: { label: "Private", icon: Lock, hint: "Only you" },
  unlisted: { label: "Unlisted", icon: Link2, hint: "Anyone with link" },
  public: { label: "Public", icon: Globe, hint: "Discoverable" },
};

type View = "list" | "create";

export function AddToCollectionModal({ open, onOpenChange, posterId, posterTitle }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { collections, loading, create, addPoster, removePoster } = useCollections({
    enabled: open,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setView("list");
    onOpenChange(nextOpen);
  };

  const sorted = useMemo(
    () =>
      [...collections].sort((a, b) => {
        const aHas = a.posterIds.includes(posterId) ? 0 : 1;
        const bHas = b.posterIds.includes(posterId) ? 0 : 1;
        if (aHas !== bHas) return aHas - bHas;
        return a.name.localeCompare(b.name);
      }),
    [collections, posterId],
  );

  const handleToggle = async (collectionId: string, has: boolean) => {
    if (!user || busyId) return;
    setBusyId(collectionId);
    try {
      if (has) {
        await removePoster(collectionId, posterId);
        toast("Removed from collection");
      } else {
        await addPoster(collectionId, posterId);
        play("chime");
        toast.success("Added to collection");
      }
    } finally {
      setBusyId(null);
    }
  };

  if (!user) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="z-[80] border-white/15 bg-[#1c1c1c] text-[#F5F5F5] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Add to collection
            </DialogTitle>
            <DialogDescription className="text-white/65">
              Sign in to organize posters into collections.
            </DialogDescription>
          </DialogHeader>
          <button
            onClick={() => {
              onOpenChange(false);
              navigate({
                to: "/login",
                search: {
                  redirect: typeof window !== "undefined" ? window.location.pathname : "/saved",
                },
              });
            }}
            className="mt-2 inline-flex items-center justify-center rounded-full bg-[#FF6B6B] px-5 py-2.5 text-sm font-medium text-[#121212] transition-[transform,background-color] duration-150 hoverable:hover:bg-[#FF8585] active:scale-95"
          >
            Sign in with Google
          </button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="z-[80] border-white/15 bg-[#1c1c1c] text-[#F5F5F5] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {view === "create" ? "New collection" : "Add to collection"}
          </DialogTitle>
          <DialogDescription className="text-white/65">
            {view === "create"
              ? "Create a collection and add this poster to it."
              : posterTitle
                ? `Save “${posterTitle}” into a collection.`
                : "Choose a collection."}{" "}
            Pin remains separate — this won’t change your favorites.
          </DialogDescription>
        </DialogHeader>

        {view === "create" ? (
          <>
            <CreateCollectionForm
              submitLabel="Create & add"
              onSubmit={async (input) => {
                const collection = await create({ ...input, posterId });
                if (!collection) return false;
                play("chime");
                setView("list");
                return true;
              }}
            />
            <button
              onClick={() => setView("list")}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border border-white/15 px-4 text-sm text-white/70 transition-colors hoverable:hover:bg-white/5"
            >
              <ArrowLeft size={14} />
              Back to collections
            </button>
          </>
        ) : (
          <>
            <div className="mt-2 space-y-1 pr-1">
              {loading && collections.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-white/55">
                  <Loader2 size={14} className="animate-spin" />
                  Loading collections…
                </div>
              ) : sorted.length === 0 ? (
                <p className="py-6 text-center text-sm text-white/55">
                  No collections yet. Create one below.
                </p>
              ) : (
                sorted.map((col) => {
                  const has = col.posterIds.includes(posterId);
                  const busy = busyId === col.id;
                  const VisIcon = visibilityMeta[col.visibility].icon;
                  return (
                    <button
                      key={col.id}
                      disabled={!!busyId}
                      onClick={() => handleToggle(col.id, has)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-white/12 bg-white/[0.06] px-3 py-2.5 text-left transition-[transform,background-color,border-color] duration-150 hoverable:hover:border-white/15 hoverable:hover:bg-white/[0.06] active:scale-[0.99] disabled:opacity-60"
                    >
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border"
                        style={{
                          borderColor: has ? "rgba(255,107,107,0.4)" : "rgba(255,255,255,0.1)",
                          backgroundColor: has ? "rgba(255,107,107,0.15)" : "transparent",
                          color: has ? "#FF6B6B" : "rgba(255,255,255,0.4)",
                        }}
                      >
                        {busy ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : has ? (
                          <Check size={14} />
                        ) : (
                          <FolderPlus size={14} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium" title={col.name}>
                          {col.name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/50">
                          <VisIcon size={10} />
                          {visibilityMeta[col.visibility].label}
                          <span className="text-white/30">·</span>
                          {col.posterIds.length} poster{col.posterIds.length === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <button
              onClick={() => setView("create")}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-dashed border-white/20 px-4 text-sm text-white/70 transition-colors hoverable:hover:border-[#FF6B6B]/50 hoverable:hover:text-[#FF6B6B]"
            >
              <FolderPlus size={15} />
              New collection
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
