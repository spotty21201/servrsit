/**
 * Deterministic, versioned finding rules (Technical Spec §14).
 *
 * - Disk and inode usage: warning at 85%, critical at 95%, and only when the
 *   threshold is met in two successive successful observations. A first
 *   observation over the line is an advisory, never a warning.
 * - Two consecutive failed scheduled connections create an unreachable finding.
 * - A changed host key is a critical finding on the FIRST occurrence (O2). It
 *   is a security event: inspection and changes stay blocked until the owner
 *   reverifies the key out of band. No confirmation window applies.
 * - CPU and memory produce no finding: the spec requires a documented
 *   sampling method and sustained-sample rule first.
 * - Unavailable checks are not findings (and never resolve one).
 *
 * Names that came from a server are only echoed into text when they pass the
 * well-formedness check. Findings are built from our own templates.
 */

import { isSafeMountPath, isSafeUnitName, type InspectionObservation } from "@servrsit/ssh";
import type { Finding } from "./schema.js";

const WARNING = 85;
const CRITICAL = 95;
const MAX_UNIT_FINDINGS = 20;

type Severity = Finding["severity"];
const ORDER: Record<Severity, number> = { critical: 0, warning: 1, advisory: 2 };

interface Usage {
  readonly mount: string;
  readonly percent: number;
}

function filesystemUsage(o: InspectionObservation | null): Usage[] | null {
  if (o === null || o.host.filesystems.status !== "ok") return null;
  return o.host.filesystems.value.entries.map((e) => ({ mount: e.mount, percent: e.usedPercent }));
}

function inodeUsage(o: InspectionObservation | null): Usage[] | null {
  if (o === null || o.host.inodes.status !== "ok") return null;
  return o.host.inodes.value.entries.map((e) => ({ mount: e.mount, percent: e.usedPercent }));
}

function levelFor(percent: number): Severity | null {
  if (percent >= CRITICAL) return "critical";
  if (percent >= WARNING) return "warning";
  return null;
}

function mountLabel(mount: string): string {
  return isSafeMountPath(mount) ? mount : "(unrecognised mount name)";
}

function usageFindings(
  kind: "disk" | "inode",
  current: Usage[] | null,
  previous: Usage[] | null,
): Finding[] {
  if (current === null) return [];
  const out: Finding[] = [];
  const noun = kind === "disk" ? "Disk space" : "Inode";
  for (const now of current) {
    const nowLevel = levelFor(now.percent);
    if (nowLevel === null) continue;
    const before = previous?.find((p) => p.mount === now.mount);
    const id = `${kind}:${now.mount}`;
    const rule = `${kind}.usage.v1`;
    if (before === undefined) {
      out.push({
        id, rule, severity: "advisory",
        summary: `${noun} on ${mountLabel(now.mount)} is at ${now.percent}%. A second successful check is needed to confirm.`,
      });
      continue;
    }
    const confirmed = levelFor(Math.min(now.percent, before.percent));
    if (confirmed === null) {
      out.push({
        id, rule, severity: "advisory",
        summary: `${noun} on ${mountLabel(now.mount)} is at ${now.percent}% but was ${before.percent}% on the previous check.`,
      });
      continue;
    }
    out.push({
      id, rule, severity: confirmed,
      summary: `${noun} on ${mountLabel(now.mount)} is at ${now.percent}% (previous check ${before.percent}%).`,
    });
  }
  return out;
}

export interface FindingsInput {
  readonly current: InspectionObservation | null;
  readonly previous: InspectionObservation | null;
  readonly consecutiveFailures: number;
  readonly latestFailureCode: string | null;
}

export function evaluateFindings(input: FindingsInput): Finding[] {
  const findings: Finding[] = [];
  const { current, previous } = input;

  if (input.latestFailureCode === "HOST_KEY_CHANGED") {
    findings.push({
      id: "host-key-changed", rule: "host.key-changed.v1", severity: "critical",
      summary:
        "The host key no longer matches the pinned key. Inspection is blocked. Verify the new fingerprint independently (for example from the provider console) before trusting this host again.",
    });
  }

  if (
    input.consecutiveFailures >= 2 &&
    (input.latestFailureCode === "ROUTE_UNAVAILABLE" || input.latestFailureCode === "TIMEOUT")
  ) {
    findings.push({
      id: "unreachable", rule: "connection.unreachable.v1", severity: "warning",
      summary: `The last ${input.consecutiveFailures} scheduled checks could not reach this host.`,
    });
  }

  if (current !== null) {
    findings.push(...usageFindings("disk", filesystemUsage(current), filesystemUsage(previous)));
    findings.push(...usageFindings("inode", inodeUsage(current), inodeUsage(previous)));

    if (current.services.failedUnits.status === "ok") {
      const { units, unparsedLineCount } = current.services.failedUnits.value;
      let unrecognised = unparsedLineCount;
      for (const u of units.slice(0, MAX_UNIT_FINDINGS)) {
        if (!u.nameValid || !isSafeUnitName(u.unit)) {
          unrecognised += 1;
          continue;
        }
        findings.push({
          id: `unit:${u.unit}`, rule: "systemd.failed-unit.v1", severity: "warning",
          summary: `Systemd unit ${u.unit} is in a failed state.`,
        });
      }
      unrecognised += Math.max(0, units.length - MAX_UNIT_FINDINGS);
      if (unrecognised > 0) {
        findings.push({
          id: "unit:unrecognised", rule: "systemd.failed-unit.v1", severity: "warning",
          summary: `${unrecognised} failed systemd unit(s) have names that could not be validated.`,
        });
      }
    }

    if (current.packages.pendingCount.status === "ok" && current.packages.pendingCount.value > 0) {
      const n = current.packages.pendingCount.value;
      findings.push({
        id: "updates-pending", rule: "packages.pending.v1", severity: "advisory",
        summary: `${n} package update${n === 1 ? "" : "s"} pending, from the host's existing package information (not refreshed by ServrSit).`,
      });
    }

    if (current.packages.rebootRequired.status === "ok" && current.packages.rebootRequired.value) {
      findings.push({
        id: "reboot-required", rule: "packages.reboot-required.v1", severity: "advisory",
        summary: "The host reports that a reboot is required.",
      });
    }
  }

  return findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.id.localeCompare(b.id));
}
