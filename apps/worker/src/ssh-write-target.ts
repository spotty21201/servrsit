/**
 * The REAL SSH write target. HARD GATE (ADR-014, execution-security
 * invariants 11 and 12): it refuses every write and returns WRITES_DISABLED.
 *
 * This module deliberately imports nothing that can start a process or open a
 * connection. It cannot be configured, flagged or tricked into running: there
 * is no code path here that contacts a server. Enabling real writes requires
 * replacing this file in a reviewed change after the disposable-server gates
 * (T-010..T-014, FI-*) pass and the specific live work is authorized.
 */

import type { SignedManifest, TransactionPreview } from "@servrsit/domain";
import type { QueryResult, SubmitResult, WriteTarget } from "./target.js";

export class WritesDisabledError extends Error {
  readonly code = "WRITES_DISABLED" as const;
  constructor() {
    super("WRITES_DISABLED: writes to real servers are disabled (ADR-014)");
    this.name = "WritesDisabledError";
  }
}

export class SshWriteTarget implements WriteTarget {
  readonly kind = "ssh" as const;

  constructor(
    readonly serverId: string,
    readonly hostKeyFingerprint: string = "unverified",
  ) {}

  /** No preview is requested from a real server: nothing new is run there. */
  async previewPackages(): Promise<TransactionPreview | null> {
    return null;
  }

  async submit(_signed: SignedManifest): Promise<SubmitResult> {
    return { status: "rejected", code: "WRITES_DISABLED" };
  }

  async query(_operationId: string): Promise<QueryResult> {
    throw new WritesDisabledError();
  }

  async inspectInstalled(_keys: readonly string[]): Promise<Readonly<Record<string, string | null>>> {
    throw new WritesDisabledError();
  }
}
