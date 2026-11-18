import { test } from "node:test";
import assert from "node:assert/strict";
import { DisconnectResponseSchema } from "@servrsit/contracts";
import { createFixtureSettingsClient, SCHEDULE_DEFAULTS } from "../api/stubs/settings";
import {
  describeDisconnect, describeNext, disconnectCopy, isDefaultSchedule, isDirty, nextDailyRun, nextHealthRun, SCHEDULE_STATEMENT, validateSchedule, zonedToUtc,
} from "./settingsLogic";

const NOW = new Date("2026-11-17T03:00:00Z"); // 10:00 WIB
const TZ = "Asia/Jakarta";
const mk = () => createFixtureSettingsClient(() => NOW);

test("defaults are 15 minutes, 03:00, Asia/Jakarta, and are detected as defaults", () => {
  assert.deepEqual(SCHEDULE_DEFAULTS, { intervalMinutes: 15, dailyTime: "03:00", timeZone: "Asia/Jakarta" });
  assert.equal(isDefaultSchedule({ intervalMinutes: 15, dailyTime: "03:00", timeZone: "Asia/Jakarta" }), true);
  assert.equal(isDefaultSchedule({ intervalMinutes: 30, dailyTime: "03:00", timeZone: "Asia/Jakarta" }), false);
});

test("next health run is the next wall-clock interval boundary; none while paused", () => {
  assert.equal(nextHealthRun(new Date("2026-11-17T03:04:10Z"), 15, false)?.toISOString(), "2026-11-17T03:15:00.000Z");
  assert.equal(nextHealthRun(new Date("2026-11-17T03:15:00Z"), 15, false)?.toISOString(), "2026-11-17T03:30:00.000Z");
  assert.equal(nextHealthRun(new Date("2026-11-17T03:04:10Z"), 60, false)?.toISOString(), "2026-11-17T04:00:00.000Z");
  assert.equal(nextHealthRun(NOW, 15, true), null);
});

test("next daily run is HH:MM in the owner's zone, today or tomorrow, and none while paused", () => {
  // 10:00 WIB now: 03:00 WIB already passed today -> tomorrow 18 Nov 03:00 WIB = 17 Nov 20:00Z
  assert.equal(nextDailyRun(NOW, "03:00", TZ, false)?.toISOString(), "2026-11-17T20:00:00.000Z");
  // 14:00 WIB is still ahead today = 07:00Z
  assert.equal(nextDailyRun(NOW, "14:00", TZ, false)?.toISOString(), "2026-11-17T07:00:00.000Z");
  assert.equal(nextDailyRun(NOW, "10:00", TZ, false)?.toISOString(), "2026-11-18T03:00:00.000Z"); // exactly now counts as passed
  assert.equal(nextDailyRun(NOW, "03:00", TZ, true), null);
  assert.equal(nextDailyRun(NOW, "25:00", TZ, false), null);
  assert.equal(nextDailyRun(NOW, "03:00", "Not/AZone", false), null);
});

test("zone conversion is DST-aware (Berlin: +1 in winter, +2 in summer)", () => {
  assert.equal(new Date(zonedToUtc(2026, 1, 15, 3, 0, "Europe/Berlin")).toISOString(), "2026-01-15T02:00:00.000Z");
  assert.equal(new Date(zonedToUtc(2026, 7, 15, 3, 0, "Europe/Berlin")).toISOString(), "2026-07-15T01:00:00.000Z");
  assert.equal(nextDailyRun(new Date("2026-03-28T12:00:00Z"), "03:00", "Europe/Berlin", false)?.toISOString(), "2026-03-29T01:00:00.000Z"); // the day clocks go forward: 03:00 is CEST (+2)
});

test("next-run text names the zone and a relative time; paused is stated, not stale", () => {
  assert.equal(describeNext(nextHealthRun(NOW, 15, false), NOW, TZ), "10:15 WIB (in 15 min)");
  assert.equal(describeNext(nextHealthRun(NOW, 15, false), NOW, TZ, true), "10:15 WIB (≈ in 15 min)");
  assert.equal(describeNext(null, NOW, TZ), "None while checks are paused");
});

