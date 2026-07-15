import { useEffect, useRef, useState } from "react";
import { X, Heart, Share2, ExternalLink, Download, Loader2 } from "lucide-react";
import { type Poster, slugifyArtist } from "@/lib/posters";
import { useSaved } from "@/lib/saved";
import { Link } from "@tanstack/react-router";
import { ShareModal } from "./ShareModal";
import { play } from "cuelume";
import { getBase64Image } from "@/lib/notion";
import { toast } from "sonner";

const triggerHaptic = () => {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(12);
    } catch {}
  }
};

const ImdbIcon = ({ className }: { className?: string }) => (
  <svg role="img" viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M22.3781 0H1.6218C.7411.0583.0587.7437.0018 1.5953l-.001 20.783c.0585.8761.7125 1.543 1.5559 1.6191A.337.337 0 0 0 1.6016 24h20.7971a.4579.4579 0 0 0 .0437-.002c.8727-.0768 1.5568-.8271 1.5568-1.7085V1.7098c0-.8914-.696-1.6416-1.584-1.7078A.3294.3294 0 0 0 22.3781 0zm0 .496a1.2144 1.2144 0 0 1 1.1252 1.2139v20.5797c0 .6377-.4875 1.1602-1.1045 1.2145H1.6016c-.5967-.0543-1.0645-.5297-1.1053-1.1258V1.6284C.5371 1.0185 1.0184.5364 1.6217.496h20.7564zM4.7954 8.2603v7.3636H2.8899V8.2603h1.9055zm6.5367 0v7.3636H9.6707v-4.9704l-.6711 4.9704H7.813l-.6986-4.8618-.0066 4.8618h-1.668V8.2603h2.468c.0748.4476.1492.9694.2307 1.5734l.2712 1.8713.4407-3.4447h2.4817zm2.9772 1.3289c.0742.0404.122.108.1417.2034.0279.0953.0345.3118.0345.6442v2.8548c0 .4881-.0345.7867-.0955.8954-.0609.1152-.2304.1695-.5018.1695V9.5211c.204 0 .3457.0205.4211.0681zm-.0211 6.0347c.4543 0 .8006-.0265 1.0245-.0742.2304-.0477.4204-.1357.5694-.2648.1556-.1218.2642-.298.3251-.5219.0611-.2238.1021-.6648.1021-1.3224v-2.5832c0-.6986-.0271-1.1668-.0742-1.4039-.041-.237-.1431-.4543-.3126-.6437-.1695-.1973-.4198-.3324-.7456-.421-.3191-.0808-.8542-.1285-1.7694-.1285h-1.4244v7.3636h2.3051zm5.14-1.7827c0 .3523-.0199.5762-.0544.6708-.033.0947-.1894.1424-.3046.1424-.1086 0-.19-.0477-.2238-.1351-.041-.0887-.0609-.2986-.0609-.6238v-1.9469c0-.3324.0199-.5423.0543-.6237.0338-.0808.1086-.122.2171-.122.1153 0 .2709.0412.3114.1425.041.0947.0609.2986.0609.6032v1.8926zm-2.4747-5.5809v7.3636h1.7157l.1152-.4675c.1556.1894.3251.3324.5152.4271.1828.0881.4608.1357.678.1357.3047 0 .5629-.0748.7802-.237.2165-.1562.3589-.3462.4198-.5628.0543-.2173.0887-.543.0887-.9841v-2.0675c0-.4409-.0139-.7324-.0344-.8681-.0199-.1357-.0742-.2781-.1695-.4204-.1021-.1425-.2437-.251-.4272-.3325-.1834-.0742-.3999-.1152-.6576-.1152-.2172 0-.4952.0477-.6846.1285-.1835.0887-.353.2238-.5086.4007V8.2603h-1.8309z"/>
  </svg>
);

