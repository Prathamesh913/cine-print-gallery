import { PosterImage } from "@/components/PosterImage";
import type { Poster } from "@/lib/posters";

interface Props {
  name: string;
  count: number;
  /** Up to three posters, fanned from back to front. */
  covers: Poster[];
  /**
   * Meaningful alt for the front print. Directory pages pass the
   * representative's title/artist so the artwork stays crawlable; the
   * homepage rail leaves it out and keeps the fan decorative (its link has
   * an aria-label).
   */
  frontAlt?: string;
}

/**
 * The CinePrint "folder" card: a small fan of prints emerging from behind a
 * substantial metadata panel. Shared by the homepage artist rail and the
 * artist / genre / style directories so every collection entry looks the same.
 *
 * The caller owns the link (and therefore the group hover/focus styles); this
 * component only renders the card body, keeping all links in the SSR markup.
 */
export function FolderCardBody({ name, count, covers, frontAlt }: Props) {
  const fan = covers.filter(Boolean).slice(0, 3);
  const frontIndex = fan.length <= 1 ? 0 : 1;
  const altFor = (index: number) =>
    frontAlt ? (index === frontIndex ? frontAlt : `${name} poster artwork`) : "";

  return (
    <>
      {/* Artwork zone — fan rises from behind the lower card */}
      <div className="relative flex h-[168px] items-end justify-center overflow-visible px-3 pt-4 sm:h-[184px]">
        <div className="relative flex items-end justify-center">
          {fan.length <= 1 ? (
            <div className="relative h-[132px] w-[88px] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-md transition-[transform] duration-200 ease-[var(--ease-out)] hoverable:group-hover:-translate-y-[2px] hoverable:group-hover:scale-[1.01] group-focus-visible:-translate-y-[2px] group-focus-visible:scale-[1.01] sm:h-[144px] sm:w-[96px]">
              {fan[0] && (
                <PosterImage
                  poster={fan[0]}
                  purpose="gallery"
                  loading="lazy"
                  alt={altFor(0)}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
          ) : fan.length === 2 ? (
            <>
              <div className="absolute bottom-0 left-1/2 h-[124px] w-[84px] -translate-x-[62%] -rotate-[5deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-85 shadow-md transition-[transform] duration-[280ms] ease-[var(--ease-out)] hoverable:group-hover:-translate-x-[70%] hoverable:group-hover:-rotate-[8deg] group-focus-visible:-translate-x-[70%] group-focus-visible:-rotate-[8deg] sm:h-[136px] sm:w-[92px]">
                <PosterImage
                  poster={fan[0]}
                  purpose="gallery"
                  loading="lazy"
                  alt={altFor(0)}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="relative z-10 h-[132px] w-[88px] translate-x-[14%] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-lg transition-[transform] duration-200 ease-[var(--ease-out)] hoverable:group-hover:-translate-y-[3px] group-focus-visible:-translate-y-[3px] sm:h-[144px] sm:w-[96px]">
                <PosterImage
                  poster={fan[1]}
                  purpose="gallery"
                  loading="lazy"
                  alt={altFor(1)}
                  className="h-full w-full object-cover"
                />
              </div>
            </>
          ) : (
            <>
              <div className="absolute bottom-0 left-1/2 h-[120px] w-[80px] -translate-x-[108%] -rotate-[6deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-80 shadow-md transition-[transform] duration-[280ms] ease-[var(--ease-out)] hoverable:group-hover:-translate-x-[118%] hoverable:group-hover:-rotate-[9deg] group-focus-visible:-translate-x-[118%] group-focus-visible:-rotate-[9deg] sm:h-[132px] sm:w-[88px]">
                <PosterImage
                  poster={fan[0]}
                  purpose="gallery"
                  loading="lazy"
                  alt={altFor(0)}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="relative z-10 h-[132px] w-[88px] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] shadow-xl transition-[transform] duration-200 ease-[var(--ease-out)] hoverable:group-hover:-translate-y-[2px] hoverable:group-hover:scale-[1.01] group-focus-visible:-translate-y-[2px] group-focus-visible:scale-[1.01] sm:h-[144px] sm:w-[96px]">
                <PosterImage
                  poster={fan[1]}
                  purpose="gallery"
                  loading="lazy"
                  alt={altFor(1)}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="absolute bottom-0 left-1/2 h-[120px] w-[80px] translate-x-[8%] rotate-[6deg] overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] opacity-90 shadow-md transition-[transform] duration-[280ms] ease-[var(--ease-out)] hoverable:group-hover:translate-x-[16%] hoverable:group-hover:rotate-[9deg] group-focus-visible:translate-x-[16%] group-focus-visible:rotate-[9deg] sm:h-[132px] sm:w-[88px]">
                <PosterImage
                  poster={fan[2]}
                  purpose="gallery"
                  loading="lazy"
                  alt={altFor(2)}
                  className="h-full w-full object-cover"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Lower collection panel — substantial, rounded top where it meets artwork */}
      <div className="flex flex-1 flex-col rounded-t-xl border-t border-white/10 bg-[#0F0F0F] px-4 pb-4 pt-4">
        <h3 className="line-clamp-2 min-h-[2.8em] text-left text-[15px] font-semibold leading-snug text-white">
          {name}
        </h3>
        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
          <span className="font-mono text-xs tabular-nums text-white/50">
            {count} poster{count === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-xs text-white/60 transition-colors group-hover:text-white">
            Explore <span aria-hidden>→</span>
          </span>
        </div>
      </div>
    </>
  );
}
