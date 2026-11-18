/**
 * [FIXTURE] In-memory model of the T-069 registration contract, for previews and
 * tests (T-080). The Connect screen uses Coder's real client
 * (apps/web/src/api/servers.ts); this fixture implements the same
 * `ServersClient` interface so /fixtures/connect can show every step, including
 * the duplicate and unreachable paths, with no backend and no SSH.
 *
 * Order enforced like the contract: host key -> owner confirms the fingerprint
 * -> access key -> first check -> activate; out of order is STATE_CONFLICT.
 * Everything is synthetic and shown under the [FIXTURE DATA] banner. No call
 * carries a private key or a password.
 */
import type { ActivateResponse, FirstCheck, HostKeyConfirmRequest, ServerDraft, ServerDraftRequest, ServerRegistrationError, ServerRegistrationErrorCode } from "@servrsit/contracts";
import type { ServersClient, ServersResult } from "../api/servers";
import { gate } from "../lib/fixtureState";

// ── [FIXTURE] in-memory model of the contract ────────────────────────────────

/** [FIXTURE] An existing server used to demonstrate DUPLICATE_SERVER. */
export const FIXTURE_DUPLICATE = { address: "192.0.2.10", id: "00000000-0000-4000-8000-0000000000aa", name: "Fixture Existing" } as const;
/** [FIXTURE] An address that demonstrates ROUTE_UNAVAILABLE. */
export const FIXTURE_UNREACHABLE_ADDRESS = "10.99.99.99";
/** [FIXTURE] The fingerprint the fixture host "presents". Not a real key. */
export const FIXTURE_FINGERPRINT = "SHA256:bX7Qf0Zt3m9H2cJkL8aVwYpR5nUe1dGsTiOoNqMxEhA";
const FIXTURE_KEY_FINGERPRINT = "SHA256:Zk3Hn8Wq1Rt6Yp0LcVb4Ju9Ms2DxEaGfOiTgNhUyQwA";

const wait = (ms: number): Promise<void> => new Promise((r) => globalThis.setTimeout(r, ms));
const fail = (error: ServerRegistrationErrorCode, reason?: string): { ok: false; error: ServerRegistrationError } => ({ ok: false, error: { error, ...(reason ? { reason } : {}) } });

const CHECKS: ReadonlyArray<{ id: FirstCheck["steps"][number]["id"]; label: string; unavailable?: string }> = [
  { id: "connect", label: "Connecting to the server" },
  { id: "auth", label: "Signing in with ServrSit's key" },
  { id: "host", label: "Reading host facts (CPU, memory, storage, uptime)" },
  { id: "services", label: "Reading failed services" },
  { id: "clock", label: "Comparing the server's clock" },
  { id: "packages", label: "Reading package state", unavailable: "Reading pending updates needs a permission this account does not have. Everything else still works." },
];

interface Run { polls: number }

