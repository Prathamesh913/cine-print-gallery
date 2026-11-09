import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from "react";
import type { Poster } from "@/lib/posters";
import {
  POSTER_UNAVAILABLE_URL,
  getPosterImageCandidates,
  type PosterImagePurpose,
  type PosterImageResolver,
} from "@/lib/poster-images";

export type PosterImageStatus = "loading" | "loaded" | "error";

const DEFAULT_LOAD_TIMEOUT_MS = 15_000;

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  poster: Poster;
  purpose?: PosterImagePurpose;
  /** Optional resolver injection for local preview/test harnesses. */
  resolver?: Pick<PosterImageResolver, "getPosterImageCandidates">;
  /** Bounded time before a pending candidate is treated as failed. 0 disables. */
  loadTimeoutMs?: number;
  /** Receives every status transition for the rendered source. */
  onStatusChange?: (status: PosterImageStatus) => void;
  /** Called when every candidate has failed. */
  onTerminalError?: () => void;
}

export const PosterImage = forwardRef<HTMLImageElement, Props>(function PosterImage(
  {
    poster,
    purpose = "gallery",
    onError,
    onLoad,
    onTerminalError,
    onStatusChange,
    decoding,
    resolver,
    loadTimeoutMs,
    ...props
  },
  forwardedRef,
) {
  const candidates = (resolver?.getPosterImageCandidates ?? getPosterImageCandidates)(
    poster,
    purpose,
  );
  const candidatesKey = candidates.join("|");
  const unavailable = candidates.length === 0;
  // Lazy grid images may wait a long time for the browser to request them.
  // Timing those out would swap small thumbnails to full-size originals before
  // the request even starts, so lazy images only use an explicit timeout.
  const explicitTimeout = loadTimeoutMs !== undefined;
  const effectiveTimeoutMs =
    loadTimeoutMs ?? (props.loading === "lazy" ? 0 : DEFAULT_LOAD_TIMEOUT_MS);
  const [src, setSrc] = useState(candidates[0] ?? POSTER_UNAVAILABLE_URL);
  const [status, setStatus] = useState<PosterImageStatus>("loading");
  const candidateIndexRef = useRef(0);
  const handledFailureRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const terminalErrorRef = useRef(onTerminalError);
  const statusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    terminalErrorRef.current = onTerminalError;
    statusChangeRef.current = onStatusChange;
  }, [onTerminalError, onStatusChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const transition = useCallback((next: PosterImageStatus) => {
    if (!mountedRef.current) return;
    setStatus(next);
    statusChangeRef.current?.(next);
  }, []);

  const setRefs = useCallback(
    (node: HTMLImageElement | null) => {
      imgRef.current = node;
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [forwardedRef],
  );

  useEffect(() => {
    candidateIndexRef.current = 0;
    handledFailureRef.current = null;
    setSrc(candidates[0] ?? POSTER_UNAVAILABLE_URL);
    transition("loading");
    if (candidates.length === 0) terminalErrorRef.current?.();
  }, [candidatesKey, transition]);

  /**
   * Advances at most once per failed source. Returns true when no candidate
   * remains, so callers can emit the terminal error exactly once.
   */
  const failCurrent = useCallback(
    (currentSrc: string): boolean => {
      if (!mountedRef.current) return true;
      if (handledFailureRef.current === currentSrc) return false;
      handledFailureRef.current = currentSrc;

      const currentIndex = candidates.indexOf(currentSrc);
      const index = currentIndex >= 0 ? currentIndex : candidateIndexRef.current;
      const next = candidates[index + 1];
      if (next) {
        candidateIndexRef.current = index + 1;
        transition("loading");
        setSrc(next);
        return false;
      }
      transition("error");
      return true;
    },
    [candidatesKey, transition],
  );

  const settleLoaded = useCallback(
    async (image: HTMLImageElement, event: React.SyntheticEvent<HTMLImageElement>) => {
      if (!mountedRef.current) return;
      if (typeof image.decode === "function") {
        try {
          await image.decode();
        } catch {
          if (!mountedRef.current) return;
          const terminal = failCurrent(image.currentSrc || image.src);
          if (terminal) terminalErrorRef.current?.();
          return;
        }
      }
      if (!mountedRef.current) return;
      transition("loaded");
      onLoad?.(event);
    },
    [failCurrent, onLoad, transition],
  );

  const handleLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      void settleLoaded(event.currentTarget, event);
    },
    [settleLoaded],
  );

  const handleError = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      const terminal = failCurrent(image.currentSrc || image.src);
      if (terminal) {
        onError?.(event);
        terminalErrorRef.current?.();
      }
    },
    [failCurrent, onError],
  );

  // React's synthetic error event can be missed when an image is already cached
  // or fails before the handler attaches. Native listeners plus the complete
  // check make candidate advancement reliable without retrying in a loop.
  useEffect(() => {
    const image = imgRef.current;
    if (!image) return;

    const onNativeError = () => {
      const terminal = failCurrent(image.currentSrc || image.src);
      if (terminal) terminalErrorRef.current?.();
    };

    if (image.complete && image.naturalWidth === 0) {
      onNativeError();
    }

    image.addEventListener("error", onNativeError);
    return () => image.removeEventListener("error", onNativeError);
  }, [src, failCurrent]);

  // A stalled request must not leave the component loading forever. Lazy images
  // that have not started loading yet are left alone: failing them would swap
  // small thumbnails to full-size originals before the browser even requests
  // them. Only an image with a selected source that has not completed counts as
  // stalled.
  useEffect(() => {
    if (!effectiveTimeoutMs || status !== "loading") return;
    const timer = setTimeout(() => {
      const image = imgRef.current;
      if (!image) return;
      // Explicit timeouts (preview/failure fixtures) apply even if a lazy image
      // has not selected a source yet. Default timeouts only apply once loading
      // has actually started.
      if (!image.currentSrc && !explicitTimeout) return;
      if (image.complete && image.naturalWidth > 0) return;
      const terminal = failCurrent(image.currentSrc || image.src);
      if (terminal) terminalErrorRef.current?.();
    }, effectiveTimeoutMs);
    return () => clearTimeout(timer);
  }, [src, status, effectiveTimeoutMs, explicitTimeout, failCurrent]);

  // Intentionally unavailable identities render the local neutral asset instead
  // of a broken image, Blob URL, or unrelated poster. Never emit an empty src.
  const resolvedAlt = unavailable
    ? props.alt === ""
      ? ""
      : props.alt?.trim()
        ? `Image unavailable: ${props.alt}`
        : "Image unavailable"
    : props.alt;

  return (
    <img
      {...props}
      alt={resolvedAlt}
      data-poster-unavailable-id={unavailable ? poster.id : undefined}
      ref={setRefs}
      src={src}
      data-image-status={status}
      decoding={decoding ?? "async"}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
});
