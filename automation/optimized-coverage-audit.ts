import path from "path";
import { fileURLToPath } from "url";
import { initAdmin } from "../scripts/sync-notion-to-firestore.js";
import { auditOptimizedCoverage } from "./blob/coverage";

async function main() {
  const db = initAdmin();
  const snap = await db.collection("posters").where("status", "==", "published").get();
  const posters = snap.docs.map((doc) => ({
    id: doc.id,
    image: String(doc.data().image ?? ""),
  }));
  const report = auditOptimizedCoverage(posters);

  console.log("Optimized-image coverage (derived, no Blob requests)");
  console.log(`Total published: ${report.total}`);
  console.log(
    `With optimized URL: ${report.withOptimized} (legacy ${report.legacy}, artwork ${report.artwork})`,
  );
  console.log(
    `Fallback to original: ${report.fallbackOriginal} (external ${report.externalExceptions})`,
  );
  console.log(`Missing image: ${report.missingImage}`);
  console.log(`Sample optimized: ${report.sampleWithOptimized.join(", ") || "none"}`);
  console.log(`Sample fallback: ${report.sampleFallback.join(", ") || "none"}`);
  console.log(`Sample missing: ${report.sampleMissing.join(", ") || "none"}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(
      `Coverage audit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
