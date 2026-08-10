import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Pin, PinOff, ExternalLink, User, FolderPlus } from "lucide-react";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { useSaved } from "@/lib/saved";
import { AddToCollectionModal } from "./AddToCollectionModal";
import { play } from "cuelume";

interface ContextMenuProps {
  x: number;
  y: number;
  poster: Poster;
  onClose: () => void;
}

export function ContextMenu({ x, y, poster, onClose }: ContextMenuProps) {
  const { isSaved, toggle } = useSaved();
  const saved = isSaved(poster.id);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [collectionOpen, setCollectionOpen] = useState(false);

  useEffect(() => {
    if (collectionOpen) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => {
      onClose();
    };

    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("touchstart", handleOutsideClick);
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("touchstart", handleOutsideClick);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [onClose, collectionOpen]);

  // Adjust positions to prevent viewport overflow
  let posX = x;
  let posY = y;
  const menuWidth = 180;
  const menuHeight = 148;

  if (typeof window !== "undefined") {
    if (x + menuWidth > window.innerWidth) {
      posX = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
      posY = window.innerHeight - menuHeight - 10;
    }
  }

  return (
    <>
      {!collectionOpen && (
        <div
          ref={menuRef}
          style={{ top: posY, left: posX }}
          className="fixed z-[150] w-44 overflow-hidden rounded-lg border border-white/15 bg-[#1c1c1c]/95 p-1 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-125 ease-[var(--ease-out)]"
        >
          <button
            onClick={() => {
              const wasSaved = saved;
              toggle(poster.id);
              if (!wasSaved) {
                play("chime");
              }
              onClose();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left font-mono text-[10px] tracking-wider uppercase text-white/80 hoverable:hover:bg-[#FF6B6B] hoverable:hover:text-[#121212] active:scale-95 rounded transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)]"
          >
            {saved ? (
              <>
                <PinOff size={12} className="shrink-0" />
                <span>Unpin Poster</span>
              </>
            ) : (
              <>
                <Pin size={12} className="shrink-0" />
                <span>Pin Poster</span>
              </>
            )}
          </button>
          <button
            onClick={() => setCollectionOpen(true)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left font-mono text-[10px] tracking-wider uppercase text-white/80 hoverable:hover:bg-[#FF6B6B] hoverable:hover:text-[#121212] active:scale-95 rounded transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)]"
          >
            <FolderPlus size={12} className="shrink-0" />
            <span>Add to collection</span>
          </button>
          <button
            onClick={() => {
              const artistName =
                poster.artists && poster.artists.length > 0
                  ? poster.artists[0].name
                  : poster.artist;
              navigate({ to: "/artist/$slug", params: { slug: slugifyArtist(artistName) } });
              onClose();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left font-mono text-[10px] tracking-wider uppercase text-white/80 hoverable:hover:bg-[#FF6B6B] hoverable:hover:text-[#121212] active:scale-95 rounded transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)]"
          >
            <User size={12} className="shrink-0" />
            <span>View Artist</span>
          </button>
          <button
            onClick={() => {
              window.open(poster.image, "_blank");
              onClose();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left font-mono text-[10px] tracking-wider uppercase text-white/80 hoverable:hover:bg-[#FF6B6B] hoverable:hover:text-[#121212] active:scale-95 rounded transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)]"
          >
            <ExternalLink size={12} className="shrink-0" />
            <span>Open in new tab</span>
          </button>
        </div>
      )}
      <AddToCollectionModal
        open={collectionOpen}
        onOpenChange={(open) => {
          setCollectionOpen(open);
          if (!open) onClose();
        }}
        posterId={poster.id}
        posterTitle={poster.title}
      />
    </>
  );
}
