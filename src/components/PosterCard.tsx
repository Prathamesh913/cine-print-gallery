import { useState } from "react";
import { Heart } from "lucide-react";
import type { Poster } from "@/lib/posters";
import { useSaved } from "@/lib/saved";

interface Props {
  poster: Poster;
  onOpen: (p: Poster) => void;
}

export function PosterCard({ poster, onOpen }: Props) {
  const [loaded, setLoaded] = useState(false);
  const { isSaved, toggle } = useSaved();
  const saved = isSaved(poster.id);

  return (
    <button
      onClick={() => onOpen(poster)}
      className="group relative block w-full overflow-hidden rounded-md text-left transition-transform duration-300 hover:scale-[1.02] hover:shadow-2xl"
      style={{ backgroundColor: "#1E1E1E" }}
    >
      <div className="relative w-full" style={{ aspectRatio: "2 / 3" }}>
        {!loaded && <div className="absolute inset-0 animate-pulse bg-white/5" />}
        <img
          src={poster.image}
          alt={`${poster.title} (${poster.year}) by ${poster.artist}`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
        />

        <span
          onClick={(e) => {
            e.stopPropagation();
            toggle(poster.id);
          }}
          role="button"
          aria-label={saved ? "Unpin poster" : "Pin poster"}
          className="absolute right-2 top-2 grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-black/50 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 sm:opacity-0"
          style={saved ? { opacity: 1 } : undefined}
        >
          <Heart size={16} fill={saved ? "#FF6B6B" : "none"} stroke={saved ? "#FF6B6B" : "#F5F5F5"} />
        </span>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent p-3 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <p className="truncate text-sm font-medium text-[#F5F5F5]">
            {poster.title} <span className="text-white/60">· {poster.year}</span>
          </p>
          <p className="truncate text-xs text-white/60">by {poster.artist}</p>
        </div>
      </div>
    </button>
  );
}
