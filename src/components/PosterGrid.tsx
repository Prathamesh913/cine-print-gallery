import { useEffect, useRef, useState } from "react";
import type { Poster } from "@/lib/posters";
import { PosterCard } from "./PosterCard";

interface Props {
  posters: Poster[];
  onOpen: (p: Poster) => void;
  pageSize?: number;
}

export function PosterGrid({ posters, onOpen, pageSize = 24 }: Props) {
  const [count, setCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  return (
    <>
      <div className="columns-2 gap-3 sm:gap-4 md:columns-3 lg:columns-4 xl:columns-5">
        {visible.map((p) => (
          <div key={p.id} className="mb-3 break-inside-avoid sm:mb-4">
            <PosterCard poster={p} onOpen={onOpen} />
          </div>
        ))}
      </div>
      <div ref={sentinelRef} className="h-10" />
    </>
  );
}
