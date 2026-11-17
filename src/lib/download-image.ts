import type { Poster } from "./posters";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export function imageExtensionFromUrl(url: string): string | null {
  try {
    const extension = new URL(url).pathname.split(".").pop()?.toLowerCase();
    if (extension && IMAGE_EXTENSIONS.has(extension)) {
      return extension === "jpeg" ? "jpg" : extension;
    }
  } catch {
    // Fall through to the default extension.
  }
  return null;
}

export function imageExtensionFromDataUrl(dataUrl: string): string | null {
  const match = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(dataUrl);
  if (!match) return null;
  const subtype = match[1].toLowerCase();
  if (subtype === "jpeg") return "jpg";
  return IMAGE_EXTENSIONS.has(subtype) ? subtype : null;
}

export function downloadExtension(url: string, dataUrl?: string): string {
  return (
    imageExtensionFromUrl(url) ?? (dataUrl ? imageExtensionFromDataUrl(dataUrl) : null) ?? "jpg"
  );
}

/** Map a verified image URL to its delivery metadata. Never constructs a URL. */
export function sourceForImageUrl(
  kind: "original" | "optimized",
  url: string,
): {
  kind: "original" | "optimized";
  url: string;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  extension: "jpg" | "png" | "webp" | "gif";
} | null {
  const extension = imageExtensionFromUrl(url) as "jpg" | "png" | "webp" | "gif" | null;
  if (!extension) return null;
  if (kind === "optimized" && extension !== "webp") return null;
  const contentType =
    extension === "jpg"
      ? "image/jpeg"
      : extension === "png"
        ? "image/png"
        : extension === "webp"
          ? "image/webp"
          : "image/gif";
  return { kind, url, contentType, extension };
}

/** Same-origin delivery endpoint. The server re-resolves and verifies the source. */
export const POSTER_DOWNLOAD_PATH = "/__poster-download";

export function posterDownloadHref(posterId: string, kind: "original" | "optimized"): string {
  return `${POSTER_DOWNLOAD_PATH}?id=${encodeURIComponent(posterId)}&kind=${kind}`;
}

/** Clean, descriptive base name derived only from catalogue identity fields. */
export function posterDownloadBaseName(poster: Poster): string {
  let name = "";
  if (poster.collectionName) {
    name = poster.collectionName;
  } else if (
    poster.mediaType === "show" &&
    poster.seasonNumber !== undefined &&
    poster.seasonNumber !== null
  ) {
    name = `${poster.title} - Season ${String(poster.seasonNumber).padStart(2, "0")}`;
  } else {
    name = `${poster.title} (${poster.year})`;
  }
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || poster.id;
}

export function posterDownloadFilename(
  poster: Poster,
  source: { kind: "original" | "optimized"; extension: string },
): string {
  return `${posterDownloadBaseName(poster)}-${source.kind}.${source.extension}`;
}
