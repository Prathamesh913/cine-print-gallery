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
    imageExtensionFromUrl(url) ??
    (dataUrl ? imageExtensionFromDataUrl(dataUrl) : null) ??
    "jpg"
  );
}
