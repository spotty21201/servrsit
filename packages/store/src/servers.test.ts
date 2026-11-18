import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteServerStore, type NewServer } from "./index.js";

const NOW = new Date("2026-11-17T10:00:00.000Z");

function fresh() {
  const path = join(mkdtempSync(join(tmpdir(), "servrsit-registry-")), "servers.db");
  return { path, store: new SqliteServerStore({ path }) };
}

const server = (over: Partial<NewServer> = {}): NewServer => ({
  id: "00000000-0000-4000-8000-000000000a01",
  source: "registration",
  access: "ssh",
  name: "Fixture One",
  role: null,
  productionStatus: "no",
  address: "192.0.2.10",
  port: 22,
  user: "servrsit",
  identityFile: "/tmp/x/id_ed25519",
  knownHostsFile: "/tmp/x/known_hosts",
  importantServices: [],
  collect: true,
  collectDisabledReason: null,
  hostKey: { algorithm: "ED25519", fingerprint: "SHA256:" + "A".repeat(43), observedAt: NOW.toISOString(), confirmedAt: NOW.toISOString(), confirmedBy: "owner" },
  accessKey: null,
  createdAt: NOW.toISOString(),
  ...over,
});

test("hosts.json is imported exactly once, even after a restart", () => {
  const { path, store } = fresh();
  const first = store.importOnce([server({ source: "import", id: "00000000-0000-4000-8000-000000000b01", name: "Imported" })], NOW);
  assert.deepEqual(first, { kind: "imported", count: 1 });
  store.close();
  const again = new SqliteServerStore({ path });
  const second = again.importOnce([server({ source: "import", id: "00000000-0000-4000-8000-000000000b02", name: "Other" })], NOW);
  assert.equal(second.kind, "already-imported");
  assert.deepEqual(again.listActive().map((s) => s.name), ["Imported"]);
});

test("an empty import still counts: the file is not re-read later", () => {
  const { store } = fresh();
  assert.deepEqual(store.importOnce([], NOW), { kind: "imported", count: 0 });
  assert.equal(store.importOnce([server()], NOW).kind, "already-imported");
  assert.equal(store.listActive().length, 0);
});

test("names and address+port are unique among connected servers", () => {
  const { store } = fresh();
  store.importOnce([], NOW);
  assert.equal(store.register(server(), "d1", "owner", NOW).ok, true);
  const sameName = store.register(server({ id: "00000000-0000-4000-8000-000000000a02", address: "192.0.2.11", name: "fixture one" }), "d2", "owner", NOW);
  assert.deepEqual(sameName, { ok: false, code: "DUPLICATE_NAME" });
  const sameEndpoint = store.register(server({ id: "00000000-0000-4000-8000-000000000a03", name: "Two", address: "192.0.2.10" }), "d3", "owner", NOW);
  assert.deepEqual(sameEndpoint, { ok: false, code: "DUPLICATE_SERVER" });
  assert.equal(store.findActiveByEndpoint("192.0.2.10", 22)?.name, "Fixture One");
  assert.equal(store.findActiveByHostKey("SHA256:" + "A".repeat(43))?.name, "Fixture One");
});

test("after disconnecting, the same address and name can be registered again", () => {
  const { store } = fresh();
  store.register(server(), "d1", "owner", NOW);
  const off = store.disconnect(server().id, "owner", NOW, { remoteKeyRemoved: false });
  assert.equal(off.ok && off.server.disconnectedAt, NOW.toISOString());
  assert.equal(off.ok && off.server.collect, false);
  assert.equal(store.listActive().length, 0);
  assert.equal(store.register(server({ id: "00000000-0000-4000-8000-000000000a09" }), "d2", "owner", NOW).ok, true);
});

