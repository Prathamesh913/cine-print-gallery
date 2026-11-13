import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLY_CONFIRMATION,
  AUTHORIZED_REPOSITORY,
  MANUAL_APPLY_REF,
  MAX_LIMIT,
  authorizeRun,
  evaluateDispatch,
  runGateCli,
} from "./run-authorization.mjs";

const INGESTION_GATE = "AUTOMATION_INGESTION_ENABLED";
const PUBLISHING_GATE = "AUTOMATION_PUBLISHING_ENABLED";

const MANUAL_DRY_RUN = {
  source: "manual",
  eventName: "workflow_dispatch",
  apply: false,
  limit: "1",
  ref: MANUAL_APPLY_REF,
  repository: AUTHORIZED_REPOSITORY,
  eventRepository: AUTHORIZED_REPOSITORY,
};

const MANUAL_APPLY = {
  ...MANUAL_DRY_RUN,
  apply: true,
  confirmation: APPLY_CONFIRMATION,
  manualApplyEnabled: "true",
};

const SCHEDULED = {
  source: "schedule",
  eventName: "schedule",
  apply: true,
  limit: "10",
  ref: MANUAL_APPLY_REF,
  repository: AUTHORIZED_REPOSITORY,
  eventRepository: AUTHORIZED_REPOSITORY,
  scheduledGate: INGESTION_GATE,
  scheduledEnabled: "true",
};

const DISPATCH = {
  action: "dry-run",
  eventName: "workflow_dispatch",
  limit: "1",
  ref: MANUAL_APPLY_REF,
  repository: AUTHORIZED_REPOSITORY,
  eventRepository: AUTHORIZED_REPOSITORY,
};

function dispatch(overrides: Record<string, unknown> = {}) {
  return evaluateDispatch({ ...DISPATCH, ...overrides });
}

function codes(result: { errors: Array<{ code: string }> }) {
  return result.errors.map((entry) => entry.code);
}

describe("manual dry-run gate", () => {
  it("is allowed while both scheduled lane variables are unset", () => {
    const result = authorizeRun(MANUAL_DRY_RUN);
    expect(result).toMatchObject({ ok: true, errors: [] });
    expect(MANUAL_DRY_RUN).not.toHaveProperty("scheduledEnabled");
    expect(MANUAL_DRY_RUN).not.toHaveProperty("manualApplyEnabled");
  });

  it("is allowed with a longer read-only limit", () => {
    expect(authorizeRun({ ...MANUAL_DRY_RUN, limit: "10" }).ok).toBe(true);
  });

  it("is allowed from a dispatch action without the manual write gate", () => {
    expect(dispatch({ manualApplyEnabled: undefined }).ok).toBe(true);
  });

  it("does not attach a GitHub Environment approval", () => {
    const result = authorizeRun({ ...MANUAL_DRY_RUN, environment: "automation-manual-apply" });
    expect(result).toMatchObject({ ok: true, errors: [] });
  });
});

describe("manual apply gate", () => {
  it("is rejected without the confirmation phrase", () => {
    const result = authorizeRun({ ...MANUAL_APPLY, confirmation: "" });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("confirmation_missing");
  });

  it("is rejected with a wrong confirmation phrase", () => {
    const result = authorizeRun({ ...MANUAL_APPLY, confirmation: "yes" });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("confirmation_missing");
  });

  it("is rejected while AUTOMATION_MANUAL_APPLY_ENABLED is unset", () => {
    const result = authorizeRun({ ...MANUAL_APPLY, manualApplyEnabled: undefined });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("manual_apply_gate_disabled");
  });

  it("is rejected for any limit other than 1", () => {
    for (const limit of ["2", "10", "0", ""]) {
      const result = authorizeRun({ ...MANUAL_APPLY, limit });
      expect(result.ok).toBe(false);
    }
  });

  it("is allowed with confirmation, limit 1 and the manual gate enabled", () => {
    const result = authorizeRun(MANUAL_APPLY);
    expect(result).toMatchObject({ ok: true, errors: [] });
  });

  it("requires no GitHub Environment reviewer approval", () => {
    // The gate has no environment input at all. A stale value on the request is
    // ignored, and the run is authorized by the manual switch plus confirmation.
    const result = authorizeRun({
      ...MANUAL_APPLY,
      environment: "automation-manual-apply",
    });
    expect(result).toMatchObject({ ok: true, errors: [] });
  });

  it("requires no GitHub Environment input", () => {
    expect(MANUAL_APPLY).not.toHaveProperty("environment");
    expect(authorizeRun(MANUAL_APPLY).ok).toBe(true);
  });

  it("rejects a dispatch from a feature branch", () => {
    const result = authorizeRun({ ...MANUAL_APPLY, ref: "refs/heads/feature/test" });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("manual_apply_branch_mismatch");
  });

  it("rejects a missing ref", () => {
    const result = authorizeRun({ ...MANUAL_APPLY, ref: undefined });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("manual_apply_branch_mismatch");
  });

  it("cannot be authorized by a scheduled event", () => {
    const result = authorizeRun({ ...MANUAL_APPLY, eventName: "schedule" });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("event_source_mismatch");
  });

  it("rejects a run from another repository", () => {
    const result = authorizeRun({ ...MANUAL_APPLY, repository: "attacker/fork" });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("repository_mismatch");
  });
});

