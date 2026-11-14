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
 * condition such as `event == 'schedule' || vars.AUTOMATION_PUBLISHING_ENABLED == 'true'`
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

/** Parse a single-job `needs:` value. */
function jobNeeds(block: string): string[] {
  const match = block.match(/^ {4}needs:\s*(\S+)\s*$/m);
  return match ? [match[1]] : [];
}

type JobContext = {
  event: string;
  vars: Record<string, string>;
  inputs: Record<string, string>;
};

/**
 * Evaluate the subset of GitHub expressions these workflows use: a conjunction
 * of `<context> == 'literal'` comparisons. Throwing on anything else keeps the
 * test honest if a condition grows a disjunction, status function or a context
 * the helper does not model.
 */
function conditionHolds(condition: string, context: JobContext): boolean {
  return condition.split("&&").every((rawClause) => {
    const clause = rawClause.trim();
    const match = clause.match(
      /^(github\.event_name|vars\.[A-Z0-9_]+|inputs\.[a-z_]+)\s*(==|!=)\s*'([^']*)'$/,
    );
    if (!match) throw new Error(`unsupported workflow condition clause: ${clause}`);
    const [, ref, operator, expected] = match;
    const actual =
      ref === "github.event_name"
        ? context.event
        : ref.startsWith("vars.")
          ? (context.vars[ref.slice("vars.".length)] ?? "")
          : (context.inputs[ref.slice("inputs.".length)] ?? "");
    return operator === "==" ? actual === expected : actual !== expected;
  });
}

/**
 * Resolve which jobs GitHub would run for one event, applying the same
 * needs-based skip propagation GitHub uses. A job whose dependency did not run
 * is skipped, so the implicit success() check fails for its dependents.
 */
function runnableJobs(text: string, order: string[], context: JobContext): string[] {
  const ran: string[] = [];
  for (const id of order) {
    const block = jobBlock(text, id);
    if (!jobNeeds(block).every((need) => ran.includes(need))) continue;
    if (conditionHolds(jobCondition(block), context)) ran.push(id);
  }
  return ran;
}

const CALLERS = [
  {
    name: "raindrop-ingestion.yml",
    cron: 'cron: "*/20 * * * *"',
    reusable: "./.github/workflows/automation-ingest-run.yml",
    scheduledLimit: "10",
    scheduledGate: "AUTOMATION_INGESTION_ENABLED",
    otherScheduledGate: "AUTOMATION_PUBLISHING_ENABLED",
    maxPages: true,
    dryRunSecrets: ["NOTION_KEY", "RAINDROP_ACCESS_TOKEN", "TMDB_API_KEY"],
    dryRunReadsFirestore: false,
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
    scheduledGate: "AUTOMATION_PUBLISHING_ENABLED",
    otherScheduledGate: "AUTOMATION_INGESTION_ENABLED",
    maxPages: false,
    dryRunSecrets: ["FIREBASE_SERVICE_ACCOUNT_JSON", "NOTION_KEY"],
    dryRunReadsFirestore: true,
    writeSecrets: ["FIREBASE_SERVICE_ACCOUNT_JSON", "NOTION_KEY"],
  },
];

const REUSABLES = [
  { name: "automation-ingest-run.yml", timeout: 20 },
  { name: "automation-publish-run.yml", timeout: 15 },
];

