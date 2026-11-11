#!/usr/bin/env node
/**
 * Activation gates for the catalogue automation workflows.
 *
 * The gates are deliberately independent:
 *
 * - Manual dry-run: always allowed, never writes, no recurring switch.
 * - Manual apply: requires AUTOMATION_MANUAL_APPLY_ENABLED, the exact
 *   confirmation phrase and a limit of exactly one poster.
 * - Scheduled runs: require AUTOMATION_ENABLED, the `schedule` event and an
 *   apply run. A manual dispatch can never satisfy the scheduled gate, and a
 *   scheduled event can never satisfy the manual gate.
 *
 * This module is plain ESM so the GitHub Actions gate step can run it with
 * `node` before dependencies are installed. Tests import the same functions, so
 * the rules exercised by the tests are the rules GitHub evaluates.
 */

export const APPLY_CONFIRMATION = "APPLY-ONE-POSTER";
export const ACTIONS = ["dry-run", "apply"];
export const SOURCES = ["manual", "schedule"];
export const MAX_LIMIT = 100;
export const MAX_PAGES = 20;

/**
 * Reusable workflows in a public repository can be called from other
 * repositories. Production automation must only ever run from this repository,
 * so both the workflow repository and the event repository must match.
 */
export const AUTHORIZED_REPOSITORY = "Prathamesh913/cine-print-gallery";

const RULES = {
  manual: {
    eventName: "workflow_dispatch",
  },
  schedule: {
    eventName: "schedule",
  },
};

function parseBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function parsePositiveInteger(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function error(code, message) {
  return { code, message };
}

/**
 * Validate one authorization request.
 *
 * @param {{
 *   source: string,
 *   eventName: string,
 *   apply: boolean | string,
 *   limit: number | string,
 *   maxPages?: number | string | null,
 *   confirmation?: string,
 *   environment?: string,
 *   repository?: string,
 *   eventRepository?: string,
 *   automationEnabled?: string | null,
 *   manualApplyEnabled?: string | null,
 * }} input
 * @returns {{ ok: boolean, errors: Array<{code: string, message: string}> }}
 */
export function authorizeRun(input) {
  const errors = [];
  const source = String(input.source ?? "").trim();
  const eventName = String(input.eventName ?? "").trim();
  const apply = parseBoolean(input.apply);
  const limit = parsePositiveInteger(input.limit);
  const hasMaxPages =
    input.maxPages !== undefined && input.maxPages !== null && String(input.maxPages).trim() !== "";
  const maxPages = hasMaxPages ? parsePositiveInteger(input.maxPages) : undefined;
  const confirmation = String(input.confirmation ?? "");
  const environment = String(input.environment ?? "").trim();
  const repository = String(input.repository ?? "").trim();
  const eventRepository = String(input.eventRepository ?? "").trim();

  if (!SOURCES.includes(source)) {
    errors.push(
      error("invalid_source", `source must be one of ${SOURCES.join(", ")}; received "${source}"`),
    );
  }
  if (apply === null) {
    errors.push(error("invalid_apply", "apply must be true or false"));
  }
  if (limit === null) {
    errors.push(error("invalid_limit", `limit must be a positive integer (maximum ${MAX_LIMIT})`));
  } else if (limit > MAX_LIMIT) {
    errors.push(error("invalid_limit", `limit must not exceed ${MAX_LIMIT}`));
  }
  if (hasMaxPages && (maxPages === null || maxPages > MAX_PAGES)) {
    errors.push(
      error("invalid_max_pages", `max-pages must be a positive integer (maximum ${MAX_PAGES})`),
    );
  }
  if (repository !== AUTHORIZED_REPOSITORY || eventRepository !== AUTHORIZED_REPOSITORY) {
    errors.push(
      error(
        "repository_mismatch",
        `automation runs are restricted to the ${AUTHORIZED_REPOSITORY} repository`,
      ),
    );
  }

  if (SOURCES.includes(source)) {
    const expectedEvent = RULES[source].eventName;
    if (eventName !== expectedEvent) {
      errors.push(
        error(
          "event_source_mismatch",
          `a ${source} run requires the ${expectedEvent} event; received "${eventName}"`,
        ),
      );
    }

    if (source === "schedule") {
      if (input.automationEnabled !== "true") {
        errors.push(
          error(
            "scheduled_gate_disabled",
            "scheduled runs require the repository variable AUTOMATION_ENABLED to be exactly 'true'",
          ),
        );
      }
      if (apply === false) {
        errors.push(
          error("schedule_requires_apply", "scheduled runs are apply-only; apply must be true"),
        );
      }
    }

    if (source === "manual" && apply === true) {
      if (input.manualApplyEnabled !== "true") {
        errors.push(
          error(
            "manual_apply_gate_disabled",
            "manual apply requires the repository variable AUTOMATION_MANUAL_APPLY_ENABLED to be exactly 'true'",
          ),
        );
      }
      if (confirmation !== APPLY_CONFIRMATION) {
        errors.push(
          error(
            "confirmation_missing",
            `manual apply requires the confirmation phrase "${APPLY_CONFIRMATION}"`,
          ),
        );
      }
      if (limit !== 1) {
        errors.push(
          error(
            "manual_apply_requires_single_poster",
            "manual apply is restricted to a single poster; limit must be exactly 1",
          ),
        );
      }
    }

    // The environment is part of the authorization: a manual apply that tries to
    // reuse the unprotected scheduled environment is rejected.
    const expectedEnvironment =
      source === "schedule"
        ? "automation-scheduled"
        : apply === true
          ? "automation-manual-apply"
          : apply === false
            ? "automation-manual-dry-run"
            : null;
    if (expectedEnvironment) {
      if (!environment) {
        errors.push(
          error(
            "environment_missing",
            `a ${source}${apply === true ? " apply" : ""} run requires the ${expectedEnvironment} environment`,
          ),
        );
      } else if (environment !== expectedEnvironment) {
        errors.push(
          error(
            "environment_mismatch",
            `a ${source}${apply === true ? " apply" : ""} run requires the ${expectedEnvironment} environment; received "${environment}"`,
          ),
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate a workflow_dispatch action and map it onto the manual gate.
 *
 * @param {{
 *   action: string,
 *   eventName?: string,
 *   limit: number | string,
 *   maxPages?: number | string | null,
 *   confirmation?: string,
 *   repository?: string,
 *   eventRepository?: string,
 *   manualApplyEnabled?: string | null,
 * }} input
 */
export function evaluateDispatch(input) {
  const action = String(input.action ?? "").trim();
  if (!ACTIONS.includes(action)) {
    return {
      ok: false,
      errors: [
        error(
          "invalid_action",
          `action must be one of ${ACTIONS.join(", ")}; received "${action}"`,
        ),
      ],
    };
  }

  return authorizeRun({
    source: "manual",
    eventName: input.eventName,
    apply: action === "apply",
    limit: input.limit,
    maxPages: input.maxPages,
    confirmation: input.confirmation,
    repository: input.repository,
    eventRepository: input.eventRepository,
    environment: action === "apply" ? "automation-manual-apply" : "automation-manual-dry-run",
    manualApplyEnabled: input.manualApplyEnabled,
  });
}

function readEnv(env) {
  return {
    source: env.GATE_SOURCE,
    eventName: env.GATE_EVENT_NAME,
    apply: env.GATE_APPLY,
    limit: env.GATE_LIMIT,
    maxPages: env.GATE_MAX_PAGES,
    confirmation: env.GATE_CONFIRMATION,
    environment: env.GATE_ENVIRONMENT,
    repository: env.GATE_REPOSITORY,
    eventRepository: env.GATE_EVENT_REPOSITORY,
    automationEnabled: env.GATE_AUTOMATION_ENABLED,
    manualApplyEnabled: env.GATE_MANUAL_APPLY_ENABLED,
  };
}

/**
 * CLI used by the workflow gate steps.
 *
 * `dispatch` validates workflow_dispatch inputs; `authorize` re-checks the
 * resolved run inside the reusable workflow before any dependency install or
 * credential use.
 */
export function runGateCli(
  mode,
  env = process.env,
  write = (line) => console.log(line),
  writeError = (line) => console.error(line),
) {
  const inputs = readEnv(env);
  let result;

  if (mode === "dispatch") {
    result = evaluateDispatch({
      action: env.GATE_ACTION,
      eventName: inputs.eventName,
      limit: inputs.limit,
      maxPages: inputs.maxPages,
      confirmation: inputs.confirmation,
      repository: inputs.repository,
      eventRepository: inputs.eventRepository,
      manualApplyEnabled: inputs.manualApplyEnabled,
    });
  } else if (mode === "authorize") {
    result = authorizeRun(inputs);
  } else {
    writeError(`::error::Unknown gate mode "${mode}" (expected dispatch or authorize)`);
    return 1;
  }

  if (!result.ok) {
    for (const { message } of result.errors) writeError(`::error::${message}`);
    writeError(
      `Automation run rejected (${mode}). No checkout install, external call, or write was performed.`,
    );
    return 1;
  }

  const effectiveSource = mode === "dispatch" ? "manual" : inputs.source;
  const effectiveApply =
    mode === "dispatch"
      ? env.GATE_ACTION === "apply"
      : inputs.apply === "true" || inputs.apply === true;
  const label =
    effectiveSource === "schedule"
      ? "scheduled apply"
      : effectiveApply
        ? "manual apply"
        : "manual dry-run";
  write(`Authorized ${label} run.`);
  return 0;
}

const invokedPath = process.argv[1] ?? "";
const isMain = invokedPath.endsWith("run-authorization.mjs");

if (isMain) {
  process.exitCode = runGateCli(process.argv[2] ?? "authorize");
}
