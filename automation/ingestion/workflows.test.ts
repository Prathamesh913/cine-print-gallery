import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows");

function readWorkflow(name: string): string {
  return fs.readFileSync(path.join(WORKFLOW_DIR, name), "utf8");
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Drop comment lines so documentation cannot satisfy or defeat assertions. */
function withoutComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

/** Extract one top-level job block from a workflow file. */
function jobBlock(text: string, id: string): string {
  const marker = `\n  ${id}:\n`;
  const start = text.indexOf(marker);
  if (start === -1) throw new Error(`job ${id} not found`);
  const rest = text.slice(start + marker.length);
  const next = rest.search(/\n {2}[a-zA-Z0-9-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Return the exact `if:` expression of a job, folding `>-` blocks. This is
 * intentionally strict: both a substring match and a comment would let a
 * condition such as `event == 'schedule' || vars.AUTOMATION_ENABLED == 'true'`
 * pass a weaker test.
 */
function jobCondition(block: string): string {
  const lines = block.split("\n");
  const index = lines.findIndex((line) => line.startsWith("    if:"));
  if (index === -1) throw new Error("job has no if condition");

  const first = lines[index].slice("    if:".length).trim();
  if (!["", ">", ">-", "|", "|-"].includes(first)) return normalize(first);

  const parts: string[] = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.trim() === "") continue;
    if (!line.startsWith("      ")) break;
    parts.push(line.trim());
  }
  return normalize(parts.join(" "));
}

/**
 * Parse a mapping at a fixed indentation (`with:`/`secrets:` at 4 spaces,
 * step `env:` at 8 spaces).
 */
function jobMapping(block: string, key: string, indent = 4): Record<string, string> {
  const lines = block.split("\n");
  const index = lines.findIndex((line) => line.trimEnd() === `${" ".repeat(indent)}${key}:`);
  if (index === -1) throw new Error(`job has no ${key} mapping`);

  const mapping: Record<string, string> = {};
  const entry = new RegExp(`^ {${indent + 2}}([a-zA-Z0-9_-]+):\\s*(.*)$`);
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.trim() === "") continue;
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent <= indent) break;
    const match = line.match(entry);
    if (match) mapping[match[1]] = normalize(match[2]);
  }
  return mapping;
}

const REPO = "Prathamesh913/cine-print-gallery";

const CALLERS = [
  {
    name: "raindrop-ingestion.yml",
    cron: 'cron: "*/20 * * * *"',
    reusable: "./.github/workflows/automation-ingest-run.yml",
    scheduledLimit: "10",
    maxPages: true,
    dryRunSecrets: ["NOTION_KEY", "RAINDROP_ACCESS_TOKEN", "TMDB_API_KEY"],
    writeSecrets: [
      "FIREBASE_SERVICE_ACCOUNT_JSON",
      "NOTION_KEY",
      "R2_ACCESS_KEY_ID",
      "R2_ACCOUNT_ID",
      "R2_SECRET_ACCESS_KEY",
      "RAINDROP_ACCESS_TOKEN",
      "TMDB_API_KEY",
    ],
  },
  {
    name: "notion-publishing-sync.yml",
    cron: 'cron: "5,25,45 * * * *"',
    reusable: "./.github/workflows/automation-publish-run.yml",
    scheduledLimit: "50",
    maxPages: false,
    dryRunSecrets: ["NOTION_KEY"],
    writeSecrets: ["FIREBASE_SERVICE_ACCOUNT_JSON", "NOTION_KEY"],
  },
];

const REUSABLES = [
  { name: "automation-ingest-run.yml", timeout: 20 },
  { name: "automation-publish-run.yml", timeout: 15 },
];

