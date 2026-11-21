/**
 * [FIXTURE DATA] T-089: the real SshWriteTarget against a FAKE server.
 *
 * No test here starts ssh or contacts any machine. The command runner is a
 * fake that plays both sides a real Sentani would: the read-only inspect
 * script (apt-get -s and dpkg-query output in Ubuntu 24.04 format) and the
 * helper gateway (ledger, signature, the installed-v1 precondition rule that
 * target-helper/tests/test_t089.py proves the Python helper uses).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest, buildPlan, createSigner, digestOf, signManifest, verifyManifestSignature, type PackagesPlan, type SignedManifest } from "@servrsit/domain";
import { MemoryIntentStore, SqliteCareStore, type StoredOperation } from "@servrsit/store";
import type { RunRequest, RunResult } from "@servrsit/ssh";
import { Dispatcher, SshWriteTarget, TransportError, type WriteTarget } from "./index.js";

const SENTANI = "00000000-0000-4000-8000-0000000089aa";
const HOST = "100.64.0.89";
const FP = "SHA256:fixture-sentani-host-key";
const INSTALL = "inst-t089";
const MAINT = "/keys/sentani/id_ed25519";
const INSPECT = "/keys/sentani/inspect";

class Clock {
  t = new Date("2026-11-17T10:00:00.000Z").getTime();
  now = () => new Date(this.t);
}

const done = (stdout: string, exitCode = 0): RunResult => ({ exitCode, stdout, stderr: "", timedOut: false, stdoutTruncated: false, spawnFailed: false });
const lost: RunResult = { exitCode: 255, stdout: "", stderr: "Connection closed by remote host", timedOut: false, stdoutTruncated: false, spawnFailed: false };

/** A fake Sentani: installed packages, available upgrades, and the helper's ledger. */
class FakeSentani {
  installed: Record<string, string> = { "wget:amd64": "1.21.4-1ubuntu4", "vim-common:all": "2:9.1.0016-1ubuntu7.8", "docker-ce:amd64": "5:27.3.1-1" };
  upgrades = [
    { key: "wget:amd64", to: "1.21.4-1ubuntu4.1", origin: "Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security" },
    { key: "vim-common:all", to: "2:9.1.0016-1ubuntu7.9", origin: "Ubuntu:24.04/noble-updates" },
    { key: "docker-ce:amd64", to: "5:27.4.0-1", origin: "Docker CE:noble" },
  ];
  held = new Set<string>();
  ledger = new Map<string, { digest: string; manifest: SignedManifest["manifest"]; state: "running" | "finished"; exitCode: number | null }>();
  claims: string[] = [];
  gatewayRequests: Array<{ op: string; identity: string | undefined }> = [];
  inspectRequests: Array<{ sections: string[]; identity: string | undefined }> = [];
  /** Faults. */
  loseNextSubmitReply = false;
  nextReply: unknown = undefined;
  inspectDown = false;

  constructor(private readonly trusted: Record<string, string>) {}

  private apply(manifest: SignedManifest["manifest"]): void {
    for (const c of (manifest.scope as { readonly packages: ReadonlyArray<{ name: string; arch: string; to: string }> }).packages) this.installed[`${c.name}:${c.arch}`] = c.to;
  }

  private preconditionDigest(manifest: SignedManifest["manifest"]): string {
    const keys = (manifest.scope as { readonly packages: ReadonlyArray<{ name: string; arch: string }> }).packages.map((c) => `${c.name}:${c.arch}`).sort();
    return digestOf({ installed: Object.fromEntries(keys.map((k) => [k, this.installed[k] ?? null])) });
  }

