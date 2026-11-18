/**
 * Plans (Technical Spec §9.1).
 *
 * A plan is an immutable, versioned record with a canonical digest and a
 * 15-minute expiry. It is derived deterministically from a server's facts and
 * a read-only transaction preview. A plan may carry typed blockers; a blocked
 * plan cannot be approved by any path.
 *
 * Only updates from Ubuntu's own archive enter the scope (T-062, Tech Spec
 * §10.2 step 2). Updates from any other origin, or with no known origin, are
 * listed in `excludedPackages` and are never part of the transaction.
 *
 * Scope is exact: package name, architecture, from-version, to-version. The
 * plan states explicitly that it includes no service restart and no reboot
 * (invariant 5: those need their own plans and approvals).
 */

import { isUbuntuArchiveOrigin } from "@servrsit/contracts";
import { digestOf } from "./canonical.js";
import type { OperationId } from "./catalog.js";

export const PLAN_TTL_MS = 15 * 60_000;

export const BLOCKER_CODES = [
  /** Writes are disabled for this server (ADR-014 gate). */
  "WRITES_DISABLED",
  /** Another unresolved operation is active on this server. */
  "TARGET_BUSY",
  /** A previous operation's outcome is unknown; it must be reconciled first. */
  "OUTCOME_UNKNOWN",
  /** No transaction preview could be produced. */
  "PLAN_UNAVAILABLE",
  /** Nothing to change. */
  "NO_CHANGES",
  /** The transaction would remove packages (not supported in Stage A). */
  "PACKAGE_REMOVAL_UNSUPPORTED",
  /** The transaction would downgrade packages. */
  "DOWNGRADE_UNSUPPORTED",
  /** Held packages are involved; holds are never overridden. */
  "HELD_PACKAGE",
  /** The package manager is locked by another process. */
  "PACKAGE_LOCKED",
  /** Every pending update comes from outside Ubuntu's archive, and those are excluded by default (T-062). */
  "ONLY_EXCLUDED_PACKAGES",
  /** ServrSit's own clock is wrong or unverified, so expiries and freshness cannot be trusted (T-063). */
  "CONTROLLER_CLOCK_UNTRUSTED",
] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];

export interface Blocker {
  readonly code: BlockerCode;
  /** Fixed text written by this module. Never contains remote output. */
  readonly message: string;
}

export const BLOCKER_MESSAGES: Readonly<Record<BlockerCode, string>> = {
  WRITES_DISABLED: "Changes are disabled for this server until disposable-server tests pass and live work is authorized.",
  TARGET_BUSY: "Another operation on this server has not finished.",
  OUTCOME_UNKNOWN: "The result of a previous operation on this server is not confirmed. It must be reconciled first.",
  PLAN_UNAVAILABLE: "No package transaction could be prepared for this server.",
  NO_CHANGES: "There are no package updates to apply.",
  PACKAGE_REMOVAL_UNSUPPORTED: "The update would remove packages, which is not supported.",
  DOWNGRADE_UNSUPPORTED: "The update would downgrade packages, which is not supported.",
  HELD_PACKAGE: "The update involves held packages. Holds are never overridden.",
  PACKAGE_LOCKED: "The package manager is in use by another process.",
  ONLY_EXCLUDED_PACKAGES:
    "The only pending updates come from sources outside Ubuntu's archive. Update plans leave those out by default.",
  CONTROLLER_CLOCK_UNTRUSTED:
    "ServrSit's own clock is wrong or unverified, so plan expiry and data freshness cannot be trusted. Fix the clock on the ServrSit machine first.",
};

export interface PackageChange {
  readonly name: string;
  readonly arch: string;
  readonly from: string;
  readonly to: string;
  /**
   * The origin the target's package manager reported (for example
   * "Ubuntu:24.04/noble-updates" or "Docker CE:noble"). A change without one
   * is treated as outside Ubuntu's archive.
   */
  readonly origin?: string | undefined;
}

/** An update the plan leaves out, and why (T-062). */
export interface ExcludedPackage {
  readonly name: string;
  readonly arch: string;
  readonly from: string;
  readonly to: string;
  /** Validated origin label, or "(unknown)" when the target reported none or an unrecognised one. */
  readonly origin: string;
  readonly reason: "outside-ubuntu-archive";
}

/** Read-only preview of the transaction a target would perform. */
export interface TransactionPreview {
  readonly upgrades: readonly PackageChange[];
  readonly removals: readonly string[];
  readonly downgrades: readonly string[];
  readonly held: readonly string[];
  readonly locked: boolean;
  /** Digest of the observed package state the preview was computed from. */
  readonly stateDigest: string;
}

export interface PlanServer {
  readonly id: string;
  readonly production: boolean;
  readonly writesEnabled: boolean;
}

