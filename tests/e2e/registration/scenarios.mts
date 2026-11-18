/**
 * Server registration acceptance scenarios (T-069). Written from PRD FR-02/FR-03 and Technical Spec 6.2
 * (target validation), 6.3 (host-key verification), and the credential rules in the execution-security
 * steering, BEFORE the implementation. The contract file supplies only paths and response shapes.
 *
 * Positive controls: every "refused" scenario also shows a valid request succeeding in the same run, so a
 * product (or harness) that refuses everything cannot pass.
 */
import assert from "node:assert/strict";
import { ServerDraftSchema, FirstCheckSchema, ServerRegistrationErrorSchema, DisconnectResponseSchema, ActivateResponseSchema } from "../../../packages/contracts/src/servers.ts";
import { ENDPOINTS, HOUR, type RegHarness, type Res, type Scenario } from "./support/contract.mts";
import { parseAuthorizedKeysLine, optionValue, fingerprintOfBlob } from "./support/ssh.mts";
import type { FakeTarget } from "./support/world.mts";

// ----------------------------------------------------------------------------- helpers
const GOOD = { address: "100.64.1.50", port: 22, user: "servrsit", name: "Fixture Alpha", role: null, production: false };
const P = "/api/servers/drafts";
type Body = Record<string, unknown>;

export const draft = (h: RegHarness, over: Body = {}) => h.api({ method: "POST", path: P, body: { ...GOOD, ...over } });
const step = (h: RegHarness, id: string, what: string, body?: unknown) => h.api({ method: "POST", path: `${P}/${id}/${what}`, ...(body === undefined ? {} : { body }) });
const getDraft = (h: RegHarness, id: string) => h.api({ method: "GET", path: `${P}/${id}` });

/** A 4xx refusal that follows the contract's error shape and never echoes what was sent. */
function refused(r: Res, label: string, codes?: readonly string[], echo?: string): void {
  assert.ok(r.status >= 400 && r.status < 500, `${label}: must be a 4xx refusal, got ${r.status} ${r.code ?? ""} ${r.raw.slice(0, 120)}`);
  const parsed = ServerRegistrationErrorSchema.safeParse(JSON.parse(r.raw || "{}"));
  assert.ok(parsed.success, `${label}: error body does not match the contract: ${r.raw.slice(0, 160)}`);
  if (codes) assert.ok(codes.includes(r.code ?? ""), `${label}: expected one of ${codes.join("/")}, got ${r.code}`);
  assert.ok(!/\bat .*\(.*:\d+:\d+\)|node_modules|Error:/.test(r.raw), `${label}: the body looks like a stack trace`);
  if (echo && echo.trim().length >= 4) assert.ok(!r.raw.includes(echo), `${label}: the refusal echoes what was submitted`);
}
const noNetwork = (h: RegHarness, before: { conns: number; lookups: number; drafts: number }, label: string): Promise<void> => (async () => {
  assert.equal(h.world.allConnections().length, before.conns, `${label}: the controller connected somewhere`);
  assert.equal(h.world.lookups().length, before.lookups, `${label}: the controller resolved a name before the input was known to be well-formed`);
  assert.equal(await h.draftCount(), before.drafts, `${label}: a draft was created`);
})();
const snap = async (h: RegHarness) => ({ conns: h.world.allConnections().length, lookups: h.world.lookups().length, drafts: await h.draftCount() });

async function positiveControl(h: RegHarness): Promise<void> {
  h.world.addTarget({ address: "100.64.1.99" });
  const r = await draft(h, { address: "100.64.1.99", name: "Control" });
  assert.equal(r.status, 201, `control: a valid address must be accepted (${r.status} ${r.code})`);
}

export async function scanAndConfirm(h: RegHarness, id: string, t: FakeTarget): Promise<void> {
  const s = await step(h, id, "host-key"); assert.equal(s.status, 200, `scan ${s.status} ${s.code}`);
  const c = await step(h, id, "host-key/confirm", { fingerprint: t.fingerprint }); assert.equal(c.status, 200, `confirm ${c.status} ${c.code}`);
}
export async function waitCheck(h: RegHarness, id: string): Promise<any> {
  for (let i = 0; i < 60; i++) { const r = await h.api({ method: "GET", path: `${P}/${id}/first-check` }); if (r.status === 200 && r.data?.finished) return r.data; await h.advance(500); }
  throw new Error("the first check never finished");
}
/** The whole happy path up to (not including) activation. Returns the draft id and the fake server. */
export async function toChecked(h: RegHarness, over: Body = {}, behavior: "ok" | "unprivileged" = "ok"): Promise<{ id: string; target: FakeTarget; line: string }> {
  const address = String(over["address"] ?? GOOD.address);
  const target = h.world.targetAt(address) ?? h.world.addTarget({ address, behavior });
  const d = await draft(h, over); assert.equal(d.status, 201, `draft ${d.status} ${d.code} ${d.reason ?? ""}`); const id = d.data.id as string;
  await scanAndConfirm(h, id, target);
  const k = await step(h, id, "access-key"); assert.equal(k.status, 200, `access-key ${k.status} ${k.code}`);
  const line = k.data.accessKey.authorizedKeysLine as string; target.authorizeKey(line, k.data.accessKey.controllerAddress);
  const f = await step(h, id, "first-check"); assert.ok(f.status === 202 || f.status === 200, `first-check ${f.status} ${f.code}`);
  const fc = await waitCheck(h, id); assert.equal(fc.failureCode, null, `first check failed: ${fc.failureCode}`);
  return { id, target, line };
}

