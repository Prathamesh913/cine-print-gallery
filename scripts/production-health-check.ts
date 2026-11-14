import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { R2_IMAGE_MAP } from "../src/lib/r2-image-map.generated.ts";
import {
  evaluateProductionHealth,
  resolveCatalogueImage,
  type CataloguePoster,
  type HarnessResult,
  type PublicImageCheck,
} from "../automation/monitoring/production-health";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.HEALTH_BASE_URL || "https://cineprint.click";
const HARNESS_RESULT = "/tmp/opencode/phase13-routes-browser.json";
const OUT_DIR = "/tmp/opencode/phase17-health";

dotenv.config({ path: path.join(ROOT, ".env.local") });
dotenv.config({ path: path.join(ROOT, ".env") });

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  }
  return response.text();
}

function readEnv(key: string): string | undefined {
  return process.env[key] || process.env[`VITE_${key}`];
}

async function fetchCatalogue(): Promise<CataloguePoster[]> {
  const { initializeApp, getApps, getApp } = await import("firebase/app");
  const { getFirestore, collection, getDocs, query, where } = await import("firebase/firestore");

  const firebaseConfig = {
    apiKey: readEnv("FIREBASE_API_KEY"),
    authDomain: readEnv("FIREBASE_AUTH_DOMAIN"),
    projectId: readEnv("FIREBASE_PROJECT_ID"),
    storageBucket: readEnv("FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: readEnv("FIREBASE_MESSAGING_SENDER_ID"),
    appId: readEnv("FIREBASE_APP_ID"),
  };
  if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
    throw new Error(
      "Firebase client config is missing (FIREBASE_PROJECT_ID / FIREBASE_API_KEY); " +
        "cannot validate the published catalogue.",
    );
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const snapshot = await getDocs(
    query(collection(db, "posters"), where("status", "==", "published")),
  );
  return snapshot.docs.map((document) => {
    const data = document.data() as Record<string, unknown>;
    return {
      id: document.id,
      image: typeof data.image === "string" ? data.image : "",
      r2Image: data.r2Image,
    };
  });
}

async function checkPublicImage(poster: CataloguePoster): Promise<PublicImageCheck> {
  const url = resolveCatalogueImage(poster, R2_IMAGE_MAP).optimizedUrl;
  if (!url) {
    return {
      posterId: poster.id,
      url: null,
      ok: false,
      status: null,
      contentType: null,
      reason: "no trusted R2 optimized image resolves for this poster",
    };
  }

  try {
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const isWebp =
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP";
    return {
      posterId: poster.id,
      url,
      ok: response.status === 200 && contentType === "image/webp" && isWebp && bytes.length > 0,
      status: response.status,
      contentType,
      contentLength: bytes.length,
      reason: isWebp ? null : "public body is not a WebP image",
    };
  } catch (error) {
    return {
      posterId: poster.id,
      url,
      ok: false,
      status: null,
      contentType: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let harnessExit = 0;
  try {
    execFileSync(process.execPath, ["scripts/browser-r2-routes.mjs"], {
      cwd: ROOT,
      env: { ...process.env, ROUTES_BASE_URL: BASE_URL },
      stdio: "inherit",
    });
  } catch (error) {
    harnessExit =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status?: number }).status ?? 1)
        : 1;
  }

  const harness = JSON.parse(fs.readFileSync(HARNESS_RESULT, "utf8")) as HarnessResult;
  const catalogue = await fetchCatalogue();
  const publicImages = await mapWithConcurrency(catalogue, 6, checkPublicImage);
  const homeHtml = await fetchText(`${BASE_URL}/`);
  const mappedDetailHtml = await fetchText(`${BASE_URL}/poster/backrooms-3`);
  const sitemapXml = await fetchText(`${BASE_URL}/sitemap-posters.xml`);
  const expectedSeo = process.env.EXPECT_SEO === "blob" ? "blob" : "r2";
  const assetPath = /\/assets\/poster-images-[^"]+\.js/.exec(homeHtml)?.[0];
  if (!assetPath) throw new Error("Could not find poster-images asset in production home HTML");
  const assetSource = await fetchText(`${BASE_URL}${assetPath}`);

  const evaluation = evaluateProductionHealth({
    harness,
    assetSource,
    mappedDetailHtml,
    sitemapXml,
    expectedSeo,
    catalogue,
    staticMap: R2_IMAGE_MAP,
    publicImages,
  });
  const timestamp = new Date().toISOString();
  const result = {
    generatedAt: timestamp,
    baseUrl: BASE_URL,
    expectedSeo,
    harnessExit,
    assetPath,
    catalogue: {
      published: catalogue.length,
      r2Backed: catalogue.filter(
        (poster) => resolveCatalogueImage(poster, R2_IMAGE_MAP).optimizedUrl,
      ).length,
      unavailable: catalogue
        .filter((poster) => resolveCatalogueImage(poster, R2_IMAGE_MAP).unavailable)
        .map((poster) => poster.id),
      failedPublicImages: publicImages.filter((entry) => !entry.ok).map((entry) => entry.posterId),
    },
    summary: {
      checks: evaluation.checks.length,
      failed: evaluation.failed,
      warnings: evaluation.warnings,
    },
    checks: evaluation.checks,
  };
  const fileSafeTimestamp = timestamp.replace(/[:.]/g, "-");
  const outputPath = path.join(OUT_DIR, `health-${fileSafeTimestamp}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(OUT_DIR, "health-latest.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        generatedAt: timestamp,
        baseUrl: BASE_URL,
        expectedSeo,
        harnessExit,
        catalogue: result.catalogue,
        checks: result.summary.checks,
        failed: result.summary.failed,
        warnings: result.summary.warnings,
        output: outputPath,
        failures: evaluation.checks.filter((check) => check.status === "FAIL"),
        warningsList: evaluation.checks.filter((check) => check.status === "WARNING"),
      },
      null,
      2,
    ),
  );

  if (harnessExit !== 0 || evaluation.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
