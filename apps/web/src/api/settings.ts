/**
 * Settings client (T-079). Data layer only; contract in
 * packages/contracts/src/settings.ts (disconnect: servers.ts, T-069).
 *
 * Same interface as the Designer's stub (apps/web/src/api/stubs/settings.ts).
 * Errors are the contract's codes as plain strings ("INVALID_INPUT" where the
 * stub said "INVALID"), plus the transport codes. Disconnect errors use the
 * T-069 registration codes.
 */

import {
  DisconnectPreviewSchema,
  DisconnectResponseSchema,
  ServerRegistrationErrorSchema,
  SettingsDataSchema,
  SettingsErrorSchema,
  type DisconnectPreview,
  type DisconnectResponse,
  type ScheduleRequest,
  type ServerRegistrationErrorCode,
  type SettingsData,
  type SettingsErrorCode,
} from "@servrsit/contracts";
import { createHttp, type HttpOptions, type HttpResult, type TransportErrorCode } from "./http";

export type { DisconnectPreview, DisconnectResponse, SettingsData };

export type SettingsClientError = SettingsErrorCode | ServerRegistrationErrorCode | TransportErrorCode;
export type SettingsResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: SettingsClientError; readonly reason?: string };

export interface SettingsClient {
  get(): Promise<SettingsResult<SettingsData>>;
  saveSchedule(s: ScheduleRequest): Promise<SettingsResult<SettingsData>>;
  setPaused(paused: boolean): Promise<SettingsResult<SettingsData>>;
  /** Off stops new inference at the next message; on needs a configured provider. */
  setAi(enabled: boolean): Promise<SettingsResult<SettingsData>>;
  previewDisconnect(serverId: string): Promise<SettingsResult<DisconnectPreview>>;
  /** Stops checks and deletes ServrSit's own key. `remoteKeyRemoved` is always false. */
  disconnect(serverId: string): Promise<SettingsResult<DisconnectResponse>>;
}

function flatten<T>(r: HttpResult<T, { error: SettingsClientError; reason?: string | undefined }>): SettingsResult<T> {
  if (r.ok) return { ok: true, data: r.data };
  const e = r.error as { error: SettingsClientError; reason?: string };
  return { ok: false, error: e.error, ...(e.reason === undefined ? {} : { reason: e.reason }) };
}

export function createSettingsClient(options: HttpOptions = {}): SettingsClient {
  const call = createHttp(options);
  const e = encodeURIComponent;
  return {
    get: async () => flatten(await call("GET", "/api/settings", undefined, SettingsDataSchema, SettingsErrorSchema)),
    saveSchedule: async (s) =>
      flatten(await call("PUT", "/api/settings/schedule", { intervalMinutes: s.intervalMinutes, dailyTime: s.dailyTime, timeZone: s.timeZone }, SettingsDataSchema, SettingsErrorSchema)),
    setPaused: async (paused) => flatten(await call("POST", "/api/settings/schedule/pause", { paused }, SettingsDataSchema, SettingsErrorSchema)),
    setAi: async (enabled) => flatten(await call("PUT", "/api/settings/ai", { enabled }, SettingsDataSchema, SettingsErrorSchema)),
    previewDisconnect: async (id) => flatten(await call("GET", `/api/servers/${e(id)}/disconnect-preview`, undefined, DisconnectPreviewSchema, SettingsErrorSchema)),
    disconnect: async (id) => flatten(await call("POST", `/api/servers/${e(id)}/disconnect`, undefined, DisconnectResponseSchema, ServerRegistrationErrorSchema)),
  };
}
