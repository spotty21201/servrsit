/**
 * Stage A action plans besides packages (T-059, PRD FR-13/FR-15, Tech Spec
 * §8.1, §8.3). BUILD ONLY: every real server has writes disabled, so these can
 * be prepared and approved only for simulated servers.
 *
 * Each kind is its own plan and its own approval (invariant 5):
 *  - restart.service.v1: one unit from the owner-selected set. Never reboots.
 *    Verified by the unit being active with a NEW start time.
 *  - reboot.host.v1: the whole machine. Never presented as a restart.
 *    Verified by a NEW boot id once the server answers again.
 *  - prepare.directories.v1: create missing directories under /srv or the
 *    user's home, with the owner, group and mode the owner approved. Existing
 *    paths are listed and left untouched; nothing is overwritten or reowned.
 *    Verified by each path existing with exactly that owner, group and mode.
 */

import { digestOf } from "./canonical.js";
import {
  block,
  commonBlockers,
  PLAN_TTL_MS,
  PRODUCTION_ACKS,
  type Blocker,
  type CommonPlanInput,
  type PlanBase,
} from "./plan.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RestartPlan extends PlanBase {
  readonly operation: "restart.service.v1";
  readonly scope: { readonly unit: string; readonly includesServiceRestart: true; readonly includesReboot: false };
  /** Success: the unit is active and its start time differs from this one. */
  readonly verification: { readonly unit: string; readonly previousActiveSince: string | null };
}

export interface RebootPlan extends PlanBase {
  readonly operation: "reboot.host.v1";
  readonly scope: { readonly includesServiceRestart: false; readonly includesReboot: true };
  /** Success: the server answers with a boot id different from this one. */
  readonly verification: { readonly previousBootId: string };
}

export interface DirectorySpec {
  readonly path: string;
  readonly owner: string;
  readonly group: string;
  /** Octal text, for example "0750". */
  readonly mode: string;
}

export interface DirectoriesPlan extends PlanBase {
  readonly operation: "prepare.directories.v1";
  readonly scope: {
    /** What the owner asked for, as asked. */
    readonly requested: readonly DirectorySpec[];
    /** What will be created. */
    readonly directories: readonly DirectorySpec[];
    /** Paths that already exist: left exactly as they are. */
    readonly existing: readonly string[];
    readonly includesServiceRestart: false;
    readonly includesReboot: false;
  };
  readonly verification: { readonly expectDirectories: readonly DirectorySpec[] };
}

/** Read-only previews the target gives for each kind. */
export interface ServicePreview {
  readonly exists: boolean;
  readonly active: boolean;
  readonly activeSince: string | null;
  readonly stateDigest: string;
}
export interface BootPreview {
  readonly bootId: string;
  readonly stateDigest: string;
}
export interface DirectoriesPreview {
  /** Requested paths that already exist (anything at the path, directory or not). */
  readonly existing: readonly string[];
  readonly stateDigest: string;
}

// ---------------------------------------------------------------------------
// Validation (Tech Spec §8.3)
// ---------------------------------------------------------------------------

const UNIT = /^[A-Za-z0-9][A-Za-z0-9@_.:-]{0,95}\.service$/;
const ACCOUNT = /^[a-z_][a-z0-9_-]{0,31}$/;
const MODE = /^0?[0-7]{3}$/;
const PATH_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_DEPTH = 8;

export function isRestartableUnitName(unit: string): boolean {
  return UNIT.test(unit);
}

/**
 * Allowed: absolute, normalised, under /srv/ or /home/<user>/, every component
 * plain (no "..", no hidden components, so never ~/.ssh), at most 8 deep.
 * The target re-checks without following symlinks.
 */
