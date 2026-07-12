/** @type {import('next-sitemap').IConfig} */
export default {
  siteUrl: process.env.SITE_URL || "https://cine-print-gallery.vercel.app",
  generateRobotsTxt: true,
  outDir: "dist",
  sourceDir: "dist",
  changefreq: "weekly",
  priority: 0.7,
};
