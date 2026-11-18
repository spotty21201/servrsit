/**
 * Deterministic text for when the model is not used (FR-08). No model is
 * involved. Numbers and validated names come from the sanitized input; the
 * status reason and finding summaries are this product's own display text and
 * are only shown to the owner, never sent to the model.
 *
 * Times are owner-local with an age (DEF-L1), and the package information
 * states how old it is and that the host refreshed it, not ServrSit (DEF-L2).
 */

import { describeClockSkew, sanitizeText } from "@servrsit/ssh";
import { buildAiInput, type AiServerInput, type ExplainableServer } from "./input.js";
import { controllerClockWarning, type LocalTime, type TimeContext } from "./time.js";

export const NOT_REFRESHED_BY_SERVRSIT = "ServrSit does not refresh package lists.";

const when = (t: LocalTime): string => `${t.at} (${t.age})`;

/** T-061: say how the package time relates to the host's clock, when that matters. */
function clockNote(m: NonNullable<AiServerInput["metrics"]>, ctx: TimeContext): string {
  // T-063: with ServrSit's own clock wrong, the host is not blamed; the warning at the top covers it.
  if (controllerClockWarning(ctx) !== null) return "";
  if (m.packageListsClock === "unverified") return " The host's clock could not be checked, so this time may be wrong.";
  if (m.packageListsClock === "corrected" && m.clock !== null) {
    return ` The host's clock is ${describeClockSkew(m.clock)}; this time is corrected for that.`;
  }
  return "";
}

/** @param clockWarning include the T-063 controller-clock warning line (an overview shows it once instead). */
export function deterministicExplanation(server: ExplainableServer, ctx: TimeContext, clockWarning = true): string {
  const input = buildAiInput(server, ctx);
  const lines: string[] = [];
  const warning = controllerClockWarning(ctx);
  if (warning !== null && clockWarning) lines.push(warning);
  const who = `${input.server.name}${input.server.role === null ? "" : ` (${input.server.role})`}`;
  lines.push(`${who}: ${input.status}. ${sanitizeText(server.statusReason, 300)}`);

  if (input.observed !== null) {
    lines.push(
      `Last successful check: ${when(input.observed)}${input.freshUntil === null ? "" : `; counts as fresh until ${input.freshUntil.at}`}.`,
    );
  } else {
    lines.push("No successful check has been recorded.");
  }
  if (input.latestAttempt !== null && !input.latestAttempt.succeeded) {
    lines.push(
      `The latest attempt at ${input.latestAttempt.at.at} failed${input.latestAttempt.failureCode === null ? "" : ` (${input.latestAttempt.failureCode})`}; ${input.latestAttempt.consecutiveFailures} in a row.`,
    );
  }
  if (input.coverage !== null) {
    lines.push(`Checks completed: ${input.coverage.passed} of ${input.coverage.total}.`);
    if (input.coverage.unavailableChecks.length > 0) {
      lines.push(`Unavailable: ${input.coverage.unavailableChecks.join(", ")}.`);
    }
  }
  const m = input.metrics;
  if (m !== null) {
    const parts: string[] = [];
    if (m.memoryUsedPercent !== null) parts.push(`memory ${m.memoryUsedPercent}% used`);
    if (m.load1 !== null) parts.push(`load ${m.load1}${m.cpuCount === null ? "" : ` on ${m.cpuCount} CPUs`}`);
    if (m.pendingUpdates !== null) parts.push(`${m.pendingUpdates} pending ${m.pendingUpdates === 1 ? "update" : "updates"}`);
    if (m.rebootRequired !== null) parts.push(m.rebootRequired ? "reboot required" : "no reboot required");
    if (parts.length > 0) lines.push(`${parts.join("; ")}.`);
    if (m.pendingOutsideUbuntu !== null && m.pendingOutsideUbuntu.count > 0) {
      const o = m.pendingOutsideUbuntu;
      const names = o.names.length > 0 ? ` (${o.names.slice(0, 5).join(", ")}${o.count > 5 ? ", ..." : ""})` : "";
      const from = o.origins.length > 0 ? ` from ${o.origins.join(", ")}` : "";
      lines.push(`${o.count} of the pending updates${names} come from outside Ubuntu's archive${from}; update plans leave them out.`);
    }
    if (m.packageLists !== null) {
      lines.push(`Package information was last refreshed by the host at ${when(m.packageLists)}. ${NOT_REFRESHED_BY_SERVRSIT}${clockNote(m, ctx)}`);
    } else if (m.pendingUpdates !== null) {
      lines.push(`The age of the package information is unknown. ${NOT_REFRESHED_BY_SERVRSIT}`);
    }
    if (m.filesystems !== null && m.filesystems.length > 0) {
      lines.push(`Disk use: ${m.filesystems.map((f) => `${f.mount} ${f.usedPercent}%`).join(", ")}.`);
    }
    if (m.failedUnits !== null) {
      const total = m.failedUnits.names.length + m.failedUnits.unrecognisedCount;
      lines.push(total === 0 ? "No failed systemd units." : `${total} failed systemd unit(s).`);
    }
  }
  for (const f of server.findings) lines.push(`[${f.severity}] ${sanitizeText(f.summary, 300)}`);
  return lines.join("\n");
}
