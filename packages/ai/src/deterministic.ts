/**
 * Deterministic text for when the model is unavailable (FR-08). No model is
 * involved. Numbers and validated names come from the sanitized input; the
 * status reason and finding summaries are this product's own display text and
 * are only shown to the owner, never sent to the model.
 */

import { sanitizeText } from "@servrsit/ssh";
import { buildAiInput, type ExplainableServer } from "./input.js";

export function deterministicExplanation(server: ExplainableServer): string {
  const input = buildAiInput(server);
  const lines: string[] = [];
  const who = `${input.server.name}${input.server.role === null ? "" : ` (${input.server.role})`}`;
  lines.push(`${who}: ${input.status}. ${sanitizeText(server.statusReason, 300)}`);

  if (input.observedAt !== null) {
    lines.push(`Last successful check: ${input.observedAt}${input.freshUntil === null ? "" : `, fresh until ${input.freshUntil}`}.`);
  } else {
    lines.push("No successful check has been recorded.");
  }
  if (input.latestAttempt !== null && !input.latestAttempt.succeeded) {
    lines.push(
      `The latest attempt failed${input.latestAttempt.failureCode === null ? "" : ` (${input.latestAttempt.failureCode})`}; ${input.latestAttempt.consecutiveFailures} in a row.`,
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
    if (m.pendingUpdates !== null) parts.push(`${m.pendingUpdates} pending updates`);
    if (m.rebootRequired !== null) parts.push(m.rebootRequired ? "reboot required" : "no reboot required");
    if (parts.length > 0) lines.push(`${parts.join("; ")}.`);
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
