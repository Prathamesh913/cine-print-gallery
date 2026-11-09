import fs from "node:fs";
import path from "node:path";
import { R2_IMAGE_MAP } from "../src/lib/r2-image-map.generated";
import { createPosterImageResolver } from "../src/lib/poster-images";
import type { PreviewData, PreviewEntry } from "./preview-r2-app";

const ARTIFACT_DIR = "/tmp/opencode/phase12c";
const CANARIES = new Set(["2001-a-space-odyssey", "bugonia", "artwork-1824607248"]);

const resolver = createPosterImageResolver(R2_IMAGE_MAP, {
  browserEnabled: true,
  seoEnabled: false,
  downloadsEnabled: false,
});

const entries: PreviewEntry[] = Object.keys(R2_IMAGE_MAP)
  .sort()
  .map((id) => ({ id, canary: CANARIES.has(id) }));

const inventory = entries.map(({ id, canary }) => {
  const entry = R2_IMAGE_MAP[id];
  return {
    id,
    canary,
    blobImageUrl: entry.blobImageUrl,
    optimizedUrl: entry.optimizedUrl,
    originalUrl: entry.originalUrl,
    optimizedKey: entry.optimizedKey,
    originalKey: entry.originalKey,
    candidates: resolver.getPosterImageCandidates(
      {
        id,
        title: id,
        year: 0,
        artist: "",
        source: "",
        sourceUrl: "",
        image: entry.blobImageUrl,
        style: "Minimalist",
        genre: [],
        tags: [],
      },
      "gallery",
    ),
  };
});

const previewData: PreviewData = { entries };

const css = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: #111; color: #f5f5f5; font: 14px/1.4 system-ui, sans-serif; }
h1 { font-size: 18px; font-weight: 600; margin: 0 0 6px; }
p { color: #aaa; margin: 0 0 20px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 16px; }
.card { margin: 0; }
.poster-frame { position: relative; overflow: hidden; background: #1e1e1e; border-radius: 8px; }
.poster-frame img { display: block; width: 100%; height: 100%; object-fit: cover; }
.poster-frame img[data-image-status="loading"] { opacity: 0; }
.poster-frame img[data-image-status="loaded"] { opacity: 1; transition: opacity 200ms ease; }
.poster-frame > div[aria-hidden="true"] { position: absolute; inset: 0; background: rgba(255,255,255,.06); animation: pulse 1.6s ease-in-out infinite; }
.poster-frame [role="img"] { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 8px; text-align: center; background: #262626; color: #a3a3a3; }
.poster-frame [role="img"] svg { width: 20px; height: 20px; }
.poster-frame [role="img"] span { font-size: 10px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; }
figcaption { margin-top: 6px; font-size: 11px; color: #aaa; overflow-wrap: anywhere; }
@media (prefers-reduced-motion: reduce) {
  .poster-frame img { transition: none; }
  .poster-frame > div[aria-hidden="true"] { animation: none; }
}
@media (prefers-color-scheme: light) {
  :root { color-scheme: light; }
  body { background: #fafafa; color: #171717; }
  p, figcaption { color: #525252; }
  .poster-frame { background: #e5e5e5; }
  .poster-frame > div[aria-hidden="true"] { background: rgba(0,0,0,.06); }
  .poster-frame [role="img"] { background: #e5e5e5; color: #525252; }
}
@keyframes pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
`;

function page({
  title,
  pageName,
  body,
  data,
}: {
  title: string;
  pageName: "preview" | "failures" | "unmount";
  body: string;
  data?: unknown;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${css}</style>
</head>
<body>
${body}
<script>window.__PREVIEW_PAGE__ = ${JSON.stringify(pageName)};window.__R2_PREVIEW_DATA__ = ${JSON.stringify(data ?? null)};</script>
<script type="module" src="/preview-client.js"></script>
</body>
</html>
`;
}

const previewHtml = page({
  title: `CinePrint R2 runtime preview — ${entries.length} entries`,
  pageName: "preview",
  body: `<h1>CinePrint R2 runtime preview</h1><p>${entries.length} entries · ${entries.filter((entry) => entry.canary).length} canaries · production flags remain disabled</p><div id="root"></div>`,
  data: previewData,
});

const failuresHtml = page({
  title: "CinePrint R2 failure-state fixtures",
  pageName: "failures",
  body: `<h1>CinePrint R2 failure-state fixtures</h1><p>Local failure endpoints only · production flags remain disabled</p><div id="root"></div>`,
});

const unmountHtml = page({
  title: "CinePrint R2 unmount fixture",
  pageName: "unmount",
  body: `<h1>CinePrint R2 unmount fixture</h1><p>Component unmounts while an image is pending</p><div id="root"></div>`,
});

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.writeFileSync(path.join(ARTIFACT_DIR, "preview.html"), previewHtml, "utf8");
fs.writeFileSync(path.join(ARTIFACT_DIR, "failures.html"), failuresHtml, "utf8");
fs.writeFileSync(path.join(ARTIFACT_DIR, "unmount.html"), unmountHtml, "utf8");
fs.writeFileSync(
  "/tmp/opencode/phase12c-preview-inventory.json",
  `${JSON.stringify({ generatedAt: new Date().toISOString(), entries: inventory }, null, 2)}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      entries: entries.length,
      canaries: entries.filter((entry) => entry.canary).length,
      migrated: entries.filter((entry) => !entry.canary).length,
      uniqueOptimizedUrls: new Set(inventory.map((entry) => entry.optimizedUrl)).size,
      uniqueOriginalUrls: new Set(inventory.map((entry) => entry.originalUrl)).size,
      artifacts: ARTIFACT_DIR,
    },
    null,
    2,
  ),
);