describe("scheduled gate", () => {
  it("is skipped unless its lane variable is exactly 'true'", () => {
    for (const scheduledEnabled of [undefined, "", "false", "TRUE", "1"]) {
      const result = authorizeRun({ ...SCHEDULED, scheduledEnabled });
      expect(result.ok).toBe(false);
      expect(codes(result)).toContain("scheduled_gate_disabled");
    }
  });

  it("is allowed for a schedule event when the ingestion gate is enabled", () => {
    const result = authorizeRun(SCHEDULED);
    expect(result).toMatchObject({ ok: true, errors: [] });
  });

  it("is allowed for a schedule event when the publishing gate is enabled", () => {
    const result = authorizeRun({ ...SCHEDULED, scheduledGate: PUBLISHING_GATE });
    expect(result).toMatchObject({ ok: true, errors: [] });
  });

  it("does not accept a lane-neutral or manual variable as a scheduled gate", () => {
    for (const scheduledGate of ["AUTOMATION_ENABLED", "AUTOMATION_MANUAL_APPLY_ENABLED", ""]) {
      const result = authorizeRun({ ...SCHEDULED, scheduledGate });
      expect(result.ok).toBe(false);
      expect(codes(result)).toContain("scheduled_gate_unconfigured");
    }
  });

  it("keeps ingestion and publishing activation independent", () => {
    // The ingestion lane reads its own variable; a publishing value cannot arm it
    // and vice versa, because the caller resolves the variable and the gate
    // verifies the exact lane name.
    expect(
      authorizeRun({
        ...SCHEDULED,
        scheduledGate: INGESTION_GATE,
        scheduledEnabled: "true",
      }).ok,
    ).toBe(true);
    expect(
      authorizeRun({
        ...SCHEDULED,
        scheduledGate: PUBLISHING_GATE,
        scheduledEnabled: "true",
      }).ok,
    ).toBe(true);
    expect(
      authorizeRun({
        ...SCHEDULED,
        scheduledGate: INGESTION_GATE,
        scheduledEnabled: "false",
      }).ok,
    ).toBe(false);
    expect(
      authorizeRun({
        ...SCHEDULED,
        scheduledGate: PUBLISHING_GATE,
        scheduledEnabled: "",
      }).ok,
    ).toBe(false);
  });

  it("cannot be reached from a manual dispatch", () => {
    const result = authorizeRun({ ...SCHEDULED, eventName: "workflow_dispatch" });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("event_source_mismatch");
  });

  it("is apply-only", () => {
    const result = authorizeRun({ ...SCHEDULED, apply: false });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("schedule_requires_apply");
  });

  it("does not depend on the manual apply gate", () => {
    expect(authorizeRun({ ...SCHEDULED, manualApplyEnabled: undefined }).ok).toBe(true);
  });

  it("rejects a run whose event repository does not match", () => {
    const result = authorizeRun({ ...SCHEDULED, eventRepository: "attacker/fork" });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("repository_mismatch");
  });
});

