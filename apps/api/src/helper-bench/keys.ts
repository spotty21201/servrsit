/**
 * T-087 (ADR-020, ADR-021): the controller's persistent keys for the Sentani
 * test bench. BUILD AND PREPARE ONLY: nothing here connects to any server.
 *
 *  - the manifest signing key: Ed25519, PKCS#8 PEM, 0600 in a 0700 directory
 *    under apps/api/.data/helper (gitignored). Made once; never printed,
 *    logged, exported or sent anywhere. Only its public half leaves, in trust.json.
 *  - one maintenance SSH key per server (separate from the inspect key),
 *    made by ssh-keygen in the same directory. Only the .pub file is read.
 */

import { createHash, generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { signerFromPrivateKeyPem, type Signer } from "@servrsit/domain";

export const DEFAULT_HELPER_DIR = new URL("../../.data/helper", import.meta.url).pathname;
const SIGNING_FILE = "manifest-signing-ed25519.pem";
const SERVER_NAME = /^[a-z][a-z0-9-]{0,31}$/;

function privateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${dir} must be a plain directory`);
  chmodSync(dir, 0o700);
}

function ownerOnlyFile(path: string): void {
  const st = lstatSync(path);
  if (st.isSymbolicLink() || !st.isFile()) throw new Error(`${path} must be a plain file`);
  if ((st.mode & 0o077) !== 0) throw new Error(`${path} must be readable by its owner only (0600)`);
}

/** Key id = "ctrl-" + the first 16 hex of the SHA-256 of the public key (stable, public). */
export function keyIdOf(publicKeyPem: string): string {
  return `ctrl-${createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16)}`;
}

/** Load the signing key, or make it once. Returns a Signer; the private key stays inside it. */
export function loadOrCreateSigningKey(dir: string = DEFAULT_HELPER_DIR, create = true): { signer: Signer; created: boolean; path: string } {
  privateDir(dir);
  const path = join(dir, SIGNING_FILE);
  let created = false;
  if (!existsSync(path)) {
    if (!create) throw new Error("there is no manifest signing key yet; run scripts/sentani-helper-install.sh first");
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(path, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600, flag: "wx" });
    created = true;
  }
  ownerOnlyFile(path);
  const pem = readFileSync(path, "utf8");
  const probe = signerFromPrivateKeyPem("probe", pem);
  return { signer: signerFromPrivateKeyPem(keyIdOf(probe.publicKeyPem), pem), created, path };
}

/** The helper's trust.json: public key only. */
export function trustJson(signer: Signer): string {
  return `${JSON.stringify({ keys: { [signer.keyId]: { algorithm: "ed25519", publicKeyPem: signer.publicKeyPem } } }, null, 2)}\n`;
}

export interface MaintenanceKey {
  /** Path of the private key, for `ssh -i` only. Its content is never read here. */
  readonly privateKeyPath: string;
  /** "ssh-ed25519 AAAA... servrsit-maintenance-<server>" */
  readonly publicLine: string;
  readonly created: boolean;
}

/** The dedicated maintenance key for one server, made once with ssh-keygen. */
export function loadOrCreateMaintenanceKey(server: string, dir: string = DEFAULT_HELPER_DIR, create = true): MaintenanceKey {
  if (!SERVER_NAME.test(server)) throw new Error("server name must be a short lower-case name");
  privateDir(dir);
  const serverDir = join(dir, server);
  privateDir(serverDir);
  const privateKeyPath = join(serverDir, "id_ed25519");
  let created = false;
  if (!existsSync(privateKeyPath)) {
    if (!create) throw new Error(`there is no maintenance key for ${server} yet; run scripts/sentani-helper-install.sh first`);
    const r = spawnSync("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", `servrsit-maintenance-${server}`, "-f", privateKeyPath], {
      stdio: ["ignore", "ignore", "ignore"],
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
      shell: false,
    });
    if (r.status !== 0) throw new Error("ssh-keygen could not make the maintenance key");
    created = true;
  }
  ownerOnlyFile(privateKeyPath);
  const pub = readFileSync(`${privateKeyPath}.pub`, "utf8").trim();
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,2} servrsit-maintenance-[a-z0-9-]+$/.test(pub)) throw new Error("unexpected maintenance public key");
  return { privateKeyPath, publicLine: pub, created };
}