export function directoryAllowed(spec: DirectorySpec, user: string): boolean {
  if (!ACCOUNT.test(spec.owner) || !ACCOUNT.test(spec.group)) return false;
  if (!MODE.test(spec.mode)) return false;
  const mode = Number.parseInt(spec.mode, 8);
  // No setuid, setgid or sticky bits, nothing writable by others, and the owner can enter it.
  if (mode > 0o777 || (mode & 0o002) !== 0 || (mode & 0o700) !== 0o700) return false;
  if (!spec.path.startsWith("/") || spec.path.endsWith("/") || spec.path.includes("//")) return false;
  const parts = spec.path.slice(1).split("/");
  if (parts.length > MAX_DEPTH || !parts.every((p) => PATH_PART.test(p))) return false;
  const underSrv = parts[0] === "srv" && parts.length >= 2;
  const underHome = ACCOUNT.test(user) && parts[0] === "home" && parts[1] === user && parts.length >= 3;
  return underSrv || underHome;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

interface ActionInput extends CommonPlanInput {
  readonly id: string;
  readonly version: number;
  readonly now: Date;
}

function finish<T extends { operation: string }>(input: ActionInput, blockers: Blocker[], previewDigest: string | null, rest: T) {
  const body = {
    id: input.id,
    version: input.version,
    ...rest,
    serverId: input.server.id,
    production: input.server.production,
    preconditions: { previewDigest: previewDigest ?? "none" },
    requiredAcknowledgements: input.server.production ? [...PRODUCTION_ACKS] : [],
    createdAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + PLAN_TTL_MS).toISOString(),
    blockers,
  };
  return { ...body, digest: digestOf(body) };
}

export function buildRestartPlan(
  input: ActionInput & { readonly unit: string; readonly selectedUnits: readonly string[]; readonly preview: ServicePreview | null },
): RestartPlan {
  const blockers = commonBlockers(input);
  if (!isRestartableUnitName(input.unit) || !input.selectedUnits.includes(input.unit)) blockers.push(block("UNIT_NOT_SELECTED"));
  else if (input.preview === null) {
    if (input.server.writesEnabled) blockers.push(block("PLAN_UNAVAILABLE"));
  } else if (!input.preview.exists) blockers.push(block("UNIT_NOT_FOUND"));
  return finish(input, blockers, input.preview?.stateDigest ?? null, {
    operation: "restart.service.v1" as const,
    scope: { unit: input.unit, includesServiceRestart: true as const, includesReboot: false as const },
    verification: { unit: input.unit, previousActiveSince: input.preview?.activeSince ?? null },
  });
}

export function buildRebootPlan(input: ActionInput & { readonly preview: BootPreview | null }): RebootPlan {
  const blockers = commonBlockers(input);
  if (input.preview === null && input.server.writesEnabled) blockers.push(block("PLAN_UNAVAILABLE"));
  return finish(input, blockers, input.preview?.stateDigest ?? null, {
    operation: "reboot.host.v1" as const,
    scope: { includesServiceRestart: false as const, includesReboot: true as const },
    verification: { previousBootId: input.preview?.bootId ?? "unknown" },
  });
}

export function buildDirectoriesPlan(
  input: ActionInput & { readonly requested: readonly DirectorySpec[]; readonly user: string; readonly preview: DirectoriesPreview | null },
): DirectoriesPlan {
  const blockers = commonBlockers(input);
  const requested = [...input.requested].sort((a, b) => a.path.localeCompare(b.path));
  const allowed = requested.length > 0 && requested.every((d) => directoryAllowed(d, input.user));
  let directories: DirectorySpec[] = [];
  let existing: string[] = [];
  if (!allowed) blockers.push(block("DIRECTORY_NOT_ALLOWED"));
  else if (input.preview === null) {
    if (input.server.writesEnabled) blockers.push(block("PLAN_UNAVAILABLE"));
  } else {
    existing = requested.filter((d) => input.preview!.existing.includes(d.path)).map((d) => d.path);
    directories = requested.filter((d) => !existing.includes(d.path));
    if (directories.length === 0) blockers.push(block("NO_CHANGES"));
  }
  return finish(input, blockers, input.preview?.stateDigest ?? null, {
    operation: "prepare.directories.v1" as const,
    scope: { requested, directories, existing, includesServiceRestart: false as const, includesReboot: false as const },
    verification: { expectDirectories: directories },
  });
}