const shellSyntax = ["ssh://100.64.1.5", "http://100.64.1.5", "ftp://x", "user@100.64.1.5", "user:pw@100.64.1.5", "100.64.1.5;id", "100.64.1.5 && id", "100.64.1.5|nc x 1", "$(id)", "`id`", "100.64.1.5\nfoo", "100.64.1.5\r\nHost *", "100.64.1.5 -p 2222",
  "-v", "-V", "-oProxyCommand=sh", "--", "-", "-100.64.1.5", "host name", "host/path", "host?x=1", "host#x", "host%00", "host\u0000x", "例え.jp", "exa\u200bmple.com", "ｅｘａｍｐｌｅ.com", "", " ", "a".repeat(254),
  "..", "...", "a..b", ".a", ":", "::::", "[", "]", "100.64.1.5:22", "[100.64.1.5]:22", "host:22", "*", "*.example.com", "100.64.1.0/24", "100.64.1.*", "~root", "$HOME", "{a,b}", "a;b", "a'b", 'a"b', "a\\b", "a<b", "a>b"];

const blockedLiterals: [string, string][] = [
  ["127.0.0.1", "loopback"], ["127.0.0.2", "loopback /8"], ["127.255.255.254", "loopback /8"], ["127.1", "short-form loopback"], ["localhost", "loopback name"], ["LOCALHOST", "case"], ["localhost.", "trailing dot"], ["ip6-localhost", "loopback name"],
  ["0.0.0.0", "unspecified"], ["0", "short-form unspecified"], ["::", "unspecified v6"], ["::1", "loopback v6"], ["[::1]", "bracketed loopback v6"], ["0:0:0:0:0:0:0:1", "expanded loopback v6"],
  ["169.254.169.254", "cloud metadata"], ["169.254.0.1", "link-local"], ["169.254.170.2", "ECS task metadata"], ["fe80::1", "link-local v6"], ["fd00:ec2::254", "AWS IMDS v6"],
  ["::ffff:127.0.0.1", "IPv4-mapped loopback"], ["::ffff:169.254.169.254", "IPv4-mapped metadata"], ["::ffff:7f00:1", "hex IPv4-mapped loopback"],
  ["2130706433", "decimal 127.0.0.1"], ["0x7f000001", "hex 127.0.0.1"], ["0177.0.0.1", "octal 127.0.0.1"], ["0x7f.0.0.1", "mixed hex 127.0.0.1"], ["127.0.0.1.", "trailing dot"], ["2852039166", "decimal 169.254.169.254"],
  ["224.0.0.1", "multicast"], ["255.255.255.255", "broadcast"], ["ff02::1", "multicast v6"],
];

const PREREG: Scenario[] = [];
const add = (s: Scenario) => { PREREG.push(s); };

// ============================================================================ A. address validation (Tech Spec 6.2)
add({ id: "SR-01", title: "shell syntax, URI schemes, embedded credentials, option-looking and malformed addresses are refused before any lookup or connection, and nothing is echoed", spec: ["Tech 6.2: reject malformed addresses, command prefixes, URI schemes, embedded credentials, shell syntax", "6.4: no local shell, fixed argument array"],
  async run(h) {
    await positiveControl(h);
    for (const a of shellSyntax) {
      const before = await snap(h); const r = await draft(h, { address: a, name: "Probe" });
      refused(r, `address ${JSON.stringify(a)}`, ["INVALID_INPUT", "ADDRESS_REJECTED"], a); await noNetwork(h, before, `address ${JSON.stringify(a)}`);
    }
  } });

