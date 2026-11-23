import { type Poster } from "./posters";
import { getBase64Image } from "./notion";

/**
 * Loads an image from a URL and returns an HTMLImageElement.
 * Uses crossOrigin = "anonymous" to prevent canvas taint.
 */
export type TicketOrientation = "landscape" | "portrait";

export type TicketStyle = "vintage" | "midnight" | "poster";

/** Color + copy slots that vary between ticket styles. */
interface TicketTheme {
  /** Card background fill. */
  paper: string;
  /** Second card color for the diagonal gradient blend; null keeps the card flat. */
  paper2: string | null;
  /** Primary ink for headings, the tear line, and placeholder strokes. */
  ink: string;
  /** Outer border stroke. */
  borderOuter: string;
  /** Inner hairline border stroke. */
  borderInner: string;
  /** Italic instruction line. */
  textSoft: string;
  /** Artist / year credit line. */
  textCredit: string;
  /** Monospace footer fields. */
  textFields: string;
  /** Backdrop plate behind the poster print. */
  frameFill: string;
  /** Keyline around the poster print. */
  frameStroke: string;
  /** Stub brand line and tagline accent. */
  brand: string;
  /** Dashed tear / stub separator lines. */
  tearLine: string;
  /** Showtime strip. */
  showtime: string;
  /** Paint-chip swatches printed under the stub footer; null when unused. */
  swatches: string[] | null;
  /** Subheader tag under the gallery name; null when the theme omits it. */
  tagline: string | null;
  /** Draw the gold pass serial on the stub (Midnight only). */
  showSerial: boolean;
}

const VINTAGE_THEME: TicketTheme = {
  paper: "#F5EAD4",
  paper2: null,
  ink: "#2b261d",
  borderOuter: "#2b261d",
  borderInner: "rgba(43, 38, 29, 0.35)",
  textSoft: "rgba(43, 38, 29, 0.75)",
  textCredit: "rgba(43, 38, 29, 0.7)",
  textFields: "rgba(43, 38, 29, 0.8)",
  frameFill: "rgba(43, 38, 29, 0.05)",
  frameStroke: "#2b261d",
  brand: "#2b261d",
  tearLine: "#2b261d",
  showtime: "#2b261d",
  swatches: null,
  tagline: "( ADMIT ONE )",
  showSerial: false,
};

/** Midnight Premiere: warm near-black pass, cream ink, brass-gold accents. */
const MIDNIGHT_THEME: TicketTheme = {
  paper: "#161209",
  // Slightly darker, less warm corner for a subtle single-hue gradient.
  paper2: "#0d0b07",
  ink: "#F0E6CE",
  borderOuter: "#C9A961",
  borderInner: "rgba(201, 169, 97, 0.4)",
  textSoft: "rgba(240, 230, 206, 0.72)",
  textCredit: "rgba(201, 169, 97, 0.95)",
  textFields: "rgba(240, 230, 206, 0.68)",
  frameFill: "rgba(201, 169, 97, 0.1)",
  frameStroke: "#C9A961",
  brand: "#C9A961",
  tearLine: "#F0E6CE",
  showtime: "#F0E6CE",
  swatches: null,
  tagline: null,
  showSerial: true,
};

/** HSL conversion used when deriving a per-poster palette. */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

const HUE_BUCKETS = 12;

/** A hue cluster accumulated while sampling the poster. */
interface HueCluster {
  /** Weighted mean hue in degrees. */
  hue: number;
  /** Weighted mean saturation, 0..1. */
  sat: number;
  /** Weighted mean lightness, 0..1. */
  lum: number;
  /** Accumulated pixel weight. */
  weight: number;
}

/** Circular distance between two hues in degrees. */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Downsamples the poster image and accumulates its chroma into hue
 * clusters, sorted by weight. Returns null when the image is missing,
 * unreadable (tainted canvas), or carries no usable chroma (grayscale).
 */
