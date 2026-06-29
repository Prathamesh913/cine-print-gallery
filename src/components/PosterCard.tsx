import { useState, useEffect, useRef } from "react";
import { Heart } from "lucide-react";
import type { Poster } from "@/lib/posters";
import { useSaved } from "@/lib/saved";

interface Props {
  poster: Poster;
  onOpen: (p: Poster) => void;
  onContextMenu: (x: number, y: number, poster: Poster) => void;
}

// Global cache to track which image URLs have already finished loading
const loadedImages = new Set<string>();

export function PosterCard({ poster, onOpen, onContextMenu }: Props) {
  const [loaded, setLoaded] = useState(() => loadedImages.has(poster.image));
  const { isSaved, toggle } = useSaved();
  const saved = isSaved(poster.id);
  const imgRef = useRef<HTMLImageElement>(null);
  const touchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [longPressActive, setLongPressActive] = useState(false);

  useEffect(() => {
    // If image is already complete in DOM (e.g. from browser cache), set loaded immediately
    if (imgRef.current?.complete) {
      loadedImages.add(poster.image);
      setLoaded(true);
    }
  }, [poster.image]);

  useEffect(() => {
    return () => {
      if (touchTimerRef.current) {
        clearTimeout(touchTimerRef.current);
      }
    };
  }, []);

  const handleLoad = () => {
    loadedImages.add(poster.image);
    setLoaded(true);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const clientX = touch.clientX;
    const clientY = touch.clientY;
    
    setLongPressActive(false);
    touchTimerRef.current = setTimeout(() => {
      setLongPressActive(true);
      onContextMenu(clientX, clientY, poster);
    }, 500);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
    }
    if (longPressActive) {
      e.preventDefault();
    }
  };

  const handleTouchMove = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
    }
  };

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(e.clientX, e.clientY, poster);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (longPressActive) {
      e.preventDefault();
      e.stopPropagation();
      setLongPressActive(false);
      return;
    }
    onOpen(poster);
  };

  return (
    <button
      onClick={handleCardClick}
      onContextMenu={handleRightClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      className="group relative block w-full overflow-hidden rounded-md text-left transition-transform duration-300 hover:scale-[1.02] hover:shadow-2xl"
      style={{ backgroundColor: "#1E1E1E" }}
    >
      <div className="relative w-full" style={{ aspectRatio: "2 / 3" }}>
        {!loaded && <div className="absolute inset-0 bg-white/5 animate-pulse" />}
        <img
          ref={imgRef}
          src={poster.image}
          alt={`${poster.title} (${poster.year}) by ${poster.artist}`}
          loading="lazy"
          onLoad={handleLoad}
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

        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-white/5 bg-black/70 p-3 opacity-100 backdrop-blur-md transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <p className="truncate text-sm font-medium text-[#F5F5F5]">
            {poster.title} <span className="text-white/60">· {poster.year}</span>
          </p>
          <p className="truncate text-xs text-white/60">by {poster.artist}</p>
        </div>
      </div>
    </button>
  );
}