describe.each(CALLERS)(
  "$name activation lanes",
  ({ name, cron, reusable, scheduledLimit, maxPages, dryRunSecrets, writeSecrets }) => {
    const text = readWorkflow(name);

    it("keeps the schedule, permissions, concurrency and non-cancelling behaviour", () => {
      expect(text).toContain(cron);
      expect(text).toContain("permissions:\n  contents: read");
      expect(text).toContain("group: cineprint-catalog-automation");
      expect(text).toContain("cancel-in-progress: false");
      expect(text).not.toContain("pull_request");
      expect(text).not.toContain("secrets: inherit");
    });

    it("keeps every action pinned to a commit SHA and uses only local reusable workflows", () => {
      const uses = [...text.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
      expect(uses.length).toBeGreaterThan(0);
      for (const action of uses) {
        if (action.startsWith("./")) {
          expect(action).toMatch(/^\.\/\.github\/workflows\/[a-z-]+\.yml$/);
        } else {
          expect(action).toMatch(/@[0-9a-f]{40}$/);
        }
      }
      expect(uses).toContain(reusable);
    });

    it("makes the manual action unmistakable with safe defaults", () => {
      expect(text).toMatch(
        /action:\n(?:.*\n)*?\s+type: choice\n\s+options:\n\s+- dry-run\n\s+- apply\n\s+default: dry-run/,
      );
      expect(text).toMatch(/confirm_apply:\n(?:.*\n)*?\s+default: ""/);
      expect(text).toMatch(/limit:\n(?:.*\n)*?\s+default: "1"/);
      expect(text).toContain("APPLY-ONE-POSTER");
    });

    it("validates dispatch inputs with the exact dispatch gate", () => {
      const validate = jobBlock(text, "validate");
      expect(jobCondition(validate)).toBe("github.event_name == 'workflow_dispatch'");
      expect(validate).toContain("run-authorization.mjs dispatch");
      expect(validate).toContain("timeout-minutes: 5");

      const env = jobMapping(validate, "env", 8);
      expect(env).toMatchObject({
        GATE_ACTION: "${{ inputs.action }}",
        GATE_EVENT_NAME: "${{ github.event_name }}",
        GATE_LIMIT: "${{ inputs.limit }}",
        GATE_ENVIRONMENT:
          "${{ inputs.action == 'apply' && 'automation-manual-apply' || 'automation-manual-dry-run' }}",
        GATE_CONFIRMATION: "${{ inputs.confirm_apply }}",
        GATE_MANUAL_APPLY_ENABLED: "${{ vars.AUTOMATION_MANUAL_APPLY_ENABLED }}",
        GATE_REPOSITORY: "${{ github.repository }}",
        GATE_EVENT_REPOSITORY: "${{ github.event.repository.full_name }}",
      });
      if (maxPages) expect(env.GATE_MAX_PAGES).toBe("${{ inputs.max_pages }}");
    });

    it("allows a manual dry-run while both activation variables are absent", () => {
      const dryRun = jobBlock(text, "manual-dry-run");
      expect(jobCondition(dryRun)).toBe(
        "github.event_name == 'workflow_dispatch' && inputs.action == 'dry-run'",
      );
      expect(dryRun).toContain("needs: validate");
      expect(dryRun).not.toMatch(/AUTOMATION_ENABLED/);
      expect(dryRun).not.toMatch(/AUTOMATION_MANUAL_APPLY_ENABLED/);
      expect(dryRun).not.toContain("R2_");
      expect(dryRun).not.toContain("FIREBASE_SERVICE_ACCOUNT_JSON");

      const withInputs = jobMapping(dryRun, "with");
      const expected: Record<string, string> = {
        apply: "false",
        limit: "${{ inputs.limit }}",
        source: "manual",
        confirmation: '""',
        environment: "automation-manual-dry-run",
      };
      if (maxPages) expected["max-pages"] = "${{ inputs.max_pages }}";
      expect(withInputs).toEqual(expected);
      expect(Object.keys(jobMapping(dryRun, "secrets")).sort()).toEqual(dryRunSecrets);
    });

    it("gates manual apply on its own variable, confirmation, limit and environment", () => {
      const apply = jobBlock(text, "manual-apply");
      expect(jobCondition(apply)).toBe(
        "github.event_name == 'workflow_dispatch' && inputs.action == 'apply' && vars.AUTOMATION_MANUAL_APPLY_ENABLED == 'true'",
      );
      expect(apply).toContain("needs: validate");

      const withInputs = jobMapping(apply, "with");
      expect(withInputs).toEqual({
        apply: "true",
        limit: "${{ inputs.limit }}",
        source: "manual",
        confirmation: "${{ inputs.confirm_apply }}",
        environment: "automation-manual-apply",
        ...(maxPages ? { "max-pages": "${{ inputs.max_pages }}" } : {}),
      });
      expect(Object.keys(jobMapping(apply, "secrets")).sort()).toEqual(writeSecrets);
    });

    it("keeps scheduled execution independently gated on the schedule event", () => {
      const scheduled = jobBlock(text, "scheduled");
      expect(jobCondition(scheduled)).toBe(
        "github.event_name == 'schedule' && vars.AUTOMATION_ENABLED == 'true'",
      );
      expect(scheduled).not.toMatch(/workflow_dispatch/);
      expect(scheduled).not.toMatch(/AUTOMATION_MANUAL_APPLY_ENABLED/);
      expect(scheduled).not.toContain("needs:");

      expect(jobMapping(scheduled, "with")).toEqual({
        apply: "true",
        limit: `"${scheduledLimit}"`,
        source: "schedule",
        confirmation: '""',
        environment: "automation-scheduled",
        ...(maxPages ? { "max-pages": '"4"' } : {}),
      });
      expect(Object.keys(jobMapping(scheduled, "secrets")).sort()).toEqual(writeSecrets);
    });
  },
);

describe.each(REUSABLES)("$name reusable body", ({ name, timeout }) => {
  const text = readWorkflow(name);

  it("is callable only and re-checks authorization before installing dependencies", () => {
    expect(text).toContain("workflow_call:");
    expect(text).not.toContain("workflow_dispatch:");
    expect(text).not.toContain("schedule:");
    expect(text).toContain("environment:\n      name: ${{ inputs.environment }}");
    expect(text).toMatch(/run: node automation\/ingestion\/run-authorization\.mjs authorize/);

    const authorizeIndex = text.indexOf("Authorize run");
    const setupIndex = text.indexOf("Set up Node");
    const installIndex = text.indexOf("Install dependencies");
    const runIndex =
      text.indexOf("Run ingestion") === -1
        ? text.indexOf("Run publishing sync")
        : text.indexOf("Run ingestion");
    expect(authorizeIndex).toBeGreaterThan(-1);
    expect(setupIndex).toBeGreaterThan(authorizeIndex);
    expect(installIndex).toBeGreaterThan(authorizeIndex);
    expect(runIndex).toBeGreaterThan(authorizeIndex);
  });

  it("passes repository, event and environment details to the gate", () => {
    const authorize = text.slice(text.indexOf("Authorize run"));
    expect(authorize).toContain("GATE_ENVIRONMENT: ${{ inputs.environment }}");
    expect(authorize).toContain("GATE_REPOSITORY: ${{ github.repository }}");
    expect(authorize).toContain("GATE_EVENT_REPOSITORY: ${{ github.event.repository.full_name }}");
  });

  it("keeps the original timeout and pinned actions", () => {
    expect(text).toContain(`timeout-minutes: ${timeout}`);
    const uses = [...text.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    for (const action of uses) {
      expect(action).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("requires confirmation for the CLI apply branch", () => {
    expect(text).toMatch(/args\+=\(--apply --confirm-apply\)/);
  });
});

describe("reusable write-credential scoping", () => {
  it("keeps R2 variables and credentials empty for dry-runs", () => {
    const text = readWorkflow("automation-ingest-run.yml");
    for (const key of [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
      "R2_PUBLIC_BASE_URL",
      "FIREBASE_SERVICE_ACCOUNT_JSON",
    ]) {
      expect(text).toContain(`${key}: \${{ inputs.apply &&`);
    }
  });

  it("passes the optional identities data source to the publishing sync", () => {
    const text = readWorkflow("automation-publish-run.yml");
    expect(text).toContain(
      "NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID: ${{ vars.NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID }}",
    );
  });
});

describe("automation safety CI", () => {
  const name = "automation-safety.yml";

  it("exists, is read-only and has no access to production secrets", () => {
    const code = withoutComments(readWorkflow(name));
    expect(code).toContain("permissions:\n  contents: read");
    expect(code).toContain("pull_request:");
    expect(code).toContain("push:");
    expect(code).not.toContain("pull_request_target");
    expect(code).not.toContain("workflow_dispatch");
    expect(code).not.toContain("secrets.");
    expect(code).not.toContain("AUTOMATION_ENABLED");
    expect(code).not.toContain("environment:");
    expect(code).not.toContain("deploy");
  });

  it("runs the activation-gate checks and pins every action", () => {
    const code = withoutComments(readWorkflow(name));
    expect(code).toContain("automation/ingestion");
    expect(code).toContain("actionlint");
    expect(code).toContain("eslint");

    const uses = [...code.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});
