/**
 * On-demand, read-only inventory for baselines (T-078, PRD FR-09/FR-15).
 *
 * Runs only when the owner asks for baseline candidates or a comparison,
 * never on the health schedule. Same transport and rules as the health
 * collector: fixed script over stdin to `sh -s`, no variable input, no sudo,
 * no writes, bounded output. It lists:
 *  - directories under /srv (two levels) and the login user's home (one
 *    level, not hidden), with owner, group and mode; never their contents
 *  - installed packages and versions, read from dpkg's status file
 *  - which installed versions appear in Ubuntu's own archive lists on that
 *    server (so third-party packages can be told apart)
 */

import { randomBytes } from "node:crypto";
import { splitSections, type RawSection } from "./parse.js";
import { spawnRunner, type CommandRunner } from "./runner.js";
import { sanitizeLines } from "./sanitize.js";
import { buildCollectorScript, isValidNonce } from "./script.js";
import type { CollectorSection } from "./sections.js";
import {
  FAILURE_MESSAGES,
  TargetRejectedError,
  assertResolvesToAllowedAddress,
  buildSshArgv,
  classifySshFailure,
  pinStateFor,
  validateTarget,
  type FailureCode,
  type SshOptions,
  type SshTarget,
} from "./transport.js";

// Space-separated: control characters (tabs too) are removed by the sanitiser. A path with a space is skipped.
const DIR_FORMAT = "'%p %u %g %m\\n'";
const STATUS_AWK =
  "'/^Package: /{p=$2} /^Status: /{s=$0} /^Version: /{v=$2} /^$/{if (p != \"\" && s ~ / installed$/) print p \" \" v; p=\"\"; s=\"\"; v=\"\"} END{if (p != \"\" && s ~ / installed$/) print p \" \" v}'";
/** First file: dpkg status (installed versions). Others: Ubuntu archive lists. Prints installed packages whose exact version is in them. */
const UBUNTU_AWK =
  "'FNR==1{f++; p=\"\"} /^Package: /{p=$2} /^Status: /{s=$0} /^Version: /{v=$2; if (f!=1 && (p in inst) && inst[p]==v) ub[p]=1} /^$/{if (f==1 && p != \"\" && s ~ / installed$/) inst[p]=v; p=\"\"; s=\"\"} END{for (k in ub) print k}'";

/** The complete, fixed list of inventory commands. Adding one is a reviewed change. */
export const INVENTORY_SECTIONS: readonly CollectorSection[] = [
  { name: "srvexists", command: "test -d /srv" },
  { name: "srvdirs", command: `$T find /srv -mindepth 1 -maxdepth 2 -type d -printf ${DIR_FORMAT}` },
  { name: "homepath", command: "printf '%s\\n' \"$HOME\"" },
  { name: "homedirs", command: `$T find "$HOME" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf ${DIR_FORMAT}` },
  { name: "pkgs", command: `$T awk ${STATUS_AWK} /var/lib/dpkg/status` },
  { name: "ubuntupkgs", command: `$T awk ${UBUNTU_AWK} /var/lib/dpkg/status /var/lib/apt/lists/*ubuntu.com_ubuntu_dists_*_Packages` },
];
const NAMES = INVENTORY_SECTIONS.map((s) => s.name);

export const INVENTORY_LIMITS = { maxTotalOutputBytes: 2 * 1024 * 1024, maxSectionBytes: 768 * 1024, maxDirectories: 500, maxPackages: 6000 } as const;
export const INVENTORY_BUDGET_MS = 30_000;

export interface InventoryDirectory {
  readonly path: string;
  readonly owner: string;
  readonly group: string;
  /** Four-digit octal, for example "0755". */
  readonly mode: string;
}

export type Part<T> = { readonly status: "ok"; readonly value: T; readonly partial: boolean } | { readonly status: "unavailable"; readonly reason: string };

