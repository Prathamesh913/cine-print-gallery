import { useEffect, useRef } from "react";
import { Pin, PinOff, ExternalLink } from "lucide-react";
import { type Poster } from "@/lib/posters";
import { useSaved } from "@/lib/saved";

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

  useEffect(() => {
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
  }, [onClose]);

  // Adjust positions to prevent viewport overflow
  let posX = x;
  let posY = y;
  const menuWidth = 160;
  const menuHeight = 80;

  if (typeof window !== "undefined") {
    if (x + menuWidth > window.innerWidth) {
      posX = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
      posY = window.innerHeight - menuHeight - 10;
    }
  }

  return (
    <div
      ref={menuRef}
      style={{ top: posY, left: posX }}
      className="fixed z-[150] w-40 overflow-hidden rounded-lg border border-white/10 bg-[#161616]/95 p-1 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
    >
      <button
        onClick={() => {
          toggle(poster.id);
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[10px] tracking-wider uppercase text-white/80 hover:bg-[#FF6B6B] hover:text-[#121212] rounded transition-colors"
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
        onClick={() => {
          window.open(poster.image, "_blank");
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[10px] tracking-wider uppercase text-white/80 hover:bg-[#FF6B6B] hover:text-[#121212] rounded transition-colors"
      >
        <ExternalLink size={12} className="shrink-0" />
        <span>Open in new tab</span>
      </button>
    </div>
  );
}
