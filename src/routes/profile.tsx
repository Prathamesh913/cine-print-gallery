import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import { Pencil, Award, Bookmark, Calendar, Image } from "lucide-react";
import { Header } from "@/components/Header";
import { PosterGrid } from "@/components/PosterGrid";
import { Footer } from "@/components/Footer";
import { type Poster } from "@/lib/posters";
import { fetchNotionPosters } from "@/lib/notion";
import { useSaved } from "@/lib/saved";
import { useAuth } from "@/lib/auth";
import { getUserProfile, updateBio } from "@/lib/user-likes";

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
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const postersList = Route.useLoaderData();
  const { saved } = useSaved();
  const [profileData, setProfileData] = useState<{ createdAt: string | null; bio: string } | null>(
    null,
  );
  const [editingBio, setEditingBio] = useState(false);
  const [bioValue, setBioValue] = useState("");
  const [savingBio, setSavingBio] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    getUserProfile({ data: user.uid })
      .then(setProfileData)
      .catch(() => {});
  }, [user]);

  const posters = useMemo(
    () => postersList.filter((p: Poster) => saved.includes(p.id)),
    [postersList, saved],
  );

  const handleOpen = (p: Poster) => {
    navigate({ to: "/poster/$id", params: { id: p.id } });
  };

  const startEditing = () => {
    setBioValue(profileData?.bio || "");
    setEditingBio(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const saveBio = async () => {
    if (!user || savingBio) return;
    setSavingBio(true);
    try {
      await updateBio({ data: { uid: user.uid, bio: bioValue } });
      setProfileData((prev) => (prev ? { ...prev, bio: bioValue } : prev));
      setEditingBio(false);
    } catch {
      // revert on failure
      setBioValue(profileData?.bio || "");
      setEditingBio(false);
    } finally {
      setSavingBio(false);
    }
  };

  const cancelBio = () => {
    setEditingBio(false);
    setBioValue(profileData?.bio || "");
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
        <Header showSearch={false} />
        <main className="mx-auto flex min-h-[calc(100vh-80px)] items-center justify-center">
          <p className="text-sm text-white/40">Loading...</p>
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
    <div className="min-h-screen" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
      <Header showSearch={false} />
      <main className="mx-auto max-w-[1600px]">
        {/* Banner */}
        <div className="relative h-40 overflow-hidden md:h-52">
          {bannerPoster ? (
            <>
              <img
                src={bannerPoster.image}
                alt=""
                className="h-full w-full scale-110 object-cover blur-2xl"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-[#121212]/60 to-transparent" />
            </>
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-[#FF6B6B]/15 via-transparent to-transparent" />
          )}
        </div>

        {/* Profile content */}
        <div className="px-4 pb-10 sm:px-6">
          {/* Avatar + name row */}
          <div className="relative z-10 flex items-end gap-4 -mt-12 mb-6">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border-4 border-white/10 shadow-lg">
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

              {nextMilestone && <p className="mt-0.5 text-[11px] text-white/25">{nextMilestone}</p>}
            </div>
          </div>

          {/* Bio */}
          <div className="ml-[calc(6rem+1rem)] mb-8">
            {editingBio ? (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={bioValue}
                  onChange={(e) => setBioValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveBio();
                    if (e.key === "Escape") cancelBio();
                  }}
                  onBlur={saveBio}
                  placeholder="Write a short bio…"
                  maxLength={120}
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-[#F5F5F5] placeholder:text-white/30 focus:border-[#FF6B6B] focus:outline-none"
                />
                {savingBio && <span className="text-xs text-white/30">Saving…</span>}
              </div>
            ) : (
              <button
                onClick={startEditing}
                className="group flex items-center gap-1.5 text-left text-sm text-white/50 transition-colors hover:text-white/70"
              >
                {profileData?.bio ? (
                  <span>{profileData.bio}</span>
                ) : (
                  <span className="text-white/30">Add a short bio…</span>
                )}
                <Pencil
                  size={12}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                />
              </button>
            )}
          </div>

          {/* Stats */}
          <div className="mb-10 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <Bookmark size={14} className="text-[#FF6B6B]" />
                {pinnedCount}
              </div>
              <p className="mt-0.5 text-xs text-white/40">
                {pinnedCount === 1 ? "Poster pinned" : "Posters pinned"}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <Calendar size={14} className="text-[#FF6B6B]" />
                {memberSince || "—"}
              </div>
              <p className="mt-0.5 text-xs text-white/40">Member since</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <Image size={14} className="text-[#FF6B6B]" />
                {postersList.length}
              </div>
              <p className="mt-0.5 text-xs text-white/40">
                {postersList.length === 1 ? "Poster in gallery" : "Posters in gallery"}
              </p>
            </div>
          </div>

          {/* Pins */}
          <h2 style={{ fontFamily: "Poppins, sans-serif" }} className="mb-6 text-xl font-semibold">
            Your Pins
          </h2>

          {pinnedCount > 0 && (
            <div className="mb-6 text-[10px] sm:text-xs tracking-widest font-mono text-white/40 uppercase">
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
        </div>
      </main>
      <Footer />
    </div>
  );
}