function extractHueClusters(img: HTMLImageElement | null): HueCluster[] | null {
  if (!img) return null;
  try {
    // Downsample so a few thousand pixels carry the palette.
    const sw = 48;
    const sh = 72;
    const sample = document.createElement("canvas");
    sample.width = sw;
    sample.height = sh;
    const sctx = sample.getContext("2d", { willReadFrequently: true });
    if (!sctx) return null;
    sctx.drawImage(img, 0, 0, sw, sh);
    const { data } = sctx.getImageData(0, 0, sw, sh);

    // Weight pixels by saturation, peaking at mid lightness, bucketed by
    // hue. Neutrals, near-blacks and blown-out highlights are ignored —
    // we want the poster's chroma, not its grays.
    const weights = new Array<number>(HUE_BUCKETS).fill(0);
    const hueSums = new Array<number>(HUE_BUCKETS).fill(0);
    const satSums = new Array<number>(HUE_BUCKETS).fill(0);
    const lumSums = new Array<number>(HUE_BUCKETS).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s < 0.15 || l < 0.08 || l > 0.92) continue;
      const weight = s * 4 * l * (1 - l);
      if (weight <= 0) continue;
      const bucket = Math.min(HUE_BUCKETS - 1, Math.floor(h / (360 / HUE_BUCKETS)));
      weights[bucket] += weight;
      hueSums[bucket] += h * weight;
      satSums[bucket] += s * weight;
      lumSums[bucket] += l * weight;
    }

    const clusters: HueCluster[] = [];
    for (let b = 0; b < HUE_BUCKETS; b++) {
      if (weights[b] <= 0) continue;
      clusters.push({
        hue: hueSums[b] / weights[b],
        sat: satSums[b] / weights[b],
        lum: lumSums[b] / weights[b],
        weight: weights[b],
      });
    }
    if (clusters.length === 0) return null;
    clusters.sort((a, b) => b.weight - a.weight);
    return clusters;
  } catch {
    // Tainted canvas or extraction failure.
    return null;
  }
}

/**
 * Derives a Midnight-style theme from the poster's palette:
 *  - the accent (borders, keyline, tagline, serial) takes the dominant hue,
 *  - a clearly separated secondary hue, when present, colors the tear line
 *    and showtime strip,
 *  - up to three well-separated clusters print as paint-chip swatches on
 *    the stub.
 * Returns null when the image is missing, mostly grayscale, or unreadable
 * (tainted canvas) so the caller falls back to the brass-gold Midnight theme.
 */
function derivePosterTheme(img: HTMLImageElement | null): TicketTheme | null {
  const clusters = extractHueClusters(img);
  if (!clusters) return null;
  const primary = clusters[0];

  // Secondary: the heaviest cluster clearly separated in hue from the
  // primary, holding enough weight that a real accent region — not a
  // stray speck — drives it. The list is weight-sorted, so the first hit
  // wins and the scan stops at the first underweight cluster.
  let secondary: HueCluster | null = null;
  const secondaryFloor = Math.max(primary.weight * 0.08, 25);
  for (const c of clusters.slice(1)) {
    if (c.weight < secondaryFloor) break;
    if (hueDistance(c.hue, primary.hue) < 60) continue;
    secondary = c;
    break;
  }
  const secondaryHue = secondary ? secondary.hue : primary.hue;

  // Paint chips: up to three clusters at least 30° apart, shown at their
  // sampled saturation/lightness clamped into a visible band.
  const chips: string[] = [];
  const chipHues: number[] = [];
  for (const c of clusters) {
    if (chips.length >= 3) break;
    if (chipHues.some((h) => hueDistance(h, c.hue) < 30)) continue;
    const s = Math.min(80, Math.max(35, c.sat * 100));
    const l = Math.min(70, Math.max(30, c.lum * 100));
    chips.push(`hsl(${c.hue.toFixed(1)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`);
    chipHues.push(c.hue);
  }

  // Accent lightness stays in a readable band on the near-black card.
  const accent = (hue: number, s: number, l: number, a = 1) =>
    `hsla(${hue.toFixed(1)}, ${s}%, ${l}%, ${a})`;
  return {
    // Card gradient: the primary hue's near-black toward the secondary's
    // (or a darker shade of the primary when no secondary exists).
    paper: accent(primary.hue, 32, 7),
    paper2: secondary ? accent(secondary.hue, 26, 6) : accent(primary.hue, 20, 4),
    ink: "#F0E6CE",
    borderOuter: accent(primary.hue, 55, 62),
    borderInner: accent(primary.hue, 55, 62, 0.4),
    textSoft: "rgba(240, 230, 206, 0.72)",
    textCredit: accent(primary.hue, 60, 68, 0.95),
    textFields: "rgba(240, 230, 206, 0.68)",
    frameFill: accent(primary.hue, 55, 62, 0.1),
    frameStroke: accent(primary.hue, 55, 62),
    brand: accent(primary.hue, 55, 62),
    tearLine: accent(secondaryHue, 55, 62),
    showtime: accent(secondaryHue, 55, 66),
    swatches: chips,
    tagline: null,
    showSerial: true,
  };
}

