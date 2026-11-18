/**
 * OpenSSH helpers for server registration (T-069). All run through the
 * argument-array runner from @servrsit/ssh; there is no shell anywhere.
 *
 *  - scanHostKeys: `ssh-keyscan` (read-only: a key exchange, no sign-in).
 *  - generateAccessKey: `ssh-keygen` makes one ED25519 key per server in a
 *    controller directory (0700). ServrSit reads only the `.pub` file; the
 *    private file is written by ssh-keygen, used only as `ssh -i <path>`, and
 *    never opened, copied or returned by this code.
 *  - probeTcp: opens and immediately closes a TCP connection.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { join, resolve, sep } from "node:path";
import { spawnRunner, type CommandRunner } from "@servrsit/ssh";

export const SSH_KEYSCAN = "/usr/bin/ssh-keyscan";
export const SSH_KEYGEN = "/usr/bin/ssh-keygen";
export const SCAN_TIMEOUT_SECONDS = 10;
const MAX_SCAN_BYTES = 32 * 1024;

export type HostKeyAlgorithm = "ED25519" | "ECDSA" | "RSA";

export interface ScannedHostKey {
  readonly algorithm: HostKeyAlgorithm;
  /** The OpenSSH key type, for example "ssh-ed25519". */
  readonly keyType: string;
  readonly keyBase64: string;
  readonly fingerprint: string;
}

export type ScanResult =
  | { readonly ok: true; readonly key: ScannedHostKey }
  | { readonly ok: false; readonly code: "ROUTE_UNAVAILABLE" | "TIMEOUT" | "OUTPUT_INVALID" };

export type HostKeyScanner = (address: string, port: number) => Promise<ScanResult>;

const KEY_TYPES: ReadonlyArray<readonly [string, HostKeyAlgorithm]> = [
  ["ssh-ed25519", "ED25519"],
  ["ecdsa-sha2-nistp256", "ECDSA"],
  ["ecdsa-sha2-nistp384", "ECDSA"],
  ["ecdsa-sha2-nistp521", "ECDSA"],
  ["rsa-sha2-512", "RSA"],
  ["rsa-sha2-256", "RSA"],
  ["ssh-rsa", "RSA"],
];
const PREFERENCE: readonly HostKeyAlgorithm[] = ["ED25519", "ECDSA", "RSA"];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** "SHA256:" + unpadded base64 of the SHA-256 of the key blob, as ssh-keygen -l prints it. */
export function fingerprintOf(keyBase64: string): string {
  const digest = createHash("sha256").update(Buffer.from(keyBase64, "base64")).digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}

/** The key type written inside an SSH public key blob, or null when malformed. */
function blobType(keyBase64: string): string | null {
  const blob = Buffer.from(keyBase64, "base64");
  if (blob.length < 8) return null;
  const n = blob.readUInt32BE(0);
  if (n === 0 || n > 64 || blob.length < 4 + n) return null;
  return blob.subarray(4, 4 + n).toString("latin1");
}

/** A public key "type base64" pair, checked against its own blob. */
export function parsePublicKey(keyType: string, keyBase64: string): ScannedHostKey | null {
  const known = KEY_TYPES.find(([t]) => t === keyType);
  if (known === undefined || keyBase64.length > 4096 || !BASE64.test(keyBase64)) return null;
  const inner = blobType(keyBase64);
  // rsa-sha2-* are signature names; the blob still says ssh-rsa.
  const expected = known[1] === "RSA" ? "ssh-rsa" : keyType;
  if (inner !== expected) return null;
  return { algorithm: known[1], keyType: inner, keyBase64, fingerprint: fingerprintOf(keyBase64) };
}

/** Pick the strongest key from `ssh-keyscan` output. Comments and other hosts' lines are ignored. */
export function parseKeyscanOutput(stdout: string): ScannedHostKey | null {
  const keys: ScannedHostKey[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const key = parsePublicKey(parts[1] ?? "", parts[2] ?? "");
    if (key !== null) keys.push(key);
  }
  for (const algorithm of PREFERENCE) {
    const found = keys.find((k) => k.algorithm === algorithm);
    if (found !== undefined) return found;
  }
  return null;
}

