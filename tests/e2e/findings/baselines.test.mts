/**
 * T-078 baselines, tested from PRD FR-09/FR-15 and UX Spec 12 (compare labels: Matches, Missing, Different by design,
 * Conflict, Not checked; ownership conflicts stay explicit blockers; never an unrestricted clone).
 *
 *  - INV-*: the NEW remote inventory script (packages/ssh/src/inventory.ts) reviewed statically, and the product's own
 *    parser fed hostile output. The script is never run here: not locally (the controller is a real machine) and not
 *    over SSH.
 *  - BL-*: the API through SIMULATED servers (real buildServer, owner session, BaselineService, care planner).
 * A process guard blocks every process, socket and DNS call.
 */
import childProcess from "node:child_process";
import dns from "node:dns";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const attempts: string[] = [];
for (const n of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) (childProcess as any)[n] = (f: string) => { attempts.push(`child_process.${n}(${f})`); throw new Error("GUARD"); };
for (const n of ["connect", "createConnection"]) (net as any)[n] = (...a: unknown[]) => { attempts.push(`net.${n}(${String(a[0])})`); throw new Error("GUARD"); };
for (const n of ["lookup", "resolve"]) { (dns as any)[n] = (h: string) => { attempts.push(`dns.${n}(${h})`); throw new Error("GUARD"); }; (dns.promises as any)[n] = (h: string) => { attempts.push(`dns.promises.${n}(${h})`); throw new Error("GUARD"); }; }
syncBuiltinESMExports();

const { INVENTORY_SECTIONS, buildInventory, buildCollectorScript } = await import("../../../packages/ssh/src/index.ts");
const { renderOutput } = await import("../../../packages/ssh/src/collector.fixtures.ts");
const { buildServer } = await import("../../../apps/api/src/server.ts");
const { enrolOwner, setupTokenSink } = await import("../../../apps/api/src/auth/testing.ts");
const { SimulatedTarget } = await import("../../../apps/worker/src/index.ts");
const { createSigner } = await import("../../../packages/domain/src/index.ts");
const { SqliteAuthStore } = await import("../../../packages/store/src/index.ts");
const { CandidatesResponseSchema, BaselineSchema, ComparisonSchema, SetupPlanResultSchema, BaselineErrorSchema } = await import("../../../packages/contracts/src/index.ts");

