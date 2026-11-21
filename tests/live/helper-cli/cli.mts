/**
 * T-087 test-only CLI for the Tester (T-088): talk to the ServrSit helper on
 * SENTANI ONLY (ADR-021). Never point it at Nabire, Timika or Merauke.
 *
 * Run from apps/api (where tsx and the workspace packages are):
 *
 *   node_modules/.bin/tsx ../../tests/live/helper-cli/cli.mts trust
 *   node_modules/.bin/tsx ../../tests/live/helper-cli/cli.mts sign  <manifest.json>      # prints the signed request; sends nothing
 *   node_modules/.bin/tsx ../../tests/live/helper-cli/cli.mts submit <manifest.json>     # signs with the controller key and sends it
 *   node_modules/.bin/tsx ../../tests/live/helper-cli/cli.mts send-raw <request.json>    # sends bytes as-is (bad-signature tests)
 *   node_modules/.bin/tsx ../../tests/live/helper-cli/cli.mts query <operationId>
 *
 * <manifest.json> is an UNSIGNED manifest (Tech Spec 8.2 fields). The CLI
 * fills nothing in: the Tester decides every field, including the
 * installation id (apps/api/config/test-bench.json) and Sentani's host key
 * fingerprint.
 *
 * Options (environment):
 *   SERVRSIT_KNOWN_HOSTS  pinned known_hosts file (default apps/api/.data/known_hosts). An unpinned host is refused.
 *   SENTANI_HOST          address to connect to (default: Sentani's address in apps/api/config/hosts.json)
 *
 * It prints the helper's JSON reply and public facts only. Private keys are
 * never printed. The app is not involved: writes stay disabled.
 */

import { readFileSync } from "node:fs";
import { DEFAULT_HELPER_DIR, loadOrCreateMaintenanceKey, loadOrCreateSigningKey, trustJson } from "../../../apps/api/src/helper-bench/keys.ts";
import { loadBench } from "../../../apps/api/src/helper-bench/prepare.ts";
import { addressOf, describe, queryRequest, send, submitRequest } from "../../../apps/api/src/helper-bench/client.ts";

const SERVER = "sentani";
const API = new URL("../../../apps/api/", import.meta.url).pathname;

function target() {
  const bench = loadBench();
  const s = bench.servers[SERVER];
  if (s === undefined) throw new Error("no sentani entry in test-bench.json");
  return {
    host: process.env["SENTANI_HOST"] ?? addressOf("Sentani", `${API}config/hosts.json`),
    account: s.account,
    identityFile: loadOrCreateMaintenanceKey(SERVER, DEFAULT_HELPER_DIR, false).privateKeyPath,
    knownHostsFile: process.env["SERVRSIT_KNOWN_HOSTS"] ?? `${API}.data/known_hosts`,
  };
}

async function main(): Promise<number> {
  const [cmd, arg] = process.argv.slice(2);
  // Never makes keys: the installed trust.json must match the existing key.
  const signer = loadOrCreateSigningKey(DEFAULT_HELPER_DIR, false).signer;
  switch (cmd) {
    case "trust":
      process.stdout.write(trustJson(signer));
      return 0;
    case "sign": {
      const m = JSON.parse(readFileSync(arg ?? "", "utf8"));
      process.stderr.write(`${JSON.stringify(describe(m, signer))}\n`);
      process.stdout.write(`${submitRequest(m, signer)}\n`);
      return 0;
    }
    case "submit": {
      const m = JSON.parse(readFileSync(arg ?? "", "utf8"));
      process.stderr.write(`${JSON.stringify(describe(m, signer))}\n`);
      return report(await send(submitRequest(m, signer), target()));
    }
    case "send-raw":
      return report(await send(readFileSync(arg ?? "", "utf8"), target()));
    case "query":
      return report(await send(queryRequest(arg ?? ""), target()));
    default:
      process.stderr.write("usage: cli.mts trust | sign <manifest.json> | submit <manifest.json> | send-raw <request.json> | query <operationId>\n");
      return 2;
  }
}

function report(r: Awaited<ReturnType<typeof send>>): number {
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  return r.ok ? 0 : 1;
}

process.exit(await main());
