/**
 * Abstract contract for server registration (T-069). Written from PRD FR-02/FR-03, Technical Spec 6.2/6.3,
 * and the endpoint list in packages/contracts/src/servers.ts. Scenarios talk only to this interface, so the
 * same scenarios run on the spec-derived reference model today and on the real API once it lands.
 */
import type { FakeTarget, World } from "./world.mts";

export interface Res<T = any> { readonly ok: boolean; readonly status: number; readonly code?: string | undefined; readonly reason?: string | undefined; readonly data?: T | undefined; readonly raw: string; readonly headers: Record<string, string> }

export interface CallInput { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; body?: unknown; session?: "owner" | "none"; csrf?: "valid" | "omit" | "wrong"; origin?: string }

export interface ServerRow { id: string; name: string; address: string; port: number; production: boolean; writesEnabled: boolean; status: "active" | "disconnected" }

export type Capability = "care" | "identity" | "routes" | "evidence" | "keystore";

export interface RegHarness {
  readonly name: string;
  readonly world: World;
  now(): number; advance(ms: number): Promise<void>;
  api(c: CallInput): Promise<Res>;
  /** A server that is already registered and active (the "existing record"). */
  seedServer(o: { name: string; address: string; port?: number; production?: boolean }): Promise<{ id: string; target: FakeTarget }>;
  servers(): Promise<ServerRow[]>;
  draftCount(): Promise<number>;
  has(c: Capability): boolean;
  /** Set the owner's enrolled private routes (CIDRs). Only if has("routes"). */
  setEnrolledRoutes(cidrs: string[]): Promise<void>;
  /** The fixed remote commands the product may run during the first check. */
  allowedCommands(): readonly string[];
  keys: { privateKeyNeedles(): string[]; storedKeyCount(): number; fileModes(): number[] };
  logText(): string;
  /** Argument vector of every subprocess the controller started. */
  argvLog(): string[][];
  scheduler: { tick(): Promise<void>; collectionsFor(serverId: string): number };
  /** actor/time/evidence record for the pinned host key. Only if has("evidence"). */
  hostKeyEvidence(serverId: string): Promise<{ fingerprint: string; algorithm: string; confirmedBy: string; confirmedAt: string } | null>;
  care: { queueOperation(serverId: string): Promise<{ opId: string }>; runningOperation(serverId: string): Promise<{ opId: string }>; operation(opId: string): Promise<{ state: string; sentToTarget: boolean }> };
  /** A second registered server presenting the same host key (alias). Only if has("identity"). */
  aliasOf(existing: { id: string; target: FakeTarget }, address: string): FakeTarget;
}

export interface Scenario { readonly id: string; readonly title: string; readonly spec: readonly string[]; readonly needs?: readonly Capability[]; run(h: RegHarness): Promise<void> }

export const HOUR = 3_600_000;
export const ENDPOINTS: { method: CallInput["method"]; path: string; body?: unknown }[] = [
  { method: "POST", path: "/api/servers/drafts", body: { address: "100.64.1.77", port: 22, user: "servrsit", name: "Probe", role: null, production: false } },
  { method: "GET", path: "/api/servers/drafts/00000000-0000-4000-8000-000000000001" },
  { method: "DELETE", path: "/api/servers/drafts/00000000-0000-4000-8000-000000000001" },
  { method: "POST", path: "/api/servers/drafts/00000000-0000-4000-8000-000000000001/host-key" },
  { method: "POST", path: "/api/servers/drafts/00000000-0000-4000-8000-000000000001/host-key/confirm", body: { fingerprint: "SHA256:" + "A".repeat(43) } },
  { method: "POST", path: "/api/servers/drafts/00000000-0000-4000-8000-000000000001/access-key" },
  { method: "POST", path: "/api/servers/drafts/00000000-0000-4000-8000-000000000001/first-check" },
  { method: "GET", path: "/api/servers/drafts/00000000-0000-4000-8000-000000000001/first-check" },
  { method: "POST", path: "/api/servers/drafts/00000000-0000-4000-8000-000000000001/activate" },
  { method: "PATCH", path: "/api/servers/00000000-0000-4000-8000-000000000002", body: { name: "Renamed" } },
  { method: "POST", path: "/api/servers/00000000-0000-4000-8000-000000000002/disconnect" },
];