/** Poster-palette accent for UI chrome (ShareModal tinting). */
export interface PosterAccent {
  /** Dominant hue in degrees, 0..360. */
  hue: number;
  /** Readable accent color built from the hue, e.g. "hsla(216, 55%, 62%)". */
  color: string;
}

/**
 * Derives the poster-palette accent used to tint UI chrome around a
 * "poster" style ticket — the same dominant hue the ticket itself renders
 * with. Grayscale posters and images that fail to load fall back to the
 * brass-gold Midnight accent, mirroring the ticket's own fallback.
 */
export async function derivePosterAccent(poster: Poster): Promise<PosterAccent> {
  const img = await loadPosterImage(poster);
  const clusters = extractHueClusters(img);
  if (!clusters) {
    // Brass gold #C9A961 ≈ hue 41, matching the ticket's fallback render.
    return { hue: 41, color: MIDNIGHT_THEME.borderOuter };
  }
  const hue = clusters[0].hue;
  return { hue, color: `hsla(${hue.toFixed(1)}, 55%, 62%)` };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    if (src.startsWith("http://") || src.startsWith("https://")) {
      img.crossOrigin = "anonymous";
      const separator = src.includes("?") ? "&" : "?";
      img.src = `${src}${separator}notion-cors-bypass=${Date.now()}`;
    } else {
      img.src = src;
    }

    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
  });
}

/**
 * Loads the poster print for canvas use, proxying remote URLs through the
 * server when possible. Returns null when the image fails to load; callers
 * render their placeholder fallback.
 */
async function loadPosterImage(poster: Poster): Promise<HTMLImageElement | null> {
  try {
    let src = poster.image;
    if (src.startsWith("http://") || src.startsWith("https://")) {
      try {
        src = await getBase64Image({ data: src });
      } catch (err) {
        console.warn("Failed to proxy image via server, trying direct load:", err);
      }
    }
    return await loadImage(src);
  } catch (e) {
    console.error("Failed to load poster image for canvas:", e);
    return null;
  }
}

/**
 * Generates a PNG blob for a ticket representing the poster.
 * Landscape renders a wide stub with the print alongside the metadata;
 * portrait stacks a larger print above metadata that is vertically centered.
 * The `style` argument selects the visual theme: "vintage" is the aged
 * cream paper stub, "midnight" is the near-black premiere pass with
 * brass-gold accents, and "poster" recolors the midnight pass with the
 * dominant hue sampled from the poster image.
 */
