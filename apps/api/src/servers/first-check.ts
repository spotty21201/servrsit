/**
 * Turn a read-only collection into the first-check steps of the contract
 * (T-069). Every reason here is ServrSit's own text; nothing from the server
 * is copied into a reason.
 */

import type { FirstCheck, FirstCheckStep } from "@servrsit/contracts";
import { FAILURE_MESSAGES, type CollectionResult, type InspectionObservation } from "@servrsit/ssh";
import { coverageOf } from "../fleet/status.js";

type StepId = FirstCheckStep["id"];

const STEPS: ReadonlyArray<{ readonly id: StepId; readonly label: string }> = [
  { id: "connect", label: "Connecting to the server" },
  { id: "auth", label: "Signing in with ServrSit's key" },
  { id: "host", label: "Reading host facts (CPU, memory, storage, uptime)" },
  { id: "services", label: "Reading failed services" },
  { id: "clock", label: "Comparing the server's clock" },
  { id: "packages", label: "Reading package state" },
];

const NOT_RUN = "Not run because an earlier step failed.";

const UNAVAILABLE: Readonly<Record<Exclude<StepId, "connect" | "auth">, string>> = {
  host: "Some host facts could not be read with this account.",
  services: "Failed services could not be read with this account.",
  clock: "The server's clock could not be read.",
  packages: "Package state could not be read with this account. Everything else still works.",
};

/** Supported targets (Tech Spec §2): Ubuntu Server 24.04 LTS on x86-64. */
export function platformOf(o: InspectionObservation): FirstCheck["platform"] {
  if (o.host.os.status !== "ok") return null;
  const os = o.host.os.value;
  const arch = o.host.architecture.status === "ok" ? o.host.architecture.value : null;
  return {
    supported: os.id === "ubuntu" && os.versionId === "24.04" && (arch === "x86_64" || arch === "amd64"),
    name: os.prettyName.slice(0, 64),
  };
}

export function runningCheck(draftId: string): FirstCheck {
  return {
    draftId,
    steps: STEPS.map((s, i) => ({ id: s.id, label: s.label, state: i === 0 ? "running" : "waiting", reason: null, at: null })),
    finished: false,
    platform: null,
    coverage: null,
    failureCode: null,
  };
}

function step(id: StepId, state: FirstCheckStep["state"], reason: string | null, at: string | null): FirstCheckStep {
  const label = STEPS.find((s) => s.id === id)?.label ?? id;
  return { id, label, state, reason, at };
}

/** Where a failed collection stopped: which step failed, given the fixed failure code. */
function failedStep(code: Extract<CollectionResult, { ok: false }>["failure"]["code"]): StepId {
  if (code === "AUTH_FAILED") return "auth";
  // Sections arrived but did not validate: sign-in worked.
  if (code === "OUTPUT_INVALID") return "host";
  return "connect";
}

export function finishedCheck(draftId: string, result: CollectionResult, at: Date): FirstCheck {
  const iso = at.toISOString();
  if (!result.ok) {
    const failed = failedStep(result.failure.code);
    const index = STEPS.findIndex((s) => s.id === failed);
    return {
      draftId,
      steps: STEPS.map((s, i) =>
        i < index
          ? step(s.id, "done", null, iso)
          : i === index
            ? step(s.id, "failed", FAILURE_MESSAGES[result.failure.code], iso)
            : step(s.id, "unavailable", NOT_RUN, null),
      ),
      finished: true,
      platform: null,
      coverage: null,
      failureCode: result.failure.code,
    };
  }
  const o = result.observation;
  const h = o.host;
  const hostOk = [h.hostname, h.os, h.architecture, h.uptimeSeconds, h.load, h.cpuCount, h.memory, h.filesystems].every((f) => f.status === "ok");
  const servicesOk = o.services.failedUnits.status === "ok";
  const clockOk = h.clock.status === "ok";
  const packagesOk = o.packages.pendingCount.status === "ok";
  const state = (ok: boolean) => (ok ? "done" : "unavailable") as FirstCheckStep["state"];
  const coverage = coverageOf(o);
  return {
    draftId,
    steps: [
      step("connect", "done", null, iso),
      step("auth", "done", null, iso),
      step("host", state(hostOk), hostOk ? null : UNAVAILABLE.host, iso),
      step("services", state(servicesOk), servicesOk ? null : UNAVAILABLE.services, iso),
      step("clock", state(clockOk), clockOk ? null : UNAVAILABLE.clock, iso),
      step("packages", state(packagesOk), packagesOk ? null : UNAVAILABLE.packages, iso),
    ],
    finished: true,
    platform: platformOf(o),
    coverage: { passed: coverage.passed, total: coverage.total },
    failureCode: null,
  };
}