add({ id: "SR-02", title: "loopback, unspecified, metadata, link-local, multicast and every odd spelling of them are refused without a connection", spec: ["Tech 6.2: block loopback, metadata endpoints, link-local infrastructure", "execution-security: Target safety"],
  async run(h) {
    await positiveControl(h);
    for (const [a, why] of blockedLiterals) {
      const before = await snap(h); const r = await draft(h, { address: a, name: "Probe" });
      refused(r, `${a} (${why})`, ["INVALID_INPUT", "ADDRESS_REJECTED"], a); assert.equal(h.world.allConnections().length, before.conns, `${a} (${why}): a connection was attempted`); assert.equal(await h.draftCount(), before.drafts, `${a} (${why}): a draft was created`);
    }
  } });

add({ id: "SR-03", title: "the controller itself and operator addresses are refused, in every spelling and through DNS, while a neighbouring address is accepted", spec: ["Tech 6.2: block the controller itself, and operator/control-plane addresses"],
  async run(h) {
    const ctrl = h.world.controllerAddresses[0]!; const op = h.world.operatorAddresses[0]!;
    h.world.dns("ctrl.example", [ctrl]); h.world.dns("op.example", [op]);
    h.world.addTarget({ address: "100.64.0.3" });
    for (const a of [ctrl, op, `::ffff:${ctrl}`, `::ffff:${op}`, "ctrl.example", "op.example"]) {
      const r = await draft(h, { address: a, name: "Probe" });
      if (r.status === 201) { const s = await step(h, r.data.id, "host-key"); refused(s, `${a}: scanning`, ["ADDRESS_REJECTED", "STATE_CONFLICT", "ROUTE_UNAVAILABLE"]); } else refused(r, a, ["INVALID_INPUT", "ADDRESS_REJECTED"], a);
      assert.equal(h.world.connectionsTo(ctrl) + h.world.connectionsTo(op), 0, `${a}: the controller connected to itself or an operator address`);
    }
    const ok = await draft(h, { address: "100.64.0.3", name: "Neighbour" }); assert.equal(ok.status, 201, "control: the address next to the controller is allowed");
  } });

add({ id: "SR-04", title: "a name that resolves to a blocked address, or to a mix that includes one, is never connected to", spec: ["Tech 6.2: resolve names with a controlled resolver; validate resolved addresses"],
  async run(h) {
    await positiveControl(h); const ctrl = h.world.controllerAddresses[0]!;
    h.world.addTarget({ address: "100.64.1.60" });
    const names: [string, string[]][] = [["evil-loop.example", ["127.0.0.1"]], ["evil-meta.example", ["169.254.169.254"]], ["metadata.google.internal", ["169.254.169.254"]], ["mixed.example", ["100.64.1.60", "127.0.0.1"]], ["mixed2.example", ["127.0.0.1", "100.64.1.60"]],
      ["v6loop.example", ["::1"]], ["mapped.example", ["::ffff:127.0.0.1"]], ["linklocal.example", ["fe80::1"]], ["self.example", [ctrl]]];
    for (const [n, ips] of names) h.world.dns(n, ips);
    for (const [n] of names) {
      const r = await draft(h, { address: n, name: "Probe" });
      if (r.status === 201) { const s = await step(h, r.data.id, "host-key"); refused(s, `${n}: scanning`); const dr = (await getDraft(h, r.data.id)).data; assert.equal(dr.hostKey, null, `${n}: a host key was recorded`); }
      else refused(r, n, ["ADDRESS_REJECTED", "INVALID_INPUT", "ROUTE_UNAVAILABLE"], n);
    }
    for (const bad of ["127.0.0.1", "169.254.169.254", "::1", ctrl]) assert.equal(h.world.connectionsTo(bad), 0, `a connection was attempted to ${bad}`);
    // a name with no records: clean refusal or an unreachable draft, never a crash and never a connection
    const nx = await draft(h, { address: "nx.example", name: "Nowhere" });
    assert.ok(nx.status < 500, `unresolvable name gave ${nx.status}`); if (nx.status === 201) assert.equal(nx.data.reachability.reachable, false);
  } });