export async function generateTicketBlob(
  poster: Poster,
  orientation: TicketOrientation = "landscape",
  style: TicketStyle = "vintage",
): Promise<Blob> {
  // Ensure fonts are loaded before drawing on canvas
  if (typeof document !== "undefined") {
    await document.fonts.ready;
  }

  // Get current date/time values for the ticket
  const now = new Date();
  const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const dayName = days[now.getDay()];

  // Calculate week of the year
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const pastDaysOfYear = (now.getTime() - startOfYear.getTime()) / 86400000;
  const weekNum = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);

  // Determine show based on time
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeVal = hours + minutes / 60;
  let showTime = "09:00 PM";
  if (timeVal <= 14.5) {
    showTime = "02:30 PM";
  } else if (timeVal <= 17.75) {
    showTime = "05:45 PM";
  }

  const width = orientation === "portrait" ? 460 : 1000;
  const height = orientation === "portrait" ? 1000 : 460;
  const scale = 3; // 3x scale up for high-resolution ticket output
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get 2D context");
  }

  // Scale the context coordinate system to match base coordinates
  ctx.scale(scale, scale);

  // Load the poster print first: the "poster" style derives its palette from
  // the image pixels, and both layouts draw from the same element.
  const posterImg = await loadPosterImage(poster);

  const theme =
    style === "vintage"
      ? VINTAGE_THEME
      : style === "poster"
        ? (derivePosterTheme(posterImg) ?? MIDNIGHT_THEME)
        : MIDNIGHT_THEME;

  // 1. Draw background card — a diagonal gradient blend when the theme
  // carries a second card color (same axis as the finish sheen), flat fill
  // otherwise.
  if (theme.paper2) {
    const card = ctx.createLinearGradient(0, 0, width, height);
    card.addColorStop(0, theme.paper);
    card.addColorStop(1, theme.paper2);
    ctx.fillStyle = card;
  } else {
    ctx.fillStyle = theme.paper;
  }
  ctx.fillRect(0, 0, width, height);

  // 2. Draw outer border line
  ctx.strokeStyle = theme.borderOuter;
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, width - 24, height - 24);

  // Inner thin border line
  ctx.strokeStyle = theme.borderInner;
  ctx.lineWidth = 1;
  ctx.strokeRect(18, 18, width - 36, height - 36);

  // 3. Draw Ticket Stub Cutouts (to look like holes punched at the ends of the tear line)
  // We use dark page background color #000000 to simulate transparency cutout
  ctx.fillStyle = "#000000";

  if (orientation === "portrait") {
    // Tear line runs horizontally; punch its ends where it meets the edges,
    // plus top/bottom center notches for the vintage look.
    const tearY = 560;
    ctx.beginPath();
    ctx.arc(0, tearY, 20, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(width, tearY, 20, Math.PI / 2, -Math.PI / 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(width / 2, 0, 22, 0, Math.PI);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(width / 2, height, 22, Math.PI, 0);
    ctx.fill();

    // Dashed tear line
    ctx.strokeStyle = theme.tearLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(22, tearY);
    ctx.lineTo(width - 22, tearY);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Top cutout at stub line (x = 340)
    ctx.beginPath();
    ctx.arc(340, 0, 22, 0, Math.PI);
    ctx.fill();

    // Bottom cutout at stub line (x = 340)
    ctx.beginPath();
    ctx.arc(340, height, 22, Math.PI, 0);
    ctx.fill();

    // Draw punch notches on the left and right edges for vintage look
    ctx.beginPath();
    ctx.arc(0, height / 2, 20, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(width, height / 2, 20, Math.PI / 2, -Math.PI / 2);
    ctx.fill();

    // 4. Draw Dashed stub separator line
    ctx.strokeStyle = theme.tearLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(340, 22);
    ctx.lineTo(340, height - 22);
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash pattern
  }

  if (orientation === "portrait") {
    drawPortraitBody(ctx, posterImg, poster, theme, { dayName, weekNum, showTime });
    if (style === "vintage") {
      applyPaperTexture(ctx, width, height);
    } else {
      applyMidnightFinish(ctx, width, height);
    }
    return blobFromCanvas(canvas);
  }

  // 5. Left Side: Stub content
  drawFramedPoster(ctx, posterImg, theme, 65, 50, 210, 315);
  if (!posterImg) {
    // Fallback: draw placeholder box if image fails to load
    ctx.strokeStyle = theme.frameStroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(65, 50, 210, 315);
    ctx.fillStyle = theme.ink;
    ctx.font = '14px "Poppins", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("IMAGE CARRIER", 170, 210);
  }

  // Footer on stub side
  ctx.fillStyle = theme.brand;
  ctx.font = '10px "Poppins", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("PRINTED BY CINEPRINT", 170, 390);
  if (theme.showSerial) {
    // Pass serial, stable per poster title
    ctx.font = "9px monospace";
    ctx.fillText(passSerial(poster, weekNum), 170, 406);
  }
  drawSwatches(ctx, theme, 170, 418);

  // 6. Right Side: Ticket Body
  const textCenterX = 670; // Center of body (340 + 330)

  // Header: Theatre Name
  ctx.font = 'bold 52px "Bebas Neue", sans-serif';
  ctx.fillStyle = theme.ink;
  ctx.textAlign = "center";
  ctx.fillText("CINEPRINT GALLERY", textCenterX, 95);

  // Subheader tag, when the theme carries one
  if (theme.tagline) {
    ctx.font = '600 11px "Poppins", sans-serif';
    ctx.fillStyle = theme.brand;
    ctx.fillText(theme.tagline, textCenterX, 130);
  }

  // Text instruction — subtitle to the masthead
  ctx.font = 'italic 15px "Poppins", sans-serif';
  ctx.fillStyle = theme.textSoft;
  ctx.fillText("Please allow 1 Person To See", textCenterX, 148);

  // Large Movie Title
  let fontSize = 48;
  ctx.font = `bold ${fontSize}px "Bebas Neue", sans-serif`;
  ctx.fillStyle = theme.ink;
  const maxTitleWidth = 540;
  const titleText = poster.title.toUpperCase();

  // Scale down font size if title is too long
  while (ctx.measureText(titleText).width > maxTitleWidth && fontSize > 20) {
    fontSize -= 3;
    ctx.font = `bold ${fontSize}px "Bebas Neue", sans-serif`;
  }
  ctx.fillText(titleText, textCenterX, 212);

  // Release Info (Artist & Year) — coupled to the title
  ctx.font = '600 13px "Poppins", sans-serif';
  ctx.fillStyle = theme.textCredit;
  ctx.fillText(`BY ${poster.artist.toUpperCase()}  ·  ${poster.year}`, textCenterX, 252);

  // Showtime listing — operational footer cluster (level with the stub
  // branding block), separated from the title unit by a deliberate pause
  ctx.font = "bold 18px monospace";
  ctx.fillStyle = theme.showtime;
  ctx.fillText("2-30, 5-45 & 9-00 P.M. SHOWS", textCenterX, 340);

  // Ticket fields footer
  ctx.font = "13px monospace";
  ctx.fillStyle = theme.textFields;
  ctx.fillText(
    `WEEK: ${String(weekNum).padStart(2, "0")}    SHOW: ${showTime}    DAY: ${dayName}`,
    textCenterX,
    400,
  );

  // Apply the finish overlay for the selected style
  if (style === "vintage") {
    applyPaperTexture(ctx, width, height);
  } else {
    applyMidnightFinish(ctx, width, height);
  }

  return blobFromCanvas(canvas);
}

interface TicketDateInfo {
  dayName: string;
  weekNum: number;
  showTime: string;
}

/** Prints the theme's paint-chip swatches as a centered row on the stub. */
function drawSwatches(
  ctx: CanvasRenderingContext2D,
  theme: TicketTheme,
  centerX: number,
  y: number,
) {
  const chips = theme.swatches;
  if (!chips || chips.length === 0) return;
  const size = 9;
  const gap = 6;
  const totalW = chips.length * size + (chips.length - 1) * gap;
  let x = centerX - totalW / 2;
  ctx.save();
  for (const chip of chips) {
    ctx.fillStyle = chip;
    ctx.fillRect(x, y, size, size);
    // Hairline outline so light chips stay visible on the dark card.
    ctx.strokeStyle = "rgba(240, 230, 206, 0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    x += size + gap;
  }
  ctx.restore();
}

/** Draws the poster inside its framed plate; no-op when the image failed to load. */
function drawFramedPoster(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  theme: TicketTheme,
  imgX: number,
  imgY: number,
  imgW: number,
  imgH: number,
) {
  if (!img) return;
  ctx.save();
  // Draw card background for the image to simulate the framed plate
  ctx.fillStyle = theme.frameFill;
  ctx.fillRect(imgX - 4, imgY - 4, imgW + 8, imgH + 8);
  ctx.strokeStyle = theme.frameStroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(imgX - 4, imgY - 4, imgW + 8, imgH + 8);
  ctx.drawImage(img, imgX, imgY, imgW, imgH);
  ctx.restore();
}

function fitBebasTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  maxTitleWidth: number,
  startSize: number,
) {
  let fontSize = startSize;
  ctx.font = `bold ${fontSize}px "Bebas Neue", sans-serif`;
  while (ctx.measureText(title).width > maxTitleWidth && fontSize > 20) {
    fontSize -= 3;
    ctx.font = `bold ${fontSize}px "Bebas Neue", sans-serif`;
  }
}

/**
 * Portrait stub: the print sits above a horizontal tear line, enlarged
 * relative to the landscape stub; the metadata block below is centered
 * vertically within the remaining space.
 */
function drawPortraitBody(
  ctx: CanvasRenderingContext2D,
  posterImg: HTMLImageElement | null,
  poster: Poster,
  theme: TicketTheme,
  { dayName, weekNum, showTime }: TicketDateInfo,
) {
  const width = 460;
  const tearY = 560;
  const centerX = width / 2;

  // Enlarged print compared to landscape mode (210x315 -> 300x450)
  const imgW = 300;
  const imgH = 450;
  const imgX = (width - imgW) / 2;
  // Raised a touch above the top notch so the footer block below the print
  // keeps clear of the tear line.
  const imgY = 38;
  drawFramedPoster(ctx, posterImg, theme, imgX, imgY, imgW, imgH);
  if (!posterImg) {
    ctx.strokeStyle = theme.frameStroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(imgX, imgY, imgW, imgH);
    ctx.fillStyle = theme.ink;
    ctx.font = '14px "Poppins", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("IMAGE CARRIER", centerX, imgY + imgH / 2);
  }

  // Footer on the stub side, under the print
  ctx.fillStyle = theme.brand;
  ctx.font = '10px "Poppins", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("PRINTED BY CINEPRINT", centerX, imgY + imgH + 18);
  if (theme.showSerial) {
    // Pass serial, stable per poster title
    ctx.font = "9px monospace";
    ctx.fillText(passSerial(poster, weekNum), centerX, imgY + imgH + 33);
  }
  drawSwatches(ctx, theme, centerX, imgY + imgH + 44);

  // Metadata block, vertically centered between the tear line and the inner border
  const blockTop = tearY + 8;
  const blockBottom = 982;
  // Vertical center of the region below the tear line; the metadata block is
  // centered on this.
  const regionCenter = blockTop + (blockBottom - blockTop) / 2;

  // Header: Theatre Name
  ctx.font = 'bold 36px "Bebas Neue", sans-serif';
  ctx.fillStyle = theme.ink;
  ctx.textAlign = "center";
  ctx.fillText("CINEPRINT GALLERY", centerX, regionCenter - 128);

  // Subheader tag, when the theme carries one
  if (theme.tagline) {
    ctx.font = '600 9px "Poppins", sans-serif';
    ctx.fillStyle = theme.brand;
    ctx.fillText(theme.tagline, centerX, regionCenter - 98);
  }

  // Text instruction — subtitle to the masthead
  ctx.font = 'italic 12px "Poppins", sans-serif';
  ctx.fillStyle = theme.textSoft;
  ctx.fillText("Please allow 1 Person To See", centerX, regionCenter - 76);

  // Large Movie Title
  const titleText = poster.title.toUpperCase();
  fitBebasTitle(ctx, titleText, 360, 38);
  ctx.fillStyle = theme.ink;
  ctx.fillText(titleText, centerX, regionCenter - 14);

  // Release Info (Artist & Year) — coupled to the title
  ctx.font = '600 10px "Poppins", sans-serif';
  ctx.fillStyle = theme.textCredit;
  ctx.fillText(`BY ${poster.artist.toUpperCase()}  ·  ${poster.year}`, centerX, regionCenter + 24);

  // Showtime listing — operational footer cluster, separated from the
  // title unit by a deliberate pause
  ctx.font = "bold 13px monospace";
  ctx.fillStyle = theme.showtime;
  ctx.fillText("2-30, 5-45 & 9-00 P.M. SHOWS", centerX, regionCenter + 88);

  // Ticket fields footer
  ctx.font = "10px monospace";
  ctx.fillStyle = theme.textFields;
  ctx.fillText(
    `WEEK: ${String(weekNum).padStart(2, "0")}    SHOW: ${showTime}    DAY: ${dayName}`,
    centerX,
    regionCenter + 132,
  );
}

function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Failed to export canvas to Blob"));
      }
    }, "image/png");
  });
}

