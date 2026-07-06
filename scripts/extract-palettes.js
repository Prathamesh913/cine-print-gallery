import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as JimpPkg from 'jimp';
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve Jimp instance in a cross-version compatible way
const Jimp = JimpPkg.Jimp || JimpPkg.default || JimpPkg;

const notionKey = process.env.NOTION_KEY || '';
const databaseId = process.env.NOTION_DATABASE_ID || '';

const CACHE_PATH = path.join(__dirname, '../src/lib/poster-palettes.json');

// Distance between two colors in RGB space
function getDistance(c1, c2) {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return dr * dr + dg * dg + db * db;
}

// Simple K-Means clustering to extract dominant colors
function extractPalette(pixels, k = 5, maxIterations = 10) {
  if (!pixels || pixels.length === 0) {
    return ['#121212', '#ffffff', '#888888', '#444444', '#aaaaaa'];
  }

  // 1. Initialize centroids by picking random pixels
  let centroids = [];
  const step = Math.max(1, Math.floor(pixels.length / k));
  for (let i = 0; i < k; i++) {
    const idx = Math.min((i * step) + Math.floor(Math.random() * Math.min(step, 10)), pixels.length - 1);
    centroids.push({ ...pixels[idx] });
  }

  // 2. Iterate clustering
  for (let iter = 0; iter < maxIterations; iter++) {
    const clusters = Array.from({ length: k }, () => []);

    // Assign each pixel to the closest centroid
    for (const pixel of pixels) {
      let minDist = Infinity;
      let closestCentroid = 0;
      for (let i = 0; i < k; i++) {
        const dist = getDistance(pixel, centroids[i]);
        if (dist < minDist) {
          minDist = dist;
          closestCentroid = i;
        }
      }
      clusters[closestCentroid].push(pixel);
    }

    // Update centroids
    let centroidsChanged = false;
    for (let i = 0; i < k; i++) {
      const cluster = clusters[i];
      if (cluster.length === 0) {
        // Re-initialize to a random pixel if the cluster becomes empty
        const randomPixel = pixels[Math.floor(Math.random() * pixels.length)];
        centroids[i] = { ...randomPixel };
        centroidsChanged = true;
        continue;
      }

      let rSum = 0, gSum = 0, bSum = 0;
      for (const p of cluster) {
        rSum += p.r;
        gSum += p.g;
        bSum += p.b;
      }

      const newCentroid = {
        r: Math.round(rSum / cluster.length),
        g: Math.round(gSum / cluster.length),
        b: Math.round(bSum / cluster.length),
        count: cluster.length
      };

      if (newCentroid.r !== centroids[i].r || newCentroid.g !== centroids[i].g || newCentroid.b !== centroids[i].b) {
        centroids[i] = newCentroid;
        centroidsChanged = true;
      } else {
        centroids[i].count = cluster.length;
      }
    }

    if (!centroidsChanged) break;
  }

  // 3. Sort centroids by number of pixels assigned (descending)
  centroids.sort((a, b) => (b.count || 0) - (a.count || 0));

  return centroids.map(c => ({ r: c.r, g: c.g, b: c.b }));
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function rgbToHsl({ r, g, b }) {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
      case gNorm: h = (bNorm - rNorm) / d + 2; break;
      case bNorm: h = (rNorm - gNorm) / d + 4; break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

async function main() {
  console.log('--- Starting Color Palette Extraction ---');

  // Load existing cache
  let paletteCache = {};
  if (fs.existsSync(CACHE_PATH)) {
    try {
      paletteCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
      console.log(`Loaded ${Object.keys(paletteCache).length} cached poster palettes.`);
    } catch (e) {
      console.warn('Failed to parse existing cache, resetting cache file.', e);
    }
  }

  if (!notionKey || !databaseId) {
    console.warn('NOTION_KEY or NOTION_DATABASE_ID missing. Skipping live extraction.');
    // Ensure file exists even if empty, so imports don't crash
    if (!fs.existsSync(CACHE_PATH)) {
      fs.writeFileSync(CACHE_PATH, JSON.stringify({}, null, 2));
      console.log('Created empty palettes JSON placeholder.');
    }
    return;
  }

  try {
    const notion = new Client({ auth: notionKey });

    console.log('Querying Notion database...');
    // Retrieve database properties first to fetch data sources if needed (exactly matching notion.ts)
    const db = await notion.databases.retrieve({ database_id: databaseId });
    const dataSources = db.data_sources;

    let results = [];
    if (dataSources && dataSources.length > 0) {
      const dataSourceId = dataSources[0].id;
      const response = await notion.dataSources.query({
        data_source_id: dataSourceId,
        filter: {
          property: 'Status',
          select: { equals: 'Published' }
        }
      });
      results = response.results;
    } else {
      // Fallback direct query on database container
      const response = await notion.databases.query({
        database_id: databaseId,
        filter: {
          property: 'Status',
          select: { equals: 'Published' }
        }
      });
      results = response.results;
    }

    console.log(`Found ${results.length} published items from Notion.`);

    // Extract raw poster items (similar to notion.ts parsing)
    const postersToProcess = [];
    for (const page of results) {
      const props = page.properties;
      const imageUrlProp = props['Image URL'];
      let imageUrls = [];

      if (imageUrlProp) {
        if (imageUrlProp.type === 'url' && imageUrlProp.url) {
          imageUrls.push(imageUrlProp.url);
        } else if (imageUrlProp.type === 'rich_text' && imageUrlProp.rich_text?.length > 0) {
          const text = imageUrlProp.rich_text[0].plain_text || '';
          imageUrls = text.split(/[\n,]+/).map(u => u.trim()).filter(Boolean);
        } else if (imageUrlProp.type === 'files' && imageUrlProp.files?.length > 0) {
          imageUrls = imageUrlProp.files.map(f => f.file?.url || f.external?.url || '').filter(Boolean);
        }
      }

      imageUrls.forEach((url, index) => {
        const id = index === 0 ? page.id : `${page.id}-${index}`;
        postersToProcess.push({ id, imageUrl: url });
      });
    }

    console.log(`Resolved to ${postersToProcess.length} individual images.`);

    let updatedCount = 0;
    for (const poster of postersToProcess) {
      // Skip if already in cache and has correct structure
      if (paletteCache[poster.id] && paletteCache[poster.id].palette && paletteCache[poster.id].primary) {
        continue;
      }

      console.log(`Processing image for poster ID ${poster.id}...`);
      try {
        // Load image
        const image = await Jimp.read(poster.imageUrl);
        
        // Resize image to small dimensions to optimize color extraction performance
        // Handle Jimp v0 and v1 resize signature differences
        if (typeof image.resize === 'function') {
          try {
            image.resize(64, 64);
          } catch (resizeErr) {
            image.resize({ w: 64, h: 64 });
          }
        }

        // Scan pixels
        const width = image.bitmap.width;
        const height = image.bitmap.height;
        const data = image.bitmap.data;
        const pixels = [];

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          // Skip highly transparent pixels if any
          if (a > 120) {
            pixels.push({ r, g, b });
          }
        }

        // Quantize colors using K-Means
        const rawPalette = extractPalette(pixels, 5, 10);
        const hexPalette = rawPalette.map(rgbToHex);
        const primaryRGB = rawPalette[0] || { r: 18, g: 18, b: 18 };
        const primaryHex = rgbToHex(primaryRGB);
        const hslVal = rgbToHsl(primaryRGB);

        paletteCache[poster.id] = {
          palette: hexPalette,
          primary: primaryHex,
          hsl: hslVal
        };

        updatedCount++;
        // Add a slight delay to respect external host rate limits
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        console.error(`Failed to process image ${poster.imageUrl} for poster ${poster.id}:`, err.message);
      }
    }

    // Save cache back to file
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(paletteCache, null, 2));
    console.log(`Cache updated. Added/Updated ${updatedCount} poster palettes. Total items in cache: ${Object.keys(paletteCache).length}.`);
  } catch (err) {
    console.error('Error during Notion database fetching or color processing:', err);
    // Write empty placeholder if it doesn't exist to prevent compile crashes
    if (!fs.existsSync(CACHE_PATH)) {
      fs.writeFileSync(CACHE_PATH, JSON.stringify({}, null, 2));
    }
  }
}

main().catch(console.error);