add({ id: "SR-05", title: "DNS rebinding: a name that changes to a blocked address after registration is never connected to", spec: ["Tech 6.2: revalidate DNS results before connection to prevent rebinding; bind the job to the validated endpoint"],
  async run(h) {
    h.world.addTarget({ address: "100.64.1.61" });
    h.world.dns("rebind.example", [["100.64.1.61"], ["127.0.0.1"]]);
    h.world.dns("rebind2.example", [["100.64.1.61"], ["169.254.169.254"], ["127.0.0.1"]]);
    for (const n of ["rebind.example", "rebind2.example"]) {
      const d = await draft(h, { address: n, name: "Rebind " + n.slice(6, 7) }); assert.equal(d.status, 201, `${n}: the first (valid) answer must be accepted`);
      const s = await step(h, d.data.id, "host-key"); assert.ok(s.status === 200 || (s.status >= 400 && s.status < 500), `${n}: scan gave ${s.status}`);
      if (s.status === 200) { const t = h.world.targetAt("100.64.1.61")!; const c = await step(h, d.data.id, "host-key/confirm", { fingerprint: t.fingerprint }); void c; await step(h, d.data.id, "access-key"); await step(h, d.data.id, "first-check"); }
    }
    for (const bad of ["127.0.0.1", "169.254.169.254"]) assert.equal(h.world.connectionsTo(bad), 0, `rebinding got through: a connection was attempted to ${bad}`);
  } });

add({ id: "SR-06", title: "private and CGNAT addresses are accepted only inside the owner's enrolled route", spec: ["Tech 6.2: permit private/CGNAT only through the explicitly enrolled customer route and registered destination"], needs: ["routes"],
  async run(h) {
    await h.setEnrolledRoutes(["100.64.0.0/10"]);
    for (const a of ["10.0.0.5", "192.168.1.10", "172.16.0.1", "172.31.255.254", "100.63.255.255", "100.128.0.1"]) { const r = await draft(h, { address: a, name: "Out " + a.slice(0, 7) }); refused(r, `${a} is outside the enrolled route`, ["ADDRESS_REJECTED"], a); }
    for (const a of ["100.64.0.3", "100.100.100.100", "100.127.255.254"]) { const r = await draft(h, { address: a, name: "In " + a.slice(0, 9) }); assert.equal(r.status, 201, `${a} is inside the enrolled route (${r.status} ${r.code})`); }
    await h.setEnrolledRoutes([]);
    refused(await draft(h, { address: "100.64.0.3", name: "None" }), "no route enrolled", ["ADDRESS_REJECTED"]);
    await h.setEnrolledRoutes(["10.0.0.0/8"]);
    assert.equal((await draft(h, { address: "10.1.1.1", name: "Ten" })).status, 201); refused(await draft(h, { address: "100.64.0.3", name: "Cg" }), "CGNAT is not enrolled now", ["ADDRESS_REJECTED"]);
  } });

add({ id: "SR-07", title: "malformed ports are refused; unusual ports are recorded as an open question, never a crash", spec: ["Tech 6.2: reject unapproved ports"],
  async run(h) {
    await positiveControl(h);
    for (const p of [0, -1, 65536, 99999, 22.5, "22", null, "", "abc", NaN, 1e21, [22], { n: 22 }, true]) {
      const before = await snap(h); const r = await draft(h, { port: p, name: "Port" }); refused(r, `port ${JSON.stringify(p)}`, ["INVALID_INPUT", "ADDRESS_REJECTED"]); await noNetwork(h, before, `port ${JSON.stringify(p)}`);
    }
    const seen: string[] = [];
    for (const p of [25, 53, 80, 443, 3306, 5432, 6379, 2222, 65535]) { h.world.addTarget({ address: "100.64.1.99", port: p }); const r = await draft(h, { address: "100.64.1.99", port: p, name: "P" + p }); assert.ok(r.status < 500, `port ${p}: ${r.status}`); seen.push(`${p}:${r.status === 201 ? "accepted" : r.code}`); }
    console.log(`# SR-07 OPEN QUESTION (which ports are "approved"?): ${seen.join(" ")}`);
  } });

