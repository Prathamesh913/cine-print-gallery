import { forwardRef, useEffect, useState, type ImgHTMLAttributes } from "react";
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

  useEffect(() => {
    setSrc(optimizedUrl);
  }, [optimizedUrl]);

  return (
    <img
      {...props}
      ref={ref}
      src={src}
      decoding={decoding ?? "async"}
      onError={(event) => {
        if (src !== fallbackUrl) {
          setSrc(fallbackUrl);
          return;
        }
        onError?.(event);
      }}
    />
  );
});