/**
 * Derives a stable pseudo serial number from the poster title so each
 * Midnight Premiere pass carries its own number across regenerations.
 */
function passSerial(poster: Poster, weekNum: number): string {
  let hash = 0;
  for (let i = 0; i < poster.title.length; i++) {
    hash = (hash * 31 + poster.title.charCodeAt(i)) >>> 0;
  }
  const serial = (hash % 900) + 100; // 100-999
  return `PASS Nº ${serial} · WEEK ${String(weekNum).padStart(2, "0")}`;
}

/**
 * Draws the Midnight Premiere finish: a permanent metallic sheen — a
 * specular light-sweep band and top-left hotspot like light catching a
 * metal sheet, fine brushed streaks along the light axis, faint grain,
 * and a soft vignette for depth. No fibers or crumple creases — the card
 * reads as a fresh brushed-metal pass, not aged paper.
 */
function applyMidnightFinish(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();

  // 1. Fine grain specks (barely-there texture so flat black isn't dead)
  ctx.fillStyle = "rgba(240, 230, 206, 0.025)";
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    ctx.fillRect(x, y, 1, 1);
  }

  // 2. Brushed-metal streaks: fine parallel micro-lines along the light
  // axis (top-left to bottom-right), alternating light and dark.
  const angle = Math.atan2(height, width);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let i = 0; i < 150; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const len = Math.random() * 110 + 40;
    ctx.strokeStyle = i % 4 === 3 ? "rgba(0, 0, 0, 0.03)" : "rgba(255, 248, 225, 0.035)";
    ctx.lineWidth = Math.random() * 0.6 + 0.4;
    ctx.beginPath();
    ctx.moveTo(x - (dx * len) / 2, y - (dy * len) / 2);
    ctx.lineTo(x + (dx * len) / 2, y + (dy * len) / 2);
    ctx.stroke();
  }

  // 3. Specular sweep: a bright diagonal band, like light sliding across a
  // metal sheet, with a second fainter band behind it.
  const sheen = ctx.createLinearGradient(0, 0, width, height);
  sheen.addColorStop(0, "rgba(255, 248, 225, 0.06)");
  sheen.addColorStop(0.17, "rgba(255, 248, 225, 0.13)");
  sheen.addColorStop(0.3, "rgba(255, 248, 225, 0.02)");
  sheen.addColorStop(0.45, "rgba(255, 248, 225, 0)");
  sheen.addColorStop(0.62, "rgba(255, 248, 225, 0)");
  sheen.addColorStop(0.74, "rgba(255, 248, 225, 0.06)");
  sheen.addColorStop(0.86, "rgba(255, 248, 225, 0)");
  sheen.addColorStop(1, "rgba(255, 248, 225, 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);

  // 4. Hotspot: a soft radial pool of light near the top-left, where the
  // hover glare pools on the live preview.
  const hotspot = ctx.createRadialGradient(
    width * 0.24,
    height * 0.2,
    0,
    width * 0.24,
    height * 0.2,
    width * 0.45,
  );
  hotspot.addColorStop(0, "rgba(255, 248, 225, 0.1)");
  hotspot.addColorStop(1, "rgba(255, 248, 225, 0)");
  ctx.fillStyle = hotspot;
  ctx.fillRect(0, 0, width, height);

  // 5. Vignette: darken the edges so the sheet has physical presence
  const radius = Math.hypot(width, height) / 2;
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    radius * 0.35,
    width / 2,
    height / 2,
    radius,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.4)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
}