  private gateway(body: { op: string; signed?: SignedManifest; operationId?: string }): unknown {
    if (this.nextReply !== undefined) {
      const r = this.nextReply;
      this.nextReply = undefined;
      return r;
    }
    const pub = (r: { digest: string; state: string; exitCode: number | null }, id: string) => ({ operationId: id, manifestDigest: r.digest, state: r.state, exitCode: r.exitCode });
    if (body.op === "query.operation.v1") {
      const r = this.ledger.get(body.operationId!);
      if (r === undefined) return { found: false, helperVersion: "0.3.0" };
      if (r.state === "running") {
        this.apply(r.manifest);
        r.state = "finished";
        r.exitCode = 0;
      }
      return {
        found: true, helperVersion: "0.3.0", record: pub(r, body.operationId!), outcome: "succeeded", restartNeeded: ["nginx.service", "bad name"],
        reasonCode: null, keptFiles: [{ path: "/etc/wgetrc", newDefault: "/etc/wgetrc.dpkg-dist" }, { path: "../../x", newDefault: null }], evidence: ["untrusted text"],
      };
    }
    const signed = body.signed!;
    if (!verifyManifestSignature(signed, this.trusted)) return { status: "rejected", code: "INVALID_SIGNATURE" };
    const m = signed.manifest;
    if (m.installationId !== INSTALL || m.server.hostKeyFingerprint !== FP) return { status: "rejected", code: "MISBOUND" };
    const digest = digestOf(m);
    const existing = this.ledger.get(m.operationId);
    if (existing !== undefined) return existing.digest === digest ? { status: "existing", record: pub(existing, m.operationId) } : { status: "rejected", code: "DIGEST_MISMATCH" };
    if (this.preconditionDigest(m) !== m.preconditionDigest) return { status: "rejected", code: "PRECONDITION_CHANGED" };
    this.claims.push(m.operationId);
    const r = { digest, manifest: m, state: "running" as const, exitCode: null };
    this.ledger.set(m.operationId, r);
    return { status: "accepted", record: pub(r, m.operationId) };
  }

  /** T-091: the nonce is the remote command's last argument (`sh -s <nonce>`). */
  private inspect(script: string, nonce: string): RunResult {
    const sections = [...script.matchAll(/^section (\w+) /gm)].map((m) => m[1]!);
    let out = "";
    for (const s of sections) {
      let body = "";
      if (s === "aptsim") {
        body = this.upgrades
          .filter((u) => this.installed[u.key] !== u.to && !this.held.has(u.key))
          .map((u) => {
            const [name, arch] = u.key.split(":");
            return `Inst ${name} [${this.installed[u.key]}] (${u.to} ${u.origin} [${arch}])`;
          })
          .join("\n");
      } else if (s === "installed") {
        body = Object.entries(this.installed)
          .map(([k, v]) => `${k.split(":")[0]} ${k.split(":")[1]} ${v} ${this.held.has(k) ? "hi" : "ii"} `)
          .join("\n");
      }
      out += `@@BEGIN ${nonce} ${s}@@\n${body}\n@@END ${nonce} ${s} 0@@\n`;
    }
    return done(out);
  }

  runner = async (r: RunRequest): Promise<RunResult> => {
    assert.equal(r.file, "/usr/bin/ssh");
    const i = r.args.indexOf("-i");
    const identity = i >= 0 ? r.args[i + 1] : undefined;
    assert.equal(r.args[r.args.indexOf("--") + 1], HOST, "only the configured host is ever named");
    if (identity === MAINT) {
      const body = JSON.parse(r.stdin) as { op: string; signed?: SignedManifest; operationId?: string };
      this.gatewayRequests.push({ op: body.op, identity });
      const reply = this.gateway(body);
      if (body.op === "submit" && this.loseNextSubmitReply) {
        this.loseNextSubmitReply = false;
        return lost;
      }
      return done(JSON.stringify(reply));
    }
    this.inspectRequests.push({ sections: [...r.stdin.matchAll(/^section (\w+) /gm)].map((m) => m[1]!), identity });
    if (this.inspectDown) return { ...lost, stderr: "ssh: connect to host 100.64.0.89 port 22: No route to host" };
    return this.inspect(r.stdin, r.args.at(-1) ?? "");
  };
}

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "servrsit-t089-"));
  const knownHostsFile = join(dir, "known_hosts");
  writeFileSync(knownHostsFile, `${HOST} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixtur\n`);
  const clock = new Clock();
  const signer = createSigner("ctrl-fixture");
  const server = new FakeSentani({ [signer.keyId]: signer.publicKeyPem });
  const target = new SshWriteTarget(SENTANI, FP, {
    gateway: { host: HOST, account: "servrsit", identityFile: MAINT, knownHostsFile },
    inspect: { target: { host: HOST, port: 22, user: "servrsit-inspect", identityFile: INSPECT }, options: { knownHostsFile } },
    machineId: () => "0123456789abcdef0123456789abcdef",
    runner: (r) => server.runner(r),
    checkResolution: async () => undefined,
  });
  const store = new SqliteCareStore({ path: ":memory:" });
  const targets = new Map<string, WriteTarget>([[SENTANI, target]]);
  let gate = true;
  const dispatcher = new Dispatcher({ store, intents: new MemoryIntentStore(), targets, writesEnabled: (id) => gate && id === SENTANI, signer, installationId: INSTALL, workerId: "w1", now: clock.now });
  const plan = async (): Promise<PackagesPlan> => {
    const p = buildPlan({
      id: randomUUID(), version: 1, operation: "apply.packages.v1", server: { id: SENTANI, production: true, writesEnabled: true },
      preview: await target.previewPackages(), unresolved: null, now: clock.now(), controllerClockTrusted: true,
    });
    store.insertPlan(p);
    return p;
  };
  const approve = (p: PackagesPlan) => {
    const r = store.approve({
      planId: p.id, planVersion: 1, planDigest: p.digest, idempotencyKey: randomUUID(), owner: "owner", acknowledgements: [...p.requiredAcknowledgements],
      writesEnabled: true, targetKind: "ssh", now: clock.now(), newId: () => randomUUID(),
    });
    if (r.kind !== "created") throw new Error(`approval failed: ${JSON.stringify(r)}`);
    return r.operation;
  };
  const state = (id: string) => (store.getOperation(id) as StoredOperation).state;
  return { server, target, store, dispatcher, signer, plan, approve, state, setGate: (v: boolean) => { gate = v; }, clock };
}