test("rename and describe record before and after; a disconnected server cannot change", () => {
  const { store } = fresh();
  store.register(server(), "d1", "owner", NOW);
  const r = store.update(server().id, { name: "Renamed", role: "Web" }, "owner", NOW);
  assert.equal(r.ok && r.server.name, "Renamed");
  assert.equal(r.ok && r.server.production, false);
  const unsure = store.update(server().id, { productionStatus: "not_sure" }, "owner", NOW);
  assert.deepEqual(unsure.ok && [unsure.server.production, unsure.server.productionStatus], [true, "not_sure"], "not sure is treated as production");
  store.disconnect(server().id, "owner", NOW, {});
  assert.deepEqual(store.update(server().id, { name: "Again" }, "owner", NOW), { ok: false, code: "DISCONNECTED" });
  assert.deepEqual(store.disconnect(server().id, "owner", NOW, {}), { ok: false, code: "DISCONNECTED" });
  assert.deepEqual(store.update("00000000-0000-4000-8000-0000000000ff", { name: "X" }, "owner", NOW), { ok: false, code: "SERVER_NOT_FOUND" });
  assert.deepEqual(store.listEvents(server().id).map((e) => e.type), ["registered", "updated", "updated", "disconnected"]);
});

test("the database refuses writesEnabled, deleting a server, editing a disconnected one, and editing events", () => {
  const { path, store } = fresh();
  store.register(server(), "d1", "owner", NOW);
  store.disconnect(server().id, "owner", NOW, {});
  const raw = new DatabaseSync(path);
  assert.throws(() => raw.prepare("DELETE FROM servers").run(), /never deleted/);
  assert.throws(() => raw.prepare("UPDATE servers SET disconnected_at = NULL").run(), /cannot change/);
  assert.throws(() => raw.prepare("UPDATE server_events SET actor = 'x'").run(), /append-only/);
  assert.throws(
    () => raw.prepare("INSERT INTO servers (id, source, access, name, production, important_services, collect, writes_enabled, created_at) VALUES ('x', 'registration', 'local', 'L', 0, '[]', 1, 1, 'now')").run(),
    /CHECK constraint failed/,
  );
});

test("registering removes the draft in the same transaction", () => {
  const { store } = fresh();
  store.saveDraft({ id: "d1", owner: "owner", body: { state: "checked" }, hostKeyLine: null, firstCheck: null, keyDir: null, expiresAt: NOW.toISOString() });
  store.register(server(), "d1", "owner", NOW);
  assert.equal(store.getDraft("d1"), null);
});

test("expired drafts are listed so their unused keys can be removed", () => {
  const { store } = fresh();
  store.saveDraft({ id: "old", owner: "o", body: {}, hostKeyLine: null, firstCheck: null, keyDir: "/k/old", expiresAt: "2026-11-16T00:00:00.000Z" });
  store.saveDraft({ id: "new", owner: "o", body: {}, hostKeyLine: null, firstCheck: null, keyDir: null, expiresAt: "2026-11-18T00:00:00.000Z" });
  assert.deepEqual(store.listExpiredDrafts(NOW).map((d) => d.id), ["old"]);
  assert.equal(store.deleteDraft("old"), true);
  assert.equal(store.deleteDraft("old"), false);
});

test("T-081: a registry made before production_status gets the column; old rows derive it from production", () => {
  const path = join(mkdtempSync(join(tmpdir(), "servrsit-registry-old-")), "servers.db");
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE servers (id TEXT PRIMARY KEY, source TEXT NOT NULL, access TEXT NOT NULL, name TEXT NOT NULL, role TEXT, production INTEGER NOT NULL, address TEXT, port INTEGER, user TEXT, identity_file TEXT, known_hosts_file TEXT, important_services TEXT NOT NULL, collect INTEGER NOT NULL, collect_disabled_reason TEXT, writes_enabled INTEGER NOT NULL DEFAULT 0 CHECK (writes_enabled = 0), host_key TEXT, access_key TEXT, created_at TEXT NOT NULL, disconnected_at TEXT) STRICT");
  old.prepare("INSERT INTO servers (id, source, access, name, production, important_services, collect, created_at) VALUES ('a', 'import', 'local', 'Old', 1, '[]', 1, 'now')").run();
  old.close();
  const store = new SqliteServerStore({ path });
  assert.equal(store.get("a")?.productionStatus, "yes");
});
