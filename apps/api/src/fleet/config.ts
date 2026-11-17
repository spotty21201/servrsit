/**
 * Host configuration. Contains no secrets: only names, addresses, and the
 * path of a key file that is passed to ssh and never opened by this app.
 */

import { readFile } from "node:fs/promises";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@servrsit/ai";
import { isSafeUnitName } from "@servrsit/ssh";
import { z } from "zod";

const UNIT_SUFFIX = /\.(service|socket|target|timer|mount|path|slice|scope|swap|automount|device)$/;

/** A systemd unit the owner cares about. "nginx" means "nginx.service". */
const ImportantService = z
  .string()
  .max(200)
  .transform((s) => (UNIT_SUFFIX.test(s) ? s : `${s}.service`))
  .refine(isSafeUnitName, { message: "importantServices entries must be plain systemd unit names" });

const HostBase = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  role: z.string().min(1).max(64).nullable(),
  production: z.boolean(),
  /** Units the owner cares about on this host (owner-maintained, no secrets). */
  importantServices: z.array(ImportantService).max(20).default([]),
  collect: z.boolean(),
  collectDisabledReason: z.string().max(200).optional(),
  /**
   * HARD GATE (ADR-014): writes to real servers are disabled. Configuration
   * can only ever say false; true fails to load. There is no API to change it.
   */
  writesEnabled: z.literal(false, { errorMap: () => ({ message: "writesEnabled must be false for real servers (ADR-014)" }) }).default(false),
});

const SshHost = HostBase.extend({
  access: z.literal("ssh"),
  address: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1).max(32),
  identityFile: z.string().min(1).max(256).optional(),
});

const LocalHost = HostBase.extend({ access: z.literal("local") });

export const HostConfigSchema = z.discriminatedUnion("access", [SshHost, LocalHost]);

export const FleetConfigSchema = z
  .object({
    healthIntervalMinutes: z.number().int().min(1).max(1440),
    /** The owner's IANA time zone. Every time in assistant answers is given in it (DEF-L1). */
    ownerTimeZone: z
      .string()
      .default(DEFAULT_TIME_ZONE)
      .refine(isValidTimeZone, { message: "ownerTimeZone is not a valid IANA time zone" }),
    hosts: z.array(HostConfigSchema).min(1).max(20),
  })
  .superRefine((config, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const host of config.hosts) {
      if (ids.has(host.id)) ctx.addIssue({ code: "custom", message: `duplicate id ${host.id}` });
      if (names.has(host.name.toLowerCase())) {
        ctx.addIssue({ code: "custom", message: `duplicate name ${host.name}` });
      }
      ids.add(host.id);
      names.add(host.name.toLowerCase());
      if (!host.collect && host.collectDisabledReason === undefined) {
        ctx.addIssue({ code: "custom", message: `${host.name}: a disabled host needs collectDisabledReason` });
      }
    }
  });

export type HostConfig = z.infer<typeof HostConfigSchema>;
export type SshHostConfig = z.infer<typeof SshHost>;
export type FleetConfig = z.infer<typeof FleetConfigSchema>;

export const DEFAULT_CONFIG_PATH = new URL("../../config/hosts.json", import.meta.url);
export const DEFAULT_KNOWN_HOSTS_PATH = new URL("../../.data/known_hosts", import.meta.url);

export async function loadFleetConfig(path: URL | string = DEFAULT_CONFIG_PATH): Promise<FleetConfig> {
  const raw = await readFile(path, "utf8");
  return FleetConfigSchema.parse(JSON.parse(raw));
}

export function knownHostsPath(): string {
  return process.env["SERVRSIT_KNOWN_HOSTS"] ?? DEFAULT_KNOWN_HOSTS_PATH.pathname;
}
