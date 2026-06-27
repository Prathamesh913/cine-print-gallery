import { useEffect, useState } from "react";
import { X, Copy, Download, Share2, Printer, Loader2 } from "lucide-react";
import { type Poster } from "@/lib/posters";
import { generateTicketBlob } from "@/lib/ticket";
import { toast } from "sonner";

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
          text: `Check out this retro ticket for ${poster.title}!`,
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
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-8 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-[#181818] p-6 shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-white/5 text-[#F5F5F5] transition hover:bg-white/10"
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
            <div className="w-full overflow-hidden rounded-lg shadow-lg border border-[#2b261d]/10">
              <img src={imageUrl} alt="Retro Ticket Preview" className="h-auto w-full object-contain" />
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
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-[#F5F5F5] transition hover:bg-white/10 disabled:opacity-50"
          >
            <Copy size={16} />
            {copied ? "Copied!" : "Copy Image"}
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || !imageUrl}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-[#F5F5F5] transition hover:bg-white/10 disabled:opacity-50"
          >
            <Download size={16} />
            Download
          </button>
          <button
            onClick={handlePrint}
            disabled={loading || !imageUrl}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-[#F5F5F5] transition hover:bg-white/10 disabled:opacity-50"
          >
            <Printer size={16} />
            Print Ticket
          </button>
          <button
            onClick={handleShare}
            disabled={loading || !blob || sharing}
            className="inline-flex items-center gap-2 rounded-full bg-[#FF6B6B] px-5 py-2 text-sm font-medium text-[#121212] transition hover:bg-[#FF8585] disabled:opacity-50"
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
