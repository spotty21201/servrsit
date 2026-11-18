/**
 * Operation catalog (Technical Spec §8.1). Only reviewed, typed operations can
 * be planned. There is no "run command" operation and no free-form field.
 *
 * T-048 implemented apply.packages.v1; T-059 adds restart.service.v1,
 * reboot.host.v1 and prepare.directories.v1. Each is its own plan with its own
 * approval (execution-security invariant 5): a package plan never restarts or
 * reboots, a restart plan never reboots, a reboot plan never restarts a unit.
 */

export const CATALOG_VERSION = 1 as const;

export const OPERATION_IDS = ["apply.packages.v1", "restart.service.v1", "reboot.host.v1", "prepare.directories.v1"] as const;
export type OperationId = (typeof OPERATION_IDS)[number];

export function isSupportedOperation(value: unknown): value is OperationId {
  return typeof value === "string" && (OPERATION_IDS as readonly string[]).includes(value);
}