describe("dispatch input validation", () => {
  it("rejects an unknown action", () => {
    const result = dispatch({ action: "write" });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("invalid_action");
  });

  it("rejects a missing event name", () => {
    const result = dispatch({ eventName: undefined });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("event_source_mismatch");
  });

  it("rejects a missing repository", () => {
    const result = dispatch({ repository: undefined });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("repository_mismatch");
  });

  it("rejects a missing limit", () => {
    const result = dispatch({ limit: "" });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("invalid_limit");
  });

  it("rejects malformed limits", () => {
    for (const limit of ["abc", "0", "-1", "1.5", " 1", "1e2", String(MAX_LIMIT + 1)]) {
      const result = dispatch({ limit });
      expect(result.ok).toBe(false);
      expect(codes(result)).toContain("invalid_limit");
    }
  });

  it("rejects a malformed max-pages value", () => {
    const result = dispatch({ maxPages: "0" });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("invalid_max_pages");
  });

  it("allows apply only through the fully authorized path", () => {
    const result = dispatch({
      action: "apply",
      confirmation: APPLY_CONFIRMATION,
      manualApplyEnabled: "true",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects apply from a feature branch", () => {
    const result = dispatch({
      action: "apply",
      confirmation: APPLY_CONFIRMATION,
      manualApplyEnabled: "true",
      ref: "refs/heads/feature/test",
    });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("manual_apply_branch_mismatch");
  });

  it("rejects apply from another repository", () => {
    const result = dispatch({
      action: "apply",
      confirmation: APPLY_CONFIRMATION,
      manualApplyEnabled: "true",
      repository: "attacker/fork",
    });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("repository_mismatch");
  });
});

describe("gate CLI", () => {
  it("prints actionable errors and exits non-zero when rejected", () => {
    const lines: string[] = [];
    const errors: string[] = [];
    const exitCode = runGateCli(
      "dispatch",
      {
        GATE_ACTION: "apply",
        GATE_EVENT_NAME: "workflow_dispatch",
        GATE_LIMIT: "2",
        GATE_CONFIRMATION: "",
        GATE_REF: MANUAL_APPLY_REF,
        GATE_REPOSITORY: AUTHORIZED_REPOSITORY,
        GATE_EVENT_REPOSITORY: AUTHORIZED_REPOSITORY,
      },
      (line) => lines.push(line),
      (line) => errors.push(line),
    );
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("::error::");
    expect(errors.join("\n")).toContain("confirmation");
  });

  it("accepts a fully authorized manual apply without an environment", () => {
    const lines: string[] = [];
    const exitCode = runGateCli(
      "authorize",
      {
        GATE_SOURCE: "manual",
        GATE_EVENT_NAME: "workflow_dispatch",
        GATE_APPLY: "true",
        GATE_LIMIT: "1",
        GATE_CONFIRMATION: APPLY_CONFIRMATION,
        GATE_REF: MANUAL_APPLY_REF,
        GATE_REPOSITORY: AUTHORIZED_REPOSITORY,
        GATE_EVENT_REPOSITORY: AUTHORIZED_REPOSITORY,
        GATE_MANUAL_APPLY_ENABLED: "true",
      },
      (line) => lines.push(line),
      (line) => lines.push(line),
    );
    expect(exitCode).toBe(0);
    expect(lines.join("\n")).toContain("manual apply");
  });

  it("rejects a reusable invocation from another repository", () => {
    const errors: string[] = [];
    const exitCode = runGateCli(
      "authorize",
      {
        GATE_SOURCE: "manual",
        GATE_EVENT_NAME: "workflow_dispatch",
        GATE_APPLY: "true",
        GATE_LIMIT: "1",
        GATE_CONFIRMATION: APPLY_CONFIRMATION,
        GATE_REF: MANUAL_APPLY_REF,
        GATE_REPOSITORY: "attacker/fork",
        GATE_EVENT_REPOSITORY: "attacker/fork",
        GATE_MANUAL_APPLY_ENABLED: "true",
      },
      () => undefined,
      (line) => errors.push(line),
    );
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("restricted to");
  });
});

describe("gate CLI entrypoint", () => {
  const entry = path.resolve(__dirname, "run-authorization.mjs");

  function runEntry(env: Record<string, string>) {
    return spawnSync(process.execPath, [entry, "authorize"], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
  }

  it("exits 0 for an authorized manual dry-run", () => {
    const result = runEntry({
      GATE_SOURCE: "manual",
      GATE_EVENT_NAME: "workflow_dispatch",
      GATE_APPLY: "false",
      GATE_LIMIT: "5",
      GATE_REF: MANUAL_APPLY_REF,
      GATE_REPOSITORY: AUTHORIZED_REPOSITORY,
      GATE_EVENT_REPOSITORY: AUTHORIZED_REPOSITORY,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("manual dry-run");
  });

  it("exits non-zero when the scheduled lane gate is absent", () => {
    const result = runEntry({
      GATE_SOURCE: "schedule",
      GATE_EVENT_NAME: "schedule",
      GATE_APPLY: "true",
      GATE_LIMIT: "10",
      GATE_REF: MANUAL_APPLY_REF,
      GATE_SCHEDULED_GATE: INGESTION_GATE,
      GATE_REPOSITORY: AUTHORIZED_REPOSITORY,
      GATE_EVENT_REPOSITORY: AUTHORIZED_REPOSITORY,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(INGESTION_GATE);
  });
});