// ===================================================================================== the remote inventory script
test("INV-01 every inventory command is read-only: only test, find, printf and awk; no redirection, pipe, chaining, substitution, sudo or network", () => {
  const allowedHeads = new Set(["test", "find", "printf", "awk"]);
  const problems: string[] = [];
  for (const s of INVENTORY_SECTIONS) {
    const c = s.command.replace(/^\$T\s+/, "");
    const quoted = c.replace(/'[^']*'/g, "''"); // look outside single-quoted awk programs and formats
    const head = quoted.trim().split(/\s+/)[0]!;
    if (!allowedHeads.has(head)) problems.push(`${s.name}: command ${head}`);
    if (/[|;&`<>]|\$\(/.test(quoted)) problems.push(`${s.name}: shell operator in "${quoted}"`);
    if (/(^|\s)(sudo|su|curl|wget|nc|ssh|apt|apt-get|dpkg)(\s|$)/.test(quoted)) // whole words outside quotes (paths like /var/lib/apt are data) problems.push(`${s.name}: forbidden program`);
    if (head === "find" && /-(exec|execdir|ok|okdir|delete|fprint|fprintf|fprint0|fls)\b/.test(c)) problems.push(`${s.name}: find action that runs or writes`);
    if (head === "awk") { const prog = (c.match(/'([^']*)'/) ?? [])[1] ?? ""; if (/\bsystem\s*\(|\bgetline\b|print[^;}]*>|printf[^;}]*>|\|/.test(prog)) problems.push(`${s.name}: awk can run commands or write files`); }
  }
  assert.deepEqual(problems, []);
  assert.deepEqual(INVENTORY_SECTIONS.map((s) => s.name), ["srvexists", "srvdirs", "homepath", "homedirs", "pkgs", "ubuntupkgs"], "the inventory command set changed: review it");
});

test("INV-02 the full script sent over SSH contains exactly these commands and nothing else", () => {
  const nonce = "0123456789abcdef0123456789abcdef"; const script = buildCollectorScript(nonce, INVENTORY_SECTIONS);
  for (const s of INVENTORY_SECTIONS) assert.ok(script.includes(s.command), `${s.name} missing from the script`);
  assert.ok(!/\bsudo\b|\brm\b|\bmkdir\b|\bchmod\b|\bchown\b|\btee\b|\bcurl\b|\bwget\b/.test(script), "the script contains a writing or network program");
  console.log(`# INV-02 script lines: ${script.split("\n").length}`);
});

test("INV-03 the parser treats hostile output as data: odd paths, control characters and over-long lists are bounded", () => {
  const nonce = "0123456789abcdef0123456789abcdef";
  const hostile = ["/srv/ok root root 755", "/srv/../etc root root 755", "/srv/with space root root 755", "/srv/$(reboot) root root 755", "/srv/\u001b[31mred root root 755", "/srv/sticky root root 1777", "/srv/setuid root root 4755", "not-a-line"];
  const many = Array.from({ length: 900 }, (_, i) => `/srv/d${i} root root 755`);
  const out = renderOutput({ srvexists: { rc: 0, body: "" }, srvdirs: { rc: 0, body: [...hostile, ...many].join("\n") }, homepath: { rc: 0, body: "/home/servrsit" }, homedirs: { rc: 0, body: "" }, pkgs: { rc: 0, body: "openssl 3.0.13-0ubuntu3.5\nbad$(x) 1" }, ubuntupkgs: { rc: 0, body: "openssl" } }, nonce);
  const inv = buildInventory(out, nonce, new Date("2026-02-10T03:00:00Z"), "ssh");
  const dirs = inv.directories.status === "ok" ? inv.directories.value : [];
  const paths = dirs.map((d: any) => d.path);
  for (const bad of ["/srv/../etc", "/srv/$(reboot)"]) assert.ok(!paths.includes(bad), `${bad} was accepted as a directory`);
  assert.ok(!paths.some((p: string) => /[\u0000-\u001f]/.test(p)), "a control character survived in a path");
  assert.ok(dirs.length <= 500, `${dirs.length} directories kept (limit 500)`);
  const pk = inv.packages.status === "ok" ? Object.keys(inv.packages.value) : []; assert.ok(!pk.includes("bad$(x)"), "an invalid package name was accepted");
});

// ===================================================================================== the API through simulated servers
const REF = "00000000-0000-4000-8000-0000000000a1", TGT = "00000000-0000-4000-8000-0000000000a2", OFF = "00000000-0000-4000-8000-0000000000a3";
type Dirs = Record<string, { owner: string; group: string; mode: string }>;
async function app(dirs: { ref: Dirs; tgt: Dirs }, writes = { tgt: true }) {
  const signer = createSigner("key-1"); const now = () => new Date();
  const mk = (id: string, d: Dirs, installed: Record<string, string>) => new SimulatedTarget({ serverId: id, installationId: "inst-test", hostKeyFingerprint: `SHA256:sim-${id}`, machineId: `m-${id}`, trustedKeys: { [signer.keyId]: signer.publicKeyPem }, installed, upgrades: [], now, directories: d } as never);
  const ref = mk(REF, dirs.ref, { "openssl:amd64": "3.0.13-0ubuntu3.5", "jq:amd64": "1.7.1-3build1" });
  const tgt = mk(TGT, dirs.tgt, { "openssl:amd64": "3.0.13-0ubuntu3.5" });
  const off = mk(OFF, dirs.tgt, {});
  const sink = setupTokenSink();
  const a = await buildServer({ logger: false, startChecks: false, mode: "live", ownerContextPath: null, auth: { store: new SqliteAuthStore({ path: ":memory:" }), onSetupToken: sink.onSetupToken },
    config: { healthIntervalMinutes: 15, ownerTimeZone: "Asia/Jakarta", hosts: [], registration: { controllerAddress: null, allowedPorts: [22], enrolledRoutes: [], allowPublicAddresses: false, operatorAddresses: [] } } as never,
    care: { simulated: [
      { server: { id: REF, name: "Sim Reference", production: false, kind: "simulated", writesEnabled: true, user: "servrsit" }, target: ref },
      { server: { id: TGT, name: "Sim Target", production: false, kind: "simulated", writesEnabled: writes.tgt, user: "servrsit" }, target: tgt },
      { server: { id: OFF, name: "Sim Off", production: false, kind: "simulated", writesEnabled: false, user: "servrsit" }, target: off },
    ] } } as never);
  const owner = await enrolOwner(a as never, sink.token());
  const call = async (method: string, url: string, body?: unknown, o: { session?: boolean; csrf?: boolean } = {}) => {
    const headers: Record<string, string> = {}; if (o.session !== false) headers.cookie = owner.cookie;
    if (method !== "GET") { headers.origin = "http://127.0.0.1:5173"; if (o.csrf !== false && o.session !== false) headers["x-csrf-token"] = owner.csrfToken; }
    const r = await a.inject({ method: method as never, url, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
    let data: any; try { data = r.body ? JSON.parse(r.body) : undefined; } catch { data = undefined; } return { status: r.statusCode, data, raw: r.body };
  };
  return { call, close: () => a.close(), tgt, ref };
}
const D = (owner = "root", group = "root", mode = "0755") => ({ owner, group, mode });
const REF_DIRS: Dirs = { "/srv": D(), "/srv/app": D("servrsit", "servrsit"), "/srv/app/data": D("servrsit", "servrsit"), "/srv/open": D("root", "root", "0777"), "/srv/sgid": D("root", "root", "2755"), "/srv/conflict": D("servrsit", "servrsit") };

async function makeBaseline(x: Awaited<ReturnType<typeof app>>, pick: (c: any) => boolean) {
  const c = await x.call("GET", `/api/baselines/candidates?reference=${REF}`); assert.equal(c.status, 200, c.raw.slice(0, 200)); assert.ok(CandidatesResponseSchema.safeParse(c.data).success, "candidates break the contract");
  const ids = c.data.candidates.filter((k: any) => k.eligible && pick(k)).map((k: any) => k.id);
  const b = await x.call("POST", "/api/baselines", { name: "Web standard", referenceId: REF, conventionIds: ids }); assert.equal(b.status, 201, b.raw.slice(0, 200)); assert.ok(BaselineSchema.safeParse(b.data).success);
  return { candidates: c.data.candidates, baseline: b.data };
}

test("BL-01 candidates: plain /srv directories are eligible; world-writable and setgid/setuid ones are not, each with a reason; source and time are stated", async () => {
  const x = await app({ ref: REF_DIRS, tgt: {} }); try {
    const c = (await x.call("GET", `/api/baselines/candidates?reference=${REF}`)).data;
    const byLabel = (l: string) => c.candidates.find((k: any) => k.label.includes(l));
    assert.equal(byLabel("/srv/app/data")?.eligible, true, "a plain directory is not eligible");
    for (const bad of ["/srv/open", "/srv/sgid"]) { const k = byLabel(bad); assert.ok(k, `${bad} missing`); assert.equal(k.eligible, false, `${bad} is eligible`); assert.ok(k.ineligibleReason && k.ineligibleReason.length > 5, `${bad} has no reason`); }
    assert.equal(c.source, "simulated"); assert.ok(c.observedAt);
  } finally { await x.close(); }
});

test("BL-02 compare: Matches, Missing and Conflict (owner differs) are distinguished; comparing changes nothing on the target", async () => {
  const x = await app({ ref: REF_DIRS, tgt: { "/srv": D(), "/srv/app": D("servrsit", "servrsit"), "/srv/conflict": D("root", "root") } }); try {
    const { baseline } = await makeBaseline(x, (k) => /\/srv\/(app|app\/data|conflict)$/.test(k.label));
    const before = JSON.stringify(x.tgt.inventorySnapshot());
    const r = await x.call("POST", `/api/baselines/${baseline.id}/compare`, { targetId: TGT }); assert.equal(r.status, 200, r.raw.slice(0, 200)); assert.ok(ComparisonSchema.safeParse(r.data).success);
    const st = (l: string) => r.data.rows.find((row: any) => row.label.includes(l))?.status;
    assert.equal(st("/srv/app/data"), "missing"); assert.equal(st("/srv/conflict"), "conflict"); assert.equal(st("/srv/app"), "matches");
    const conflict = r.data.rows.find((row: any) => row.label.includes("/srv/conflict")); assert.ok(conflict.found && conflict.reason.length > 5, "a conflict does not say what was found");
    assert.equal(JSON.stringify(x.tgt.inventorySnapshot()), before, "comparing changed the target");
  } finally { await x.close(); }
});

test("BL-03 'mark intentional' turns a row into Different by design, records it in an append-only history, and can be removed", async () => {
  const x = await app({ ref: REF_DIRS, tgt: { "/srv": D(), "/srv/conflict": D("root", "root") } }); try {
    const { baseline } = await makeBaseline(x, (k) => /\/srv\/conflict$/.test(k.label));
    const row = (await x.call("POST", `/api/baselines/${baseline.id}/compare`, { targetId: TGT })).data.rows[0];
    const m = await x.call("PUT", `/api/baselines/${baseline.id}/exceptions`, { targetId: TGT, conventionId: row.conventionId, reason: "root-owned on purpose" }); assert.equal(m.status, 200, m.raw.slice(0, 200));
    assert.equal(m.data.rows[0].status, "different-by-design"); assert.equal(m.data.rows[0].intentional?.reason, "root-owned on purpose");
    for (const bad of [{ targetId: TGT, conventionId: row.conventionId, reason: "<script>" }, { targetId: TGT, conventionId: row.conventionId }, { targetId: "x", conventionId: row.conventionId, reason: null }]) assert.equal((await x.call("PUT", `/api/baselines/${baseline.id}/exceptions`, bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    const del = await x.call("DELETE", `/api/baselines/${baseline.id}/exceptions/${TGT}/${encodeURIComponent(row.conventionId)}`); assert.equal(del.status, 200, del.raw.slice(0, 160)); assert.equal(del.data.rows[0].status, "conflict");
    const h = await x.call("GET", `/api/baselines/${baseline.id}/history?target=${TGT}`); assert.ok(h.data.events.length >= 2, "marking and removing are not both in the history");
  } finally { await x.close(); }
});

test("BL-04 a setup plan holds only MISSING directories, parents first, as prepare.directories.v1; conflicts and packages are listed as not included with reasons; nothing runs", async () => {
  const x = await app({ ref: REF_DIRS, tgt: { "/srv": D(), "/srv/conflict": D("root", "root") } }); try {
    const { baseline } = await makeBaseline(x, (k) => /\/srv\/(app|app\/data|conflict)$/.test(k.label) || k.kind === "package");
    const before = JSON.stringify(x.tgt.inventorySnapshot());
    const p = await x.call("POST", `/api/baselines/${baseline.id}/setup-plan`, { targetId: TGT }); assert.equal(p.status, 201, p.raw.slice(0, 200)); assert.ok(SetupPlanResultSchema.safeParse(p.data).success);
    assert.equal(p.data.included, 2, `the plan holds ${p.data.included} directories (expected the 2 missing ones)`);
    assert.ok(p.data.notIncluded.some((n: any) => n.label.includes("/srv/conflict")), "the conflict is not listed as not included");
    assert.ok(p.data.notIncluded.some((n: any) => /package|jq/i.test(n.label + n.reason)), "packages are not listed as not included");
    const plan = await x.call("GET", `/api/plans/${p.data.planId}`); assert.equal(plan.status, 200, plan.raw.slice(0, 160));
    const txt = JSON.stringify(plan.data); assert.ok(txt.includes("prepare.directories.v1"), "the plan is not prepare.directories.v1");
    const i1 = txt.indexOf('"/srv/app"'), i2 = txt.indexOf('"/srv/app/data"'); assert.ok(i1 >= 0 && i2 > i1, "parents do not come first");
    assert.equal(JSON.stringify(x.tgt.inventorySnapshot()), before, "making a setup plan changed the target");
  } finally { await x.close(); }
});

test("BL-05 a server with writes disabled gets a plan blocked WRITES_DISABLED", async () => {
  const x = await app({ ref: REF_DIRS, tgt: {} }); try {
    const { baseline } = await makeBaseline(x, (k) => /\/srv\/app$/.test(k.label));
    const p = await x.call("POST", `/api/baselines/${baseline.id}/setup-plan`, { targetId: OFF }); assert.ok(p.status === 201 || (p.status >= 400 && p.status < 500), `${p.status}`);
    if (p.status === 201) { const plan = (await x.call("GET", `/api/plans/${p.data.planId}`)).data; assert.ok(JSON.stringify(plan.blockers ?? []).includes("WRITES_DISABLED"), "the plan for a write-disabled server is not blocked"); assert.equal(plan.approvable, false); }
  } finally { await x.close(); }
});

test("BL-06 versions: saving with baselineId makes version 2 and the latest is returned; names and ids are validated", async () => {
  const x = await app({ ref: REF_DIRS, tgt: {} }); try {
    const { baseline, candidates } = await makeBaseline(x, (k) => /\/srv\/app$/.test(k.label));
    const more = candidates.filter((k: any) => k.eligible && /\/srv\/app/.test(k.label)).map((k: any) => k.id);
    const v2 = await x.call("POST", "/api/baselines", { name: "Web standard", referenceId: REF, conventionIds: more, baselineId: baseline.id }); assert.equal(v2.status, 201); assert.equal(v2.data.version, 2); assert.equal(v2.data.id, baseline.id);
    assert.equal((await x.call("GET", `/api/baselines/${baseline.id}`)).data.version, 2);
    for (const bad of [{ name: "<x>", referenceId: REF, conventionIds: more }, { name: "Ok", referenceId: REF, conventionIds: [] }, { name: "Ok", referenceId: "x", conventionIds: more }, { name: "Ok", referenceId: REF, conventionIds: ["/etc/shadow"] }]) {
      const r = await x.call("POST", "/api/baselines", bad); assert.ok(r.status >= 400 && r.status < 500, `${JSON.stringify(bad).slice(0, 60)} -> ${r.status}`); assert.ok(BaselineErrorSchema.safeParse(r.data).success, r.raw.slice(0, 120));
    }
  } finally { await x.close(); }
});

test("BL-07 every baseline route needs a session; state-changing ones a CSRF token", async () => {
  const x = await app({ ref: REF_DIRS, tgt: {} }); try {
    const { baseline } = await makeBaseline(x, (k) => /\/srv\/app$/.test(k.label));
    for (const [m, u, b] of [["GET", "/api/baselines"], ["GET", "/api/baselines/servers"], ["GET", `/api/baselines/candidates?reference=${REF}`], ["POST", `/api/baselines/${baseline.id}/compare`, { targetId: TGT }], ["POST", `/api/baselines/${baseline.id}/setup-plan`, { targetId: TGT }], ["PUT", `/api/baselines/${baseline.id}/exceptions`, { targetId: TGT, conventionId: "x", reason: null }]] as const) {
      assert.equal((await x.call(m, u, b, { session: false })).status, 401, `${m} ${u}`);
      if (m !== "GET") assert.equal((await x.call(m, u, b, { csrf: false })).status, 403, `${m} ${u} without CSRF`);
    }
  } finally { await x.close(); }
});

test("GUARD (baselines): no process, socket or DNS lookup was attempted", () => { assert.deepEqual(attempts, []); });
