export type ImageLoadStatus = "loading" | "loaded" | "error";

export interface ImageLoadState {
  key: string | null;
  status: ImageLoadStatus;
}

export const INITIAL_IMAGE_LOAD_STATE: ImageLoadState = {
  key: null,
  status: "loading",
};

/**
 * Derive the load status from the actual image element. This catches images
 * that completed before React attached onLoad/onError (for example, an image
 * already cached by the detail hero).
 */
export function statusFromImage(
  image: Pick<HTMLImageElement, "complete" | "naturalWidth"> | null,
): ImageLoadStatus {
  if (!image || !image.complete) return "loading";
  return image.naturalWidth > 0 ? "loaded" : "error";
}

/**
 * State is scoped to an image key so a previous image's loaded/error state can
 * never leak into a new poster, zoom variant or URL.
 */
export function imageStatusForKey(
  state: ImageLoadState,
  key: string | null,
): ImageLoadStatus {
  if (!key) return "loading";
  return state.key === key ? state.status : "loading";
}

export function withImageStatus(key: string, status: ImageLoadStatus): ImageLoadState {
  return { key, status };
}
