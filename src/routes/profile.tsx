import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useEffect, useState, useRef, useReducer } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Pencil,
  Award,
  Bookmark,
  Calendar,
  Image,
  FolderPlus,
  Heart,
  Download,
  Trash2,
  Loader2,
} from "lucide-react";
import { bioReducer } from "@/lib/bio-editor";
import { getAuthToken } from "@/lib/auth-token";
import { exportUserData, deleteAccount } from "@/lib/account";
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
import { Header } from "@/components/Header";
import { PosterGrid } from "@/components/PosterGrid";
import { Footer } from "@/components/Footer";
import { TabToggle } from "@/components/TabToggle";
import { CollectionCard } from "@/components/CollectionCard";
import { CreateCollectionModal } from "@/components/CreateCollectionModal";
import { PosterImage } from "@/components/PosterImage";
import { type Poster } from "@/lib/posters";
import { fetchNotionPosters } from "@/lib/notion";
import { useSaved } from "@/lib/saved";
import { useAuth } from "@/lib/auth";
import { useCollections } from "@/hooks/use-collections";
import { useUserProfile } from "@/lib/user-profile";

export const Route = createFileRoute("/profile")({
  loader: () => fetchNotionPosters(),
  head: () => ({
    meta: [
      { title: "Profile — CinePrint" },
      { name: "description", content: "Your profile and liked posters on CinePrint." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const postersList = Route.useLoaderData();
  const { saved, error: savedError, loading: savedLoading, retry: retrySaved } = useSaved();
  const {
    collections,
    loading: colsLoading,
    error: colsError,
    retry: retryCollections,
    create,
  } = useCollections();
  const {
    profile: profileData,
    saveBio: persistBio,
    error: profileError,
    retry: retryProfile,
  } = useUserProfile();
  const [bio, dispatch] = useReducer(bioReducer, {
    editing: false,
    saving: false,
    value: "",
    persisted: "",
    error: null,
    skipBlur: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"pins" | "collections">("pins");
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: "/profile" } });
    }
  }, [user, loading, navigate]);

  const posters = useMemo(
    () => postersList.filter((p: Poster) => saved.includes(p.id)),
    [postersList, saved],
  );

  const posterMap = useMemo(() => new Map(postersList.map((p) => [p.id, p])), [postersList]);

  const handleOpen = (p: Poster) => {
    navigate({ to: "/poster/$id", params: { id: p.id } });
  };

  const startEditing = () => {
    dispatch({ type: "START_EDIT", persisted: profileData?.bio || "" });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const saveBio = async () => {
    if (!user || bio.saving) return;
    dispatch({ type: "SAVE_START" });
    try {
      await persistBio(bio.value);
      dispatch({ type: "SAVE_SUCCESS", value: bio.value });
    } catch {
      dispatch({ type: "SAVE_FAIL", error: "Couldn't save your bio. Please try again." });
    }
  };

  const cancelBio = () => {
    dispatch({ type: "CANCEL" });
  };

  const handleBioBlur = () => {
    if (bio.skipBlur) {
      dispatch({ type: "CONSUME_SKIP" });
      return;
    }
    if (bio.editing && !bio.saving) {
      void saveBio();
    }
  };

  const handleExport = async () => {
    if (!user) return;
    const token = await getAuthToken(user);
    if (!token) {
      toast.error("Couldn't export your data. Please sign in again.");
      return;
    }
    try {
      const data = await exportUserData({ data: { token, uid: user.uid } });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cineprint-data.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Your data has been exported.");
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("Couldn't export your data. Please try again.");
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || deletingAccount) return;
    setDeletingAccount(true);
    try {
      const token = await getAuthToken(user);
      if (!token) {
        toast.error("Couldn't delete your account. Please sign in again.");
        return;
      }
      await deleteAccount({ data: { token, uid: user.uid } });
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem("cineprint:saved");
        } catch {
          // ignore
        }
        try {
          sessionStorage.removeItem("cineprint:user-profile");
        } catch {
          // ignore
        }
      }
      toast.success("Your account has been deleted.");
      await signOut();
      navigate({ to: "/" });
    } catch (err) {
      console.error("Account deletion failed:", err);
      toast.error("Couldn't delete your account. Please try again.");
    } finally {
      setDeletingAccount(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "#000000", color: "#F5F5F5" }}>
        <Header showSearch={false} />
        <main className="mx-auto flex min-h-[calc(100vh-80px)] items-center justify-center">
          <p className="text-sm text-white/55">Loading...</p>
        </main>
      </div>
    );
  }

  const memberSince = profileData?.createdAt
    ? format(new Date(profileData.createdAt), "MMM yyyy")
    : null;

  const pinnedCount = posters.length;
  const badgeLabel =
    pinnedCount >= 50
      ? "Gallerist"
      : pinnedCount >= 25
        ? "Archivist"
        : pinnedCount >= 10
          ? "Curator"
          : pinnedCount >= 1
            ? "Collector"
            : null;

  const nextMilestone =
    pinnedCount < 1
      ? "Start pinning to earn your first badge"
      : pinnedCount < 10
        ? `${10 - pinnedCount} more until Curator`
        : pinnedCount < 25
          ? `${25 - pinnedCount} more until Archivist`
          : pinnedCount < 50
            ? `${50 - pinnedCount} more until Gallerist`
            : null;

  const bannerPoster = posters.length > 0 ? posters[0] : null;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#000000", color: "#F5F5F5" }}>
      <Header showSearch={false} />
      <main className="mx-auto max-w-[1600px]">
        {/* Banner */}
        <div className="relative h-40 overflow-hidden md:h-52">
          {bannerPoster ? (
            <>
              <PosterImage
                poster={bannerPoster}
                purpose="gallery"
                alt=""
                className="h-full w-full scale-110 object-cover blur-2xl"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#000000] via-[#000000]/60 to-transparent" />
            </>
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-[#FF6B6B]/15 via-transparent to-transparent" />
          )}
        </div>

        {/* Profile content */}
        <div className="px-4 pb-10 sm:px-6">
          {/* Avatar + name row */}
          <div className="relative z-10 flex items-end gap-4 -mt-12 mb-6">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border-4 border-white/15 shadow-lg">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || ""}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[#FF6B6B] text-xl font-bold text-[#121212]">
                  {user.displayName?.charAt(0) || user.email?.charAt(0) || "?"}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1
                  style={{ fontFamily: "Poppins, sans-serif" }}
                  className="text-xl font-semibold sm:text-2xl"
                >
                  {user.displayName || "User"}
                </h1>
                {badgeLabel && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#FF6B6B]/30 bg-[#FF6B6B]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#FF6B6B]">
                    <Award size={11} />
                    {badgeLabel}
                  </span>
                )}
              </div>

              {nextMilestone && <p className="mt-0.5 text-[11px] text-white/35">{nextMilestone}</p>}
            </div>
          </div>

          {/* Bio */}
          <div className="ml-[calc(6rem+1rem)] mb-8">
            {bio.editing ? (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={bio.value}
                  onChange={(e) => dispatch({ type: "CHANGE", value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveBio();
                    if (e.key === "Escape") cancelBio();
                  }}
                  onBlur={handleBioBlur}
                  placeholder="Write a short bio…"
                  maxLength={120}
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-[#F5F5F5] placeholder:text-white/45 focus:border-[#FF6B6B] focus:outline-none"
                />
                {bio.saving && <span className="text-xs text-white/45">Saving…</span>}
              </div>
            ) : (
              <button
                onClick={startEditing}
                className="group flex items-center gap-1.5 text-left text-sm text-white/65 transition-colors hover:text-white/70"
              >
                {profileData?.bio ? (
                  <span>{profileData.bio}</span>
                ) : (
                  <span className="text-white/45">Add a short bio…</span>
                )}
                <Pencil
                  size={12}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                />
              </button>
            )}
          </div>

          {profileError && (
            <div className="mb-8 flex items-center justify-between gap-3 rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3">
              <p className="text-sm text-white/70">{profileError}</p>
              <button
                onClick={retryProfile}
                className="shrink-0 rounded-full border border-white/15 px-4 py-1.5 text-sm hoverable:hover:border-[#FF6B6B] hoverable:hover:text-[#FF6B6B]"
              >
                Retry
              </button>
            </div>
          )}

          {/* Stats */}
          <div className="mb-10 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/5 bg-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <Bookmark size={14} className="text-[#FF6B6B]" />
                {pinnedCount}
              </div>
              <p className="mt-0.5 text-xs text-white/55">
                {pinnedCount === 1 ? "Poster pinned" : "Posters pinned"}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <Calendar size={14} className="text-[#FF6B6B]" />
                {memberSince || "—"}
              </div>
              <p className="mt-0.5 text-xs text-white/55">Member since</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <Image size={14} className="text-[#FF6B6B]" />
                {postersList.length}
              </div>
              <p className="mt-0.5 text-xs text-white/55">
                {postersList.length === 1 ? "Poster in gallery" : "Posters in gallery"}
              </p>
            </div>
          </div>

          {/* Pins / Collections */}
          <div className="mb-8 flex items-center justify-between gap-4">
            <h2
              style={{ fontFamily: "Poppins, sans-serif" }}
              className="shrink-0 text-xl font-semibold"
            >
              {tab === "pins" ? "Your Pins" : "Collections"}
            </h2>
            <TabToggle
              value={tab}
              onChange={setTab}
              className="shrink-0"
              tabs={[
                { id: "pins", label: "Pins", icon: Heart, count: pinnedCount },
                {
                  id: "collections",
                  label: "Collections",
                  icon: FolderPlus,
                  count: collections.length,
                },
              ]}
            />
          </div>

          {tab === "pins" ? (
            <>
              {savedLoading ? (
                <div className="flex min-h-[30vh] items-center justify-center">
                  <p className="text-sm text-white/55">Loading your saved posters…</p>
                </div>
              ) : savedError ? (
                <div className="flex min-h-[30vh] flex-col items-center justify-center gap-4 text-center">
                  <p className="text-white/70">{savedError}</p>
                  <button
                    onClick={retrySaved}
                    className="rounded-full border border-white/15 px-4 py-2 text-sm hoverable:hover:border-[#FF6B6B] hoverable:hover:text-[#FF6B6B]"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {pinnedCount > 0 && (
                    <div className="mb-6 text-[10px] sm:text-xs tracking-widest font-mono text-white/55 uppercase">
                      Showing {pinnedCount} {pinnedCount === 1 ? "poster" : "posters"}
                    </div>
                  )}

                  {pinnedCount === 0 ? (
                    <div className="flex min-h-[30vh] flex-col items-center justify-center gap-4 text-center">
                      <p className="text-white/60">You haven't pinned any posters yet.</p>
                    </div>
                  ) : (
                    <PosterGrid posters={posters} onOpen={handleOpen} />
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="mb-6">
                <button
                  onClick={() => setCreateOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#FF6B6B] px-4 py-2.5 text-sm font-medium text-[#121212] transition-[transform,background-color] duration-150 hoverable:hover:bg-[#FF8585] active:scale-95"
                >
                  <FolderPlus size={15} />
                  New collection
                </button>
              </div>

              {colsError ? (
                <div className="flex min-h-[30vh] flex-col items-center justify-center gap-4 text-center">
                  <p className="text-white/70">{colsError}</p>
                  <button
                    onClick={retryCollections}
                    className="rounded-full border border-white/15 px-4 py-2 text-sm hoverable:hover:border-[#FF6B6B] hoverable:hover:text-[#FF6B6B]"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {collections.length > 0 && (
                    <div className="mb-6 text-[10px] sm:text-xs tracking-widest font-mono text-white/55 uppercase">
                      Showing {collections.length} collection{collections.length !== 1 && "s"}
                    </div>
                  )}

                  {colsLoading && collections.length === 0 ? (
                    <p className="py-16 text-center text-sm text-white/55">Loading collections…</p>
                  ) : collections.length === 0 ? (
                    <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center">
                      <p className="text-white/70">No collections yet.</p>
                      <p className="max-w-sm text-xs text-white/50">
                        Examples: Posters I'd Hang · Horror · Korean Cinema · Color Inspiration
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {collections.map((col) => {
                        const coverIds = Array.from(
                          new Set(
                            [col.coverPosterId, ...col.posterIds].filter(Boolean) as string[],
                          ),
                        ).slice(0, 4);
                        const coverPosters = coverIds
                          .map((id) => posterMap.get(id))
                          .filter((poster): poster is Poster => Boolean(poster));
                        return (
                          <CollectionCard
                            key={col.id}
                            collection={col}
                            coverPosters={coverPosters}
                          />
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Data & account */}
        <div className="mt-10 border-t border-white/10 px-4 pt-8 sm:px-6">
          <h2 style={{ fontFamily: "Poppins, sans-serif" }} className="mb-4 text-lg font-semibold">
            Data & account
          </h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-white/65">
              Export your profile, saved posters, and collections.
            </p>
            <button
              onClick={handleExport}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm transition-colors hoverable:hover:border-white/30"
            >
              <Download size={14} />
              Export my data
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-white/65">
              Permanently delete your account and all your data.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-red-400/30 px-4 py-2 text-sm text-red-400 transition-colors hoverable:hover:bg-red-400/10">
                  <Trash2 size={14} />
                  Delete account
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes your profile, saved posters, and collections. This
                    action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-full border border-white/15 px-4 py-2 text-sm">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    disabled={deletingAccount}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:pointer-events-none disabled:opacity-50"
                  >
                    {deletingAccount ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Deleting…
                      </>
                    ) : (
                      "Delete account"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </main>
      <Footer />
      <CreateCollectionModal open={createOpen} onOpenChange={setCreateOpen} create={create} />
    </div>
  );
}