describe.each(CALLERS)(
  "$name activation lanes",
  ({
    name,
    cron,
    reusable,
    scheduledLimit,
    scheduledGate,
    otherScheduledGate,
    maxPages,
    dryRunSecrets,
    dryRunReadsFirestore,
    writeSecrets,
  }) => {
    const text = readWorkflow(name);

    it("keeps the schedule, permissions, concurrency and non-cancelling behaviour", () => {
      expect(text).toContain(cron);
      expect(text).toContain("permissions:\n  contents: read");
      expect(text).toContain("group: cineprint-catalog-automation");
      expect(text).toContain("cancel-in-progress: false");
      expect(text).not.toContain("pull_request");
      expect(text).not.toContain("secrets: inherit");
      expect(text).not.toContain("environment:");
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
        GATE_CONFIRMATION: "${{ inputs.confirm_apply }}",
        GATE_REF: "${{ github.ref }}",
        GATE_MANUAL_APPLY_ENABLED: "${{ vars.AUTOMATION_MANUAL_APPLY_ENABLED }}",
        GATE_REPOSITORY: "${{ github.repository }}",
        GATE_EVENT_REPOSITORY: "${{ github.event.repository.full_name }}",
      });
      expect(env).not.toHaveProperty("GATE_ENVIRONMENT");
      if (maxPages) expect(env.GATE_MAX_PAGES).toBe("${{ inputs.max_pages }}");
    });

    it("allows a manual dry-run while every activation variable is absent", () => {
      const dryRun = jobBlock(text, "manual-dry-run");
      expect(jobCondition(dryRun)).toBe(
        "github.event_name == 'workflow_dispatch' && inputs.action == 'dry-run'",
      );
      expect(dryRun).toContain("needs: validate");
      expect(dryRun).not.toMatch(/AUTOMATION_/);
      expect(dryRun).not.toContain("environment:");
      expect(dryRun).not.toContain("R2_");
      // A dry-run reads existing Firestore state; the CLI's read-only adapters
      // make every write throw, so the credential is read-only in practice.
      expect(dryRun.includes("FIREBASE_SERVICE_ACCOUNT_JSON")).toBe(dryRunReadsFirestore);

      const withInputs = jobMapping(dryRun, "with");
      const expected: Record<string, string> = {
        apply: "false",
        limit: "${{ inputs.limit }}",
        source: "manual",
        confirmation: '""',
      };
      if (maxPages) expected["max-pages"] = "${{ inputs.max_pages }}";
      expect(withInputs).toEqual(expected);
      expect(Object.keys(jobMapping(dryRun, "secrets")).sort()).toEqual(dryRunSecrets);
    });

    it("gates manual apply on its own variable, confirmation and limit without a reviewer environment", () => {
      const apply = jobBlock(text, "manual-apply");
      expect(jobCondition(apply)).toBe(
        "github.event_name == 'workflow_dispatch' && inputs.action == 'apply' && vars.AUTOMATION_MANUAL_APPLY_ENABLED == 'true'",
      );
      expect(apply).toContain("needs: validate");
      expect(apply).not.toContain("environment:");
      expect(apply).not.toMatch(/AUTOMATION_(INGESTION|PUBLISHING)_ENABLED/);

      const withInputs = jobMapping(apply, "with");
      expect(withInputs).toEqual({
        apply: "true",
        limit: "${{ inputs.limit }}",
        source: "manual",
        confirmation: "${{ inputs.confirm_apply }}",
        ...(maxPages ? { "max-pages": "${{ inputs.max_pages }}" } : {}),
      });
      expect(Object.keys(jobMapping(apply, "secrets")).sort()).toEqual(writeSecrets);
    });

    it("keeps scheduled execution independently gated on its own lane variable", () => {
      const scheduled = jobBlock(text, "scheduled");
      expect(jobCondition(scheduled)).toBe(
        `github.event_name == 'schedule' && vars.${scheduledGate} == 'true'`,
      );
      expect(scheduled).not.toMatch(/workflow_dispatch/);
      expect(scheduled).not.toMatch(/AUTOMATION_MANUAL_APPLY_ENABLED/);
      expect(scheduled).not.toMatch(new RegExp(otherScheduledGate));
      expect(jobNeeds(scheduled)).toEqual([]);
      expect(scheduled).not.toContain("environment:");

      expect(jobMapping(scheduled, "with")).toEqual({
        apply: "true",
        limit: `"${scheduledLimit}"`,
        source: "schedule",
        confirmation: '""',
        "scheduled-gate": scheduledGate,
        "scheduled-enabled": `\${{ vars.${scheduledGate} }}`,
        ...(maxPages ? { "max-pages": '"4"' } : {}),
      });
      expect(Object.keys(jobMapping(scheduled, "secrets")).sort()).toEqual(writeSecrets);
    });

    it("never reintroduces the retired lane-neutral activation variable", () => {
      expect(withoutComments(text)).not.toMatch(/\bAUTOMATION_ENABLED\b/);
    });
  },
);

describe.each(CALLERS)(
  "$name scheduled job graph",
  ({ name, scheduledGate, otherScheduledGate }) => {
    const text = readWorkflow(name);
    const order = ["validate", "manual-dry-run", "manual-apply", "scheduled"];

    it("reaches scheduled apply on a schedule event while manual validation is skipped", () => {
      const ran = runnableJobs(text, order, {
        event: "schedule",
        vars: { [scheduledGate]: "true" },
        inputs: {},
      });

      // `validate` is intentionally `workflow_dispatch`-only, so it is skipped on
      // a schedule event. `scheduled` has no `needs:`, which is why that skipped
      // job cannot block it through GitHub's implicit success() check.
      expect(ran).toEqual(["scheduled"]);
      expect(ran).not.toContain("validate");
      expect(jobNeeds(jobBlock(text, "scheduled"))).toEqual([]);
    });

    it("skips scheduled apply when its own lane variable is absent or not true", () => {
      for (const value of ["", "false", "TRUE", "1"]) {
        const ran = runnableJobs(text, order, {
          event: "schedule",
          vars: { [scheduledGate]: value },
          inputs: {},
        });
        expect(ran).toEqual([]);
      }
    });

    it("does not arm the scheduled lane from the other lane variable", () => {
      const ran = runnableJobs(text, order, {
        event: "schedule",
        vars: { [otherScheduledGate]: "true" },
        inputs: {},
      });
      expect(ran).toEqual([]);
    });

    it("still reaches manual dry-run through validation", () => {
      const ran = runnableJobs(text, order, {
        event: "workflow_dispatch",
        vars: { [scheduledGate]: "true" },
        inputs: { action: "dry-run" },
      });
      expect(ran).toEqual(["validate", "manual-dry-run"]);
    });

    it("still reaches manual apply through validation", () => {
      const ran = runnableJobs(text, order, {
        event: "workflow_dispatch",
        vars: {
          [scheduledGate]: "true",
          AUTOMATION_MANUAL_APPLY_ENABLED: "true",
        },
        inputs: { action: "apply" },
      });
      expect(ran).toEqual(["validate", "manual-apply"]);
    });

    it("does not let a scheduled event enter a manual lane", () => {
      const ran = runnableJobs(text, order, {
        event: "schedule",
        vars: {
          [scheduledGate]: "true",
          AUTOMATION_MANUAL_APPLY_ENABLED: "true",
        },
        inputs: { action: "apply" },
      });
      expect(ran).toEqual(["scheduled"]);
    });
  },
);

