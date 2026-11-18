/**
 * [FIXTURE] STUB client for the Connect a server flow (T-068). The API has no
 * endpoints for registering a server, reading a host key or running a first
 * check yet. Every response here is synthetic and labelled [FIXTURE]; nothing
 * leaves the browser and nothing is stored on a server. Coder owns
 * apps/web/src/api/*: replace `createFixtureServersClient()` with a real client
 * that implements `ServersClient` and the screen needs no change.
 *
 * Proposed endpoints (for Coder), all behind the session + CSRF guard:
 *   POST /api/servers/precheck        {address, port}            -> {duplicateOf: id|null, reachable: ...}
 *   GET  /api/servers/access-info                                -> {publicKey, controllerAddress}
 *   POST /api/servers/host-key        {address, port}            -> {algorithm, fingerprint, observedAt}
 *   POST /api/servers                 {draft, confirmedFingerprint} -> {serverId}
 *   POST /api/servers/:id/first-check                            -> operation-like record polled by GET
 * No endpoint ever accepts a private key or a password.
 */

export interface AccessInfo {
  /** ServrSit's public key line (the part that goes in authorized_keys), without options. */
  readonly publicKey: string;
  /** The address ServrSit connects from, for the `from=` restriction. */
  readonly controllerAddress: string;
  readonly fixture: true;
}

export type Reachability =
  | { readonly reachable: true; readonly note: string }
  | { readonly reachable: false; readonly reason: string };

export interface PrecheckResult {
  /** Id of an existing server with the same address and port, or null. */
  readonly duplicateOf: string | null;
  readonly duplicateName: string | null;
  readonly reachability: Reachability;
  readonly fixture: true;
}

export interface HostKeyResult {
  readonly algorithm: "ED25519" | "ECDSA" | "RSA";
  /** "SHA256:" + 43 base64 characters, as `ssh-keygen -lf` prints it. */
  readonly fingerprint: string;
  readonly observedAt: string;
  readonly fixture: true;
}

export type CheckStepState = "waiting" | "running" | "done" | "unavailable" | "failed";

export interface FirstCheckStep {
  readonly id: string;
  readonly label: string;
  readonly state: CheckStepState;
  /** Why a step is unavailable or failed. */
  readonly reason: string | null;
  readonly at: string | null;
}

export interface FirstCheckSnapshot {
  readonly steps: readonly FirstCheckStep[];
  readonly finished: boolean;
  readonly platform: { readonly supported: boolean; readonly name: string } | null;
  readonly fixture: true;
}

export interface ConnectRequest {
  readonly address: string;
  readonly port: number;
}

export interface ServersClient {
  getAccessInfo(): Promise<AccessInfo>;
  precheck(req: ConnectRequest): Promise<PrecheckResult>;
  getHostKey(req: ConnectRequest): Promise<HostKeyResult>;
  /** Starts the first check. Real clients must refuse unless the fingerprint was confirmed. */
  startFirstCheck(req: ConnectRequest & { fingerprint: string }): Promise<FirstCheckHandle>;
}

export interface FirstCheckHandle {
  /** Latest state; each call may advance a fixture run. */
  poll(): Promise<FirstCheckSnapshot>;
}

/** [FIXTURE] An existing server used to demonstrate the duplicate-host path. */
export const FIXTURE_DUPLICATE = { address: "192.0.2.10", port: 22, id: "00000000-0000-4000-8000-0000000000aa", name: "Fixture Existing" } as const;
/** [FIXTURE] An address that demonstrates the unreachable-private-address path. */
export const FIXTURE_UNREACHABLE_ADDRESS = "10.99.99.99";
/** [FIXTURE] The fingerprint the fixture host "presents". Not a real key. */
export const FIXTURE_FINGERPRINT = "SHA256:bX7Qf0Zt3m9H2cJkL8aVwYpR5nUe1dGsTiOoNqMxEhA";

const wait = (ms: number): Promise<void> => new Promise((r) => globalThis.setTimeout(r, ms));

const CHECKS: ReadonlyArray<{ id: string; label: string; unavailable?: string }> = [
  { id: "connect", label: "Connecting to the server" },
  { id: "auth", label: "Signing in with ServrSit's key" },
  { id: "host", label: "Reading host facts (CPU, memory, storage, uptime)" },
  { id: "services", label: "Reading failed services" },
  { id: "packages", label: "Reading package state", unavailable: "Reading pending updates needs a permission this account does not have. Everything else still works." },
];

export function createFixtureServersClient(now: () => Date = () => new Date()): ServersClient {
  return {
    async getAccessInfo() {
      await wait(150);
      return { publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixtureFixt servrsit-fixture", controllerAddress: "100.64.0.1", fixture: true };
    },
    async precheck(req) {
      await wait(500);
      const dup = req.address === FIXTURE_DUPLICATE.address && req.port === FIXTURE_DUPLICATE.port;
      return {
        duplicateOf: dup ? FIXTURE_DUPLICATE.id : null,
        duplicateName: dup ? FIXTURE_DUPLICATE.name : null,
        reachability: req.address === FIXTURE_UNREACHABLE_ADDRESS
          ? { reachable: false, reason: "It needs a private route to the network the address is on." }
          : { reachable: true, note: "The network path is open. This does not test signing in." },
        fixture: true,
      };
    },
    async getHostKey() {
      await wait(600);
      return { algorithm: "ED25519", fingerprint: FIXTURE_FINGERPRINT, observedAt: now().toISOString(), fixture: true };
    },
    async startFirstCheck(req) {
      if (req.fingerprint !== FIXTURE_FINGERPRINT) throw new Error("fingerprint not confirmed");
      const started = now().getTime();
      let tick = 0;
      return {
        async poll() {
          await wait(450);
          tick++;
          const steps: FirstCheckStep[] = CHECKS.map((c, i) => {
            const at = new Date(started + (i + 1) * 900).toISOString();
            if (i < tick - 1) return { id: c.id, label: c.label, state: c.unavailable ? "unavailable" : "done", reason: c.unavailable ?? null, at };
            if (i === tick - 1) return { id: c.id, label: c.label, state: "running", reason: null, at: null };
            return { id: c.id, label: c.label, state: "waiting", reason: null, at: null };
          });
          const finished = tick > CHECKS.length;
          return { steps, finished, platform: finished || tick > 3 ? { supported: true, name: "Ubuntu 24.04.1 LTS" } : null, fixture: true };
        },
      };
    },
  };
}
