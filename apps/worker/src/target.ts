/**
 * Write-target contract: the remote helper's ledger interface
 * (Technical Spec §8.2, §9.3).
 *
 *  - submit(signed manifest) claims the operation id atomically. The same id
 *    with the same digest returns the existing record ("existing"); the same
 *    id with a different digest is rejected. Acceptance is the start of work,
 *    not its result.
 *  - query(operationId) reads the ledger. It is the ONLY evidence of what the
 *    target did. A transport failure is never evidence of anything.
 *  - inspectInstalled is a read-only, independent postcondition check.
 */

import type { BootPreview, DirectoriesPreview, ServicePreview, SignedManifest, TransactionPreview } from "@servrsit/domain";
import type { TargetKind } from "@servrsit/store";

export type RejectCode =
  | "WRITES_DISABLED"
  | "UNSUPPORTED_SCHEMA"
  | "UNSUPPORTED_OPERATION"
  | "UNKNOWN_KEY"
  | "INVALID_SIGNATURE"
  | "MISBOUND"
  | "EXPIRED"
  | "DIGEST_MISMATCH"
  | "TARGET_BUSY"
  | "PRECONDITION_CHANGED"
  /** T-090: a package in the update has a configuration file the owner changed (helper 0.2.0). */
  | "CONFFILE_MODIFIED"
  /** T-090 (D-S8): a package in the update is on hold; ServrSit never overrides a hold. */
  | "PACKAGE_HELD";

export interface RemoteRecord {
  readonly operationId: string;
  readonly manifestDigest: string;
  readonly state: "running" | "finished";
  /** Set when finished. Exit status alone never proves success (invariant 9). */
  readonly exitCode: number | null;
}

export type SubmitResult =
  | { readonly status: "accepted" | "existing"; readonly record: RemoteRecord }
  | { readonly status: "rejected"; readonly code: RejectCode };

export type QueryResult = { readonly found: false } | { readonly found: true; readonly record: RemoteRecord };

/**
 * The request may or may not have reached the target. "before-send" and
 * "after-send" describe where the simulation injected the fault; callers must
 * treat both the same way, because in reality they cannot tell them apart.
 */
export class TransportError extends Error {
  constructor(readonly phase: "before-send" | "after-send" | "query" | "inspect") {
    super(`transport failure (${phase})`);
    this.name = "TransportError";
  }
}

/** T-056: what identifies the machine, as observed. Null when the target has not been observed. */
export interface TargetIdentity {
  readonly hostKeyFingerprint: string;
  /** /etc/machine-id, or null if it could not be read. Cloned images can share one. */
  readonly machineId: string | null;
}

/** T-059: observed state of one service unit. */
export interface ServiceState {
  readonly exists: boolean;
  readonly active: boolean;
  /** When the unit last became active, or null. A restart changes it. */
  readonly activeSince: string | null;
}

/** T-059: what is at one requested directory path. */
export interface DirectoryState {
  readonly path: string;
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly owner: string | null;
  readonly group: string | null;
  readonly mode: string | null;
}

export interface WriteTarget {
  readonly kind: TargetKind;
  readonly serverId: string;
  readonly hostKeyFingerprint: string;
  /** T-056: observed identity, or null when unknown. */
  identity(): TargetIdentity | null;
  /** Read-only transaction preview. Null if none can be produced. */
  previewPackages(): Promise<TransactionPreview | null>;
  submit(signed: SignedManifest): Promise<SubmitResult>;
  query(operationId: string): Promise<QueryResult>;
  /** Installed versions for "name:arch" keys. Independent of the ledger. */
  inspectInstalled(keys: readonly string[]): Promise<Readonly<Record<string, string | null>>>;
  /** T-059: read-only previews for restart, reboot and directory plans. Null if none can be produced. */
  previewService(unit: string): Promise<ServicePreview | null>;
  previewBoot(): Promise<BootPreview | null>;
  previewDirectories(paths: readonly string[]): Promise<DirectoriesPreview | null>;
  /** T-059: independent post-condition checks (invariant 9), never the ledger's word. */
  inspectService(unit: string): Promise<ServiceState>;
  inspectBoot(): Promise<{ readonly bootId: string }>;
  inspectDirectories(paths: readonly string[]): Promise<readonly DirectoryState[]>;
}
