/**
 * Remote change manifest (Technical Spec §8.2).
 *
 * Contains: schema version, installation id, server identity binding, unique
 * operation id, plan id/version/digest, catalog version, exact scope,
 * precondition digest, issue/expiry times, verification contract. It contains
 * no executable code: only data the reviewed adapter interprets.
 */

import { CATALOG_VERSION } from "./catalog.js";
import { digestOf } from "./canonical.js";
import type { PackageChange, Plan } from "./plan.js";
import type { DirectoriesPlan, RebootPlan, RestartPlan } from "./actions.js";

export const MANIFEST_SCHEMA_VERSION = 1 as const;
/** A manifest must be accepted remotely within this window after issue. */
export const MANIFEST_ACCEPT_WINDOW_MS = 10 * 60_000;

export interface Manifest {
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  readonly installationId: string;
  readonly server: { readonly id: string; readonly hostKeyFingerprint: string };
  readonly operationId: string;
  readonly operation: Plan["operation"];
  readonly catalogVersion: typeof CATALOG_VERSION;
  readonly plan: { readonly id: string; readonly version: number; readonly digest: string };
  /** Packages: exactly { packages } (unchanged since T-048). Other kinds: their plan's scope (T-059). */
  readonly scope: { readonly packages: readonly PackageChange[] } | RestartPlan["scope"] | RebootPlan["scope"] | DirectoriesPlan["scope"];
  readonly preconditionDigest: string;
  readonly issuedAt: string;
  readonly acceptBefore: string;
  readonly verification: Plan["verification"];
}

export interface ManifestInput {
  readonly installationId: string;
  readonly operationId: string;
  readonly plan: Plan;
  readonly hostKeyFingerprint: string;
  readonly issuedAt: Date;
}

export function buildManifest(input: ManifestInput): { manifest: Manifest; digest: string } {
  const { plan } = input;
  const acceptBefore = new Date(
    Math.min(input.issuedAt.getTime() + MANIFEST_ACCEPT_WINDOW_MS, Date.parse(plan.expiresAt)),
  );
  const manifest: Manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    installationId: input.installationId,
    server: { id: plan.serverId, hostKeyFingerprint: input.hostKeyFingerprint },
    operationId: input.operationId,
    operation: plan.operation,
    catalogVersion: CATALOG_VERSION,
    plan: { id: plan.id, version: plan.version, digest: plan.digest },
    scope: plan.operation === "apply.packages.v1" ? { packages: plan.scope.packages } : plan.scope,
    preconditionDigest: plan.preconditions.previewDigest,
    issuedAt: input.issuedAt.toISOString(),
    acceptBefore: acceptBefore.toISOString(),
    verification: plan.verification,
  };
  return { manifest, digest: digestOf(manifest) };
}
