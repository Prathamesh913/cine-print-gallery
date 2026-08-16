import { Link } from "@tanstack/react-router";
import { Lock, Link2, Globe, Image as ImageIcon, Images } from "lucide-react";
import type { UserCollection, CollectionVisibility } from "@/lib/collections";
import type { Poster } from "@/lib/posters";
import { PosterImage } from "./PosterImage";

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
  return (
    <Link
      to="/c/$id"
      params={{ id: collection.id }}
      className="group flex h-fit gap-2.5 self-start overflow-hidden rounded-2xl border border-white/12 bg-white/[0.06] p-2.5 transition-[transform,border-color,background-color] duration-150 hoverable:hover:-translate-y-0.5 hoverable:hover:border-white/20 hoverable:hover:bg-white/[0.08] active:scale-[0.99]"
    >
      <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-white/5">
        {coverPosters.length > 1 ? (
          <div className="grid h-full grid-cols-2 gap-px bg-black/30">
            {coverPosters.slice(0, 4).map((poster) => (
              <PosterImage
                key={poster.id}
                poster={poster}
                purpose="gallery"
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ))}
          </div>
        ) : coverPosters[0] ? (
          <PosterImage
            poster={coverPosters[0]}
            purpose="gallery"
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full place-items-center text-white/30">
            <ImageIcon size={18} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 self-center">
        <h3 className="truncate font-medium">{collection.name}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-white/75">
            <Images size={12} className="text-white/50" />
            {collection.posterIds.length} poster{collection.posterIds.length === 1 ? "" : "s"}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${visStyle[collection.visibility]}`}
          >
            <Vis size={10} />
            {collection.visibility}
          </span>
        </div>
      </div>
    </Link>
  );
}