describe.each(REUSABLES)("$name reusable body", ({ name, timeout }) => {
  const text = readWorkflow(name);

  it("is callable only and re-checks authorization before installing dependencies", () => {
    expect(text).toContain("workflow_call:");
    expect(text).not.toContain("workflow_dispatch:");
    expect(text).not.toContain("schedule:");
    expect(text).not.toContain("environment:");
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

  it("passes repository, event, ref and lane details to the gate", () => {
    const authorize = text.slice(text.indexOf("Authorize run"));
    expect(authorize).toContain("GATE_REF: ${{ github.ref }}");
    expect(authorize).toContain("GATE_REPOSITORY: ${{ github.repository }}");
    expect(authorize).toContain("GATE_EVENT_REPOSITORY: ${{ github.event.repository.full_name }}");
    expect(authorize).toContain("GATE_SCHEDULED_ENABLED: ${{ inputs.scheduled-enabled }}");
    expect(authorize).toContain("GATE_SCHEDULED_GATE: ${{ inputs.scheduled-gate }}");
    expect(authorize).not.toContain("GATE_ENVIRONMENT");
    expect(authorize).not.toContain("GATE_AUTOMATION_ENABLED");
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

describe("approval-model simplification", () => {
  it("removes every GitHub Environment and required-reviewer reference from automation workflows", () => {
    for (const name of [
      "raindrop-ingestion.yml",
      "notion-publishing-sync.yml",
      "automation-ingest-run.yml",
      "automation-publish-run.yml",
    ]) {
      const code = withoutComments(readWorkflow(name));
      expect(code).not.toContain("environment:");
      expect(code).not.toContain("required_reviewers");
      expect(code).not.toContain("automation-manual-apply");
      expect(code).not.toContain("automation-scheduled");
    }
  });

  it("keeps the safety CI workflow free of environments and deployment access", () => {
    const code = withoutComments(readWorkflow("automation-safety.yml"));
    expect(code).not.toContain("environment:");
    expect(code).not.toContain("required_reviewers");
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

  it("passes the explicit poster data source to the ingestion sync", () => {
    const text = readWorkflow("automation-ingest-run.yml");
    expect(text).toContain(
      "NOTION_POSTER_DATA_SOURCE_ID: ${{ vars.NOTION_POSTER_DATA_SOURCE_ID }}",
    );
  });

  it("names the poster data source explicitly and lets dry-runs read Firestore", () => {
    const text = readWorkflow("automation-publish-run.yml");
    const runStep = text.slice(text.indexOf("Run publishing sync"));

    expect(runStep).toContain(
      "NOTION_POSTER_DATA_SOURCE_ID: ${{ vars.NOTION_POSTER_DATA_SOURCE_ID }}",
    );
    // Read-only in a dry-run: the CLI wraps Firestore writes in throwing proxies.
    expect(runStep).toContain(
      "FIREBASE_SERVICE_ACCOUNT_JSON: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON }}",
    );
    expect(runStep).not.toContain("inputs.apply && secrets.FIREBASE_SERVICE_ACCOUNT_JSON");
    expect(runStep).not.toContain("R2_");
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
    expect(code).not.toContain("AUTOMATION_");
    expect(code).not.toContain("environment:");
    expect(code).not.toContain("deploy");
  });

  it("runs the activation-gate checks and pins every action", () => {
    const code = withoutComments(readWorkflow(name));
    expect(code).toContain("automation/ingestion");
    expect(code).toContain("automation/notion");
    expect(code.match(/automation\/repair\/\*\*/g)).toHaveLength(2);
    expect(code).toContain("npx vitest run automation/repair");
    expect(code).toContain("npx eslint automation/ingestion automation/notion automation/repair");
    expect(code).toContain("actionlint");
    expect(code).toContain("eslint");

    const uses = [...code.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});
