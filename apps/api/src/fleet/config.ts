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

/**
 * Where servers may be registered (T-069, Tech Spec §6.2). Absent means:
 * port 22 only, public addresses allowed, no private route enrolled (so no
 * private or CGNAT address can be registered), and no controller address,
 * which means no access key can be issued until one is set.
 */
export const RegistrationConfigSchema = z
  .object({
    /** The address servers see ServrSit connect from. Goes into `from="..."`. */
    controllerAddress: z.string().min(1).max(253).nullable().default(null),
    allowedPorts: z.array(z.number().int().min(1).max(65535)).min(1).max(10).default([22]),
    /** CIDRs, for example the owner's Tailscale range "100.64.0.0/10". */
    enrolledRoutes: z.array(z.string().max(64)).max(20).default([]),
    allowPublicAddresses: z.boolean().default(true),
    operatorAddresses: z.array(z.string().max(64)).max(50).default([]),
  })
  .strict();
export type RegistrationConfig = z.infer<typeof RegistrationConfigSchema>;

export const FleetConfigSchema = z
  .object({
    healthIntervalMinutes: z.number().int().min(1).max(1440),
    /** The owner's IANA time zone. Every time in assistant answers is given in it (DEF-L1). */
    ownerTimeZone: z
      .string()
      .default(DEFAULT_TIME_ZONE)
      .refine(isValidTimeZone, { message: "ownerTimeZone is not a valid IANA time zone" }),
    /**
     * T-069: imported into the server registry ONCE, the first time an empty
     * registry starts. After that this list is not read; servers are added,
     * renamed and disconnected through the API.
     */
    hosts: z.array(HostConfigSchema).max(20),
    registration: RegistrationConfigSchema.default({}),
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
/**
 * A host as the fleet service checks it. Registered servers (T-069) carry
 * their own pinned known_hosts file; imported ones use the shared file.
 */
export type FleetHost = HostConfig & { readonly knownHostsFile?: string | undefined };
export type SshHostConfig = z.infer<typeof SshHost>;
export type FleetConfig = z.infer<typeof FleetConfigSchema>;

export const DEFAULT_CONFIG_PATH = new URL("../../config/hosts.json", import.meta.url);
export const DEFAULT_KNOWN_HOSTS_PATH = new URL("../../.data/known_hosts", import.meta.url);
/** T-069: the server registry (gitignored). */
export const DEFAULT_REGISTRY_PATH = new URL("../../.data/servers.db", import.meta.url);
/** T-076: finding records (gitignored). */
export const DEFAULT_FINDINGS_PATH = new URL("../../.data/findings.db", import.meta.url);
/** T-076/T-079: installation settings, such as the scheduler pause (gitignored). */
export const DEFAULT_SETTINGS_PATH = new URL("../../.data/settings.db", import.meta.url);
/** T-069: one 0700 directory per registered server, holding its key pair and pinned known_hosts (gitignored). */
export const DEFAULT_SERVER_KEYS_DIR = new URL("../../.data/server-keys", import.meta.url);

export async function loadFleetConfig(path: URL | string = DEFAULT_CONFIG_PATH): Promise<FleetConfig> {
  const raw = await readFile(path, "utf8");
  return FleetConfigSchema.parse(JSON.parse(raw));
}

export function knownHostsPath(): string {
  return process.env["SERVRSIT_KNOWN_HOSTS"] ?? DEFAULT_KNOWN_HOSTS_PATH.pathname;
}
