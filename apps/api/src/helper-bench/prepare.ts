/**
 * T-087: prepare the files the founder copies to Sentani. Run by
 * scripts/sentani-helper-install.sh on Merauke. Connects to nothing.
 *
 *   tsx src/helper-bench/prepare.ts <server> <out-dir>
 *
 * Writes <out-dir>/trust.json (public key only) and prints one JSON object
 * with public facts only: key id, installation id, the maintenance key's
 * public line, account, home user and from-address. Never a private key.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadOrCreateMaintenanceKey, loadOrCreateSigningKey, trustJson } from "./keys.js";

export interface BenchServer {
  readonly founderSshTarget: string;
  readonly account: string;
  readonly homeUser: string;
  readonly from: string;
}

export interface BenchConfig {
  readonly installationId: string;
  readonly servers: Readonly<Record<string, BenchServer>>;
}

export const BENCH_CONFIG = new URL("../../config/test-bench.json", import.meta.url).pathname;

export function loadBench(path: string = BENCH_CONFIG): BenchConfig {
  const c = JSON.parse(readFileSync(path, "utf8")) as BenchConfig;
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(c.installationId)) throw new Error("installationId is not valid");
  return c;
}

export function prepare(server: string, outDir: string, helperDir?: string, benchPath?: string) {
  const bench = loadBench(benchPath);
  const s = bench.servers[server];
  if (s === undefined) throw new Error(`no test-bench entry for ${server}`);
  const signing = loadOrCreateSigningKey(helperDir);
  writeFileSync(join(outDir, "trust.json"), trustJson(signing.signer), { mode: 0o644 });
  const maint = loadOrCreateMaintenanceKey(server, helperDir);
  return {
    server,
    installationId: bench.installationId,
    keyId: signing.signer.keyId,
    signingKeyCreated: signing.created,
    maintenanceKeyCreated: maint.created,
    maintenancePublicLine: maint.publicLine,
    founderSshTarget: s.founderSshTarget,
    account: s.account,
    homeUser: s.homeUser,
    from: s.from,
  };
}

if (process.argv[1]?.endsWith("prepare.ts")) {
  const [server, outDir] = process.argv.slice(2);
  if (server === undefined || outDir === undefined) {
    process.stderr.write("usage: prepare.ts <server> <out-dir>\n");
    process.exit(2);
  }
  // SERVRSIT_HELPER_KEYS_DIR: tests only (a temporary directory instead of apps/api/.data/helper).
  process.stdout.write(`${JSON.stringify(prepare(server, outDir, process.env["SERVRSIT_HELPER_KEYS_DIR"]))}\n`);
}
