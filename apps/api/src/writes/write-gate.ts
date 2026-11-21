/**
 * T-089 (ADR-021): the write gate for real servers.
 *
 * Writes to a real server are possible only when ALL of these hold, checked
 * again on every use (planning, approval, every dispatch step):
 *  - the controller's own config/writes.json says `writesEnabled: true` for
 *    Sentani. The file is not read or written by any API or UI route. Any
 *    other server name, or a file that does not parse, closes the gate for
 *    every server;
 *  - the registry row is the one connected server named Sentani, with its own
 *    pinned known_hosts file that pins only Sentani's address, and a
 *    confirmed host key (the manifest is bound to it);
 *  - Sentani's maintenance key and the manifest signing key exist (made by
 *    scripts/sentani-helper-install.sh); they are never created here.
 * Nabire, Timika and Merauke are refused by name whatever the file says.
 *
 * Nothing here connects to a server.
 */

import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import type { Signer } from "@servrsit/domain";
import type { GatewayTarget, SshOptions, SshTarget } from "@servrsit/ssh";
import type { StoredServer } from "@servrsit/store";
import { DEFAULT_WRITES_CONFIG_PATH } from "../fleet/config.js";
import { BENCH_SERVERS, BenchRefused, gatewayTargetFromRegistry, PROTECTED_SERVERS } from "../helper-bench/client.js";
import { DEFAULT_HELPER_DIR, loadOrCreateMaintenanceKey, loadOrCreateSigningKey } from "../helper-bench/keys.js";
import { BENCH_CONFIG, loadBench } from "../helper-bench/prepare.js";

/** Only Sentani can appear; any other key fails to parse and closes the gate. */
const WritesConfigSchema = z
  .object({
    note: z.string().optional(),
    servers: z.object({ sentani: z.object({ writesEnabled: z.boolean() }).strict().optional() }).strict(),
  })
  .strict();

export interface WriteAccess {
  readonly serverId: string;
  readonly hostKeyFingerprint: string;
  /** The helper gateway with Sentani's maintenance key. */
  readonly gateway: GatewayTarget;
  /** The registry's own inspect access, for previews and verification. */
  readonly inspect: { readonly target: SshTarget; readonly options: SshOptions };
}

export interface WriteGateOptions {
  readonly configPath?: string | undefined;
  readonly benchPath?: string | undefined;
  readonly helperDir?: string | undefined;
  readonly log?: { warn(o: object, m: string): void; info(o: object, m: string): void } | undefined;
}

export class WriteGate {
  private readonly configPath: string;
  private readonly benchPath: string;
  private readonly helperDir: string;
  private cached: { key: string; enabled: ReadonlySet<string> } | null = null;
  private lastReason: string | null = null;
  private log: WriteGateOptions["log"];

  constructor(o: WriteGateOptions = {}) {
    this.log = o.log;
    this.configPath = o.configPath ?? DEFAULT_WRITES_CONFIG_PATH.pathname;
    this.benchPath = o.benchPath ?? BENCH_CONFIG;
    this.helperDir = o.helperDir ?? DEFAULT_HELPER_DIR;
  }

  /** The API passes its logger once it exists. */
  useLog(log: NonNullable<WriteGateOptions["log"]>): void {
    this.log = log;
  }

  /** The names writes.json enables, re-read whenever the file changes. Unreadable or invalid: none. */
  private enabledNames(): ReadonlySet<string> {
    let key: string;
    try {
      const st = statSync(this.configPath);
      key = `${st.mtimeMs}:${st.size}:${st.ino}`;
    } catch {
      return this.closed("writes.json is missing");
    }
    if (this.cached?.key === key) return this.cached.enabled;
    let enabled: ReadonlySet<string>;
    try {
      const parsed = WritesConfigSchema.parse(JSON.parse(readFileSync(this.configPath, "utf8")));
      enabled = new Set(parsed.servers.sentani?.writesEnabled === true ? ["sentani"] : []);
    } catch {
      enabled = this.closed("writes.json is not valid (only Sentani may be listed)");
    }
    this.cached = { key, enabled };
    this.log?.info({ writesEnabled: [...enabled] }, "writes: controller write configuration read");
    return enabled;
  }

  private closed(reason: string): ReadonlySet<string> {
    this.note(reason);
    return new Set();
  }

  /** Log a refusal reason once, when it changes. Never includes a key or a path to one. */
  private note(reason: string | null): void {
    if (reason === this.lastReason) return;
    this.lastReason = reason;
    if (reason !== null) this.log?.warn({ reason }, "writes: write access is closed");
  }

  /**
   * Full check for one registry row. Null: no access.
   *
   * `forWrites` true (planning, approval, dispatch): writes.json must enable the server.
   * `forWrites` false: read-only access to the helper's ledger and installed versions, so an
   * operation already sent can still be followed and verified after writes.json is closed. It
   * never submits anything: every submit is behind the write check.
   */
  accessFor(row: StoredServer, active: readonly StoredServer[], forWrites = true): WriteAccess | null {
    const name = row.name.toLowerCase();
    if (PROTECTED_SERVERS.has(name) || !BENCH_SERVERS.has(name)) return null;
    if (forWrites && !this.enabledNames().has(name)) return null;
    if (row.disconnectedAt !== null || row.hostKey === null || row.address === null || row.port === null || row.user === null || row.knownHostsFile === null) {
      this.note(`${row.name} is not a connected server with a confirmed host key`);
      return null;
    }
    let gateway: GatewayTarget;
    try {
      const bench = loadBench(this.benchPath).servers[name];
      if (bench === undefined) throw new BenchRefused(`test-bench.json has no ${name} entry`);
      const maintenance = loadOrCreateMaintenanceKey(name, this.helperDir, false);
      gateway = gatewayTargetFromRegistry(name, active, bench.account, maintenance.privateKeyPath);
      loadOrCreateSigningKey(this.helperDir, false);
    } catch (error) {
      this.note(error instanceof BenchRefused ? error.message : "the maintenance or signing key is not ready");
      return null;
    }
    if (gateway.host !== row.address) return null;
    this.note(null);
    return {
      serverId: row.id,
      hostKeyFingerprint: row.hostKey.fingerprint,
      gateway,
      inspect: {
        target: { host: row.address, port: row.port, user: row.user, ...(row.identityFile === null ? {} : { identityFile: row.identityFile }) },
        options: { knownHostsFile: row.knownHostsFile },
      },
    };
  }

  /** The persistent manifest signer, or null when it has not been made. Never creates it. */
  signer(): Signer | null {
    try {
      return loadOrCreateSigningKey(this.helperDir, false).signer;
    } catch {
      return null;
    }
  }

  /** The installation id the helper on Sentani was configured with, or null. */
  installationId(): string | null {
    try {
      return loadBench(this.benchPath).installationId;
    } catch {
      return null;
    }
  }
}
