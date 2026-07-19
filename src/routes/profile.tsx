import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useEffect } from "react";
import { Header } from "@/components/Header";
import { PosterGrid } from "@/components/PosterGrid";
import { Footer } from "@/components/Footer";
import { type Poster } from "@/lib/posters";
import { fetchNotionPosters } from "@/lib/notion";
import { useSaved } from "@/lib/saved";
import { useAuth } from "@/lib/auth";

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

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
    }
  }, [user, loading, navigate]);

  const posters = useMemo(
    () => postersList.filter((p: Poster) => saved.includes(p.id)),
    [postersList, saved],
  );

  const handleOpen = (p: Poster) => {
    navigate({ to: "/poster/$id", params: { id: p.id } });
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

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
      <Header showSearch={false} />
      <main className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">
        <div className="mb-10 flex items-center gap-4">
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName || ""}
              className="h-14 w-14 rounded-full border border-white/10"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FF6B6B] text-lg font-bold text-[#121212]">
              {user.displayName?.charAt(0) || user.email?.charAt(0) || "?"}
            </div>
          )}
          <div>
            <h1 style={{ fontFamily: "Poppins, sans-serif" }} className="text-2xl font-semibold">
              {user.displayName || "User"}
            </h1>
            <p className="text-sm text-white/50">{user.email}</p>
          </div>
        </div>

        <h2 style={{ fontFamily: "Poppins, sans-serif" }} className="mb-6 text-xl font-semibold">
          Your Pins
        </h2>

        {posters.length > 0 && (
          <div className="mb-6 text-[10px] sm:text-xs tracking-widest font-mono text-white/40 uppercase">
            Showing {posters.length} poster{posters.length !== 1 && "s"}
          </div>
        )}

        {posters.length === 0 ? (
          <div className="flex min-h-[30vh] flex-col items-center justify-center gap-4 text-center">
            <p className="text-white/60">You haven't pinned any posters yet.</p>
          </div>
        ) : (
          <PosterGrid posters={posters} onOpen={handleOpen} />
        )}
      </main>
      <Footer />
    </div>
  );
}
