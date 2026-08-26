import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FolderPlus, Heart, LogIn } from "lucide-react";
import { Header } from "@/components/Header";
import { PosterGrid } from "@/components/PosterGrid";
import { GalleryErrorBoundary } from "@/components/GalleryErrorBoundary";
import { Footer } from "@/components/Footer";
import { TabToggle } from "@/components/TabToggle";
import { CollectionCard } from "@/components/CollectionCard";
import { CreateCollectionModal } from "@/components/CreateCollectionModal";
import { CollectionCardSkeleton, EmptyState } from "@/components/states";
import { type Poster } from "@/lib/posters";
import { fetchNotionPosters } from "@/lib/notion";
import { useSaved } from "@/lib/saved";
import { useAuth } from "@/lib/auth";
import { useCollections } from "@/hooks/use-collections";

const primaryPill =
  "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full bg-[#FF6B6B] px-5 text-sm font-semibold text-[#121212] shadow-md shadow-[#FF6B6B]/15 transition duration-150 ease-[var(--ease-out)] hover:bg-[#FF8585] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";
const outlinePill =
  "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-5 text-sm font-medium text-white transition duration-150 ease-[var(--ease-out)] hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

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
      <main className="page-shell py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/55 sm:text-xs">
              {tab === "pins" ? "Your Pins" : "Your Collections"}
            </div>
            <h1 className="mt-1 text-2xl font-semibold font-heading">Saved</h1>
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
              user
                ? {
                    id: "collections",
                    label: "Collections",
                    icon: FolderPlus,
                    count: collections.length,
                  }
                : { id: "collections", label: "Collections", icon: FolderPlus },
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
                <button type="button" onClick={retrySaved} className={outlinePill}>
                  Retry
                </button>
              </div>
            ) : (
              <>
                {posters.length === 0 ? (
                  <div className="flex min-h-[50vh] items-center justify-center">
                    <EmptyState
                      icon={Heart}
                      title="Nothing pinned yet"
                      body={
                        user
                          ? "Tap the heart on any poster to pin it here."
                          : "Pins are saved on this device — sign in to sync them everywhere."
                      }
                    >
                      <Link to="/" preload="intent" className={primaryPill}>
                        Browse Posters
                      </Link>
                    </EmptyState>
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
              <div className="flex min-h-[40vh] items-center justify-center">
                <EmptyState
                  icon={LogIn}
                  title="Sign in to create collections"
                  body={
                    "Save posters into collections like “Horror”, “Minimal Typography”, or “Posters I’d Hang”."
                  }
                >
                  <Link
                    to="/login"
                    search={{ redirect: "/saved" }}
                    preload="intent"
                    className={primaryPill}
                  >
                    Sign in
                  </Link>
                </EmptyState>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <button onClick={() => setCreateOpen(true)} className={primaryPill}>
                    <FolderPlus size={15} />
                    New collection
                  </button>
                </div>

                {colsError ? (
                  <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
                    <p className="text-white/70">{colsError}</p>
                    <button type="button" onClick={retryCollections} className={outlinePill}>
                      Retry
                    </button>
                  </div>
                ) : (
                  <>
                    {colsLoading && collections.length === 0 ? (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {Array.from({ length: 3 }, (_, i) => (
                          <CollectionCardSkeleton key={i} />
                        ))}
                      </div>
                    ) : collections.length === 0 ? (
                      <div className="flex min-h-[30vh] items-center justify-center">
                        <EmptyState
                          icon={FolderPlus}
                          title="No collections yet"
                          body='Group posters however you like — try "Horror", "Korean Cinema", or "Color Inspiration".'
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