test("preview: Ubuntu updates only, the helper's digest rule over exactly those packages, read with the inspect key", async () => {
  const h = harness();
  const p = await h.plan();
  assert.deepEqual(p.blockers, []);
  assert.deepEqual(p.scope.packages.map((c) => `${c.name}:${c.arch}`), ["vim-common:all", "wget:amd64"]);
  assert.deepEqual(p.scope.excludedPackages.map((c) => c.name), ["docker-ce"]);
  assert.equal(p.preconditions.previewDigest, digestOf({ installed: { "vim-common:all": "2:9.1.0016-1ubuntu7.8", "wget:amd64": "1.21.4-1ubuntu4" } }));
  assert.deepEqual(h.server.inspectRequests, [{ sections: ["aptsim", "installed"], identity: INSPECT }]);
  assert.equal(h.server.gatewayRequests.length, 0, "planning never reaches the gateway");
  assert.deepEqual(h.target.identity(), { hostKeyFingerprint: FP, machineId: "0123456789abcdef0123456789abcdef" });
});

test("approve -> dispatch -> helper ledger -> independent dpkg check -> succeeded; one claim; helper report recorded", async () => {
  const h = harness();
  const op = h.approve(await h.plan());
  const r = await h.dispatcher.drain();
  assert.equal(r.status, "final");
  assert.equal(h.state(op.id), "succeeded");
  assert.deepEqual(h.server.claims, [op.id]);
  assert.deepEqual(h.server.gatewayRequests.map((g) => [g.op, g.identity]), [["submit", MAINT], ["query.operation.v1", MAINT]]);
  assert.deepEqual(h.server.inspectRequests.at(-1), { sections: ["installed"], identity: INSPECT }, "verification reads dpkg only, with the inspect key");
  const events = h.store.listEvents(op.id);
  const finished = events.find((e) => e.type === "remote_finished");
  assert.deepEqual(finished?.payload["helperReport"], {
    helperVersion: "0.3.0", outcome: "succeeded", reasonCode: null, restartNeeded: ["nginx.service"],
    keptFiles: [{ path: "/etc/wgetrc", newDefault: "/etc/wgetrc.dpkg-dist" }],
  });
  assert.equal(JSON.stringify(events).includes("untrusted text"), false, "helper evidence text is not copied into events");
  assert.deepEqual(events.find((e) => e.type === "verification_recorded")?.payload["verified"], ["vim-common:all", "wget:amd64"]);
});

test("invariant 7: a lost submit reply is resolved by querying the same id; never a second claim", async () => {
  const h = harness();
  const op = h.approve(await h.plan());
  h.server.loseNextSubmitReply = true;
  await h.dispatcher.drain();
  assert.equal(h.state(op.id), "succeeded");
  assert.deepEqual(h.server.claims, [op.id]);
  assert.equal(h.server.gatewayRequests.filter((g) => g.op === "submit").length, 1);
});

