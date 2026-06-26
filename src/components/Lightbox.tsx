import { useEffect, useState } from "react";
import { X, Heart, Share2, ExternalLink } from "lucide-react";
import type { Poster } from "@/lib/posters";
import { useSaved } from "@/lib/saved";

interface Props {
  poster: Poster | null;
  onClose: () => void;
}

export function Lightbox({ poster, onClose }: Props) {
  const { isSaved, toggle } = useSaved();
  const [zoom, setZoom] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!poster) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [poster, onClose]);

  useEffect(() => {
    setZoom(false);
    setCopied(false);
  }, [poster]);

  if (!poster) return null;

  const saved = isSaved(poster.id);

  const share = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const data = { title: `${poster.title} — CinePrint`, text: `${poster.title} by ${poster.artist}`, url };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch { /* fall through */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-8 sm:px-8"
      style={{ backgroundColor: "rgba(18,18,18,0.95)" }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="fixed right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-[#F5F5F5] backdrop-blur transition hover:bg-white/20"
      >
        <X size={20} />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        className="grid w-full max-w-6xl gap-6 md:grid-cols-[3fr_2fr]"
      >
        <div className="flex items-start justify-center">
          <img
            src={poster.image}
            alt={`${poster.title} (${poster.year})`}
            onClick={() => setZoom((z) => !z)}
            className="max-h-[85vh] w-full cursor-zoom-in rounded-md object-contain transition-transform duration-300"
            style={zoom ? { transform: "scale(1.25)", cursor: "zoom-out" } : undefined}
          />
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
              {poster.artistUrl ? (
                <a href={poster.artistUrl} target="_blank" rel="noreferrer" className="text-[#F5F5F5] underline underline-offset-4 hover:text-[#FF6B6B]">
                  {poster.artist}
                </a>
              ) : (
                <span className="text-[#F5F5F5]">{poster.artist}</span>
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

          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            <button
              onClick={() => toggle(poster.id)}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition"
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
              onClick={share}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-[#F5F5F5] transition hover:border-white/30"
            >
              <Share2 size={16} />
              {copied ? "Link copied" : "Share"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
