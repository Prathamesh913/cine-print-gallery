import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Copy,
  Globe,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { PosterImage } from "@/components/PosterImage";
import type { UserCollection, CollectionVisibility } from "@/lib/collections";
import posterPalettesRaw from "@/lib/poster-palettes.json";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const posterPalettes = posterPalettesRaw as Record<
  string,
  { palette: string[]; primary: string; hsl: { h: number; s: number; l: number } }
>;

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";
const FALLBACK_PRIMARY = { hex: "#FF6B6B", rgb: [255, 107, 107] as const };

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    const [r, g, b] = FALLBACK_PRIMARY.rgb;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function collectPrimaries(posters: Poster[]): string[] {
  const seen = new Map<string, { hex: string; count: number; sat: number }>();

  for (const poster of posters) {
    const entry = posterPalettes[poster.id];
    if (!entry?.primary) continue;
    const key = entry.primary.toLowerCase();
    const found = seen.get(key);
    if (found) {
      found.count += 1;
      if ((entry.hsl?.s ?? 0) > found.sat) found.sat = entry.hsl.s;
    } else {
      seen.set(key, { hex: entry.primary.toUpperCase(), count: 1, sat: entry.hsl?.s ?? 0 });
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.count - a.count || b.sat - a.sat)
    .slice(0, 4)
    .map((entry) => entry.hex);
}

function buildGlowBackground(colors: string[]): string {
  const spots = ["82% 20%", "60% 85%", "98% 65%", "40% 0%"];
  const alphas = [0.28, 0.18, 0.14, 0.1];

  return colors
    .map((hex, i) => {
      const rx = `${34 + i * 8}rem`;
      const ry = `${22 + i * 5}rem`;
      return `radial-gradient(${rx} ${ry} at ${spots[i % spots.length]}, ${hexToRgba(
        hex,
        alphas[i] ?? 0.08,
      )} 0%, transparent 68%)`;
    })
    .join(", ");
}

const visMeta: Record<
  CollectionVisibility,
  { label: string; icon: typeof Lock }
> = {
  private: { label: "Private", icon: Lock },
  unlisted: { label: "Unlisted", icon: Link2 },
  public: { label: "Public", icon: Globe },
};

interface CollectionHeroProps {
  collection: UserCollection;
  posters: Poster[];
  cover?: Poster | null;
  isOwner: boolean;
  copyShareLink: () => void;
  onEdit: () => void;
  onSetVisibility: (vis: CollectionVisibility) => void;
  onDelete: () => void;
}

export function CollectionHero({
  collection,
  posters,
  cover,
  isOwner,
  copyShareLink,
  onEdit,
  onSetVisibility,
  onDelete,
}: CollectionHeroProps) {
  const VisIcon = visMeta[collection.visibility].icon;

  const featuredArtists = useMemo(() => {
    const seen = new Map<string, string>();
    for (const poster of posters) {
      const names =
        poster.artists && poster.artists.length > 0
          ? poster.artists.map((a) => a.name)
          : [poster.artist];
      for (const name of names) {
        const trimmed = (name ?? "").trim();
        const slug = slugifyArtist(trimmed);
        if (!trimmed || slug === "unknown") continue;
        if (!seen.has(slug)) seen.set(slug, trimmed);
      }
    }
    return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
  }, [posters]);

  const coverPosters = useMemo(() => {
    if (cover) {
      const rest = posters.filter((p) => p.id !== cover.id);
      return [cover, ...rest].slice(0, 3);
    }
    return posters.slice(0, 3);
  }, [cover, posters]);

  const showCovers = coverPosters.length >= 2;

  const glowBackground = useMemo(
    () => buildGlowBackground(collectPrimaries(posters)),
    [posters],
  );

  const fanLayouts =
    coverPosters.length === 2
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
    <section className="relative">
      {/* Palette hero band — pure CSS from already-bundled palette data */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[240px] overflow-hidden rounded-b-3xl sm:h-[300px]"
      >
        <div className="absolute inset-0" style={{ background: glowBackground }} />
        {/* Scrim keeping the left text column dark for readability */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 42%, rgba(0,0,0,0) 78%)",
          }}
        />
        {/* Bottom fade melting into the page's pure-black background */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0) 30%, rgba(0,0,0,0.75) 78%, #000000 100%)",
          }}
        />
      </div>

      <div className="page-shell relative z-10 pb-10 pt-5 sm:pb-14 sm:pt-8">
        <div>
          <Link
            to="/saved"
            preload="intent"
            className={`inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-4 font-mono text-[10px] uppercase tracking-widest text-white/65 transition-colors duration-150 ease-[var(--ease-out)] hover:border-white/25 hover:bg-white/10 hover:text-[#FF6B6B] sm:text-xs ${focusRing}`}
          >
            <ArrowLeft size={12} />
            <span>Saved</span>
          </Link>
        </div>

        <div className="mt-7 flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="min-w-0 max-w-3xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-[#FF6B6B]">
              Curated Collection
            </p>
            <h1 className="mt-3 break-words font-display text-5xl uppercase leading-none text-[#F5F5F5] sm:text-6xl lg:text-7xl">
              {collection.name}
            </h1>

            {collection.description && (
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/70 sm:text-[15px]">
                {collection.description}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.25em] tabular-nums text-white/55">
              <span className="inline-flex items-center gap-1.5">
                <VisIcon size={12} />
                {visMeta[collection.visibility].label}
              </span>
              <span>·</span>
              <span>
                {posters.length} poster{posters.length !== 1 ? "s" : ""}
              </span>
              {collection.ownerName && (
                <>
                  <span>·</span>
                  <span className="break-words">by {collection.ownerName}</span>
                </>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {(collection.visibility === "public" ||
                collection.visibility === "unlisted" ||
                isOwner) && (
                <button
                  type="button"
                  onClick={copyShareLink}
                  className={`inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-5 text-sm text-[#F5F5F5] transition duration-150 ease-[var(--ease-out)] hover:border-white/25 hover:bg-white/10 active:scale-95 ${focusRing}`}
                >
                  <Copy size={14} />
                  <span>Copy link</span>
                </button>
              )}

              {isOwner && (
                <AlertDialog>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={`inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-5 text-sm text-[#F5F5F5] transition duration-150 ease-[var(--ease-out)] hover:border-white/25 hover:bg-white/10 active:scale-95 ${focusRing}`}
                      >
                        <MoreHorizontal size={14} />
                        <span>Manage</span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" sideOffset={8}>
                      <DropdownMenuItem onClick={onEdit}>
                        <Pencil size={14} /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onSetVisibility("private")}>
                        <Lock size={14} /> Private
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onSetVisibility("unlisted")}>
                        <Link2 size={14} /> Unlisted
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onSetVisibility("public")}>
                        <Globe size={14} /> Public
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <AlertDialogTrigger asChild>
                        <DropdownMenuItem
                          variant="destructive"
                          className="text-red-400 focus:bg-red-500 focus:text-white"
                        >
                          <Trash2 size={14} /> Delete collection
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete collection?</AlertDialogTitle>
                      <AlertDialogDescription>
                        “{collection.name}” will be permanently deleted. Posters stay in your Pins
                        and other collections.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-full border border-white/15 px-4 py-2 text-sm">
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={onDelete}
                        className="rounded-full bg-red-500 px-4 py-2 text-sm font-medium text-white"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          {/* Featured covers fan — aligned with details and action buttons */}
          {showCovers && (
            <div aria-hidden className="hidden shrink-0 items-center py-2 pr-2 sm:flex">
              {coverPosters.map((poster, i) => (
                <PosterImage
                  key={poster.id}
                  poster={poster}
                  purpose="gallery"
                  loading="lazy"
                  alt=""
                  decoding="async"
                  className={`relative rounded-lg border border-white/15 object-cover shadow-xl aspect-[2/3] w-auto ${fanLayouts[i].height} ${fanLayouts[i].rotate} ${fanLayouts[i].extra}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Featured Artists Pills — positioned below the main hero row */}
        {featuredArtists.length > 0 && (
          <div className="mt-8 border-t border-white/10 pt-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-white/55">
              Featured Artists
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {featuredArtists.map((artist) => (
                <Link
                  key={artist.slug}
                  to="/artist/$slug"
                  params={{ slug: artist.slug }}
                  preload="intent"
                  className={`inline-flex min-h-11 items-center gap-2.5 rounded-full border border-white/15 bg-white/5 px-4 text-sm text-[#F5F5F5] transition duration-150 ease-[var(--ease-out)] hover:border-white/25 hover:bg-white/10 ${focusRing}`}
                >
                  <span
                    aria-hidden
                    className="font-display text-base leading-none text-[#FF6B6B]"
                  >
                    {artist.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="max-w-36 truncate">{artist.name}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