test("the server changed after planning: the helper refuses PRECONDITION_CHANGED and nothing is changed", async () => {
  const h = harness();
  const op = h.approve(await h.plan());
  h.server.installed["wget:amd64"] = "1.21.4-1ubuntu4.1";
  await h.dispatcher.drain();
  assert.equal(h.state(op.id), "failed");
  assert.equal(h.store.listEvents(op.id).find((e) => e.type === "remote_rejected")?.payload["code"], "PRECONDITION_CHANGED");
  assert.deepEqual(h.server.claims, []);
});

test("write gate closed in controller configuration: nothing is sent, the operation is cancelled before start", async () => {
  const h = harness();
  const op = h.approve(await h.plan());
  h.setGate(false);
  await h.dispatcher.drain();
  assert.equal(h.state(op.id), "cancelled_before_start");
  assert.equal(h.server.gatewayRequests.length, 0);
});

test("a reply not in the helper's format, or an unreadable ledger, is never evidence: TransportError", async () => {
  const h = harness();
  const p = await h.plan();
  const { manifest } = buildManifest({ installationId: INSTALL, operationId: randomUUID(), plan: p, hostKeyFingerprint: FP, issuedAt: h.clock.now() });
  const signed = signManifest(manifest, h.signer);
  h.server.nextReply = { status: "accepted", record: { operationId: "not-an-id" } };
  await assert.rejects(h.target.submit(signed), TransportError);
  h.server.nextReply = { status: "rejected", code: "SOMETHING_NEW" };
  await assert.rejects(h.target.submit(signed), TransportError);
  h.server.nextReply = { status: "rejected", code: "HELPER_UNAVAILABLE", detail: "x" };
  await assert.rejects(h.target.query(manifest.operationId), TransportError);
  h.server.nextReply = { status: "rejected", code: "TARGET_BUSY" };
  assert.deepEqual(await h.target.submit(signed), { status: "rejected", code: "TARGET_BUSY" });
});

test("packages only: a manifest for any other operation is refused locally, before contact", async () => {
  const h = harness();
  const fake = { manifest: { operation: "reboot.host.v1", server: { id: SENTANI } }, keyId: "k", signature: "s" } as unknown as SignedManifest;
  assert.deepEqual(await h.target.submit(fake), { status: "rejected", code: "UNSUPPORTED_OPERATION" });
  const other = { manifest: { operation: "apply.packages.v1", server: { id: randomUUID() } }, keyId: "k", signature: "s" } as unknown as SignedManifest;
  assert.deepEqual(await h.target.submit(other), { status: "rejected", code: "MISBOUND" });
  assert.equal(await h.target.previewService(), null);
  assert.equal(await h.target.previewBoot(), null);
  assert.equal(await h.target.previewDirectories(), null);
  assert.equal(h.server.gatewayRequests.length + h.server.inspectRequests.length, 0);
});

test("preview: a held package is kept back, never planned; an unreachable server is a TransportError; apt and dpkg disagreeing gives no preview", async () => {
  const h = harness();
  h.server.held.add("wget:amd64");
  const kept = await h.target.previewPackages();
  assert.deepEqual(kept?.upgrades.map((u) => u.name), ["vim-common", "docker-ce"], "apt keeps a held package back; the helper also refuses one (PACKAGE_HELD)");
  h.server.held.clear();

  h.server.inspectDown = true;
  await assert.rejects(h.target.previewPackages(), TransportError);
  await assert.rejects(h.target.inspectInstalled(["wget:amd64"]), TransportError);
  h.server.inspectDown = false;

  const honest = h.server.runner;
  h.server.runner = async (r) => {
    const res = await honest(r);
    return { ...res, stdout: res.stdout.replace("wget amd64 1.21.4-1ubuntu4 ", "wget amd64 1.0 ") };
  };
  assert.equal(await h.target.previewPackages(), null);
});

test("without a connection the target contacts nothing and refuses every write (every server not enabled in writes.json)", async () => {
  const t = new SshWriteTarget(SENTANI);
  assert.equal(t.connected, false);
  assert.equal(t.identity(), null);
  assert.equal(await t.previewPackages(), null);
  assert.deepEqual(await t.submit({} as SignedManifest), { status: "rejected", code: "WRITES_DISABLED" });
  await assert.rejects(t.query(randomUUID()));
  await assert.rejects(t.inspectInstalled(["wget:amd64"]));
});
