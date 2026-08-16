const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const ORIGINAL_PATH_PATTERN = /^\/cineprint\/raindrop\/(\d+)\.[^/]+$/;

export function optimizedPathFor(documentId: string, originalUrl: string): string | null {
  try {
    const url = new URL(originalUrl);

    if (!url.hostname.endsWith(BLOB_HOST_SUFFIX)) {
      return null;
    }

    const match = ORIGINAL_PATH_PATTERN.exec(url.pathname);
    if (!match) {
      return null;
    }

    const raindropId = match[1];

    if (documentId.startsWith("artwork-")) {
      return `cineprint/optimized/${raindropId}.webp`;
    }

    return `cineprint/optimized/legacy/${documentId}.webp`;
  } catch {
    return null;
  }
}

export function optimizedUrlFor(documentId: string, originalUrl: string): string | null {
  const path = optimizedPathFor(documentId, originalUrl);

  if (!path) {
    return null;
  }

  const original = new URL(originalUrl);
  return `${original.origin}/${path}`;
}
