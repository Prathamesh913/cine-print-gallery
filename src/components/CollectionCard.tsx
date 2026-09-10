import { Link } from "@tanstack/react-router";
import { Lock, Link2, Globe, Image as ImageIcon } from "lucide-react";
import type { UserCollection, CollectionVisibility } from "@/lib/collections";
import type { Poster } from "@/lib/posters";
import { PosterImage } from "./PosterImage";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

const visIcon: Record<CollectionVisibility, typeof Lock> = {
  private: Lock,
  unlisted: Link2,
  public: Globe,
};

const visStyle: Record<CollectionVisibility, string> = {
  private: "border-white/15 bg-white/10 text-white/70",
  unlisted: "border-white/15 bg-white/10 text-white/70",
  public: "border-[#FF6B6B]/35 bg-[#FF6B6B]/10 text-[#FF6B6B]",
};

export function CollectionCard({
  collection,
  coverPosters,
}: {
  collection: UserCollection;
  coverPosters: Poster[];
}) {
  const Vis = visIcon[collection.visibility];
  const count = collection.posterIds.length;
  const covers = coverPosters.slice(0, 3);

  return (
    <Link
      to="/c/$id"
      params={{ id: collection.id }}
      aria-label={`${collection.name}, ${count} poster${count === 1 ? "" : "s"}`}
      className={`group relative flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-white/12 bg-white/[0.06] transition-[transform,border-color,background-color] duration-[160ms] ease-[var(--ease-out)] hover:border-white/20 hover:bg-white/[0.08] hoverable:hover:-translate-y-[1px] active:scale-[0.98] sm:w-64 ${focusRing}`}
    >
      {/* Artwork zone — fan rises from behind the lower card */}
      <div className="relative flex h-[168px] items-end justify-center overflow-visible px-3 pt-4 sm:h-[184px]">
        <div className="relative flex items-end justify-center">
          {covers.length === 0 ? (
            <div className="relative grid h-[132px] w-[88px] place-items-center overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-md sm:h-[144px] sm:w-[96px]">
              <ImageIcon size={20} className="text-white/30" />
            </div>
          ) : covers.length === 1 ? (
            <div className="relative h-[132px] w-[88px] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-md transition-[transform] duration-200 ease-[var(--ease-out)] hoverable:group-hover:-translate-y-[2px] hoverable:group-hover:scale-[1.01] group-focus-visible:-translate-y-[2px] group-focus-visible:scale-[1.01] sm:h-[144px] sm:w-[96px]">
              <PosterImage
                poster={covers[0]}
                purpose="gallery"
                loading="lazy"
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
          ) : covers.length === 2 ? (
            <>
              <div className="absolute bottom-0 left-1/2 h-[124px] w-[84px] -translate-x-[62%] -rotate-[5deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-85 shadow-md transition-[transform] duration-[280ms] ease-[var(--ease-out)] hoverable:group-hover:-translate-x-[70%] hoverable:group-hover:-rotate-[8deg] group-focus-visible:-translate-x-[70%] group-focus-visible:-rotate-[8deg] sm:h-[136px] sm:w-[92px]">
                <PosterImage
                  poster={covers[0]}
                  purpose="gallery"
                  loading="lazy"
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="relative z-10 h-[132px] w-[88px] translate-x-[14%] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-lg transition-[transform] duration-200 ease-[var(--ease-out)] hoverable:group-hover:-translate-y-[3px] group-focus-visible:-translate-y-[3px] sm:h-[144px] sm:w-[96px]">
                <PosterImage
                  poster={covers[1]}
                  purpose="gallery"
                  loading="lazy"
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
            </>
          ) : (
            <>
              <div className="absolute bottom-0 left-1/2 h-[120px] w-[80px] -translate-x-[108%] -rotate-[6deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-80 shadow-md transition-[transform] duration-[280ms] ease-[var(--ease-out)] hoverable:group-hover:-translate-x-[118%] hoverable:group-hover:-rotate-[9deg] group-focus-visible:-translate-x-[118%] group-focus-visible:-rotate-[9deg] sm:h-[132px] sm:w-[88px]">
                <PosterImage
                  poster={covers[0]}
                  purpose="gallery"
                  loading="lazy"
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="relative z-10 h-[132px] w-[88px] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-xl transition-[transform] duration-200 ease-[var(--ease-out)] hoverable:group-hover:-translate-y-[2px] hoverable:group-hover:scale-[1.01] group-focus-visible:-translate-y-[2px] group-focus-visible:scale-[1.01] sm:h-[144px] sm:w-[96px]">
                <PosterImage
                  poster={covers[1]}
                  purpose="gallery"
                  loading="lazy"
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="absolute bottom-0 left-1/2 h-[120px] w-[80px] translate-x-[8%] rotate-[6deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-90 shadow-md transition-[transform] duration-[280ms] ease-[var(--ease-out)] hoverable:group-hover:translate-x-[16%] hoverable:group-hover:rotate-[9deg] group-focus-visible:translate-x-[16%] group-focus-visible:rotate-[9deg] sm:h-[132px] sm:w-[88px]">
                <PosterImage
                  poster={covers[2]}
                  purpose="gallery"
                  loading="lazy"
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Lower collection panel — substantial, rounded top where it meets artwork */}
      <div className="flex flex-1 flex-col rounded-t-xl border-t border-white/10 bg-[#0F0F0F] px-4 pb-4 pt-4">
        <h3
          className="line-clamp-2 min-h-[2.8em] text-left text-[15px] font-semibold leading-snug text-white"
          title={collection.name}
        >
          {collection.name}
        </h3>
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex w-full items-center justify-between">
            <span className="font-mono text-xs tabular-nums text-white/50">
              {count} poster{count === 1 ? "" : "s"}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${visStyle[collection.visibility]}`}
            >
              <Vis size={10} />
              {collection.visibility}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 font-mono text-xs text-white/60 transition-colors group-hover:text-white">
            Explore <span aria-hidden>→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