export interface Inventory {
  readonly collectedAt: string;
  readonly source: "ssh" | "local" | "simulated";
  readonly home: Part<string>;
  /** /srv and home directories together. */
  readonly directories: Part<readonly InventoryDirectory[]>;
  /** name -> installed version */
  readonly packages: Part<Readonly<Record<string, string>>>;
  /** Installed packages whose installed version is in Ubuntu's archive (names). */
  readonly ubuntuPackages: Part<readonly string[]>;
}

export type InventoryResult =
  | { readonly ok: true; readonly inventory: Inventory }
  | { readonly ok: false; readonly code: FailureCode; readonly message: string };

const PATH = /^\/[A-Za-z0-9._@+/-]{1,255}$/;
const ACCOUNT = /^[a-z_][a-z0-9_-]{0,31}$/;
const MODE = /^[0-7]{3,4}$/;
const PACKAGE = /^[a-z0-9][a-z0-9+.-]{0,99}$/;
const VERSION = /^[A-Za-z0-9.+~:-]{1,100}$/;

function unavailable<T>(reason: string): Part<T> {
  return { status: "unavailable", reason };
}

function lines(s: RawSection): string[] {
  return sanitizeLines(s.output).filter((l) => l !== "");
}

/** find exits 1 when some directories could not be read; what it printed is still true, so it is partial. */
function directoriesOf(s: RawSection | undefined, missingIsEmpty: boolean): Part<InventoryDirectory[]> {
  if (s === undefined) return unavailable("not collected");
  if (s.truncated) return unavailable("output exceeded size limit");
  if (s.exitCode !== 0 && s.exitCode !== 1) return unavailable("could not be listed");
  const out: InventoryDirectory[] = [];
  let skipped = 0;
  for (const l of lines(s)) {
    const [path, owner, group, mode, ...rest] = l.split(" ");
    if (rest.length > 0 || path === undefined || owner === undefined || group === undefined || mode === undefined) { skipped++; continue; }
    if (!PATH.test(path) || path.includes("//") || path.split("/").includes("..") || !ACCOUNT.test(owner) || !ACCOUNT.test(group) || !MODE.test(mode)) { skipped++; continue; }
    out.push({ path, owner, group, mode: mode.padStart(4, "0") });
  }
  if (out.length > INVENTORY_LIMITS.maxDirectories) return unavailable("too many directories");
  if (s.exitCode === 1 && out.length === 0 && missingIsEmpty) return { status: "ok", value: [], partial: false };
  return { status: "ok", value: out, partial: s.exitCode === 1 || skipped > 0 };
}

export function buildInventory(stdout: string, nonce: string, collectedAt: Date, source: "ssh" | "local"): Inventory {
  const sections = splitSections(stdout, nonce, INVENTORY_LIMITS.maxSectionBytes, NAMES);
  const get = (n: string) => sections.get(n);

  const homeSection = get("homepath");
  const homeLine = homeSection === undefined || homeSection.exitCode !== 0 ? undefined : lines(homeSection)[0];
  const home: Part<string> = homeLine !== undefined && PATH.test(homeLine) ? { status: "ok", value: homeLine, partial: false } : unavailable("home directory unknown");

  const srvExists = get("srvexists");
  const srv: Part<InventoryDirectory[]> =
    srvExists === undefined ? unavailable("not collected") : srvExists.exitCode !== 0 ? { status: "ok", value: [], partial: false } : directoriesOf(get("srvdirs"), false);
  const homeDirs = home.status === "ok" ? directoriesOf(get("homedirs"), true) : unavailable<InventoryDirectory[]>("home directory unknown");
  const directories: Part<readonly InventoryDirectory[]> =
    srv.status === "unavailable" ? srv : homeDirs.status === "unavailable" ? { ...srv, partial: true } : { status: "ok", value: [...srv.value, ...homeDirs.value], partial: srv.partial || homeDirs.partial };

  const pk = get("pkgs");
  let packages: Part<Record<string, string>>;
  if (pk === undefined || pk.truncated || pk.exitCode !== 0) packages = unavailable("installed packages could not be read");
  else {
    const map: Record<string, string> = {};
    let skipped = 0;
    for (const l of lines(pk)) {
      const [name, version, ...more] = l.split(" ");
      if (more.length === 0 && name !== undefined && version !== undefined && PACKAGE.test(name) && VERSION.test(version)) map[name] = version;
      else skipped++;
    }
    packages = Object.keys(map).length > INVENTORY_LIMITS.maxPackages ? unavailable("too many packages") : { status: "ok", value: map, partial: skipped > 0 };
  }

  const ub = get("ubuntupkgs");
  const ubuntuPackages: Part<string[]> =
    ub === undefined || ub.truncated || ub.exitCode !== 0
      ? unavailable("Ubuntu's archive lists could not be read on this server")
      : { status: "ok", value: lines(ub).filter((n) => PACKAGE.test(n)).sort(), partial: false };

  return { collectedAt: collectedAt.toISOString(), source, home, directories, packages, ubuntuPackages };
}

