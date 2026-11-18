/**
 * Shared visual helpers for collection detail heroes (artist and film pages).
 *
 * The glow is built from the build-time palette cache, so it adds no network
 * requests and no runtime image decoding. Kept in one place so the artist and
 * film heroes cannot drift apart visually.
 */
import posterPalettesRaw from "@/lib/poster-palettes.json";
import type { Poster } from "./posters";

const posterPalettes = posterPalettesRaw as Record<
  string,
  { palette: string[]; primary: string; hsl: { h: number; s: number; l: number } }
>;

/** Fallback tint when a poster id is missing from the build-time palette data. */
const FALLBACK_PRIMARY = { hex: "#FF6B6B", rgb: [255, 107, 107] as const };

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    const [r, g, b] = FALLBACK_PRIMARY.rgb;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** Up to four distinct primaries, ordered by frequency then saturation. */
function collectPrimaries(posters: Poster[]): string[] {
  const seen = new Map<string, { hex: string; count: number; sat: number }>();

  for (const poster of posters) {
    const entry = posterPalettes[poster.id];
    if (!entry?.primary) continue;
    const key = entry.primary.toLowerCase();
    const found = seen.get(key);
    if (found) {
      found.count += 1;
      if ((entry.hsl?.s ?? 0) > found.sat) found.sat = entry.hsl?.s ?? 0;
    } else {
      seen.set(key, { hex: entry.primary.toUpperCase(), count: 1, sat: entry.hsl?.s ?? 0 });
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.count - a.count || b.sat - a.sat)
    .slice(0, 4)
    .map((entry) => entry.hex);
}

const SPOTS = ["82% 20%", "60% 85%", "98% 65%", "40% 0%"];
const ALPHAS = [0.28, 0.18, 0.14, 0.1];

/** Static decorative CSS: one low-alpha radial gradient per primary on black. */
export function buildGlowBackground(posters: Poster[]): string {
  return collectPrimaries(posters)
    .map((hex, i) => {
      const rx = `${34 + i * 8}rem`;
      const ry = `${22 + i * 5}rem`;
      return `radial-gradient(${rx} ${ry} at ${SPOTS[i % SPOTS.length]}, ${hexToRgba(
        hex,
        ALPHAS[i] ?? 0.08,
      )} 0%, transparent 68%)`;
    })
    .join(", ");
}