const TmdbIcon = ({ className }: { className?: string }) => (
  <svg role="img" viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M6.62 12a2.291 2.291 0 0 1 2.292-2.295h-.013A2.291 2.291 0 0 1 11.189 12a2.291 2.291 0 0 1-2.29 2.291h.013A2.291 2.291 0 0 1 6.62 12zm10.72-4.062h4.266a2.291 2.291 0 0 0 2.29-2.291 2.291 2.291 0 0 0-2.29-2.296H17.34a2.291 2.291 0 0 0-2.291 2.296 2.291 2.291 0 0 0 2.29 2.29zM2.688 20.645h8.285a2.291 2.291 0 0 0 2.291-2.292 2.291 2.291 0 0 0-2.29-2.295H2.687a2.291 2.291 0 0 0-2.291 2.295 2.291 2.291 0 0 0 2.29 2.292zm10.881-6.354h.81l1.894-4.586H15.19l-1.154 3.008h-.013l-1.135-3.008h-1.154zm4.208 0h1.011V9.705h-1.011zm2.878 0h3.235v-.93h-2.223v-.933h1.99v-.934h-1.99v-.855h2.107v-.934h-3.112zM1.31 7.941h1.01V4.247h1.31v-.895H0v.895h1.31zm3.747 0h1.011V5.959h1.958v1.984h1.011v-4.59h-1.01v1.711H6.061V3.351H5.057zm5.348 0h3.242v-.933H11.41v-.934h1.99v-.933h-1.99v-.856h2.107v-.934h-3.112zM.162 14.296h1.005v-3.52h.013l1.167 3.52h.765l1.206-3.52h.013v3.52h1.011v-4.59H3.82L2.755 12.7h-.013L1.686 9.705H.156zm14.534 6.353h1.641a3.188 3.188 0 0 0 .98-.149 2.531 2.531 0 0 0 .824-.437 2.123 2.123 0 0 0 .567-.713 2.193 2.193 0 0 0 .223-.983 2.399 2.399 0 0 0-.218-1.07 1.958 1.958 0 0 0-.586-.716 2.405 2.405 0 0 0-.873-.392 4.349 4.349 0 0 0-1.046-.13h-1.519zm1.013-3.656h.596a2.26 2.26 0 0 1 .606.08 1.514 1.514 0 0 1 .503.244 1.167 1.167 0 0 1 .34.412 1.28 1.28 0 0 1 .13.587 1.546 1.546 0 0 1-.13.658 1.127 1.127 0 0 1-.347.433 1.41 1.41 0 0 1-.518.238 2.797 2.797 0 0 1-.649.07h-.538zm4.686 3.656h1.88a2.997 2.997 0 0 0 .613-.064 1.735 1.735 0 0 0 .554-.214 1.221 1.221 0 0 0 .402-.39 1.105 1.105 0 0 0 .155-.606 1.188 1.188 0 0 0-.071-.415 1.01 1.01 0 0 0-.204-.34 1.087 1.087 0 0 0-.317-.24 1.297 1.297 0 0 0-.413-.13v-.012a1.203 1.203 0 0 0 .575-.366.962.962 0 0 0 .216-.648 1.081 1.081 0 0 0-.149-.603 1.022 1.022 0 0 0-.389-.354 1.673 1.673 0 0 0-.54-.169 4.463 4.463 0 0 0-.6-.041h-1.712zm1.011-3.734h.687a1.4 1.4 0 0 1 .24.022.748.748 0 0 1 .22.075.432.432 0 0 1 .16.147.418.418 0 0 1 .061.236.47.47 0 0 1-.055.233.433.433 0 0 1-.146.156.62.62 0 0 1-.204.084 1.058 1.058 0 0 1-.23.026h-.745zm0 1.835h.765a1.96 1.96 0 0 1 .266.02 1.015 1.015 0 0 1 .26.07.519.519 0 0 1 .204.152.406.406 0 0 1 .08.26.481.481 0 0 1-.06.253.519.519 0 0 1-.16.168.62.62 0 0 1-.217.09 1.155 1.155 0 0 1-.237.027H21.4z"/>
  </svg>
);

const FilmReelIcon = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg
    viewBox="0 0 100 100"
    className={className}
    style={style}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
  >
    {/* Outer Rim */}
    <circle cx="50" cy="50" r="44" strokeWidth="6" />
    
    {/* Inner Track */}
    <circle cx="50" cy="50" r="34" strokeWidth="2" strokeDasharray="6 6" className="opacity-40" />

    {/* Center Hub */}
    <circle cx="50" cy="50" r="14" strokeWidth="5" />
    <circle cx="50" cy="50" r="4" fill="currentColor" />

    {/* Spokes */}
    <line x1="50" y1="14" x2="50" y2="36" strokeWidth="5" />
    <line x1="50" y1="64" x2="50" y2="86" strokeWidth="5" />
    <line x1="14" y1="50" x2="36" y2="50" strokeWidth="5" />
    <line x1="64" y1="50" x2="86" y2="50" strokeWidth="5" />
    
    {/* Diagonal Spokes */}
    <line x1="24.5" y1="24.5" x2="40" y2="40" strokeWidth="5" />
    <line x1="60" y1="60" x2="75.5" y2="75.5" strokeWidth="5" />
    <line x1="24.5" y1="75.5" x2="40" y2="60" strokeWidth="5" />
    <line x1="60" y1="40" x2="75.5" y2="24.5" strokeWidth="5" />
  </svg>
);

