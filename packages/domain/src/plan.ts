/**
 * Plans (Technical Spec §9.1).
 *
 * A plan is an immutable, versioned record with a canonical digest and a
 * 15-minute expiry. It is derived deterministically from a server's facts and
 * a read-only transaction preview. A plan may carry typed blockers; a blocked
 * plan cannot be approved by any path.
 *
 * Scope is exact: package name, architecture, from-version, to-version. The
 * plan states explicitly that it includes no service restart and no reboot
 * (invariant 5: those need their own plans and approvals).
 */

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
};

export interface PackageChange {
  readonly name: string;
  readonly arch: string;
  readonly from: string;
  readonly to: string;
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
    readonly packages: readonly PackageChange[];
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
}

const block = (code: BlockerCode): Blocker => ({ code, message: BLOCKER_MESSAGES[code] });

/** The digest covers every field of the plan except the digest itself. */
export function planDigest(plan: Omit<Plan, "digest">): string {
  return digestOf(plan);
}

export function buildPlan(input: BuildPlanInput): Plan {
  const blockers: Blocker[] = [];
  if (!input.server.writesEnabled) blockers.push(block("WRITES_DISABLED"));
  if (input.unresolved === "outcome_unknown") blockers.push(block("OUTCOME_UNKNOWN"));
  else if (input.unresolved !== null) blockers.push(block("TARGET_BUSY"));

  const preview = input.preview;
  let packages: PackageChange[] = [];
  if (preview === null) {
    if (input.server.writesEnabled) blockers.push(block("PLAN_UNAVAILABLE"));
  } else {
    if (preview.upgrades.some((c) => !validChange(c))) blockers.push(block("PLAN_UNAVAILABLE"));
    else packages = [...preview.upgrades].sort((a, b) => a.name.localeCompare(b.name) || a.arch.localeCompare(b.arch));
    if (preview.removals.length > 0) blockers.push(block("PACKAGE_REMOVAL_UNSUPPORTED"));
    if (preview.downgrades.length > 0) blockers.push(block("DOWNGRADE_UNSUPPORTED"));
    if (preview.held.length > 0) blockers.push(block("HELD_PACKAGE"));
    if (preview.locked) blockers.push(block("PACKAGE_LOCKED"));
    if (packages.length === 0 && blockers.every((b) => b.code !== "PLAN_UNAVAILABLE")) blockers.push(block("NO_CHANGES"));
  }

  const body: Omit<Plan, "digest"> = {
    id: input.id,
    version: input.version,
    operation: input.operation,
    serverId: input.server.id,
    production: input.server.production,
    scope: { packages, includesServiceRestart: false, includesReboot: false },
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
