/**
 * Operation catalog (Technical Spec §8.1). Only reviewed, typed operations can
 * be planned. There is no "run command" operation and no free-form field.
 *
 * T-048 implements apply.packages.v1 only. Service restart and reboot are
 * separate catalog entries with separate approvals (execution-security
 * invariant 5); they are not implemented, so they cannot be planned at all.
 */

export const CATALOG_VERSION = 1 as const;

export const OPERATION_IDS = ["apply.packages.v1"] as const;
export type OperationId = (typeof OPERATION_IDS)[number];

export function isSupportedOperation(value: unknown): value is OperationId {
  return typeof value === "string" && (OPERATION_IDS as readonly string[]).includes(value);
}

/** Catalog entries that exist in the spec but are deliberately not implemented. */
export const NOT_IMPLEMENTED_OPERATIONS = ["restart.service.v1", "reboot.host.v1", "prepare.directories.v1"] as const;
