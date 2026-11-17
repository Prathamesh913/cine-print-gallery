import type { Poster } from "@/lib/posters";
import { PosterImage } from "./PosterImage";

/**
 * Decorative poster fan used by collection heroes. Purely visual: the
 * crawlable poster links live in the grid below, so the fan is aria-hidden and
 * every image has an empty alt. Shown from the small breakpoint up only.
 */
interface Props {
  posters: Poster[];
  /** Pages with crawlability tests on every <img> can pass meaningful text. */
  imageAlt?: (poster: Poster) => string;
}

export function FeaturedFan({ posters, imageAlt }: Props) {
  const covers = posters.slice(0, 3);
  if (covers.length < 2) return null;

  const fanLayouts =
    covers.length === 2
      ? [
          { rotate: "-rotate-6", height: "h-40", extra: "" },
          { rotate: "rotate-6", height: "h-40", extra: "-ml-10" },
        ]
      : [
          { rotate: "-rotate-6", height: "h-40", extra: "" },
          { rotate: "", height: "h-44", extra: "-mx-7 z-10" },
          { rotate: "rotate-6", height: "h-40", extra: "-ml-10" },
        ];

  return (
    <div aria-hidden className="hidden shrink-0 items-center py-2 pr-2 sm:flex">
      {covers.map((poster, i) => (
        <PosterImage
          key={poster.id}
          poster={poster}
          purpose="gallery"
          loading="lazy"
          alt={imageAlt ? imageAlt(poster) : ""}
          decoding="async"
          className={`relative rounded-lg border border-white/15 object-cover shadow-xl aspect-[2/3] w-auto ${fanLayouts[i].height} ${fanLayouts[i].rotate} ${fanLayouts[i].extra}`}
        />
      ))}
    </div>
  );
}