export interface InventoryDeps {
  readonly runner?: CommandRunner | undefined;
  readonly now?: (() => Date) | undefined;
  readonly nonce?: (() => string) | undefined;
  readonly checkResolution?: ((host: string) => Promise<void>) | undefined;
}

async function run(file: string, args: readonly string[], source: "ssh" | "local", deps: InventoryDeps): Promise<InventoryResult> {
  const now = deps.now ?? (() => new Date());
  const nonce = (deps.nonce ?? (() => randomBytes(16).toString("hex")))();
  if (!isValidNonce(nonce)) throw new Error("collector nonce must be 32 lowercase hex characters");
  const result = await (deps.runner ?? spawnRunner)({
    file,
    args: [...args, nonce],
    stdin: buildCollectorScript(INVENTORY_SECTIONS),
    timeoutMs: INVENTORY_BUDGET_MS,
    maxStdoutBytes: INVENTORY_LIMITS.maxTotalOutputBytes,
    maxStderrBytes: 8 * 1024,
  });
  const fail = (code: FailureCode): InventoryResult => ({ ok: false, code, message: FAILURE_MESSAGES[code] });
  if (result.spawnFailed) return fail("COLLECTION_FAILED");
  if (result.timedOut) return fail("TIMEOUT");
  if (result.stdoutTruncated) return fail("OUTPUT_INVALID");
  if (!result.stdout.includes(`@@BEGIN ${nonce} `)) return fail(source === "ssh" ? classifySshFailure(result.stderr) : "COLLECTION_FAILED");
  return { ok: true, inventory: buildInventory(result.stdout, nonce, now(), source) };
}

/** Read-only inventory over SSH. Refuses unpinned hosts, like the health collector. */
export async function collectInventoryViaSsh(target: SshTarget, options: SshOptions, deps: InventoryDeps = {}): Promise<InventoryResult> {
  try {
    validateTarget(target, options);
  } catch (error) {
    if (error instanceof TargetRejectedError) return { ok: false, code: "TARGET_REJECTED", message: FAILURE_MESSAGES.TARGET_REJECTED };
    throw error;
  }
  if ((await pinStateFor(options.knownHostsFile, target.host, target.port)) !== "pinned") {
    return { ok: false, code: "HOST_UNTRUSTED", message: FAILURE_MESSAGES.HOST_UNTRUSTED };
  }
  try {
    await (deps.checkResolution ?? assertResolvesToAllowedAddress)(target.host);
  } catch (error) {
    const code: FailureCode = error instanceof TargetRejectedError ? "TARGET_REJECTED" : "ROUTE_UNAVAILABLE";
    return { ok: false, code, message: FAILURE_MESSAGES[code] };
  }
  return run("/usr/bin/ssh", buildSshArgv(target, options), "ssh", deps);
}

export function collectInventoryLocal(deps: InventoryDeps = {}): Promise<InventoryResult> {
  return run("/bin/sh", ["-s"], "local", deps);
}