interface Props {
  poster: Poster | null;
  posters?: Poster[];
  onNavigate?: (p: Poster) => void;
  onClose: () => void;
}

export function Lightbox({ poster, posters = [], onNavigate, onClose }: Props) {
  const { isSaved, toggle } = useSaved();
  const [downloading, setDownloading] = useState(false);

  const handlePlexDownload = async () => {
    if (!poster || downloading) return;
    
    const downloadUrl = poster.posterImageUrl || poster.image;
    if (!downloadUrl) {
      toast.error("No image URL found for this poster.");
      return;
    }
    
    let filename = "";
    if (poster.collectionName) {
      filename = `${poster.collectionName}.jpg`;
    } else if (poster.mediaType === "show") {
      if (poster.seasonNumber !== undefined && poster.seasonNumber !== null) {
        const paddedSeason = String(poster.seasonNumber).padStart(2, "0");
        filename = `${poster.title} - Season ${paddedSeason}.jpg`;
      } else {
        filename = `${poster.title}.jpg`;
      }
    } else {
      filename = `${poster.title} (${poster.year}).jpg`;
    }
    
    filename = filename.replace(/[\\/:*?"<>|]/g, "_");
    
    setDownloading(true);
    const toastId = toast.loading(`Preparing high-res download for Plex/Jellyfin...`);
    
    try {
      const base64Data = await getBase64Image({ data: downloadUrl });
      
      const link = document.createElement("a");
      link.href = base64Data;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success(`Downloaded: ${filename}`, { id: toastId });
      play("success");
    } catch (err) {
      console.error("Download failed:", err);
      toast.error("Failed to fetch image. Please try again.", { id: toastId });
    } finally {
      setDownloading(false);
    }
  };

  const [zoom, setZoom] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  // Exit animation state — keeps component mounted while fading out
  const [visible, setVisible] = useState(false);
  
  // Mobile bottom sheet state & touch swipe tracking
  const [showDetails, setShowDetails] = useState(false);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const currentY = e.touches[0].clientY;
    const deltaY = touchStartYRef.current - currentY;
    
    if (deltaY > 50 && !showDetails) {
      setShowDetails(true);
      triggerHaptic();
      touchStartYRef.current = null;
    } else if (deltaY < -50 && showDetails) {
      setShowDetails(false);
      triggerHaptic();
      touchStartYRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    touchStartYRef.current = null;
  };

  const handlePosterTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handlePosterTouchMove = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const currentY = e.touches[0].clientY;
    const deltaY = touchStartYRef.current - currentY;
    
    if (deltaY > 50) {
      setShowDetails(true);
      triggerHaptic();
      touchStartYRef.current = null;
    } else if (deltaY < -50) {
      handleClose();
      triggerHaptic();
      touchStartYRef.current = null;
    }
  };

  // Track whether last nav was via keyboard to skip slide animation
  const keyboardNavRef = useRef(false);
  const currentIndex = poster ? posters.findIndex((p) => p.id === poster.id) : -1;
  const prevPoster = currentIndex > 0 ? posters[currentIndex - 1] : null;
  const nextPoster = currentIndex < posters.length - 1 ? posters[currentIndex + 1] : null;
  const artistSocials = poster
    ? (poster.artists && poster.artists.length > 0
        ? (poster.artists.map((art) => art.url).filter(Boolean) as string[])
        : (poster.artistUrl ? [poster.artistUrl] : []))
    : [];

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

  // Track already loaded images to prevent flashing loading placeholder when navigating back/forward
  const loadedUrlsRef = useRef<Set<string>>(new Set());

  // Reset transient state on poster change
  const prevPosterIdRef = useRef<string | null>(null);
  useEffect(() => {
    setZoom(false);
    setCopied(false);
    setShowDetails(false);
    
    if (poster) {
      if (loadedUrlsRef.current.has(poster.image)) {
        setImageLoaded(true);
      } else {
        setImageLoaded(false);
      }

      if (prevPosterIdRef.current && prevPosterIdRef.current !== poster.id) {
        play("bloom");
      }
      prevPosterIdRef.current = poster.id;
    } else {
      setImageLoaded(false);
      prevPosterIdRef.current = null;
    }

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
  const skipAnimation = keyboardNavRef.current;  return (
    <div
      onClick={handleClose}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden md:overflow-y-auto px-0 py-0 md:px-8 md:py-8 transition-opacity duration-200"
      style={{
        backgroundColor: "rgba(18,18,18,0.95)",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {/* Mobile dimming overlay when details are open */}
      <div 
        onClick={() => {
          setShowDetails(false);
          triggerHaptic();
        }}
        className={`fixed inset-0 bg-black/60 transition-opacity duration-300 md:hidden z-20 ${
          showDetails ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

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
        className={`grid w-full h-full md:h-auto max-w-6xl gap-6 md:grid-cols-[3fr_2fr] ${
          skipAnimation ? "" : "animate-in fade-in zoom-in-95 duration-200 ease-out"
        }`}
      >
        <div 
          className="flex flex-col items-center justify-center w-full h-full md:h-auto py-4 md:py-0"
          onTouchStart={handlePosterTouchStart}
          onTouchMove={handlePosterTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="relative flex items-start justify-center group/nav w-full">
            {/* Previous Arrow Button Indicator */}
            {prevPoster && onNavigate && (
              <button
                onClick={() => { keyboardNavRef.current = false; onNavigate(prevPoster); }}
                aria-label="Previous Poster"
                className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 border border-white/10 text-white/70 backdrop-blur-md opacity-0 group-hover/nav:opacity-100 transition-all duration-150 hover:bg-black/80 hover:text-white active:scale-95 sm:flex hidden"
              >
                <span className="text-xs">←</span>
              </button>
            )}

            <div className={`relative flex items-center justify-center aspect-[2/3] max-h-[calc(100vh-120px)] md:max-h-[85vh] w-full max-w-[56.67vh] transition-all duration-300 rounded-xl ${
              !imageLoaded ? "bg-white/[0.02] border border-white/5" : "border border-transparent"
            }`}>
              <img
                key={poster.id}
                src={poster.image}
                alt={`${poster.title} (${poster.year})`}
                onLoad={() => {
                  setImageLoaded(true);
                  if (poster) {
                    loadedUrlsRef.current.add(poster.image);
                  }
                }}
                onClick={() => setZoom((z) => !z)}
                className={`max-h-[calc(100vh-120px)] md:max-h-[85vh] w-full cursor-zoom-in rounded-lg object-contain transition-all duration-200 ${
                  imageLoaded ? "opacity-100 scale-100" : "opacity-0 scale-95"
                }`}
                style={zoom ? { transform: "scale(1.25)", cursor: "zoom-out" } : undefined}
              />
              {!imageLoaded && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute w-20 h-20 rounded-full bg-[#FF6B6B]/5 blur-xl animate-pulse" />
                    <FilmReelIcon className="w-14 h-14 text-[#FF6B6B]/80 animate-spin" style={{ animationDuration: "3.5s" }} />
                  </div>
                  <span className="text-[10px] tracking-[0.25em] font-mono text-white/40 uppercase animate-pulse">
                    Loading Poster
                  </span>
                </div>
              )}
            </div>

            {/* Next Arrow Button Indicator */}
            {nextPoster && onNavigate && (
              <button
                onClick={() => { keyboardNavRef.current = false; onNavigate(nextPoster); }}
                aria-label="Next Poster"
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 border border-white/10 text-white/70 backdrop-blur-md opacity-0 group-hover/nav:opacity-100 transition-all duration-150 hover:bg-black/80 hover:text-white active:scale-95 sm:flex hidden"
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

        <div 
          className={`
            fixed bottom-0 left-0 right-0 z-30 bg-[#161616] border-t border-white/10 rounded-t-3xl shadow-[0_-12px_40px_rgba(0,0,0,0.6)] 
            transition-transform duration-300 ease-out flex flex-col max-h-[85vh]
            md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto md:bg-transparent md:border-none md:rounded-none md:shadow-none md:max-h-none md:transition-none md:translate-y-0
            ${showDetails ? "translate-y-0" : "translate-y-[calc(100%-80px)]"}
          `}
        >
          {/* Bottom Sheet Grab Header (visible on mobile only) */}
          <div 
            onClick={() => {
              setShowDetails(!showDetails);
              triggerHaptic();
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className={`flex flex-col items-center cursor-pointer md:hidden shrink-0 select-none ${
              showDetails ? "py-2.5" : "py-3.5 px-6 border-b border-white/[0.03]"
            }`}
          >
            {/* Grab Handle */}
            <div className="w-12 h-1.5 rounded-full bg-white/15" />
            
            {/* Peek Title & Arrow */}
            {!showDetails && (
              <div className="flex items-center justify-between w-full mt-3 animate-in fade-in duration-200">
                <div className="truncate flex-1 pr-4">
                  <span className="text-sm font-semibold text-[#F5F5F5]">{poster.title}</span>
                  <span className="text-xs text-white/40 ml-2">{poster.year}</span>
                </div>
                <span className="text-[10px] font-mono tracking-wider text-white/30 uppercase flex items-center gap-1.5">
                  Swipe up 
                  <span className="text-xs text-[#FF6B6B]">▲</span>
                </span>
              </div>
            )}
          </div>

          {/* Scrollable details container */}
          <div className="overflow-y-auto px-6 py-6 flex-grow md:overflow-visible md:px-0 md:py-0 flex flex-col gap-4">
            <div>
              <div className="flex items-start justify-between gap-4">
                <h2
                  style={{ fontFamily: "Poppins, sans-serif" }}
                  className="text-3xl font-semibold leading-tight text-[#F5F5F5] sm:text-4xl flex-1"
                >
                  {poster.title}
                </h2>
                {/* Swipe down indicator in line with the title (visible on mobile only when sheet is expanded) */}
                <button
                  onClick={() => {
                    setShowDetails(false);
                    triggerHaptic();
                  }}
                  className="md:hidden flex items-center gap-1.5 shrink-0 self-start mt-1.5 text-[9px] font-mono tracking-wider text-white/40 uppercase active:scale-95 transition-all select-none"
                >
                  <span>Swipe down</span>
                  <span className="text-[10px] text-[#FF6B6B]">▼</span>
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-white/55">
                <span className="font-medium text-white/80">{poster.year}</span>
                {(((poster.seasonNumber !== undefined && poster.seasonNumber !== null) || poster.collectionName) || poster.mediaType) && (
                  <>
                    <span className="text-white/20">•</span>
                    {poster.seasonNumber !== undefined && poster.seasonNumber !== null ? (
                      <span className="rounded bg-[#FF6B6B]/15 border border-[#FF6B6B]/25 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[#FF6B6B] font-semibold">
                        Season {poster.seasonNumber}
                      </span>
                    ) : poster.collectionName ? (
                      <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-white/70">
                        {poster.collectionName}
                      </span>
                    ) : (
                      <span className="text-xs text-white/50 capitalize font-medium">{poster.mediaType}</span>
                    )}
                  </>
                )}
                <span className="text-white/20">•</span>
                <div className="flex flex-wrap items-center text-xs text-white/50">
                  <span>{poster.style}</span>
                  {poster.genre.map((g) => (
                    <span key={g}>
                      <span className="mx-1 text-white/20">/</span>
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Structured Details Card */}
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-1 flex flex-col divide-y divide-white/5">
              {/* Artist Row */}
              <div className="grid grid-cols-[85px_1fr] items-center gap-4 py-3">
                <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">Artist</span>
                <div className="text-sm text-white/85">
                  {poster.artists && poster.artists.length > 0 ? (
                    poster.artists.map((art, idx) => (
                      <span key={idx} className="inline-flex items-center flex-wrap">
                        {idx > 0 && <span className="mx-1 text-white/40">&</span>}
                        <Link
                          to="/artist/$slug"
                          params={{ slug: slugifyArtist(art.name) }}
                          preload="intent"
                          className="font-medium text-[#F5F5F5] underline underline-offset-4 hover:text-[#FF6B6B] transition"
                        >
                          {art.name}
                        </Link>
                      </span>
                    ))
                  ) : (
                    <span className="inline-flex items-center flex-wrap">
                      <Link
                        to="/artist/$slug"
                        params={{ slug: slugifyArtist(poster.artist) }}
                        preload="intent"
                        className="font-medium text-[#F5F5F5] underline underline-offset-4 hover:text-[#FF6B6B] transition"
                      >
                        {poster.artist}
                      </Link>
                    </span>
                  )}
                </div>
              </div>

              {/* Artist Social Row */}
              {artistSocials.length > 0 && (
                <div className="grid grid-cols-[85px_1fr] items-center gap-4 py-3">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">Artist Social</span>
                  <div className="text-sm text-white/85 flex flex-wrap gap-x-3 gap-y-1">
                    {artistSocials.map((url, idx) => {
                      const displayLabel = (() => {
                        try {
                          const u = new URL(url);
                          return u.hostname.replace("www.", "");
                        } catch {
                          return "Portfolio";
                        }
                      })();
                      return (
                        <a
                          key={idx}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-[#F5F5F5] underline underline-offset-4 hover:text-[#FF6B6B] transition"
                        >
                          <span>{displayLabel}</span>
                          <ExternalLink size={11} className="opacity-50" />
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Source Row */}
              <div className="grid grid-cols-[85px_1fr] items-center gap-4 py-3">
                <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">Source</span>
                <div className="text-sm text-white/85">
                  {poster.sourceUrl ? (
                    <a
                      href={poster.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-[#F5F5F5] underline underline-offset-4 hover:text-[#FF6B6B] transition"
                    >
                      <span>{poster.source}</span>
                      <ExternalLink size={11} className="opacity-50" />
                    </a>
                  ) : (
                    <span className="text-[#F5F5F5]">{poster.source}</span>
                  )}
                </div>
              </div>

              {/* Databases Row */}
              {(poster.imdbId || poster.tmdbId) && (
                <div className="grid grid-cols-[85px_1fr] items-center gap-4 py-3">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">View On</span>
                  <div className="flex flex-wrap gap-2">
                    {poster.imdbId && (
                      <a
                        href={`https://www.imdb.com/title/${poster.imdbId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded bg-[#F5C518]/10 border border-[#F5C518]/20 px-2 py-0.5 text-[10px] font-semibold text-[#F5C518] hover:bg-[#F5C518]/20 active:scale-95 transition"
                      >
                        <ImdbIcon className="w-3 h-3 text-[#F5C518]" />
                        <span>IMDb</span>
                        <ExternalLink size={9} />
                      </a>
                    )}
                    {poster.tmdbId && (
                      <a
                        href={
                          poster.mediaType === "show"
                            ? `https://www.themoviedb.org/tv/${poster.tmdbId}`
                            : `https://www.themoviedb.org/movie/${poster.tmdbId}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded bg-[#01B4E4]/10 border border-[#01B4E4]/20 px-2 py-0.5 text-[10px] font-semibold text-[#01B4E4] hover:bg-[#01B4E4]/20 active:scale-95 transition"
                      >
                        <TmdbIcon className="w-3 h-3 text-[#01B4E4]" />
                        <span>TMDb</span>
                        <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Libraries Row */}
              {poster.libraryNames && poster.libraryNames.length > 0 && (
                <div className="grid grid-cols-[85px_1fr] items-center gap-4 py-3">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">Libraries</span>
                  <div className="flex flex-wrap gap-1.5">
                    {poster.libraryNames.map((lib) => (
                      <span
                        key={lib}
                        className="rounded bg-[#FF6B6B]/5 border border-[#FF6B6B]/25 px-2 py-0.5 text-[10px] font-medium text-[#FF6B6B]/90"
                      >
                        {lib}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {poster.note && (
              <p className="border-l-2 border-white/10 pl-3.5 italic text-sm text-white/50 leading-relaxed py-0.5">
                "{poster.note}"
              </p>
            )}

            {((!poster.artist || poster.artist.toLowerCase() === "unknown") ||
              (!poster.source || poster.source.toLowerCase() === "unknown")) && (
              <p className="text-[11px] leading-relaxed text-white/35">
                Know the artist or source of this poster? Reach out via socials on the{" "}
                <Link to="/about" className="text-white/60 underline hover:text-[#FF6B6B]">
                  About
                </Link>{" "}
                page so I can update the details!
              </p>
            )}

             <div className="mt-auto flex w-full gap-2 pt-4 md:w-auto md:flex-wrap">
              <button
                onClick={() => {
                  const wasSaved = saved;
                  toggle(poster.id);
                  if (!wasSaved) {
                    play("chime");
                  }
                }}
                className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-95 flex-1 md:flex-initial"
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
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-[#F5F5F5] transition-all duration-150 hover:border-white/30 active:scale-95 flex-1 md:flex-initial"
              >
                <Share2 size={16} />
                Share
              </button>
              <button
                onClick={handlePlexDownload}
                disabled={downloading}
                title="For personal, non-commercial media server use only."
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-[#F5F5F5] transition-all duration-150 hover:bg-white/10 active:scale-95 disabled:opacity-50 flex-1 md:flex-initial"
              >
                {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Download
              </button>
            </div>
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
