import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Link } from "@tanstack/react-router";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { PosterImage } from "@/components/PosterImage";
import { FolderCardBody } from "@/components/FolderCard";
import { getPosterImageUrl } from "@/lib/poster-images";
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

interface DailySpotlightProps {
  filmPosters: Poster[];
  wallPosters: Poster[];
  totalPosters: number;
  totalArtists: number;
}

const stackOffsets = [
  { x: 0, y: 0, rotate: 0, opacity: 1 },
  { x: 34, y: 30, rotate: 3, opacity: 0.7 },
  { x: -34, y: 46, rotate: -2, opacity: 0.45 },
];

const DEFAULT_POSTER_ASPECT = 2 / 3;
// Fixed frame height for the stack; prints size themselves within it so the
// hero never reflows when the stack cycles to a different-shaped poster.
const STACK_HEIGHT = "clamp(260px, 52svh, 460px)";

/**
 * The daily film's prints as a physical stack. The film and artist sit together
 * as the print label, the lift control sits with the prints, and the stack
 * cycles the interpretations when the visitor is not interacting with it.
 */
export function DailySpotlight({
  filmPosters,
  wallPosters,
  totalPosters,
  totalArtists,
}: DailySpotlightProps) {
  const [activePosterIdx, setActivePosterIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Posters ship without dimension metadata, so ratios are measured from the
  // loaded images and each print renders at its own aspect inside the frame.
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const activePoster = filmPosters[activePosterIdx] || filmPosters[0];
  const measurePoster = (posterId: string) => (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (!naturalWidth || !naturalHeight) return;
    const ratio = naturalWidth / naturalHeight;
    setAspects((prev) => (prev[posterId] === ratio ? prev : { ...prev, [posterId]: ratio }));
  };
  const totalCount = filmPosters.length;
  const wallRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!activePoster) return;
    const timer = window.setTimeout(() => {
      for (const poster of filmPosters) {
        if (poster.id === activePoster.id) continue;
        const image = new Image();
        image.src = getPosterImageUrl(poster, "gallery");
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [filmPosters, activePoster]);

  useEffect(() => {
    if (totalCount < 2 || reduceMotion || paused) return;
    let interval: number | undefined;
    const start = window.setTimeout(() => {
      setActivePosterIdx((current) => (current + 1) % totalCount);
      interval = window.setInterval(() => {
        setActivePosterIdx((current) => (current + 1) % totalCount);
      }, 3000);
    }, 1500);
    return () => {
      window.clearTimeout(start);
      if (interval) window.clearInterval(interval);
    };
  }, [totalCount, reduceMotion, paused, resetKey]);

  useEffect(() => {
    const el = wallRef.current;
    if (!el || wallPosters.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const anim = el.animate([{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }], {
      duration: 60000,
      iterations: Infinity,
      easing: "linear",
    });

    const section = el.closest(".hero-wall") as HTMLElement | null;
    if (!section) return () => anim.cancel();

    let rafId: number | null = null;
    let current = 1;
    let target = 1;

    function tick() {
      const diff = target - current;
      if (Math.abs(diff) < 0.003) {
        anim.playbackRate = target;
        current = target;
        rafId = null;
        return;
      }
      current += diff * 0.07;
      anim.playbackRate = current;
      rafId = requestAnimationFrame(tick);
    }

    const onEnter = () => {
      target = 0.25;
      if (!rafId) rafId = requestAnimationFrame(tick);
    };
    const onLeave = () => {
      target = 1;
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    section.addEventListener("mouseenter", onEnter);
    section.addEventListener("mouseleave", onLeave);

    return () => {
      anim.cancel();
      if (rafId) cancelAnimationFrame(rafId);
      section.removeEventListener("mouseenter", onEnter);
      section.removeEventListener("mouseleave", onLeave);
    };
  }, [wallPosters.length]);

  if (!activePoster || filmPosters.length === 0) return null;

  const filmTitle = activePoster.title ?? "Cinema";
  const filmYear = activePoster.year;
  const choose = (index: number) => {
    setActivePosterIdx(index);
    setResetKey((key) => key + 1);
  };

  return (
    <section className="relative mx-auto flex min-h-[calc(100svh-72px)] w-full max-w-[1600px] flex-col items-center justify-center overflow-hidden px-4 pb-10 pt-6 text-center sm:px-6">
      <div
        aria-hidden
        className="hero-wall pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent 0%, #000 15%, #000 85%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, #000 15%, #000 85%, transparent 100%)",
        }}
      >
        <div ref={wallRef} className="will-change-transform opacity-30">
          {[0, 1].map((copy) => (
            <div
              key={copy}
              className="grid grid-cols-3 gap-3 p-3 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
            >
              {wallPosters.map((poster) => (
                <div
                  key={`${copy}-${poster.id}`}
                  className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-[#1E1E1E]"
                >
                  <PosterImage
                    poster={poster}
                    purpose="gallery"
                    loading="lazy"
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="absolute inset-0 bg-black/60" />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <h1 className="hero-rise whitespace-nowrap font-display uppercase leading-[0.9] tracking-[-0.01em] text-[clamp(26px,5.6vw,96px)]">
          One film. Many visions.
        </h1>

        <div
          className="hero-rise relative mt-8 flex w-full max-w-[300px] items-center justify-center md:max-w-[400px]"
          style={{ animationDelay: "80ms", height: STACK_HEIGHT }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setPaused(false);
            }
          }}
        >
          {filmPosters.map((poster, index) => {
            const relative = (index - activePosterIdx + totalCount) % totalCount;
            const offset = stackOffsets[relative] ?? stackOffsets[0];
            const isTop = relative === 0;
            const printAspect = aspects[poster.id] ?? DEFAULT_POSTER_ASPECT;
            const stackStyle = {
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) rotate(${offset.rotate}deg)`,
              zIndex: totalCount - relative,
              opacity: offset.opacity,
              aspectRatio: `${printAspect}`,
              // Each print keeps its own dimensions; the stable frame never
              // resizes so cycling the stack doesn't shift the hero.
              width: `min(100%, calc(${STACK_HEIGHT} * ${printAspect}))`,
            };
            // The top print is the crawlable destination; prints behind it stay
            // buttons so the stack can still be reordered without nesting controls.
            if (isTop) {
              return (
                <Link
                  key={poster.id}
                  to="/poster/$id"
                  params={{ id: poster.id }}
                  preload="intent"
                  aria-label={`${filmTitle} (${filmYear}) — open poster by ${poster.artist}`}
                  className="absolute left-1/2 top-1/2 overflow-hidden bg-[#1E1E1E] transition-[transform,opacity,width] duration-[480ms] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]"
                  style={stackStyle}
                >
                  <PosterImage
                    poster={poster}
                    purpose="gallery"
                    loading="eager"
                    fetchPriority="high"
                    alt={`${filmTitle} (${filmYear}) by ${poster.artist}`}
                    onLoad={measurePoster(poster.id)}
                    className="h-full w-full object-cover"
                  />
                </Link>
              );
            }
            return (
              <button
                key={poster.id}
                type="button"
                onClick={() => choose(index)}
                aria-label={`Bring print ${index + 1} to the top`}
                className="absolute left-1/2 top-1/2 overflow-hidden bg-[#1E1E1E] transition-[transform,opacity,width] duration-[480ms] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]"
                style={stackStyle}
              >
                <PosterImage
                  poster={poster}
                  purpose="gallery"
                  loading="lazy"
                  alt=""
                  onLoad={measurePoster(poster.id)}
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
        </div>

        <p
          className="hero-rise mx-auto mt-8 max-w-[46ch] text-[17px] leading-relaxed text-white/80"
          style={{ animationDelay: "160ms" }}
        >
          An independent archive of {totalPosters} alternative movie posters by {totalArtists}{" "}
          artists.
        </p>

        <a
          href="#gallery"
          onClick={(event) => {
            event.preventDefault();
            const gallery = document.getElementById("gallery");
            if (!gallery) return;
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            gallery.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
          }}
          className={`hero-rise mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-[#FF6B6B] px-6 text-[15px] font-semibold text-[#121212] transition-[transform,background-color] duration-150 hover:bg-[#FF8585] active:scale-[0.98] ${focusRing}`}
          style={{ animationDelay: "240ms" }}
        >
          Browse the archive
        </a>
      </div>
    </section>
  );
}

export interface RailArtist {
  name: string;
  count: number;
  covers: Poster[];
}

export interface RailFilm {
  slug: string;
  title: string;
  count: number;
  covers: Poster[];
}

/** Premade film/show collections — the same folder card as the artist rail. */
export function FilmRail({ films }: { films: RailFilm[] }) {
  if (films.length === 0) return null;

  return (
    <section aria-label="Premade collections">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-white/55 sm:text-xs">
        Premade Collections
      </p>
      <div
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-1 pb-3 scrollbar-hide"
        style={{ scrollPaddingInline: "1rem" }}
      >
        {films.map(({ slug, title, count, covers }) => (
          <Link
            key={slug}
            to="/film/$slug"
            params={{ slug }}
            aria-label={`${title}, ${count} poster${count === 1 ? "" : "s"}`}
            className={`group relative flex w-56 shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-white/12 bg-white/[0.06] transition-[transform,border-color,background-color] duration-[160ms] ease-[var(--ease-out)] hover:border-white/20 hover:bg-white/[0.08] hoverable:hover:-translate-y-[1px] active:scale-[0.98] sm:w-64 ${focusRing}`}
          >
            <FolderCardBody name={title} count={count} covers={covers} />
          </Link>
        ))}
      </div>
    </section>
  );
}

/** ArtistRail — collection/folder card: artwork emerges from behind a substantial metadata panel. */
export function ArtistRail({ artists }: { artists: RailArtist[] }) {
  if (artists.length < 4) return null;

  return (
    <section aria-label="Explore artists">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-white/55 sm:text-xs">
        Explore Artists
      </p>
      <div
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-1 pb-3 scrollbar-hide"
        style={{ scrollPaddingInline: "1rem" }}
      >
        {artists.map(({ name, count, covers }) => (
          <Link
            key={name}
            to="/artist/$slug"
            params={{ slug: slugifyArtist(name) }}
            aria-label={`${name}, ${count} poster${count === 1 ? "" : "s"}`}
            className={`group relative flex w-56 shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-white/12 bg-white/[0.06] transition-[transform,border-color,background-color] duration-[160ms] ease-[var(--ease-out)] hover:border-white/20 hover:bg-white/[0.08] hoverable:hover:-translate-y-[1px] active:scale-[0.98] sm:w-64 ${focusRing}`}
          >
            <FolderCardBody name={name} count={count} covers={covers} />
          </Link>
        ))}
      </div>
    </section>
  );
}