test("schedule validation and dirty detection", () => {
  assert.deepEqual(validateSchedule({ intervalMinutes: 15, dailyTime: "03:00", timeZone: "Asia/Jakarta" }), {});
  assert.ok(validateSchedule({ intervalMinutes: 7, dailyTime: "3am", timeZone: "Mars/Base" }).dailyTime);
  assert.ok(validateSchedule({ intervalMinutes: 7, dailyTime: "3am", timeZone: "Mars/Base" }).timeZone);
  assert.ok(validateSchedule({ intervalMinutes: 7, dailyTime: "3am", timeZone: "Mars/Base" }).intervalMinutes);
  assert.equal(isDirty({ intervalMinutes: 15, dailyTime: "03:00", timeZone: TZ }, { intervalMinutes: 15, dailyTime: "03:00", timeZone: TZ }), false);
  assert.equal(isDirty({ intervalMinutes: 15, dailyTime: "03:00", timeZone: TZ }, { intervalMinutes: 15, dailyTime: "04:00", timeZone: TZ }), true);
  assert.match(SCHEDULE_STATEMENT, /No schedule can install updates, restart a service, reboot or clean anything up/);
});

test("fixture client: save, pause and AI are separate actions; invalid schedules are refused", async () => {
  const c = mk();
  const s = await c.saveSchedule({ intervalMinutes: 30, dailyTime: "04:30", timeZone: "UTC" });
  assert.ok(s.ok && s.data.schedule.intervalMinutes === 30 && s.data.schedule.paused === false);
  const p = await c.setPaused(true);
  assert.ok(p.ok && p.data.schedule.paused && p.data.schedule.pausedSince !== null && p.data.schedule.intervalMinutes === 30);
  const r = await c.setPaused(false);
  assert.ok(r.ok && r.data.schedule.pausedSince === null);
  const ai = await c.setAi(false);
  assert.ok(ai.ok && ai.data.ai.enabled === false && ai.data.schedule.intervalMinutes === 30);
  assert.deepEqual(await c.saveSchedule({ intervalMinutes: 30, dailyTime: "99:99", timeZone: "UTC" }), { ok: false, error: "INVALID" });
});

test("disconnect: the confirmation names the server and lists queued and active work", async () => {
  const c = mk();
  const g = await c.get();
  assert.ok(g.ok);
  const web = g.data.servers.find((x) => x.id === "s-web1")!;
  const pv = await c.previewDisconnect("s-web1");
  assert.ok(pv.ok);
  const copy = disconnectCopy(web, pv.data);
  assert.equal(copy.title, "Disconnect Fixture Web-1?");
  assert.equal(copy.confirmLabel, "Disconnect Fixture Web-1");
  assert.match(copy.queued[0]!, /Update packages \(waiting to start\): will be cancelled/);
  assert.match(copy.active[0]!, /ServrSit cannot stop it\. It may keep running/);
  assert.ok(copy.keep.some((t) => /does not delete the server or shut it down/.test(t)));
  assert.match(copy.yourStep, /cannot remove its key from the server/);
  const quiet = disconnectCopy(g.data.servers[1]!, (await c.previewDisconnect("s-dev2") as { ok: true; data: never }).data);
  assert.deepEqual([quiet.queued[0], quiet.active[0]], ["No queued work.", "No work is running."]);
});

test("disconnect result: contract-shaped, never claims the remote key is gone, reports running work that may continue", async () => {
  const c = mk();
  const pv = await c.previewDisconnect("s-web1");
  const r = await c.disconnect("s-web1");
  assert.ok(pv.ok && r.ok);
  assert.equal(DisconnectResponseSchema.safeParse(r.data).success, true);
  assert.equal(r.data.remoteKeyRemoved, false);
  const d = describeDisconnect("Fixture Web-1", r.data, pv.data);
  assert.equal(d.headline, "Fixture Web-1 is disconnected");
  assert.ok(d.done.includes("1 queued operation was cancelled."));
  assert.ok(d.notDone.some((t) => /cannot confirm that its key line is gone from the server/.test(t)));
  assert.ok(d.notDone.some((t) => /1 action was already running and may continue/.test(t)));
  assert.ok(d.notDone.some((t) => /not deleted or shut down/.test(t)));
  assert.ok(d.line?.startsWith("restrict,from="));
  assert.doesNotMatch(JSON.stringify(d), /has been removed|is removed|key was removed/i);
  // an owner key: nothing of ServrSit's own to delete, and still no claim about the server
  const own = await c.disconnect("s-old");
  assert.ok(own.ok && own.data.controllerKeyDeleted === false && own.data.authorizedKeysLine === null);
  assert.ok(describeDisconnect("Fixture Old-1", own.data, { queued: [], active: [] }).done.includes("ServrSit had no key of its own to delete for this server."));
});
