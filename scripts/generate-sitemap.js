import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "public");
const siteUrl = process.env.SITE_URL || "https://cine-print-gallery.vercel.app";

const pages = [
  { loc: "/", priority: 1.0, changefreq: "weekly" },
  { loc: "/about", priority: 0.5, changefreq: "monthly" },
  { loc: "/submit", priority: 0.6, changefreq: "monthly" },
  { loc: "/saved", priority: 0.5, changefreq: "weekly" },
  { loc: "/constellation", priority: 0.7, changefreq: "weekly" },
];

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function generateSitemap() {
  const urls = pages
    .map(
      (p) => `  <url>
    <loc>${escapeXml(siteUrl)}${p.loc}</loc>
    <lastmod>${today()}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority.toFixed(1)}</priority>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function generateRobots() {
  return `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
}

mkdirSync(outDir, { recursive: true });

writeFileSync(resolve(outDir, "sitemap.xml"), generateSitemap(), "utf-8");
writeFileSync(resolve(outDir, "robots.txt"), generateRobots(), "utf-8");

console.log(`✓ sitemap.xml & robots.txt generated in ${outDir}`);
