import { type Poster } from "./posters";
import { getBase64Image } from "./notion";

/**
 * Loads an image from a URL and returns an HTMLImageElement.
 * Uses crossOrigin = "anonymous" to prevent canvas taint.
 */
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
 * Generates a PNG blob for a vintage-style ticket representing the poster.
 */
export async function generateTicketBlob(poster: Poster): Promise<Blob> {
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

  const width = 1000;
  const height = 460;
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

  // 1. Draw background card (cream/vintage paper)
  ctx.fillStyle = "#F5EAD4";
  ctx.fillRect(0, 0, width, height);

  // 2. Draw outer border line
  ctx.strokeStyle = "#2b261d";
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, width - 24, height - 24);

  // Inner thin border line
  ctx.strokeStyle = "rgba(43, 38, 29, 0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(18, 18, width - 36, height - 36);

  // 3. Draw Ticket Stub Cutouts (to look like holes punched at the ends of the tear line)
  // We use dark page background color #121212 to simulate transparency cutout
  ctx.fillStyle = "#121212";
  
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
  ctx.strokeStyle = "#2b261d";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(340, 22);
  ctx.lineTo(340, height - 22);
  ctx.stroke();
  ctx.setLineDash([]); // Reset dash pattern

  // 5. Left Side: Stub content
  try {
    let src = poster.image;
    if (src.startsWith("http://") || src.startsWith("https://")) {
      try {
        src = await getBase64Image({ data: src });
      } catch (err) {
        console.warn("Failed to proxy image via server, trying direct load:", err);
      }
    }
    const img = await loadImage(src);
    // Draw image centered in the stub area (width ~300)
    ctx.save();
    
    const imgW = 210;
    const imgH = 315; // 2:3 aspect ratio
    const imgX = 65;
    const imgY = 50;

    // Draw card background for the image to simulate paper frame
    ctx.fillStyle = "rgba(43, 38, 29, 0.05)";
    ctx.fillRect(imgX - 4, imgY - 4, imgW + 8, imgH + 8);
    ctx.strokeStyle = "#2b261d";
    ctx.lineWidth = 1;
    ctx.strokeRect(imgX - 4, imgY - 4, imgW + 8, imgH + 8);

    ctx.drawImage(img, imgX, imgY, imgW, imgH);
    ctx.restore();
  } catch (e) {
    console.error("Failed to load poster image for canvas:", e);
    // Fallback: draw placeholder box if image fails to load
    ctx.strokeStyle = "#2b261d";
    ctx.lineWidth = 2;
    ctx.strokeRect(65, 50, 210, 315);
    ctx.fillStyle = "#2b261d";
    ctx.font = '14px "Poppins", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("IMAGE CARRIER", 170, 210);
  }

  // Footer on stub side
  ctx.fillStyle = "#2b261d";
  ctx.font = '10px "Poppins", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("PRINTED BY CINEPRINT", 170, 410);

  // 6. Right Side: Ticket Body
  const textCenterX = 670; // Center of body (340 + 330)

  // Header: Theatre Name
  ctx.font = 'bold 52px "Bebas Neue", sans-serif';
  ctx.fillStyle = "#2b261d";
  ctx.textAlign = "center";
  ctx.fillText("CINEPRINT GALLERY", textCenterX, 95);

  // Subheader: Retro tags
  ctx.font = '600 11px "Poppins", sans-serif';
  ctx.fillText("( ADMIT ONE )", textCenterX, 130);

  // Text instruction
  ctx.font = 'italic 15px "Poppins", sans-serif';
  ctx.fillStyle = "rgba(43, 38, 29, 0.75)";
  ctx.fillText("Please allow 1 Person To See", textCenterX, 180);

  // Divider line
  ctx.strokeStyle = "rgba(43, 38, 29, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(390, 195);
  ctx.lineTo(950, 195);
  ctx.stroke();

  // Large Movie Title
  let fontSize = 48;
  ctx.font = `bold ${fontSize}px "Bebas Neue", sans-serif`;
  ctx.fillStyle = "#2b261d";
  const maxTitleWidth = 540;
  const titleText = poster.title.toUpperCase();
  
  // Scale down font size if title is too long
  while (ctx.measureText(titleText).width > maxTitleWidth && fontSize > 20) {
    fontSize -= 3;
    ctx.font = `bold ${fontSize}px "Bebas Neue", sans-serif`;
  }
  ctx.fillText(titleText, textCenterX, 245);

  // Release Info (Artist & Year)
  ctx.font = '600 13px "Poppins", sans-serif';
  ctx.fillStyle = "rgba(43, 38, 29, 0.7)";
  ctx.fillText(`BY ${poster.artist.toUpperCase()}  ·  ${poster.year}`, textCenterX, 285);

  // Showtime listing
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = "#2b261d";
  ctx.fillText("2-30, 5-45 & 9-00 P.M. SHOWS", textCenterX, 340);

  // Ticket fields footer
  ctx.font = '13px monospace';
  ctx.fillStyle = "rgba(43, 38, 29, 0.8)";
  ctx.fillText(`WEEK: ${String(weekNum).padStart(2, '0')}    SHOW: ${showTime}    DAY: ${dayName}`, textCenterX, 400);

  // Apply paper texture overlay (fibers, grain, gradients)
  applyPaperTexture(ctx, width, height);

  // Return canvas as blob
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
