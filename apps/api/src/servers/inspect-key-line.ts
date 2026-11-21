/**
 * T-091 (D-S3): the forced-command authorized_keys line for a server that was
 * registered before T-091, made from the public key ServrSit already issued
 * for it. Connects to nothing and prints public text only.
 *
 *   tsx src/servers/inspect-key-line.ts <server name>
 *
 * The owner replaces the server's old `servrsit-<name>` line with this one.
 * ServrSit works with either line, so servers can be switched one at a time.
 */

import { existsSync } from "node:fs";
import { inspectKeyOptions } from "@servrsit/ssh";
import { SqliteServerStore, type StoredServer } from "@servrsit/store";
import { DEFAULT_REGISTRY_PATH } from "../fleet/config.js";

const KEY_PART = /(ssh-ed25519) ([A-Za-z0-9+/]+={0,2}) (servrsit-[a-z0-9-]+)$/;

/** The new line for one registry row, or an explanation of why there is none. */
export function forcedCommandLine(row: StoredServer): { ok: true; line: string; comment: string } | { ok: false; reason: string } {
  if (row.access !== "ssh" || row.accessKey === null) return { ok: false, reason: `${row.name} does not use a key ServrSit made, so there is no line to replace` };
  const m = KEY_PART.exec(row.accessKey.authorizedKeysLine);
  if (m === null) return { ok: false, reason: `${row.name}'s issued key line is not in the expected form` };
  return { ok: true, line: `${inspectKeyOptions(row.accessKey.controllerAddress)} ${m[1]} ${m[2]} ${m[3]}`, comment: m[3]! };
}

if (process.argv[1]?.endsWith("inspect-key-line.ts")) {
  const name = process.argv[2];
  const path = process.env["SERVRSIT_REGISTRY_DB"] ?? DEFAULT_REGISTRY_PATH.pathname;
  if (name === undefined) {
    process.stderr.write("usage: inspect-key-line.ts <server name>\n");
    process.exit(2);
  }
  if (!existsSync(path)) {
    process.stderr.write("the server registry does not exist\n");
    process.exit(1);
  }
  const store = new SqliteServerStore({ path });
  const rows = store.listActive().filter((s) => s.name.toLowerCase() === name.toLowerCase());
  store.close();
  if (rows.length !== 1) {
    process.stderr.write(`expected exactly one connected server named ${name}, found ${rows.length}\n`);
    process.exit(1);
  }
  const r = forcedCommandLine(rows[0]!);
  if (!r.ok) {
    process.stderr.write(`${r.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(`# In ~/.ssh/authorized_keys of ${rows[0]!.user ?? "the account"} on ${rows[0]!.name}, replace the line ending with ${r.comment} with:\n${r.line}\n`);
}
