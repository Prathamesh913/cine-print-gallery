import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Poster } from "@/lib/posters";
import type { PosterImagePurpose, PosterImageResolver } from "@/lib/poster-images";
import { PosterImage, type PosterImageStatus } from "./PosterImage";

interface Props {
  poster: Poster;
  alt: string;
  purpose?: PosterImagePurpose;
  resolver?: Pick<PosterImageResolver, "getPosterImageCandidates">;
  /** CSS aspect-ratio reservation. Defaults to the poster 2:3 shape. */
  aspectRatio?: string;
  className?: string;
  imageClassName?: string;
  /** Above-the-fold images load eagerly with high priority. */
  priority?: boolean;
  loadTimeoutMs?: number;
  fallbackLabel?: string;
  onStatusChange?: (status: PosterImageStatus) => void;
}

/**
 * Aspect-ratio-stable image frame with a skeleton while loading and a neutral
 * unavailable state when every verified source fails. No Blob fallback and no
 * unrelated artwork is ever shown.
 */
export function PosterImageFrame({
  poster,
  alt,
  purpose = "gallery",
  resolver,
  aspectRatio = "2 / 3",
  className,
  imageClassName,
  priority = false,
  loadTimeoutMs,
  fallbackLabel,
  onStatusChange,
}: Props) {
  const [status, setStatus] = useState<PosterImageStatus>("loading");

  const handleStatusChange = (next: PosterImageStatus) => {
    setStatus(next);
    onStatusChange?.(next);
  };

  return (
    <div
      className={cn("relative overflow-hidden bg-neutral-200/70 dark:bg-neutral-800/70", className)}
      style={{ aspectRatio }}
      data-image-frame-status={status}
    >
      {status !== "error" && (
        <PosterImage
          poster={poster}
          purpose={purpose}
          resolver={resolver}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          loadTimeoutMs={loadTimeoutMs}
          onStatusChange={handleStatusChange}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
            status === "loaded" ? "opacity-100" : "opacity-0",
            imageClassName,
          )}
        />
      )}

      {status === "loading" && (
        <Skeleton
          aria-hidden="true"
          className="absolute inset-0 rounded-none motion-reduce:animate-none"
        />
      )}

      {status === "error" && (
        <div
          role="img"
          aria-label={fallbackLabel ?? alt}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-neutral-200/80 px-2 text-center text-neutral-500 dark:bg-neutral-800/80 dark:text-neutral-400"
        >
          <ImageOff aria-hidden="true" className="h-5 w-5" />
          <span className="text-[10px] font-medium uppercase tracking-wide">Image unavailable</span>
        </div>
      )}
    </div>
  );
}
