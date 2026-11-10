import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOWS = ["raindrop-ingestion.yml", "notion-publishing-sync.yml"].map((name) => ({
  name,
  text: fs.readFileSync(path.join(ROOT, ".github", "workflows", name), "utf8"),
}));

describe("automation workflows", () => {
  it.each(WORKFLOWS)("$name is gated until explicitly activated", ({ text }) => {
    expect(text).toContain("AUTOMATION_ENABLED == 'true'");
    expect(text).toContain("workflow_dispatch:");
  });

  it.each(WORKFLOWS)("$name never runs on pull requests", ({ text }) => {
    expect(text).not.toContain("pull_request");
  });

  it.each(WORKFLOWS)("$name uses minimal permissions and a timeout", ({ text }) => {
    expect(text).toContain("permissions:\n  contents: read");
    expect(text).toMatch(/timeout-minutes: \d+/);
  });

  it.each(WORKFLOWS)("$name shares the non-cancelling concurrency group", ({ text }) => {
    expect(text).toContain("group: cineprint-catalog-automation");
    expect(text).toContain("cancel-in-progress: false");
  });

  it.each(WORKFLOWS)("$name pins every action to an immutable commit SHA", ({ text }) => {
    const uses = [...text.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("schedules both workflows in the 15-30 minute window", () => {
    for (const { text } of WORKFLOWS) {
      expect(text).toMatch(/cron: "\*\/20 \* \* \* \*"|cron: "5,25,45 \* \* \* \*"/);
    }
  });

  it("supports a manual dry-run by default", () => {
    for (const { text } of WORKFLOWS) {
      expect(text).toMatch(/type: boolean\n\s+default: false/);
    }
  });
});
