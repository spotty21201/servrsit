/**
 * Canonical server identity (T-056, Tech Spec §6.3, §9.4, PRD FR-02).
 *
 * A machine is identified by its host key AND its observed machine id
 * together. Cloned images can share a machine id and a rebuilt server can
 * keep its host key, so no single attribute is enough:
 *  - both equal to another record's: the same machine (an alias). They share
 *    one canonical id, so they share one operation lock.
 *  - exactly one equal: ambiguous. Write enablement is blocked for both.
 *  - either attribute unknown: unverified. Write enablement is blocked.
 */

import { digestOf } from "./canonical.js";

export interface IdentityInput {
  readonly id: string;
  readonly hostKeyFingerprint: string | null;
  readonly machineId: string | null;
}

export type IdentityStatus =
  | { readonly status: "verified"; readonly canonicalId: string; readonly aliases: readonly string[] }
  | { readonly status: "unverified"; readonly reason: "host-key-unknown" | "machine-id-unknown" }
  | { readonly status: "ambiguous"; readonly conflictsWith: readonly string[] };

export function canonicalIdOf(hostKeyFingerprint: string, machineId: string): string {
  return `machine:${digestOf({ hostKeyFingerprint, machineId })}`;
}

export function resolveIdentities(inputs: readonly IdentityInput[]): Map<string, IdentityStatus> {
  const out = new Map<string, IdentityStatus>();
  for (const s of inputs) {
    if (s.hostKeyFingerprint === null) {
      out.set(s.id, { status: "unverified", reason: "host-key-unknown" });
      continue;
    }
    if (s.machineId === null) {
      out.set(s.id, { status: "unverified", reason: "machine-id-unknown" });
      continue;
    }
    const others = inputs.filter((o) => o.id !== s.id);
    // Exactly one attribute in common: neither clearly the same machine nor clearly another.
    const conflicts = others.filter((o) => (o.hostKeyFingerprint === s.hostKeyFingerprint) !== (o.machineId === s.machineId));
    if (conflicts.length > 0) {
      out.set(s.id, { status: "ambiguous", conflictsWith: conflicts.map((o) => o.id) });
      continue;
    }
    const aliases = others.filter((o) => o.hostKeyFingerprint === s.hostKeyFingerprint && o.machineId === s.machineId).map((o) => o.id);
    out.set(s.id, { status: "verified", canonicalId: canonicalIdOf(s.hostKeyFingerprint, s.machineId), aliases });
  }
  return out;
}
