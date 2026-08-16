import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FolderPlus, Heart } from "lucide-react";
import { Header } from "@/components/Header";
import { PosterGrid } from "@/components/PosterGrid";
import { GalleryErrorBoundary } from "@/components/GalleryErrorBoundary";
import { Footer } from "@/components/Footer";
import { TabToggle } from "@/components/TabToggle";
import { CollectionCard } from "@/components/CollectionCard";
import { CreateCollectionModal } from "@/components/CreateCollectionModal";
import { type Poster } from "@/lib/posters";
import { fetchNotionPosters } from "@/lib/notion";
import { useSaved } from "@/lib/saved";
import { useAuth } from "@/lib/auth";
import { useCollections } from "@/hooks/use-collections";

export const Route = createFileRoute("/saved")({
  loader: () => fetchNotionPosters(),
  head: () => ({
    meta: [
      { title: "Saved — CinePrint" },
      { name: "description", content: "Your pinned posters and collections on CinePrint." },
    ],
  }),
  component: SavedPage,
});

type Tab = "pins" | "collections";

function SavedPage() {
  const { user, loading } = useAuth();
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
  const [tab, setTab] = useState<Tab>("pins");
  const [createOpen, setCreateOpen] = useState(false);

  const posters = useMemo(
    () => postersList.filter((p) => saved.includes(p.id)),
    [postersList, saved],
  );

  const posterMap = useMemo(() => new Map(postersList.map((p) => [p.id, p])), [postersList]);

  const handleOpen = (p: Poster) => {
    navigate({ to: "/poster/$id", params: { id: p.id } });
  };

  const handleFeelingLucky = () => {
    if (posters.length === 0) return;
    const randomIndex = Math.floor(Math.random() * posters.length);
    handleOpen(posters[randomIndex]);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#000000", color: "#F5F5F5" }}>
      <Header showSearch={false} onFeelingLucky={handleFeelingLucky} />
      <main className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 style={{ fontFamily: "Poppins, sans-serif" }} className="text-2xl font-semibold">
              {tab === "pins" ? "Pins" : "Collections"}
            </h1>
            <p className="mt-1 truncate text-sm text-white/60">
              {tab === "pins"
                ? "Quick pins stay frictionless."
                : "Collections help you organize and share."}
            </p>
          </div>

          <TabToggle<Tab>
            value={tab}
            onChange={setTab}
            className="shrink-0"
            tabs={[
              { id: "pins", label: "Pins", icon: Heart, count: posters.length },
              {
                id: "collections",
                label: "Collections",
                icon: FolderPlus,
                count: user ? collections.length : "—",
              },
            ]}
          />
        </div>

        {tab === "pins" ? (
          <>
            {savedLoading ? (
              <div className="flex min-h-[50vh] items-center justify-center">
                <p className="text-sm text-white/55">Loading your saved posters…</p>
              </div>
            ) : savedError ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
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
                {posters.length > 0 && (
                  <div className="mb-6 text-[10px] font-mono uppercase tracking-widest text-white/55 sm:text-xs">
                    Showing {posters.length} poster{posters.length !== 1 && "s"}
                  </div>
                )}
                {posters.length === 0 ? (
                  <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
                    <p className="text-white/60">
                      Nothing pinned yet. Start discovering posters you love.
                    </p>
                    <Link
                      to="/"
                      className="rounded-full border border-white/15 px-4 py-2 text-sm hoverable:hover:border-[#FF6B6B] hoverable:hover:text-[#FF6B6B]"
                    >
                      Browse the gallery
                    </Link>
                  </div>
                ) : (
                  <GalleryErrorBoundary>
                    <PosterGrid posters={posters} onOpen={handleOpen} />
                  </GalleryErrorBoundary>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {!user && !loading ? (
              <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
                <p className="max-w-sm text-white/60">
                  Sign in to create collections like “Horror”, “Minimal Typography”, or “Posters I’d
                  Hang”.
                </p>
                <Link
                  to="/login"
                  search={{ redirect: "/saved" }}
                  className="rounded-full bg-[#FF6B6B] px-5 py-2 text-sm font-medium text-[#121212]"
                >
                  Sign in
                </Link>
              </div>
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
                  <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
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
                      <div className="mb-6 text-[10px] font-mono uppercase tracking-widest text-white/55 sm:text-xs">
                        Showing {collections.length} collection{collections.length !== 1 && "s"}
                      </div>
                    )}

                    {colsLoading && collections.length === 0 ? (
                      <p className="py-16 text-center text-sm text-white/55">
                        Loading collections…
                      </p>
                    ) : collections.length === 0 ? (
                      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center">
                        <p className="text-white/70">No collections yet.</p>
                        <p className="max-w-sm text-xs text-white/50">
                          Examples: Posters I’d Hang · Horror · Korean Cinema · Color Inspiration
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
          </>
        )}
      </main>
      <Footer />
      <CreateCollectionModal open={createOpen} onOpenChange={setCreateOpen} create={create} />
    </div>
  );
}
