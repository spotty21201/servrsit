/**
 * T-078 baselines through the API, on [SIMULATED] servers only. The real
 * host in the config is never contacted: its key is not pinned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSigner } from "@servrsit/domain";
import { SqliteBaselineStore } from "@servrsit/store";
import { SimulatedTarget } from "@servrsit/worker";
import { FleetConfigSchema } from "../fleet/config.js";
import { signedInServer } from "../auth/testing.js";

process.env["SERVRSIT_KNOWN_HOSTS"] = join(mkdtempSync(join(tmpdir(), "servrsit-kh-")), "known_hosts");

const REAL = "11111111-1111-4111-a111-111111111111";
const REF = "00000000-0000-4000-8000-0000005eba01";
const TGT = "00000000-0000-4000-8000-0000005eba02";
const RO = "00000000-0000-4000-8000-0000005eba03";
const config = FleetConfigSchema.parse({
  healthIntervalMinutes: 15,
  hosts: [{ id: REAL, name: "Alpha", access: "ssh", address: "alpha.example", port: 22, user: "u", role: null, production: true, collect: true }],
});
const signer = createSigner("k");
const sim = (serverId: string, directories: Record<string, { owner: string; group: string; mode: string }>, installed: Record<string, string>) =>
  new SimulatedTarget({ serverId, installationId: "i", hostKeyFingerprint: `SHA256:${serverId}`, trustedKeys: { k: signer.publicKeyPem }, installed, upgrades: [], directories, now: () => new Date() });

async function start() {
  const ref = sim(REF, {
    "/srv/app": { owner: "deploy", group: "deploy", mode: "0755" },
    "/srv/app/releases": { owner: "deploy", group: "deploy", mode: "0750" },
    "/srv/drop": { owner: "root", group: "root", mode: "0777" },
    "/home/alice/projects": { owner: "alice", group: "alice", mode: "0700" },
  }, { "nginx:amd64": "1.24.0-2ubuntu7.1", "logrotate:amd64": "3.21.0-2build1" });
  const tgt = sim(TGT, { "/srv/app": { owner: "www", group: "www", mode: "0755" } }, { "nginx:amd64": "1.24.0-2ubuntu7.0" });
  const ro = sim(RO, {}, {});
  const store = new SqliteBaselineStore({ path: ":memory:" });
  const s = await signedInServer({
    config, startChecks: false, logger: false,
    findings: { baselines: store },
    care: {
      simulated: [
        { server: { id: REF, name: "Sim Ref", production: false, kind: "simulated", writesEnabled: true, user: "alice" }, target: ref },
        { server: { id: TGT, name: "Sim Target", production: false, kind: "simulated", writesEnabled: true, user: "bob" }, target: tgt },
        { server: { id: RO, name: "Sim Readonly", production: true, kind: "simulated", writesEnabled: false, user: "carol" }, target: ro },
      ],
    },
  });
  const j = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) => {
    const r = await s.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: r.statusCode, body: r.body === "" ? null : r.json() };
  };
  return { ...s, j, store };
}

async function saved(h: Awaited<ReturnType<typeof start>>, ids = ["dir:srv:app", "dir:srv:app/releases", "dir:home:projects", "pkg:nginx", "pkg:logrotate"]) {
  assert.equal((await h.j("GET", `/api/baselines/candidates?reference=${REF}`)).status, 200);
  const b = await h.j("POST", "/api/baselines", { name: "Web role", referenceId: REF, conventionIds: ids });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  return b.body as { id: string; version: number };
}

test("candidates: directories with owner and mode, Ubuntu packages, and reasons for what cannot be included", async () => {
  const h = await start();
  try {
    const servers = (await h.j("GET", "/api/baselines/servers")).body.servers as Array<{ id: string; simulated: boolean; writesEnabled: boolean }>;
    assert.equal(servers.find((x) => x.id === REAL)?.writesEnabled, false);
    assert.equal("user" in servers[0]!, false, "login users are not exposed");
    const c = (await h.j("GET", `/api/baselines/candidates?reference=${REF}`)).body as { source: string; candidates: Array<{ id: string; label: string; detail: string; eligible: boolean; ineligibleReason: string | null }> };
    assert.equal(c.source, "simulated");
    const byId = new Map(c.candidates.map((x) => [x.id, x]));
    assert.deepEqual([byId.get("dir:srv:app")?.label, byId.get("dir:srv:app")?.detail, byId.get("dir:srv:app")?.eligible], ["/srv/app", "owner deploy:deploy, mode 0755", true]);
    assert.equal(byId.get("dir:home:projects")?.detail, "owner (login user):(login user), mode 0700");
    assert.equal(byId.get("dir:srv:drop")?.eligible, false);
    assert.match(byId.get("dir:srv:drop")!.ineligibleReason!, /world-writable/);
    assert.equal(byId.get("pkg:nginx")?.detail, "Ubuntu archive, version 1.24.0-2ubuntu7.1");
    const bad = await h.j("POST", "/api/baselines", { name: "X", referenceId: REF, conventionIds: ["dir:srv:drop"] });
    assert.deepEqual([bad.status, bad.body.error], [400, "INVALID_INPUT"]);
  } finally { await h.app.close(); }
});

test("a baseline is versioned; saving needs fresh candidates; a real host's inventory is refused without contact", async () => {
  const h = await start();
  try {
    assert.equal((await h.j("POST", "/api/baselines", { name: "Web role", referenceId: REF, conventionIds: ["pkg:nginx"] })).body.error, "STALE_CANDIDATES");
    const b = await saved(h);
    assert.equal(b.version, 1);
    await h.j("GET", `/api/baselines/candidates?reference=${REF}`);
    const v2 = await h.j("POST", "/api/baselines", { name: "Web role", referenceId: REF, conventionIds: ["pkg:nginx"], baselineId: b.id });
    assert.deepEqual([v2.body.id, v2.body.version, v2.body.conventions.length], [b.id, 2, 1]);
    assert.equal((await h.j("GET", "/api/baselines")).body.baselines.length, 1);
    const real = await h.j("GET", `/api/baselines/candidates?reference=${REAL}`);
    assert.deepEqual([real.status, real.body.error], [503, "UNAVAILABLE"]);
    assert.match(real.body.reason, /not been verified and pinned/);
  } finally { await h.app.close(); }
});

test("comparison: matches, missing, conflict; home paths follow the target's user; nothing on the target changes", async () => {
  const h = await start();
  try {
    const b = await saved(h);
    const cmp = (await h.j("POST", `/api/baselines/${b.id}/compare`, { targetId: TGT })).body as { rows: Array<{ conventionId: string; label: string; status: string; actionable: boolean; found: string | null }> };
    const row = new Map(cmp.rows.map((r) => [r.conventionId, r]));
    assert.deepEqual([row.get("dir:srv:app")?.status, row.get("dir:srv:app")?.found], ["conflict", "owner www:www, mode 0755"]);
    assert.deepEqual([row.get("dir:srv:app/releases")?.status, row.get("dir:srv:app/releases")?.actionable], ["missing", true]);
    assert.deepEqual([row.get("dir:home:projects")?.label, row.get("dir:home:projects")?.status], ["/home/bob/projects", "missing"]);
    assert.equal(row.get("pkg:nginx")?.status, "conflict");
    assert.deepEqual([row.get("pkg:logrotate")?.status, row.get("pkg:logrotate")?.actionable], ["missing", false]);
    const again = (await h.j("POST", `/api/baselines/${b.id}/compare`, { targetId: TGT })).body;
    assert.deepEqual(again.rows, cmp.rows, "comparing changed nothing");
  } finally { await h.app.close(); }
});

test("mark intentional changes only the record, is reversible, and is in the append-only history", async () => {
  const h = await start();
  try {
    const b = await saved(h);
    await h.j("POST", `/api/baselines/${b.id}/compare`, { targetId: TGT });
    const marked = (await h.j("PUT", `/api/baselines/${b.id}/exceptions`, { targetId: TGT, conventionId: "pkg:nginx", reason: "Pinned for the client" })).body;
    const r = marked.rows.find((x: { conventionId: string }) => x.conventionId === "pkg:nginx");
    assert.equal(r.status, "different-by-design");
    assert.equal(r.intentional.reason, "Pinned for the client");
    const un = (await h.j("DELETE", `/api/baselines/${b.id}/exceptions/${TGT}/pkg:nginx`)).body;
    assert.equal(un.rows.find((x: { conventionId: string }) => x.conventionId === "pkg:nginx").status, "conflict");
    const events = (await h.j("GET", `/api/baselines/${b.id}/history?target=${TGT}`)).body.events.map((e: { text: string }) => e.text);
    assert.deepEqual(events, ["Version 1 saved from Sim Ref with 5 conventions.", "Marked nginx as intentional: Pinned for the client.", "Removed the intentional mark on nginx."]);
  } finally { await h.app.close(); }
});

test("setup plan: only missing directories, parents first, through the canonical planner; packages and conflicts listed as not included", async () => {
  const h = await start();
  try {
    const b = await saved(h);
    const sp = await h.j("POST", `/api/baselines/${b.id}/setup-plan`, { targetId: TGT });
    assert.equal(sp.status, 201, JSON.stringify(sp.body));
    assert.equal(sp.body.included, 2);
    assert.deepEqual(sp.body.notIncluded.map((n: { label: string }) => n.label).sort(), ["/srv/app", "logrotate", "nginx"]);
    const plan = (await h.j("GET", `/api/plans/${sp.body.planId}`)).body;
    assert.equal(plan.operation, "prepare.directories.v1");
    assert.deepEqual(plan.scope.requested.map((d: { path: string; owner: string }) => `${d.path} ${d.owner}`), ["/home/bob/projects bob", "/srv/app/releases deploy"]);
    assert.equal(plan.target.simulated, true);

    const blocked = await h.j("POST", `/api/baselines/${b.id}/setup-plan`, { targetId: RO });
    const roPlan = (await h.j("GET", `/api/plans/${blocked.body.planId}`)).body;
    assert.ok(roPlan.blockers.some((x: { code: string }) => x.code === "WRITES_DISABLED"), "a server with writes disabled gets a blocked plan");
  } finally { await h.app.close(); }
});

test("routes need a session; changes need the CSRF token; bad ids are 404", async () => {
  const h = await start();
  try {
    assert.equal((await h.app.inject({ method: "GET", url: "/api/baselines" })).statusCode, 401);
    assert.equal((await h.app.inject({ method: "POST", url: "/api/baselines", headers: { cookie: h.owner.cookie, "content-type": "application/json" }, payload: "{}" })).statusCode, 403);
    assert.equal((await h.j("GET", "/api/baselines/nope")).status, 404);
    assert.equal((await h.j("GET", "/api/baselines/candidates?reference=nope")).status, 400);
  } finally { await h.app.close(); }
});
