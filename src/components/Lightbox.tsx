import { useEffect, useRef, useState } from "react";
import { X, Heart, Share2, ExternalLink } from "lucide-react";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { useSaved } from "@/lib/saved";
import { Link } from "@tanstack/react-router";
import { ShareModal } from "./ShareModal";

interface Props {
  poster: Poster | null;
  posters?: Poster[];
  onNavigate?: (p: Poster) => void;
  onClose: () => void;
}

export function Lightbox({ poster, posters = [], onNavigate, onClose }: Props) {
  const { isSaved, toggle } = useSaved();
  const [zoom, setZoom] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  // Exit animation state — keeps component mounted while fading out
  const [visible, setVisible] = useState(false);
  // Track whether last nav was via keyboard to skip slide animation
  const keyboardNavRef = useRef(false);
  const currentIndex = poster ? posters.findIndex((p) => p.id === poster.id) : -1;
  const prevPoster = currentIndex > 0 ? posters[currentIndex - 1] : null;
  const nextPoster = currentIndex < posters.length - 1 ? posters[currentIndex + 1] : null;

  // Fade-in when poster becomes available
  useEffect(() => {
    if (poster) {
      // Defer one frame to allow CSS transition to play
      requestAnimationFrame(() => setVisible(true));
    }
  }, [!!poster]);

  // Keyboard events
  useEffect(() => {
    if (!poster) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      } else if (e.key === "ArrowLeft" && prevPoster && onNavigate) {
        keyboardNavRef.current = true;
        onNavigate(prevPoster);
      } else if (e.key === "ArrowRight" && nextPoster && onNavigate) {
        keyboardNavRef.current = true;
        onNavigate(nextPoster);
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [poster, prevPoster, nextPoster, onNavigate]);

  // Reset transient state on poster change
  useEffect(() => {
    setZoom(false);
    setCopied(false);
    setImageLoaded(false);
    // Reset keyboard flag after each navigation
    keyboardNavRef.current = false;
  }, [poster]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  if (!poster) return null;

  const saved = isSaved(poster.id);

  const share = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const data = { title: `${poster.title} — CinePrint`, text: `${poster.title} by ${poster.artist} on CinePrint!`, url };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch { /* fall through */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  // Skip content animation when navigating via keyboard (instant) per none-keyboard-navigation rule
  const skipAnimation = keyboardNavRef.current;

  return (
    <div
      onClick={handleClose}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-8 sm:px-8 transition-opacity duration-200"
      style={{
        backgroundColor: "rgba(18,18,18,0.95)",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <button
        onClick={handleClose}
        aria-label="Close"
        className="fixed right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-[#F5F5F5] backdrop-blur transition-all duration-150 hover:bg-white/20 active:scale-90"
      >
        <X size={20} />
      </button>

      <div
        key={poster.id}
        onClick={(e) => e.stopPropagation()}
        className={`grid w-full max-w-6xl gap-6 md:grid-cols-[3fr_2fr] ${
          skipAnimation ? "" : "animate-in fade-in zoom-in-95 duration-200 ease-out"
        }`}
      >
        <div className="flex flex-col items-center w-full">
          <div className="relative flex items-start justify-center group/nav w-full">
            {/* Previous Arrow Button Indicator */}
            {prevPoster && onNavigate && (
              <button
                onClick={() => { keyboardNavRef.current = false; onNavigate(prevPoster); }}
                aria-label="Previous Poster"
                className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 border border-white/10 text-white/70 backdrop-blur-md opacity-0 group-hover/nav:opacity-100 transition-all duration-150 hover:bg-black/80 hover:text-white active:scale-90 sm:flex hidden"
              >
                <span className="text-xs">←</span>
              </button>
            )}

            <img
              key={poster.id}
              src={poster.image}
              alt={`${poster.title} (${poster.year})`}
              onLoad={() => setImageLoaded(true)}
              onClick={() => setZoom((z) => !z)}
              className={`max-h-[85vh] w-full cursor-zoom-in rounded-lg object-contain transition-all duration-200 ${
                imageLoaded ? "opacity-100 scale-100" : "opacity-0 scale-95"
              }`}
              style={zoom ? { transform: "scale(1.25)", cursor: "zoom-out" } : undefined}
            />
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/5 animate-pulse rounded-xl" />
            )}

            {/* Next Arrow Button Indicator */}
            {nextPoster && onNavigate && (
              <button
                onClick={() => { keyboardNavRef.current = false; onNavigate(nextPoster); }}
                aria-label="Next Poster"
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 border border-white/10 text-white/70 backdrop-blur-md opacity-0 group-hover/nav:opacity-100 transition-all duration-150 hover:bg-black/80 hover:text-white active:scale-90 sm:flex hidden"
              >
                <span className="text-xs">→</span>
              </button>
            )}
          </div>

          {/* Keyboard navigation helper */}
          {(prevPoster || nextPoster) && (
            <div className="mt-4 hidden sm:flex items-center justify-center gap-3 text-[10px] tracking-widest font-mono text-white/30 uppercase select-none tabular-nums">
              {prevPoster && (
                <span className="flex items-center gap-1.5">
                  <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/40">←</kbd> PREV
                </span>
              )}
              {prevPoster && nextPoster && <span>·</span>}
              {nextPoster && (
                <span className="flex items-center gap-1.5">
                  NEXT <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/40">→</kbd>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 md:py-4">
          <div>
            <h2
              style={{ fontFamily: "Poppins, sans-serif" }}
              className="text-3xl font-semibold leading-tight text-[#F5F5F5] sm:text-4xl"
            >
              {poster.title}
            </h2>
            <p className="mt-1 text-sm text-white/50">{poster.year}</p>
          </div>

          <div className="space-y-1.5 text-sm">
            <p className="text-white/70">
              by{" "}
              {poster.artists && poster.artists.length > 0 ? (
                poster.artists.map((art, idx) => (
                  <span key={idx}>
                    {idx > 0 && " & "}
                    {art.url ? (
                      <a
                        href={art.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#F5F5F5] underline underline-offset-4 hover:text-[#FF6B6B]"
                      >
                        {art.name}
                      </a>
                    ) : (
                      <span className="text-[#F5F5F5]">{art.name}</span>
                    )}
                    <span className="ml-1.5 text-xs text-white/40">
                      (
                      <Link
                        to="/artist/$slug"
                        params={{ slug: slugifyArtist(art.name) }}
                        preload="intent"
                        className="underline hover:text-[#FF6B6B]"
                      >
                        view gallery
                      </Link>
                      )
                    </span>
                  </span>
                ))
              ) : (
                <span>
                  {poster.artistUrl ? (
                    <a
                      href={poster.artistUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#F5F5F5] underline underline-offset-4 hover:text-[#FF6B6B]"
                    >
                      {poster.artist}
                    </a>
                  ) : (
                    <span className="text-[#F5F5F5]">{poster.artist}</span>
                  )}
                  <span className="ml-1.5 text-xs text-white/40">
                    (
                    <Link
                      to="/artist/$slug"
                      params={{ slug: slugifyArtist(poster.artist) }}
                      preload="intent"
                      className="underline hover:text-[#FF6B6B]"
                    >
                      view gallery
                    </Link>
                    )
                  </span>
                </span>
              )}
            </p>
            <p className="text-white/70">
              Found on{" "}
              <a href={poster.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#F5F5F5] underline underline-offset-4 hover:text-[#FF6B6B]">
                {poster.source} <ExternalLink size={12} />
              </a>
            </p>
          </div>

          {poster.note && <p className="italic text-white/60">"{poster.note}"</p>}

          <div className="flex flex-wrap gap-2 pt-2">
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/60">{poster.style}</span>
            {poster.genre.map((g) => (
              <span key={g} className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/60">{g}</span>
            ))}
          </div>

          {((!poster.artist || poster.artist.toLowerCase() === "unknown") ||
            (!poster.source || poster.source.toLowerCase() === "unknown")) && (
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              Know the artist or source of this poster? Reach out via socials on the{" "}
              <Link to="/about" className="text-white/60 underline hover:text-[#FF6B6B]">
                About
              </Link>{" "}
              page so I can update the details!
            </p>
          )}

          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            <button
              onClick={() => toggle(poster.id)}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-95"
              style={{
                backgroundColor: saved ? "#FF6B6B" : "transparent",
                color: saved ? "#121212" : "#F5F5F5",
                border: `1px solid ${saved ? "#FF6B6B" : "rgba(255,255,255,0.15)"}`,
              }}
            >
              <Heart size={16} fill={saved ? "#121212" : "none"} />
              {saved ? "Pinned" : "Pin it"}
            </button>
            <button
              onClick={() => setShareOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-[#F5F5F5] transition-all duration-150 hover:border-white/30 active:scale-95"
            >
              <Share2 size={16} />
              Share
            </button>
          </div>
        </div>
      </div>

      {/* ShareModal with exit animation */}
      {shareOpen && (
        <ShareModal
          poster={poster}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
