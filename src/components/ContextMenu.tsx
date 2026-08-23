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
  const triggerRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
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

  // Menu semantics: focus the first item, restore focus to the trigger on close.
  useEffect(() => {
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    itemRefs.current[0]?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, []);

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        items[(index + 1) % items.length].focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        items[(index - 1 + items.length) % items.length].focus();
        break;
      case "Home":
        e.preventDefault();
        items[0].focus();
        break;
      case "End":
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "Tab":
        onClose();
        break;
    }
  };

  // Adjust positions to prevent viewport overflow
  let posX = x;
  let posY = y;
  const menuWidth = 180;
  let menuHeight = 148;

  if (typeof window !== "undefined") {
    if (window.innerWidth < 640) {
      menuHeight = 184;
    }
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
          onKeyDown={handleMenuKeyDown}
          role="menu"
          aria-label="Poster actions"
          style={{ top: posY, left: posX }}
          className="fixed z-[150] w-44 overflow-hidden rounded-lg border border-white/15 bg-[#1c1c1c]/95 p-1 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-125 ease-[var(--ease-out)]"
        >
          <button
            ref={(el) => {
              itemRefs.current[0] = el;
            }}
            role="menuitem"
            onClick={() => {
              const wasSaved = saved;
              toggle(poster.id);
              if (!wasSaved) {
                play("chime");
              }
              onClose();
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded px-3 py-2.5 text-left font-mono text-[10px] tracking-wider uppercase text-white/80 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] hoverable:hover:bg-[#FF6B6B] hoverable:hover:text-[#121212] active:scale-95 sm:min-h-0"
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
            ref={(el) => {
              itemRefs.current[1] = el;
            }}
            role="menuitem"
            onClick={() => setCollectionOpen(true)}
            className="flex min-h-11 w-full items-center gap-2 rounded px-3 py-2.5 text-left font-mono text-[10px] tracking-wider uppercase text-white/80 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] hoverable:hover:bg-[#FF6B6B] hoverable:hover:text-[#121212] active:scale-95 sm:min-h-0"
          >
            <FolderPlus size={12} className="shrink-0" />
            <span>Add to collection</span>
          </button>
          <button
            ref={(el) => {
              itemRefs.current[2] = el;
            }}
            role="menuitem"
            onClick={() => {
              const artistName =
                poster.artists && poster.artists.length > 0
                  ? poster.artists[0].name
                  : poster.artist;
              navigate({ to: "/artist/$slug", params: { slug: slugifyArtist(artistName) } });
              onClose();
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded px-3 py-2.5 text-left font-mono text-[10px] tracking-wider uppercase text-white/80 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] hoverable:hover:bg-[#FF6B6B] hoverable:hover:text-[#121212] active:scale-95 sm:min-h-0"
          >
            <User size={12} className="shrink-0" />
            <span>View Artist</span>
          </button>
          <button
            ref={(el) => {
              itemRefs.current[3] = el;
            }}
            role="menuitem"
            onClick={() => {
              window.open(poster.image, "_blank");
              onClose();
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded px-3 py-2.5 text-left font-mono text-[10px] tracking-wider uppercase text-white/80 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] hoverable:hover:bg-[#FF6B6B] hoverable:hover:text-[#121212] active:scale-95 sm:min-h-0"
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
