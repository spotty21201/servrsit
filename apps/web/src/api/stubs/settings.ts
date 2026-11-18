/**
 * [FIXTURE] STUB client for Settings (T-074, PRD FR-19, FR-21, FR-03; UX Spec
 * §13.2 and §14). The API has no settings endpoints yet, so the shapes below
 * are local and PROVISIONAL (except `DisconnectResponse`, which is the T-069
 * contract type and is used as is). Coder should propose a contract and replace
 * this file. Proposed endpoints:
 *
 *   GET  /api/settings                      -> SettingsData
 *   PUT  /api/settings/schedule {intervalMinutes, dailyTime, timeZone}
 *   POST /api/settings/schedule/pause {paused}              (separate from saving the schedule)
 *   PUT  /api/settings/ai {enabled}
 *   GET  /api/servers/:id/disconnect-preview -> {queued, active}   (what disconnecting would stop)
 *   POST /api/servers/:id/disconnect         -> DisconnectResponse (contract)
 *
 * Rules the API must keep (the UI relies on them): no schedule can authorize
 * package installation, restart, reboot or cleanup; turning AI off stops new
 * inference only; disconnecting stops schedules, cancels queued work, disables
 * stored access, never deletes or shuts down the server, and never claims the
 * remote key is gone (`remoteKeyRemoved` is always false).
 */
import type { DisconnectResponse } from "@servrsit/contracts";
import { gate } from "../../lib/fixtureState";

export interface ScheduleSettings {
  readonly intervalMinutes: 5 | 15 | 30 | 60;
  /** "HH:MM" in `timeZone`. */
  readonly dailyTime: string;
  /** IANA zone. */
  readonly timeZone: string;
  readonly paused: boolean;
  readonly pausedSince: string | null;
}

export const SCHEDULE_DEFAULTS = { intervalMinutes: 15, dailyTime: "03:00", timeZone: "Asia/Jakarta" } as const;

export interface AiSettings {
  readonly enabled: boolean;
  /** What answers questions, in plain words. */
  readonly providerLabel: string;
  /** How the request reaches it. */
  readonly route: string;
  readonly region: string | null;
}

export interface WorkItem {
  readonly id: string;
  readonly title: string;
}

export interface AccessServer {
  readonly id: string;
  readonly name: string;
  readonly production: boolean;
  readonly keyKind: "dedicated ServrSit key" | "owner key";
  readonly hostKeyConfirmedAt: string | null;
  readonly connected: boolean;
}

export interface SettingsData {
  readonly schedule: ScheduleSettings;
  readonly ai: AiSettings;
  readonly retention: { readonly observationsDays: number; readonly operationRecordsDays: number };
  readonly servers: readonly AccessServer[];
}

export interface DisconnectPreview {
  readonly queued: readonly WorkItem[];
  readonly active: readonly WorkItem[];
}

export type SettingsResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: "NOT_FOUND" | "INVALID" | "NETWORK" };

export interface SettingsClient {
  get(): Promise<SettingsResult<SettingsData>>;
  saveSchedule(s: Pick<ScheduleSettings, "intervalMinutes" | "dailyTime" | "timeZone">): Promise<SettingsResult<SettingsData>>;
  setPaused(paused: boolean): Promise<SettingsResult<SettingsData>>;
  setAi(enabled: boolean): Promise<SettingsResult<SettingsData>>;
  previewDisconnect(serverId: string): Promise<SettingsResult<DisconnectPreview>>;
  disconnect(serverId: string): Promise<SettingsResult<DisconnectResponse>>;
}

const wait = (): Promise<void> => new Promise((r) => globalThis.setTimeout(r, 150));

export function createFixtureSettingsClient(now: () => Date = () => new Date()): SettingsClient {
  const ago = (min: number): string => new Date(now().getTime() - min * 60_000).toISOString();
  let data: SettingsData = {
    schedule: { ...SCHEDULE_DEFAULTS, paused: false, pausedSince: null },
    ai: { enabled: true, providerLabel: "[FIXTURE] A language model reached through a third-party routing proxy", route: "Development setup only. The real provider and region are not known to this screen yet.", region: null },
    retention: { observationsDays: 30, operationRecordsDays: 90 },
    servers: [
      { id: "s-web1", name: "Fixture Web-1", production: true, keyKind: "dedicated ServrSit key", hostKeyConfirmedAt: ago(9 * 24 * 60), connected: true },
      { id: "s-dev2", name: "Fixture Dev-2", production: false, keyKind: "dedicated ServrSit key", hostKeyConfirmedAt: ago(2 * 24 * 60), connected: true },
      { id: "s-old", name: "Fixture Old-1", production: false, keyKind: "owner key", hostKeyConfirmedAt: ago(40 * 24 * 60), connected: true },
    ],
  };
  const work: Record<string, DisconnectPreview> = {
    "s-web1": { queued: [{ id: "q1", title: "Update packages (waiting to start)" }], active: [{ id: "a1", title: "Update packages (running)" }] },
    "s-dev2": { queued: [], active: [] },
    "s-old": { queued: [], active: [] },
  };
  return {
    async get() { await wait(); return gate<SettingsResult<SettingsData>>(() => ({ ok: true, data }), () => ({ ok: false, error: "NETWORK" })); },
    async saveSchedule(s) {
      await wait();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.dailyTime) || ![5, 15, 30, 60].includes(s.intervalMinutes)) return { ok: false, error: "INVALID" };
      data = { ...data, schedule: { ...data.schedule, ...s } };
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
      if (!s) return { ok: false, error: "NOT_FOUND" };
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
