import { useEffect, useState } from "react";
import { X, Copy, Download, Share2, Printer, Loader2 } from "lucide-react";
import { type Poster } from "@/lib/posters";
import { generateTicketBlob } from "@/lib/ticket";
import { toast } from "sonner";
import { useCornerSmoothing } from "@/lib/smoothing";
import { play } from "cuelume";

interface Props {
  poster: Poster | null;
  onClose: () => void;
}

export function ShareModal({ poster, onClose }: Props) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Exit animation state
  const [visible, setVisible] = useState(false);
  const ticketSmoothing = useCornerSmoothing<HTMLDivElement>(16, 60);

  const [tiltStyle, setTiltStyle] = useState<React.CSSProperties>({
    transform: "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)",
    transition: "transform 0.5s ease",
  });

  const [glareStyle, setGlareStyle] = useState<React.CSSProperties>({
    opacity: 0,
    background: "radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0) 80%)",
  });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const xc = x / rect.width - 0.5;
    const yc = 0.5 - y / rect.height;

    const maxRotate = 15;
    const rotateX = yc * maxRotate;
    const rotateY = xc * maxRotate;

    const glareX = (x / rect.width) * 100;
    const glareY = (y / rect.height) * 100;

    setTiltStyle({
      transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`,
      transition: "transform 0.05s ease-out",
    });

    setGlareStyle({
      opacity: 1,
      background: `radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 80%)`,
    });
  };

  const handleMouseLeave = () => {
    setTiltStyle({
      transform: "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)",
      transition: "transform 0.5s ease-in-out",
    });
    setGlareStyle({
      opacity: 0,
      background: "radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0) 80%)",
    });
  };

  useEffect(() => {
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    if (!isTouch) return;

    let initialBeta: number | null = null;
    let initialGamma: number | null = null;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const { beta, gamma } = e;
      if (beta === null || gamma === null) return;

      if (initialBeta === null) initialBeta = beta;
      if (initialGamma === null) initialGamma = gamma;

      const maxTilt = 15;
      const deltaBeta = Math.min(Math.max(beta - initialBeta, -maxTilt), maxTilt);
      const deltaGamma = Math.min(Math.max(gamma - initialGamma, -maxTilt), maxTilt);

      const rotateX = deltaBeta;
      const rotateY = -deltaGamma;

      const lightX = 50 + (deltaGamma / maxTilt) * 50;
      const lightY = 50 + (deltaBeta / maxTilt) * 50;

      setTiltStyle({
        transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`,
        transition: "transform 0.1s ease-out",
      });
      setGlareStyle({
        opacity: 0.8,
        background: `radial-gradient(circle at ${lightX}% ${lightY}%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 80%)`,
      });
    };

    const enableGyro = () => {
      const reqPermission = (DeviceOrientationEvent as any).requestPermission;
      if (typeof reqPermission === "function") {
        reqPermission()
          .then((state: string) => {
            if (state === "granted") {
              window.addEventListener("deviceorientation", handleOrientation);
            }
          })
          .catch(console.error);
      } else {
        window.addEventListener("deviceorientation", handleOrientation);
      }
      window.removeEventListener("touchstart", enableGyro);
    };

    window.addEventListener("touchstart", enableGyro);

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
      window.removeEventListener("touchstart", enableGyro);
    };
  }, []);

  useEffect(() => {
    if (poster) {
      requestAnimationFrame(() => setVisible(true));
    }
  }, [!!poster]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  useEffect(() => {
    if (!poster) return;

    setLoading(true);
    setBlob(null);
    setImageUrl("");

    let active = true;

    generateTicketBlob(poster)
      .then((b) => {
        if (!active) return;
        setBlob(b);
        setImageUrl(URL.createObjectURL(b));
        setLoading(false);
        play("sparkle");
      })
      .catch((err) => {
        console.error(err);
        if (active) {
          toast.error("Failed to generate ticket");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [poster]);

  // Clean up object URL when modal is closed
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  if (!poster) return null;

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `${poster.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-ticket.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success("Ticket downloaded successfully");
  };

  const handlePrint = () => {
    if (!imageUrl) return;
    const printWindow = window.open("");
    if (!printWindow) {
      toast.error("Popup blocked. Please allow popups to print.");
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Print CinePrint Ticket - ${poster.title}</title>
          <style>
            body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background-color: #121212; }
            img { max-width: 100%; max-height: 100%; object-fit: contain; }
            @media print {
              body { background-color: #ffffff; }
              img { max-width: 100%; max-height: 100%; }
            }
          </style>
        </head>
        <body>
          <img src="${imageUrl}" onload="window.print(); window.close();" />
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleCopy = async () => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob,
        }),
      ]);
      setCopied(true);
      toast.success("Ticket image copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
      toast.error("Clipboard copy blocked. Try downloading instead.");
    }
  };

  const handleShare = async () => {
    if (!blob) return;
    setSharing(true);
    try {
      const file = new File([blob], "ticket.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${poster.title} — CinePrint Ticket`,
          text: `Check out this retro ticket for ${poster.title} on CinePrint! ${window.location.origin}`,
        });
      } else {
        // Fallback: Copy current window URL
        await navigator.clipboard.writeText(window.location.href);
        toast.success("Link copied! Share API not supported on this device.");
      }
    } catch (err) {
      // User cancelled or share failed
      if ((err as Error).name !== "AbortError") {
        toast.error("Could not share ticket");
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <div
      onClick={handleClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8 backdrop-blur-sm transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-[#181818] p-6 shadow-2xl"
      >
        <button
          onClick={handleClose}
          aria-label="Close"
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-white/5 text-[#F5F5F5] transition-all duration-150 hover:bg-white/10 active:scale-90"
        >
          <X size={16} />
        </button>

        <h3 style={{ fontFamily: "Poppins, sans-serif" }} className="mb-1 text-lg font-semibold text-[#F5F5F5]">
          Poster Ticket
        </h3>
        <p className="mb-6 text-xs text-white/50">Save or share this ticket of {poster.title}</p>

        {/* Ticket Container */}
        <div className="flex min-h-[220px] items-center justify-center rounded-xl bg-black/40 p-4 border border-white/5">
          {loading ? (
            <div className="flex flex-col items-center gap-2 text-white/60">
              <Loader2 className="animate-spin" size={24} />
              <span className="text-xs">Printing Ticket...</span>
            </div>
          ) : imageUrl ? (
            <div 
              ref={ticketSmoothing.ref}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              style={{ ...tiltStyle, ...ticketSmoothing.style }}
              className="w-full overflow-hidden shadow-lg border border-white/8 relative group cursor-pointer select-none"
            >
              <img src={imageUrl} alt="Retro Ticket Preview" className="h-auto w-full object-contain pointer-events-none" />
              {/* Dynamic light reflection glare overlay */}
              <div 
                style={glareStyle}
                className="absolute inset-0 pointer-events-none transition-opacity duration-300"
              />
            </div>
          ) : (
            <div className="text-sm text-white/40">Failed to render ticket preview.</div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            onClick={handleCopy}
            disabled={loading || !blob}
            className={`inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-[#F5F5F5] transition-all duration-150 hover:bg-white/10 active:scale-95 disabled:opacity-50 ${
              copied ? "scale-110" : "scale-100"
            }`}
          >
            <Copy size={16} />
            {copied ? "Copied!" : "Copy Image"}
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || !imageUrl}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-[#F5F5F5] transition-all duration-150 hover:bg-white/10 active:scale-95 disabled:opacity-50"
          >
            <Download size={16} />
            Download
          </button>
          <button
            onClick={handlePrint}
            disabled={loading || !imageUrl}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-[#F5F5F5] transition-all duration-150 hover:bg-white/10 active:scale-95 disabled:opacity-50"
          >
            <Printer size={16} />
            Print Ticket
          </button>
          <button
            onClick={handleShare}
            disabled={loading || !blob || sharing}
            className="inline-flex items-center gap-2 rounded-full bg-[#FF6B6B] px-5 py-2 text-sm font-medium text-[#121212] transition-all duration-150 hover:bg-[#FF8585] active:scale-95 disabled:opacity-50"
          >
            {sharing ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                Sharing...
              </>
            ) : (
              <>
                <Share2 size={16} />
                Share Ticket
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