add({ id: "SR-08", title: "production must be stated; names, roles and logins are validated; credentials and unknown fields are refused", spec: ["FR-02: production status must be explicitly confirmed; unset uses production-level precautions", "FR-03: credentials never via ordinary surfaces"],
  async run(h) {
    await positiveControl(h);
    const { production: _p, ...noProd } = GOOD;
    refused(await h.api({ method: "POST", path: P, body: noProd }), "production omitted", ["INVALID_INPUT"]);
    for (const v of [null, "true", 1, "yes", undefined]) refused(await draft(h, { production: v, name: "Prod" }), `production ${JSON.stringify(v)}`, ["INVALID_INPUT"]);
    for (const u of ["root;id", "Root", "1abc", "a b", "", "a".repeat(33), "user@host", "-x", "$(id)"]) refused(await draft(h, { user: u, name: "U" }), `user ${JSON.stringify(u)}`, ["INVALID_INPUT"], u);
    for (const n of ["", " lead", "a\nb", "<script>", "a".repeat(65), "x;rm", "名前"]) refused(await draft(h, { name: n }), `name ${JSON.stringify(n)}`, ["INVALID_INPUT"], n);
    for (const k of ["privateKey", "private_key", "password", "passphrase", "identityFile", "writesEnabled", "id", "state", "hostKey", "secret", "sshKey"]) {
      const before = await draft(h, { name: "Extra", [k]: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc" });
      refused(before, `unknown field ${k}`, ["INVALID_INPUT"], "BEGIN OPENSSH");
    }
    assert.ok(!h.logText().includes("BEGIN OPENSSH PRIVATE KEY"), "a submitted private key reached the log");
  } });

// ============================================================================ B. host key (Tech Spec 6.3, FR-02)
add({ id: "SR-10", title: "the host key is read without signing in, shown as an independently computed fingerprint, and never confirmed by the product itself", spec: ["Tech 6.3: first enrollment obtains a fingerprint and requires independent verification from the owner", "Tech 6.3: never accept any host key"],
  async run(h) {
    const t = h.world.addTarget({ address: "100.64.1.50" }); const d = await draft(h); assert.equal(d.status, 201);
    assert.ok(ServerDraftSchema.safeParse(d.data).success, "the draft does not match the contract"); assert.equal(d.data.state, "draft"); assert.equal(d.data.hostKey, null); assert.equal(d.data.hostKeyConfirmedAt, null);
    const s = await step(h, d.data.id, "host-key"); assert.equal(s.status, 200);
    assert.equal(s.data.state, "host-key-seen"); assert.equal(s.data.hostKey.fingerprint, t.fingerprint, "the fingerprint shown is not the one the server's key actually has");
    assert.equal(s.data.hostKey.algorithm, "ED25519"); assert.equal(s.data.hostKeyConfirmedAt, null, "the product confirmed the key by itself");
    assert.equal(t.authAttempts(), 0, "the key scan tried to sign in"); assert.deepEqual([...t.commands()], [], "the key scan ran a command");
    assert.equal(t.offeredKeys().length, 0);
    const again = await step(h, d.data.id, "host-key"); assert.equal(again.status, 200); assert.equal(again.data.hostKey.fingerprint, t.fingerprint, "a second scan must give the same answer");
  } });

add({ id: "SR-11", title: "only the exact fingerprint the owner supplies confirms the key; a wrong, other-server, malformed or empty one is refused and nothing advances", spec: ["Tech 6.3: independent verification", "PRD FR-02"],
  async run(h) {
    const t = h.world.addTarget({ address: "100.64.1.50" }); const other = h.world.addTarget({ address: "100.64.1.51" });
    const d = await draft(h); const id = d.data.id as string; await step(h, id, "host-key");
    const fp = t.fingerprint; const swapCase = fp.replace(/[A-Za-z]/, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    const bad: unknown[] = [other.fingerprint, fp.slice(0, -1) + (fp.endsWith("A") ? "B" : "A"), swapCase === fp ? fp.replace(/^SHA256:/, "SHA256: ") : swapCase, fp + " ", " " + fp, fp.replace("SHA256:", "sha256:"), fp.replace("SHA256:", ""), "MD5:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99", "", null, 123, [fp], { fingerprint: fp }];
    for (const b of bad) {
      const r = await step(h, id, "host-key/confirm", { fingerprint: b }); refused(r, `confirm with ${JSON.stringify(b)?.slice(0, 40)}`, ["FINGERPRINT_MISMATCH", "INVALID_INPUT"]);
      const now = (await getDraft(h, id)).data; assert.equal(now.state, "host-key-seen", `state moved to ${now.state}`); assert.equal(now.hostKeyConfirmedAt, null);
    }
    refused(await h.api({ method: "POST", path: `${P}/${id}/host-key/confirm`, body: {} }), "empty body", ["INVALID_INPUT"]);
    refused(await h.api({ method: "POST", path: `${P}/${id}/host-key/confirm` }), "no body", ["INVALID_INPUT"]);
    refused(await step(h, id, "access-key"), "access key before a confirmed host key", ["HOST_KEY_NOT_CONFIRMED", "STATE_CONFLICT"]);
    assert.equal(h.keys.storedKeyCount(), 0, "a key was made for an unconfirmed host");
    const ok = await step(h, id, "host-key/confirm", { fingerprint: fp }); assert.equal(ok.status, 200, "control: the exact fingerprint is accepted"); assert.equal(ok.data.state, "host-key-confirmed"); assert.ok(ok.data.hostKeyConfirmedAt);
  } });

add({ id: "SR-12", title: "steps out of order are refused, change nothing, issue no key and contact no server", spec: ["contract: order is enforced by the API", "Tech 6.3"],
  async run(h) {
    const t = h.world.addTarget({ address: "100.64.1.50" }); const id = (await draft(h)).data.id as string;
    const conns0 = t.connections();
    for (const w of ["host-key/confirm", "access-key", "first-check", "activate"]) refused(await step(h, id, w, w === "host-key/confirm" ? { fingerprint: t.fingerprint } : undefined), `${w} on a fresh draft`, ["STATE_CONFLICT", "HOST_KEY_NOT_CONFIRMED", "INVALID_INPUT"]);
    assert.equal(t.connections(), conns0, "an out-of-order step contacted the server"); assert.equal(h.keys.storedKeyCount(), 0);
    assert.equal((await getDraft(h, id)).data.state, "draft");
    await scanAndConfirm(h, id, t);
    for (const w of ["first-check", "activate"]) refused(await step(h, id, w), `${w} before an access key`, ["STATE_CONFLICT", "HOST_KEY_NOT_CONFIRMED"]);
    assert.equal(t.authAttempts(), 0, "the server was signed in to before a key existed"); assert.equal((await h.servers()).length, 0);
    await step(h, id, "access-key");
    refused(await step(h, id, "activate"), "activate before a check", ["STATE_CONFLICT"]);
    assert.equal((await h.servers()).length, 0, "a server was created without a first check");
  } });

add({ id: "SR-13", title: "a changed host key voids the confirmation: the owner must confirm the new fingerprint, and the old one never carries over", spec: ["Tech 6.3: a changed key blocks inspection and changes until reverified; reverification does not inherit", "PRD FR-02: changed host key blocks access until separately reverified"],
  async run(h) {
    const t = h.world.addTarget({ address: "100.64.1.50" }); const id = (await draft(h)).data.id as string; await scanAndConfirm(h, id, t);
    const oldFp = t.fingerprint; const newFp = t.changeHostKey(); assert.notEqual(oldFp, newFp);
    const rescan = await step(h, id, "host-key");
    if (rescan.status === 200) { assert.notEqual(rescan.data.state, "host-key-confirmed", "the old confirmation was kept for a different key"); assert.equal(rescan.data.hostKeyConfirmedAt, null); assert.equal(rescan.data.hostKey.fingerprint, newFp); }
    else refused(rescan, "rescan after change", ["HOST_KEY_CHANGED"]);
    refused(await step(h, id, "access-key"), "access key while the new fingerprint is unconfirmed", ["HOST_KEY_NOT_CONFIRMED", "STATE_CONFLICT", "HOST_KEY_CHANGED"]);
    refused(await step(h, id, "host-key/confirm", { fingerprint: oldFp }), "the OLD fingerprint", ["FINGERPRINT_MISMATCH", "STATE_CONFLICT", "HOST_KEY_CHANGED"]);
    assert.equal(t.authAttempts(), 0);
  } });

add({ id: "SR-14", title: "if the key changes between confirmation and the first check, nothing is offered to the new server and the failure is HOST_KEY_CHANGED", spec: ["Tech 6.3", "PRD FR-02: connection tests distinguish host-key mismatch", "execution-security: strict host checking"],
  async run(h) {
    const t = h.world.addTarget({ address: "100.64.1.50" }); const id = (await draft(h)).data.id as string; await scanAndConfirm(h, id, t);
    const k = await step(h, id, "access-key"); t.authorizeKey(k.data.accessKey.authorizedKeysLine, k.data.accessKey.controllerAddress);
    t.changeHostKey();
    const r = await step(h, id, "first-check"); assert.ok(r.status === 202 || r.status === 200 || (r.status >= 400 && r.status < 500));
    if (r.status < 300) { const fc = await waitCheck(h, id); assert.equal(fc.failureCode, "HOST_KEY_CHANGED"); assert.equal((await getDraft(h, id)).data.state, "check-failed"); } else refused(r, "first check", ["HOST_KEY_CHANGED"]);
    assert.equal(t.authAttempts(), 0, "the controller presented its key to a server whose host key had changed"); assert.equal(t.offeredKeys().length, 0); assert.deepEqual([...t.commands()], []);
    refused(await step(h, id, "activate"), "activate after a changed key", ["STATE_CONFLICT", "HOST_KEY_CHANGED"]); assert.equal((await h.servers()).length, 0);
  } });

add({ id: "SR-15", title: "the pinned key's evidence is recorded: algorithm, fingerprint, who confirmed it and when", spec: ["Tech 6.3: store the host key, algorithm, verification evidence, actor, and time"], needs: ["evidence"],
  async run(h) {
    const { id } = await toChecked(h); const t0 = h.now(); const a = await step(h, id, "activate"); assert.equal(a.status, 201); const sid = a.data.serverId as string;
    const ev = await h.hostKeyEvidence(sid); assert.ok(ev, "no host-key evidence stored for the server");
    assert.equal(ev!.fingerprint, h.world.targetAt("100.64.1.50")!.fingerprint); assert.equal(ev!.algorithm, "ED25519"); assert.equal(ev!.confirmedBy, "owner");
    assert.ok(Math.abs(Date.parse(ev!.confirmedAt) - t0) < 10 * 60_000 + 60_000, "the confirmation time is not close to when it happened");
  } });

// ============================================================================ C. access key (FR-03, credential rules)
add({ id: "SR-20", title: "the access key is a public line with `restrict` and `from=` the controller, ed25519, whose fingerprint matches an independent computation", spec: ["FR-03: dedicated credential, minimum permissions", "contract: restrict,from=... line", "Tech 6.4: explicitly selected key"],
  async run(h) {
    const t = h.world.addTarget({ address: "100.64.1.50" }); const id = (await draft(h, { name: "Key Line" })).data.id as string; await scanAndConfirm(h, id, t);
    const k = await step(h, id, "access-key"); assert.equal(k.status, 200); const ak = k.data.accessKey; assert.equal(k.data.state, "key-issued");
    const p = parseAuthorizedKeysLine(ak.authorizedKeysLine);
    assert.equal(p.type, "ssh-ed25519"); assert.ok(p.options.includes("restrict"), "no `restrict` option: the key could open a shell with forwarding and a TTY");
    const from = optionValue(p.options, "from"); assert.ok(from && from !== "*" && !/\*/.test(from), `from= is "${from}": it must name the controller, not a wildcard`);
    assert.ok(from!.split(",").includes(ak.controllerAddress), "from= does not name the controller address"); assert.ok(h.world.controllerAddresses.includes(ak.controllerAddress), "the controller address is not the real one");
    assert.equal(p.fingerprint, ak.keyFingerprint, "keyFingerprint is not the fingerprint of the key in the line"); assert.equal(fingerprintOfBlob(p.blob), ak.keyFingerprint);
    for (const bad of ["command=", "permitopen", "environment=", "cert-authority", "principals="]) assert.ok(!p.options.some((o) => o.startsWith(bad)), `unexpected option ${bad}`);
    assert.ok(/^servrsit-/.test(p.comment) || p.comment.includes("servrsit"), `the comment "${p.comment}" does not say who owns the key`);
    assert.ok(!/[\r\n\0\t]/.test(ak.authorizedKeysLine) && ak.authorizedKeysLine.trim() === ak.authorizedKeysLine, "the line has stray whitespace or control characters");
  } });

add({ id: "SR-21", title: "each server gets its own key; asking again does not mint a second live key", spec: ["FR-03: dedicated credential per server", "contract: per-server dedicated key"],
  async run(h) {
    const a = h.world.addTarget({ address: "100.64.1.50" }); const b = h.world.addTarget({ address: "100.64.1.51" });
    const da = (await draft(h, { name: "Aa" })).data.id as string; const db = (await draft(h, { address: "100.64.1.51", name: "Bb" })).data.id as string;
    await scanAndConfirm(h, da, a); await scanAndConfirm(h, db, b);
    const ka = await step(h, da, "access-key"); const kb = await step(h, db, "access-key");
    assert.notEqual(ka.data.accessKey.keyFingerprint, kb.data.accessKey.keyFingerprint, "two servers share one key");
    const again = await step(h, da, "access-key");
    if (again.status === 200) assert.equal(again.data.accessKey.keyFingerprint, ka.data.accessKey.keyFingerprint, "a second request replaced the key the owner may already have installed"); else refused(again, "second access-key", ["STATE_CONFLICT"]);
    assert.equal(h.keys.storedKeyCount(), 2, `${h.keys.storedKeyCount()} keys stored for 2 drafts`);
  } });

add({ id: "SR-22", title: "no private key, in any response, log line or subprocess argument, through the whole flow including disconnect", spec: ["execution-security: never place keys in command-line arguments, logs, exceptions, exported reports", "contract: no endpoint returns a private key"],
  async run(h) {
    const { id } = await toChecked(h, { name: "Secret Hunt" }); const a = await step(h, id, "activate"); assert.equal(a.status, 201);
    const bodies: string[] = [];
    const all = async (r: Res) => { bodies.push(r.raw, JSON.stringify(r.headers)); return r; };
    await all(await getDraft(h, id)); await all(await h.api({ method: "GET", path: "/api/fleet" })); await all(await h.api({ method: "GET", path: `${P}/${id}/first-check` }));
    await all(await h.api({ method: "PATCH", path: `/api/servers/${a.data.serverId}`, body: { name: "Secret Hunt 2" } }));
    for (const e of ENDPOINTS) await all(await h.api({ method: e.method, path: e.path, ...(e.body === undefined ? {} : { body: e.body }) }));
    const d = await h.api({ method: "POST", path: `/api/servers/${a.data.serverId}/disconnect` }); await all(d);
    const needles = h.keys.privateKeyNeedles(); assert.ok(needles.length > 0, "premise: the harness could read the private key to search for it");
    const haystacks: [string, string][] = [["a response", bodies.join("\n")], ["the log", h.logText()], ["a subprocess argument", h.argvLog().map((a) => a.join(" ")).join("\n")]];
    for (const [where, text] of haystacks) {
      assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text), `a private-key header appears in ${where}`);
      for (const n of needles) assert.ok(n.length < 16 || !text.includes(n), `private key material appears in ${where}`);
    }
  } });

add({ id: "SR-23", title: "key files are owner-only, deleting a draft removes its unused key, an expired draft loses its key, and activating then deleting the draft keeps the server's key", spec: ["execution-security: restricted, owner-only permissions", "contract: DELETE removes the draft and its unused key", "contract: a draft expires after 24 hours"], needs: ["keystore"],
  async run(h) {
    for (const m of h.keys.fileModes()) assert.equal(m & 0o077, 0, `a key file is group/other accessible (mode ${m.toString(8)})`);
    const t = h.world.addTarget({ address: "100.64.1.50" }); const id = (await draft(h, { name: "Del" })).data.id as string; await scanAndConfirm(h, id, t); await step(h, id, "access-key");
    assert.equal(h.keys.storedKeyCount(), 1); for (const m of h.keys.fileModes()) assert.equal(m & 0o077, 0, `key file mode ${m.toString(8)}`);
    const del = await h.api({ method: "DELETE", path: `${P}/${id}` }); assert.equal(del.status, 204); assert.equal(h.keys.storedKeyCount(), 0, "the unused key survived its draft"); refused(await getDraft(h, id), "deleted draft", ["DRAFT_NOT_FOUND"]);
    // expiry
    const t2 = h.world.addTarget({ address: "100.64.1.52" }); const id2 = (await draft(h, { address: "100.64.1.52", name: "Exp" })).data.id as string; await scanAndConfirm(h, id2, t2); await step(h, id2, "access-key");
    await h.advance(24 * HOUR + 60_000); refused(await step(h, id2, "first-check"), "expired draft", ["DRAFT_EXPIRED", "DRAFT_NOT_FOUND"]); assert.equal(h.keys.storedKeyCount(), 0, "an expired draft kept its key");
    // an activated draft's delete must not destroy the live key
    const live = await toChecked(h, { address: "100.64.1.53", name: "Live" }); const act = await step(h, live.id, "activate"); assert.equal(act.status, 201);
    await h.api({ method: "DELETE", path: `${P}/${live.id}` }); assert.equal(h.keys.storedKeyCount(), 1, "deleting the draft deleted the key a live server is using");
    const before = live.target.authAttempts(); await h.scheduler.tick(); assert.ok(live.target.authAttempts() > before, "the live server can no longer be checked");
  } });

add({ id: "SR-24", title: "the first check offers only this server's key, and only after the owner has installed it: until then the answer is AUTH_FAILED and retrying works", spec: ["PRD FR-02: connection tests distinguish authentication failure", "Tech 6.4: explicitly select the intended key"],
  async run(h) {
    const t = h.world.addTarget({ address: "100.64.1.50" }); const id = (await draft(h)).data.id as string; await scanAndConfirm(h, id, t);
    const k = await step(h, id, "access-key"); const ownFp = k.data.accessKey.keyFingerprint as string;
    await step(h, id, "first-check"); const fc = await waitCheck(h, id); assert.equal(fc.failureCode, "AUTH_FAILED", `before the key is installed: ${fc.failureCode}`);
    assert.equal((await getDraft(h, id)).data.state, "check-failed");
    for (const o of t.offeredKeys()) assert.equal(o, ownFp, "the controller offered a key that is not this server's");
    t.authorizeKey(k.data.accessKey.authorizedKeysLine, k.data.accessKey.controllerAddress);
    const retry = await step(h, id, "first-check"); assert.ok(retry.status < 300, `retry ${retry.status} ${retry.code}`); const ok = await waitCheck(h, id); assert.equal(ok.failureCode, null); assert.equal((await getDraft(h, id)).data.state, "checked");
  } });

export const part1 = PREREG;
