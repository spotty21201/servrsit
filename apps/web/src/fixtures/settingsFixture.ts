/**
 * [FIXTURE DATA] Settings client (T-074, moved here by T-080). Implements the
 * real SettingsClient interface (api/settings.ts) over an in-memory model of
 * synthetic servers. Used only by /fixtures/settings. The real /settings screen
 * never imports this, and nothing here changes a real schedule, AI setting or
 * connection.
 */
import type { DisconnectPreview, ScheduleSettings, SettingsData } from "@servrsit/contracts";
import { SCHEDULE_DEFAULTS } from "@servrsit/contracts";
import type { SettingsClient, SettingsResult } from "../api/settings";
import { gate } from "../lib/fixtureState";

const wait = (): Promise<void> => new Promise((r) => globalThis.setTimeout(r, 150));

export function createFixtureSettingsClient(now: () => Date = () => new Date()): SettingsClient {
  const ago = (min: number): string => new Date(now().getTime() - min * 60_000).toISOString();
  let data: SettingsData = {
    schedule: { ...SCHEDULE_DEFAULTS, dailyTimeInEffect: false, timeZone: "Asia/Jakarta", paused: false, pausedSince: null } satisfies ScheduleSettings,
    ai: { enabled: true, available: true, providerLabel: "[FIXTURE DATA] A language model reached through a third-party routing proxy", route: "Development setup only. The real provider and region are not known to this screen yet.", region: null, sends: "Only cleaned facts about your servers and your question. Never credentials, keys, passwords or file contents." },
    retention: { observationsDays: 30, operationRecordsDays: 90, exportsDays: 7 },
    servers: [
      { id: "s-web1", name: "Fixture Web-1", production: true, keyKind: "dedicated ServrSit key", hostKeyConfirmedAt: ago(9 * 24 * 60), connected: true },
      { id: "s-dev2", name: "Fixture Dev-2", production: false, keyKind: "dedicated ServrSit key", hostKeyConfirmedAt: ago(2 * 24 * 60), connected: true },
      { id: "s-old", name: "Fixture Old-1", production: false, keyKind: "owner key", hostKeyConfirmedAt: ago(40 * 24 * 60), connected: true },
    ],
  };
  const work: Record<string, DisconnectPreview> = {
    "s-web1": { queued: [], active: [{ id: "a1", title: "Update packages" }], canDisconnect: false },
    "s-dev2": { queued: [], active: [], canDisconnect: true },
    "s-old": { queued: [], active: [], canDisconnect: true },
  };
  return {
    async get() { await wait(); return gate<SettingsResult<SettingsData>>(() => ({ ok: true, data }), () => ({ ok: false, error: "NETWORK" })); },
    async saveSchedule(s) {
      await wait();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.dailyTime) || ![5, 15, 30, 60].includes(s.intervalMinutes)) return { ok: false, error: "INVALID_INPUT" };
      data = { ...data, schedule: { ...data.schedule, ...s, intervalMinutes: s.intervalMinutes as 5 | 15 | 30 | 60 } };
      return { ok: true, data };
    },
    async setPaused(paused) {
      await wait();
      data = { ...data, schedule: { ...data.schedule, paused, pausedSince: paused ? now().toISOString() : null } };
      return { ok: true, data };
    },
    async setAi(enabled) { await wait(); data = { ...data, ai: { ...data.ai, enabled } }; return { ok: true, data }; },
    async previewDisconnect(id) { await wait(); const w = work[id]; return w ? { ok: true, data: w } : { ok: false, error: "NOT_FOUND" }; },
    async disconnect(id) {
      await wait();
      const s = data.servers.find((x) => x.id === id);
      if (!s) return { ok: false, error: "SERVER_NOT_FOUND" };
      if (work[id]?.canDisconnect === false) return { ok: false, error: "STATE_CONFLICT", reason: "An operation on this server is not resolved yet." };
      data = { ...data, servers: data.servers.map((x) => (x.id === id ? { ...x, connected: false } : x)) };
      const dedicated = s.keyKind === "dedicated ServrSit key";
      const line = dedicated ? `restrict,from="100.64.0.1" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixtureFixt servrsit-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : null;
      return { ok: true, data: {
        serverId: "00000000-0000-4000-8000-0000000000dd",
        schedulesStopped: true,
        controllerKeyDeleted: dedicated,
        remoteKeyRemoved: false,
        remoteSteps: dedicated
          ? ["Sign in to the server as the user ServrSit connected as.", "Open ~/.ssh/authorized_keys in an editor.", "Delete the line shown below (it ends with the name servrsit-…).", "Save the file. ServrSit cannot do this for you and cannot check that it was done."]
          : ["ServrSit used your own key. Remove that key from the server's authorized_keys only if you no longer want it to work.", "ServrSit cannot do this for you and cannot check that it was done."],
        authorizedKeysLine: line,
      } };
    },
  };
}