/** Scan the validated address. The caller has already applied the address policy. */
export function createHostKeyScanner(runner: CommandRunner = spawnRunner): HostKeyScanner {
  return async (address, port) => {
    const result = await runner({
      file: SSH_KEYSCAN,
      args: ["-T", String(SCAN_TIMEOUT_SECONDS), "-t", "ed25519,ecdsa,rsa", "-p", String(port), "--", address],
      stdin: "",
      timeoutMs: (SCAN_TIMEOUT_SECONDS + 5) * 1000,
      maxStdoutBytes: MAX_SCAN_BYTES,
      maxStderrBytes: 4096,
    });
    if (result.timedOut) return { ok: false, code: "TIMEOUT" };
    if (result.spawnFailed) return { ok: false, code: "ROUTE_UNAVAILABLE" };
    if (result.stdoutTruncated) return { ok: false, code: "OUTPUT_INVALID" };
    const key = parseKeyscanOutput(result.stdout);
    // ssh-keyscan prints nothing when the host cannot be reached.
    if (key === null) return { ok: false, code: result.stdout.trim() === "" ? "ROUTE_UNAVAILABLE" : "OUTPUT_INVALID" };
    return { ok: true, key };
  };
}

/** The pinned known_hosts line for one registered endpoint. */
export function knownHostsLine(address: string, port: number, key: ScannedHostKey): string {
  const pattern = port === 22 ? address.toLowerCase() : `[${address.toLowerCase()}]:${port}`;
  return `${pattern} ${key.keyType} ${key.keyBase64}\n`;
}

// ---------------------------------------------------------------------------
// Per-server keys on the controller
// ---------------------------------------------------------------------------

export interface GeneratedKey {
  /** Path of the private key file (for `ssh -i`). Its content is never read. */
  readonly privateKeyPath: string;
  readonly keyType: "ssh-ed25519";
  readonly keyBase64: string;
  readonly fingerprint: string;
}

export interface KeyVault {
  /** The controller directory for one draft or server (0700). */
  dirFor(id: string): string;
  generate(id: string, comment: string): Promise<GeneratedKey>;
  writeKnownHosts(id: string, line: string): Promise<string>;
  /** Remove every file ServrSit made for this id. True when nothing is left. */
  remove(id: string): Promise<boolean>;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMMENT = /^servrsit-[a-z0-9-]{1,64}$/;

export function createKeyVault(root: string, runner: CommandRunner = spawnRunner): KeyVault {
  const base = resolve(root);
  const dirFor = (id: string): string => {
    if (!ID.test(id)) throw new Error("key directory id must be a lower-case UUID");
    const dir = join(base, id);
    if (!dir.startsWith(base + sep)) throw new Error("key directory escaped its root");
    return dir;
  };
  return {
    dirFor,
    async generate(id, comment) {
      if (!COMMENT.test(comment)) throw new Error("unsafe key comment");
      const dir = dirFor(id);
      await mkdir(base, { recursive: true, mode: 0o700 });
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const privateKeyPath = join(dir, "id_ed25519");
      // -N "" : no passphrase, so the unattended collector can use it. The file is 0600 in a 0700 directory.
      const result = await runner({
        file: SSH_KEYGEN,
        args: ["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", privateKeyPath],
        stdin: "",
        timeoutMs: 15_000,
        maxStdoutBytes: 4096,
        maxStderrBytes: 4096,
      });
      const discard = async () => {
        await rm(privateKeyPath, { force: true });
        await rm(`${privateKeyPath}.pub`, { force: true });
      };
      if (result.spawnFailed || result.timedOut || result.exitCode !== 0) {
        await discard();
        throw new Error("ssh-keygen could not make the key");
      }
      const pub = (await readFile(`${privateKeyPath}.pub`, "utf8")).trim().split(/\s+/);
      const key = parsePublicKey(pub[0] ?? "", pub[1] ?? "");
      if (key === null || key.keyType !== "ssh-ed25519") {
        await discard();
        throw new Error("ssh-keygen produced an unexpected public key");
      }
      return { privateKeyPath, keyType: "ssh-ed25519", keyBase64: key.keyBase64, fingerprint: key.fingerprint };
    },
    async writeKnownHosts(id, line) {
      const dir = dirFor(id);
      await mkdir(base, { recursive: true, mode: 0o700 });
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, "known_hosts");
      await writeFile(path, line, { mode: 0o600 });
      return path;
    },
    async remove(id) {
      const dir = dirFor(id);
      await rm(dir, { recursive: true, force: true });
      return true;
    },
  };
}

/** Open a TCP connection and close it at once. Sends nothing. */
export function probeTcp(address: string, port: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((done) => {
    const socket = new Socket();
    const finish = (ok: boolean) => {
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.connect(port, address);
  });
}