export interface Plan {
  readonly id: string;
  readonly version: number;
  readonly operation: OperationId;
  readonly serverId: string;
  readonly production: boolean;
  readonly scope: {
    /** The exact transaction: Ubuntu-archive updates only, without origin labels. */
    readonly packages: readonly PackageChange[];
    /** Pending updates the plan leaves out (T-062). Shown to the owner; never applied. */
    readonly excludedPackages: readonly ExcludedPackage[];
    readonly includesServiceRestart: false;
    readonly includesReboot: false;
  };
  readonly preconditions: { readonly previewDigest: string };
  readonly verification: { readonly expectInstalled: Readonly<Record<string, string>> };
  /** Acknowledgements the owner must give before approving. */
  readonly requiredAcknowledgements: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly blockers: readonly Blocker[];
  readonly digest: string;
}

export const PRODUCTION_ACK = "production-impact" as const;

const PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]{0,99}$/;
const ARCH = /^[a-z0-9_-]{1,20}$/;
const VERSION = /^[A-Za-z0-9.+~:-]{1,100}$/;
const ORIGIN_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:/,+~-]{0,63}$/;

function validChange(c: PackageChange): boolean {
  return PACKAGE_NAME.test(c.name) && ARCH.test(c.arch) && VERSION.test(c.from) && VERSION.test(c.to);
}

export interface BuildPlanInput {
  readonly id: string;
  readonly version: number;
  readonly operation: OperationId;
  readonly server: PlanServer;
  /** Null when no preview could be obtained (for example writes are disabled and nothing was asked). */
  readonly preview: TransactionPreview | null;
  /** State of this server's unresolved operation, if any. */
  readonly unresolved: "queued" | "running" | "verifying" | "outcome_unknown" | null;
  readonly now: Date;
  /** T-063: false when ServrSit's own clock is untrusted. */
  readonly controllerClockTrusted: boolean;
}

const block = (code: BlockerCode): Blocker => ({ code, message: BLOCKER_MESSAGES[code] });

/** The digest covers every field of the plan except the digest itself. */
export function planDigest(plan: Omit<Plan, "digest">): string {
  return digestOf(plan);
}

export function buildPlan(input: BuildPlanInput): Plan {
  const blockers: Blocker[] = [];
  if (!input.server.writesEnabled) blockers.push(block("WRITES_DISABLED"));
  if (!input.controllerClockTrusted) blockers.push(block("CONTROLLER_CLOCK_UNTRUSTED"));
  if (input.unresolved === "outcome_unknown") blockers.push(block("OUTCOME_UNKNOWN"));
  else if (input.unresolved !== null) blockers.push(block("TARGET_BUSY"));

  const preview = input.preview;
  let packages: PackageChange[] = [];
  let excludedPackages: ExcludedPackage[] = [];
  if (preview === null) {
    if (input.server.writesEnabled) blockers.push(block("PLAN_UNAVAILABLE"));
  } else {
    if (preview.upgrades.some((c) => !validChange(c))) blockers.push(block("PLAN_UNAVAILABLE"));
    else {
      const sorted = [...preview.upgrades].sort((a, b) => a.name.localeCompare(b.name) || a.arch.localeCompare(b.arch));
      const fromUbuntu = (c: PackageChange) => c.origin !== undefined && ORIGIN_LABEL.test(c.origin) && isUbuntuArchiveOrigin(c.origin);
      packages = sorted.filter(fromUbuntu).map(({ name, arch, from, to }) => ({ name, arch, from, to }));
      excludedPackages = sorted
        .filter((c) => !fromUbuntu(c))
        .map(({ name, arch, from, to, origin }) => ({
          name, arch, from, to,
          origin: origin !== undefined && ORIGIN_LABEL.test(origin) ? origin : "(unknown)",
          reason: "outside-ubuntu-archive" as const,
        }));
    }
    if (preview.removals.length > 0) blockers.push(block("PACKAGE_REMOVAL_UNSUPPORTED"));
    if (preview.downgrades.length > 0) blockers.push(block("DOWNGRADE_UNSUPPORTED"));
    if (preview.held.length > 0) blockers.push(block("HELD_PACKAGE"));
    if (preview.locked) blockers.push(block("PACKAGE_LOCKED"));
    if (packages.length === 0 && blockers.every((b) => b.code !== "PLAN_UNAVAILABLE")) {
      blockers.push(block(excludedPackages.length > 0 ? "ONLY_EXCLUDED_PACKAGES" : "NO_CHANGES"));
    }
  }

  const body: Omit<Plan, "digest"> = {
    id: input.id,
    version: input.version,
    operation: input.operation,
    serverId: input.server.id,
    production: input.server.production,
    scope: { packages, excludedPackages, includesServiceRestart: false, includesReboot: false },
    preconditions: { previewDigest: preview?.stateDigest ?? "none" },
    verification: {
      expectInstalled: Object.fromEntries(packages.map((c) => [`${c.name}:${c.arch}`, c.to])),
    },
    requiredAcknowledgements: input.server.production ? [PRODUCTION_ACK] : [],
    createdAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + PLAN_TTL_MS).toISOString(),
    blockers,
  };
  return { ...body, digest: planDigest(body) };
}

export function isExpired(plan: Pick<Plan, "expiresAt">, now: Date): boolean {
  return now.getTime() >= Date.parse(plan.expiresAt);
}

/** Recompute the digest; false means the stored plan was altered. */
export function verifyPlanDigest(plan: Plan): boolean {
  const { digest, ...body } = plan;
  return planDigest(body) === digest;
}
