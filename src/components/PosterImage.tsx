import { forwardRef, useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import type { Poster } from "@/lib/posters";
import {
  getPosterImageFallbackUrl,
  getPosterImageUrl,
  type PosterImagePurpose,
} from "@/lib/poster-images";

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  poster: Poster;
  purpose?: PosterImagePurpose;
}

export const PosterImage = forwardRef<HTMLImageElement, Props>(function PosterImage(
  { poster, purpose = "gallery", onError, decoding, ...props },
  ref,
) {
  const optimizedUrl = getPosterImageUrl(poster, purpose);
  const fallbackUrl = getPosterImageFallbackUrl(poster);
  const [src, setSrc] = useState(optimizedUrl);
  const fallbackAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    setSrc(optimizedUrl);
    fallbackAttemptedRef.current = null;
  }, [optimizedUrl]);

  return (
    <img
      {...props}
      ref={ref}
      src={src}
      decoding={decoding ?? "async"}
      onError={(event) => {
        if (src !== fallbackUrl && fallbackAttemptedRef.current !== fallbackUrl) {
          fallbackAttemptedRef.current = fallbackUrl;
          setSrc(fallbackUrl);
          return;
        }
        onError?.(event);
      }}
    />
  );
});