/**
 * Draws procedural paper texture overlay onto canvas.
 * Simulates organic paper pulp, recycled fibers, and 3D crumple shading.
 */
function applyPaperTexture(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();

  // 1. Draw paper fiber threads (more visible and thicker)
  ctx.strokeStyle = "rgba(43, 38, 29, 0.09)";
  for (let i = 0; i < 1100; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const len = Math.random() * 6 + 4;
    const angle = Math.random() * Math.PI * 2;
    ctx.lineWidth = Math.random() * 0.75 + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  // 2. Draw fine paper grain dots (increased opacity)
  ctx.fillStyle = "rgba(43, 38, 29, 0.035)";
  for (let i = 0; i < 15000; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const size = Math.random() * 1.5 + 0.5;
    ctx.fillRect(x, y, size, size);
  }

  // 3. Draw larger pulp flecks (organic specs of recycled paper)
  ctx.fillStyle = "rgba(43, 38, 29, 0.12)";
  for (let i = 0; i < 150; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const radius = Math.random() * 1.25 + 0.75;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Draw paper crease folds (illusion of crumpled ticket)
  // Crease 1 (diagonal)
  ctx.strokeStyle = "rgba(43, 38, 29, 0.05)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(150, 0);
  ctx.lineTo(650, height);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.moveTo(147, 0);
  ctx.lineTo(647, height);
  ctx.stroke();

  // Crease 2 (vertical-ish)
  ctx.strokeStyle = "rgba(43, 38, 29, 0.04)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(550, 0);
  ctx.lineTo(510, height);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.beginPath();
  ctx.moveTo(546, 0);
  ctx.lineTo(506, height);
  ctx.stroke();

  // 5. Draw lighting gradient overlay for 3D paper shadow/highlight depth
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.08)"); // Soft highlight top-left
  grad.addColorStop(0.4, "rgba(255, 255, 255, 0.0)");
  grad.addColorStop(0.7, "rgba(0, 0, 0, 0.0)");
  grad.addColorStop(1, "rgba(43, 38, 29, 0.18)"); // Stronger shadow bottom-right
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
}
