import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateProductionHealth,
  type HarnessResult,
} from "../automation/monitoring/production-health";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.HEALTH_BASE_URL || "https://cineprint.click";
const HARNESS_RESULT = "/tmp/opencode/phase13-routes-browser.json";
const OUT_DIR = "/tmp/opencode/phase17-health";

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  }
  return response.text();
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
  const homeHtml = await fetchText(`${BASE_URL}/`);
  const mappedDetailHtml = await fetchText(`${BASE_URL}/poster/backrooms-3`);
  const sitemapXml = await fetchText(`${BASE_URL}/sitemap-posters.xml`);
  const expectedSeo = process.env.EXPECT_SEO === "r2" ? "r2" : "blob";
  const assetPath = /\/assets\/poster-images-[^"]+\.js/.exec(homeHtml)?.[0];
  if (!assetPath) throw new Error("Could not find poster-images asset in production home HTML");
  const assetSource = await fetchText(`${BASE_URL}${assetPath}`);

  const evaluation = evaluateProductionHealth({
    harness,
    assetSource,
    mappedDetailHtml,
    sitemapXml,
    expectedSeo,
  });
  const timestamp = new Date().toISOString();
  const result = {
    generatedAt: timestamp,
    baseUrl: BASE_URL,
    expectedSeo,
    harnessExit,
    assetPath,
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
