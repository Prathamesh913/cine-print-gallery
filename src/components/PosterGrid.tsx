import { useEffect, useRef, useState } from "react";
import type { Poster } from "@/lib/posters";
import { PosterCard } from "./PosterCard";
import { ContextMenu } from "./ContextMenu";

interface Props {
  posters: Poster[];
  onOpen: (p: Poster) => void;
  pageSize?: number;
}

export function PosterGrid({ posters, onOpen, pageSize = 24 }: Props) {
  const [count, setCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    poster: Poster;
  } | null>(null);

  useEffect(() => {
    setCount(pageSize);
  }, [posters, pageSize]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setCount((c) => Math.min(c + pageSize, posters.length));
        }
      },
      { rootMargin: "400px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [posters.length, pageSize]);

  const visible = posters.slice(0, count);

  if (posters.length === 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-center text-white/50">
        <p>No posters match your search. Try a different word.</p>
      </div>
    );
  }

  const handleContextMenu = (x: number, y: number, poster: Poster) => {
    setContextMenu({ x, y, poster });
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {visible.map((p) => (
          <div key={p.id}>
            <PosterCard poster={p} onOpen={onOpen} onContextMenu={handleContextMenu} />
          </div>
        ))}
      </div>
      <div ref={sentinelRef} className="h-10" />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          poster={contextMenu.poster}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