export function createFixtureServersClient(now: () => Date = () => new Date(), delayMs = 350): ServersClient {
  const drafts = new Map<string, ServerDraft>();
  const runs = new Map<string, Run>();
  let n = 0;
  const iso = (): string => now().toISOString();
  const save = (d: ServerDraft): ServerDraft => { drafts.set(d.id, d); return d; };
  const find = (id: string): ServerDraft | null => {
    const d = drafts.get(id) ?? null;
    return d;
  };

  function snapshot(d: ServerDraft, run: Run): FirstCheck {
    const steps = CHECKS.map((c, i) => {
      const at = new Date(now().getTime() + i * 1000).toISOString();
      if (i < run.polls - 1) return { id: c.id, label: c.label, state: c.unavailable ? ("unavailable" as const) : ("done" as const), reason: c.unavailable ?? null, at };
      if (i === run.polls - 1) return { id: c.id, label: c.label, state: "running" as const, reason: null, at: null };
      return { id: c.id, label: c.label, state: "waiting" as const, reason: null, at: null };
    });
    const finished = run.polls > CHECKS.length;
    return {
      draftId: d.id,
      steps,
      finished,
      platform: run.polls > 3 ? { supported: true, name: "Ubuntu 24.04.1 LTS" } : null,
      coverage: finished ? { passed: CHECKS.length - 1, total: CHECKS.length } : null,
      failureCode: null,
    };
  }

  function createDraftNow(req: ServerDraftRequest): ServersResult<ServerDraft> {
      const dup = req.address === FIXTURE_DUPLICATE.address;
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      const t = now();
      return { ok: true, data: save({
        id, state: "draft", address: req.address, port: req.port, user: req.user, name: req.name, role: req.role, production: req.production,
        duplicateOf: dup ? { id: FIXTURE_DUPLICATE.id, name: FIXTURE_DUPLICATE.name } : null,
        reachability: req.address === FIXTURE_UNREACHABLE_ADDRESS
          ? { reachable: false, reason: "It needs a private route to the network the address is on." }
          : { reachable: true, note: "The network path is open. This does not test signing in." },
        hostKey: null, hostKeyConfirmedAt: null, accessKey: null, createdAt: t.toISOString(), expiresAt: new Date(t.getTime() + 24 * 3600_000).toISOString(),
      }) };
    }

  return {
    async createDraft(req) {
      await wait(delayMs);
      return gate<ServersResult<ServerDraft>>(() => createDraftNow(req), () => ({ ok: false, error: { error: "NETWORK" } }));
    },
    async getDraft(id) { await wait(delayMs / 2); const d = find(id); return d ? { ok: true, data: d } : fail("DRAFT_NOT_FOUND"); },
    async deleteDraft(id) { await wait(delayMs / 2); drafts.delete(id); runs.delete(id); return { ok: true, data: null }; },
    async scanHostKey(id) {
      await wait(delayMs);
      const d = find(id);
      if (!d) return fail("DRAFT_NOT_FOUND");
      if (d.state !== "draft" && d.state !== "host-key-seen") return fail("STATE_CONFLICT", "The host key was already confirmed for this draft.");
      if (!d.reachability.reachable) return fail("ROUTE_UNAVAILABLE", "ServrSit cannot reach this address yet.");
      return { ok: true, data: save({ ...d, state: "host-key-seen", hostKey: { algorithm: "ED25519", fingerprint: FIXTURE_FINGERPRINT, observedAt: iso() } }) };
    },
    async confirmHostKey(id, body) {
      await wait(delayMs);
      const d = find(id);
      if (!d) return fail("DRAFT_NOT_FOUND");
      if (d.state !== "host-key-seen" || !d.hostKey) return fail("STATE_CONFLICT", "Scan the host key first.");
      if (body.fingerprint !== d.hostKey.fingerprint) return fail("FINGERPRINT_MISMATCH", "That fingerprint is not the one the server presented.");
      return { ok: true, data: save({ ...d, state: "host-key-confirmed", hostKeyConfirmedAt: iso() }) };
    },
    async issueAccessKey(id) {
      await wait(delayMs);
      const d = find(id);
      if (!d) return fail("DRAFT_NOT_FOUND");
      if (d.state === "key-issued" && d.accessKey) return { ok: true, data: d };
      if (d.state !== "host-key-confirmed") return fail("HOST_KEY_NOT_CONFIRMED", "Confirm the host key before a key is made.");
      const slug = d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return { ok: true, data: save({ ...d, state: "key-issued", accessKey: {
        authorizedKeysLine: `restrict,from="100.64.0.1" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixtureFixt servrsit-${slug}`,
        algorithm: "ED25519", keyFingerprint: FIXTURE_KEY_FINGERPRINT, controllerAddress: "100.64.0.1", createdAt: iso(),
      } }) };
    },
    async startFirstCheck(id) {
      await wait(delayMs);
      const d = find(id);
      if (!d) return fail("DRAFT_NOT_FOUND");
      if (!["key-issued", "check-failed", "checked"].includes(d.state)) return fail("STATE_CONFLICT", "Issue the access key first.");
      const run: Run = { polls: 0 };
      runs.set(id, run);
      save({ ...d, state: "checking" });
      return { ok: true, data: snapshot(d, run) };
    },
    async getFirstCheck(id) {
      await wait(delayMs);
      const d = find(id);
      const run = runs.get(id);
      if (!d || !run) return fail("DRAFT_NOT_FOUND");
      run.polls++;
      const s = snapshot(d, run);
      if (s.finished && d.state === "checking") save({ ...d, state: "checked" });
      return { ok: true, data: s };
    },
    // The Connect flow never renames or disconnects; the fixture has no server pages behind it.
    async updateServer() { return fail("SERVER_NOT_FOUND"); },
    async disconnect() { return fail("SERVER_NOT_FOUND"); },
    async activate(id) {
      await wait(delayMs);
      const d = find(id);
      if (!d) return fail("DRAFT_NOT_FOUND");
      if (d.duplicateOf) return fail("DUPLICATE_SERVER", "This address is already registered.");
      if (d.state !== "checked") return fail("STATE_CONFLICT", "Run the first check before adding the server.");
      drafts.delete(id);
      return { ok: true, data: { serverId: "00000000-0000-4000-8000-0000000000ff" } };
    },
  };
}
