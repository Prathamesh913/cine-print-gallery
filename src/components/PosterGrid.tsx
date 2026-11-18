import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Poster } from "@/lib/posters";
import { PosterCard } from "./PosterCard";
import { ContextMenu } from "./ContextMenu";

interface Props {
  posters: Poster[];
  /**
   * Absolute number of cards per page. When omitted, one page is four full
   * rows at the grid's current column count. Callers that want every poster
   * on one page can pass `posters.length`.
   */
  pageSize?: number;
}

const ROWS_PER_PAGE = 4;
/** Used for SSR and the first client render; corrected before paint after mount. */
const FALLBACK_COLUMNS = 5;

// measure() must run before the first paint so a narrow viewport never flashes
// a desktop-sized first page. useLayoutEffect is not meaningful on the server.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function PosterGrid({ posters, pageSize }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(FALLBACK_COLUMNS);
  const [pages, setPages] = useState(1);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    poster: Poster;
  } | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    // Reading the computed track count keeps this in sync with the grid's
    // responsive classes without duplicating Tailwind's breakpoints in JS.
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
      if (tracks > 0) setColumns(tracks);
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // A new search or filter starts from the first page again.
    setPages(1);
  }, [posters]);

  const perPage = pageSize ?? columns * ROWS_PER_PAGE;
  const visibleCount = Math.min(pages * perPage, posters.length);
  const remaining = posters.length - visibleCount;
  const visible = posters.slice(0, visibleCount);

  if (posters.length === 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-center text-white/65">
        <p>No posters match your search. Try a different word.</p>
      </div>
    );
  }

  const handleContextMenu = (x: number, y: number, poster: Poster) => {
    setContextMenu({ x, y, poster });
  };

  return (
    <>
      <div
        ref={gridRef}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        {visible.map((p, i) => (
          <div
            key={p.id}
            className="animate-in fade-in slide-in-from-bottom-1 duration-300 ease-[var(--ease-out)]"
            style={
              {
                animationDelay: `${Math.min(i, 8) * 35}ms`,
                animationFillMode: "backwards",
              } as React.CSSProperties
            }
          >
            <PosterCard poster={p} onContextMenu={handleContextMenu} />
          </div>
        ))}
      </div>

      {/* Deliberately explicit: the grid never fetches or reveals more on
          scroll. The user decides when to extend it. */}
      {remaining > 0 && (
        <div className="mt-8 flex flex-col items-center gap-2">
          <p className="text-xs text-white/45">
            Showing {visibleCount} of {posters.length}
          </p>
          <button
            type="button"
            onClick={() => setPages((current) => current + 1)}
            aria-label={`Load more posters, ${remaining} remaining`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-2.5 text-sm font-medium text-[#F5F5F5] transition-colors hover:bg-white/10 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]"
          >
            Load more
            <span className="text-white/45">({remaining} left)</span>
          </button>
        </div>
      )}

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
