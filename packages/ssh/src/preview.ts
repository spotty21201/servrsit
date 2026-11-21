/**
 * T-089: read-only package preview and installed-version read for a
 * write-enabled server (Sentani only, ADR-021). Same transport and rules as
 * the health collector: inspect key, pinned host key, fixed script over
 * stdin, no variable input, no sudo, nothing written.
 *
 *  - `apt-get -s -o Debug::NoLocking=1 upgrade`: the exact transaction apt
 *    would make, simulated, without refreshing metadata or taking the lock
 *  - `dpkg-query -W`: every installed package with its architecture and
 *    version (filtered on the controller, so no package name is sent)
 */

import { randomBytes } from "node:crypto";
import { splitSections } from "./parse.js";
import { spawnRunner, type CommandRunner } from "./runner.js";
import { sanitizeLines } from "./sanitize.js";
import { buildCollectorScript, remoteCommand } from "./script.js";
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

/**
 * D-T2 (ADR-024): the two conffile sections let the plan show, before approval, which of the
 * owner's configuration files the update will keep. Same rule as the helper's `dpkg --verify`:
 * a conffile whose MD5 differs from the one dpkg recorded. Read-only: dpkg's own records, then
 * `md5sum` of each listed conffile under /etc that this account can read. Only hashes leave the
 * server, never file contents, and no package or path is sent to it.
 */
export const CONFFILE_SECTIONS: readonly CollectorSection[] = [
  { name: "conffiles", command: "$T dpkg-query -W -f '@${Package}:${Architecture}\\n${Conffiles}\\n'" },
  {
    name: "conffilesums",
    command: String.raw`$T sh -c 'dpkg-query -W -f "\${Conffiles}\n" | while read -r p s x; do case $p in /etc/*) if [ -f "$p" ] && [ -r "$p" ]; then md5sum -- "$p"; fi ;; esac; done; exit 0'`,
  },
];

export const PREVIEW_SECTIONS: readonly CollectorSection[] = [
  { name: "aptsim", command: "$T apt-get -s -o Debug::NoLocking=1 upgrade" },
  { name: "installed", command: "$T dpkg-query -W -f '${Package} ${Architecture} ${Version} ${db:Status-Abbrev}\\n'" },
  ...CONFFILE_SECTIONS,
];
/** Verification reads installed versions only. */
export const INSTALLED_SECTIONS: readonly CollectorSection[] = PREVIEW_SECTIONS.filter((s) => s.name === "installed");
const LIMITS = { maxTotalOutputBytes: 2 * 1024 * 1024, maxSectionBytes: 1024 * 1024 } as const;

const PACKAGE = /^[a-z0-9][a-z0-9+.-]{0,99}$/;
const ARCH = /^[a-z0-9][a-z0-9-]{0,31}$/;
const VERSION = /^[A-Za-z0-9.+~:-]{1,100}$/;
const ORIGIN = /^[A-Za-z0-9 .,:/_+()-]{1,200}$/;
/** `Inst name [installed] (candidate ORIGIN [arch])`; the origin may contain spaces. */
const INST = /^Inst\s+(\S+)\s+\[([^\]]+)\]\s+\((\S+)\s+(.+?)\s+\[([a-z0-9-]+)\]\)/;
const REMV = /^Remv\s+(\S+)/;

export interface PreviewChange {
  readonly name: string;
  readonly arch: string;
  readonly from: string;
  readonly to: string;
  readonly origin: string;
}

export interface PackagePreview {
  readonly upgrades: readonly PreviewChange[];
  readonly removals: readonly string[];
  /** Lines that looked like a transaction line but could not be read: the preview is not trusted. */
  readonly unreadable: number;
}

/** Parse `apt-get -s upgrade`. A package name with ":arch" keeps only the name. */
export function parseAptUpgrade(text: string): PackagePreview {
  const upgrades: PreviewChange[] = [];
  const removals: string[] = [];
  let unreadable = 0;
  for (const line of sanitizeLines(text)) {
    if (line.startsWith("Inst ")) {
      const m = INST.exec(line);
      const name = m?.[1]?.split(":")[0];
      if (m === null || name === undefined || !PACKAGE.test(name) || !VERSION.test(m[2]!) || !VERSION.test(m[3]!) || !ARCH.test(m[5]!)) {
        unreadable++;
        continue;
      }
      const origin = m[4]!.trim();
      upgrades.push({ name, arch: m[5]!, from: m[2]!, to: m[3]!, origin: ORIGIN.test(origin) ? origin : "(unrecognised)" });
    } else if (line.startsWith("Remv ")) {
      const name = REMV.exec(line)?.[1]?.split(":")[0];
      if (name !== undefined && PACKAGE.test(name)) removals.push(name);
      else unreadable++;
    }
  }
  return { upgrades, removals, unreadable };
}

export interface InstalledPackages {
  /** "name:arch" -> version, for packages dpkg reports fully installed ("ii" or held "hi"). */
  readonly installed: Record<string, string>;
  /** "name:arch" of packages the owner put on hold (`apt-mark hold`). */
  readonly held: readonly string[];
}

/** Parse `dpkg-query -W` lines "name arch version status". Anything else is ignored. */
export function parseInstalled(text: string): InstalledPackages {
  const installed: Record<string, string> = {};
  const held: string[] = [];
  for (const line of sanitizeLines(text)) {
    const [name, arch, version, status, ...rest] = line.trim().split(" ");
    if (rest.length > 0 || name === undefined || arch === undefined || version === undefined || status === undefined) continue;
    if (!PACKAGE.test(name) || !ARCH.test(arch) || !VERSION.test(version)) continue;
    if (status !== "ii" && status !== "hi") continue;
    const key = `${name}:${arch}`;
    installed[key] = version;
    if (status === "hi") held.push(key);
  }
  return { installed, held: held.sort() };
}

const CONFFILE_PATH_FORM = /^\/etc\/[A-Za-z0-9._@+/-]{1,250}$/;
const CONFFILE_PATH = { test: (p: string) => CONFFILE_PATH_FORM.test(p) && !p.split("/").some((seg) => seg === ".." || seg === ".") };
const MD5 = /^[0-9a-f]{32}$/;

/** One configuration file the owner changed (its MD5 differs from dpkg's record). */
export interface ChangedConffile {
  /** "name:arch" of the package it belongs to. */
  readonly package: string;
  readonly path: string;
}

/**
 * `dpkg-query -W -f '@${Package}:${Architecture}\n${Conffiles}\n'` -> "name:arch" -> [{path, md5}].
 * Obsolete conffiles and ones dpkg has not installed yet ("newconffile") are left out.
 */
export function parseConffiles(text: string): Record<string, Array<{ path: string; md5: string }>> {
  const out: Record<string, Array<{ path: string; md5: string }>> = {};
  let current: string | null = null;
  for (const raw of sanitizeLines(text)) {
    if (raw.startsWith("@")) {
      const [name, arch, ...rest] = raw.slice(1).split(":");
      current = rest.length === 0 && name !== undefined && arch !== undefined && PACKAGE.test(name) && ARCH.test(arch) ? `${name}:${arch}` : null;
      continue;
    }
    const [path, md5, flag, ...rest] = raw.trim().split(/\s+/);
    if (current === null || path === undefined || md5 === undefined || rest.length > 0 || flag !== undefined) continue;
    if (!CONFFILE_PATH.test(path) || !MD5.test(md5)) continue;
    (out[current] ??= []).push({ path, md5 });
  }
  return out;
}

/** `md5sum` lines "<md5>  <path>" -> path -> md5. Escaped names (leading backslash) are not read. */
export function parseMd5sums(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of sanitizeLines(text)) {
    const m = /^([0-9a-f]{32}) {2}(\S+)$/.exec(line);
    if (m !== null && CONFFILE_PATH.test(m[2]!)) out[m[2]!] = m[1]!;
  }
  return out;
}

/** Conffiles whose current MD5 differs from dpkg's record. A file this account cannot read is not claimed either way. */
export function changedConffiles(conffiles: Record<string, Array<{ path: string; md5: string }>>, sums: Record<string, string>): ChangedConffile[] {
  const out: ChangedConffile[] = [];
  for (const [pkg, files] of Object.entries(conffiles)) {
    for (const f of files) {
      const now = sums[f.path];
      if (now !== undefined && now !== f.md5) out.push({ package: pkg, path: f.path });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.package.localeCompare(b.package));
}

export type PreviewResult =
  | { readonly ok: true; readonly preview: PackagePreview; readonly installed: InstalledPackages; readonly changedConffiles: readonly ChangedConffile[] }
  | { readonly ok: false; readonly code: FailureCode; readonly message: string };

export interface PreviewDeps {
  readonly runner?: CommandRunner | undefined;
  readonly nonce?: (() => string) | undefined;
  readonly checkResolution?: ((host: string) => Promise<void>) | undefined;
}

export type InstalledResult =
  | { readonly ok: true; readonly installed: InstalledPackages }
  | { readonly ok: false; readonly code: FailureCode; readonly message: string };

type Failure = { readonly ok: false; readonly code: FailureCode; readonly message: string };
const fail = (code: FailureCode): Failure => ({ ok: false, code, message: FAILURE_MESSAGES[code] });

/** Run reviewed sections over the inspect connection; every one must end with status 0 and fit. */
async function runSections(
  target: SshTarget,
  options: SshOptions,
  sections: readonly CollectorSection[],
  deps: PreviewDeps,
): Promise<{ readonly ok: true; readonly outputs: Map<string, string> } | Failure> {
  try {
    validateTarget(target, options);
  } catch (error) {
    if (error instanceof TargetRejectedError) return fail("TARGET_REJECTED");
    throw error;
  }
  if ((await pinStateFor(options.knownHostsFile, target.host, target.port)) !== "pinned") return fail("HOST_UNTRUSTED");
  try {
    await (deps.checkResolution ?? assertResolvesToAllowedAddress)(target.host);
  } catch (error) {
    return fail(error instanceof TargetRejectedError ? "TARGET_REJECTED" : "ROUTE_UNAVAILABLE");
  }
  const nonce = (deps.nonce ?? (() => randomBytes(16).toString("hex")))();
  const r = await (deps.runner ?? spawnRunner)({
    file: "/usr/bin/ssh",
    args: buildSshArgv(target, options, remoteCommand(nonce)),
    stdin: buildCollectorScript(sections),
    timeoutMs: 60_000,
    maxStdoutBytes: LIMITS.maxTotalOutputBytes,
    maxStderrBytes: 8 * 1024,
  });
  if (r.spawnFailed) return fail("COLLECTION_FAILED");
  if (r.timedOut) return fail("TIMEOUT");
  if (r.stdoutTruncated) return fail("OUTPUT_INVALID");
  if (!r.stdout.includes(`@@BEGIN ${nonce} `)) return fail(classifySshFailure(r.stderr));
  const found = splitSections(r.stdout, nonce, LIMITS.maxSectionBytes, sections.map((s) => s.name));
  const outputs = new Map<string, string>();
  for (const s of sections) {
    const raw = found.get(s.name);
    if (raw === undefined || raw.exitCode !== 0 || raw.truncated) return fail("OUTPUT_INVALID");
    outputs.set(s.name, raw.output);
  }
  return { ok: true, outputs };
}

/** The simulated upgrade and the installed packages, in one read-only connection. */
export async function collectPackagePreviewViaSsh(target: SshTarget, options: SshOptions, deps: PreviewDeps = {}): Promise<PreviewResult> {
  const r = await runSections(target, options, PREVIEW_SECTIONS, deps);
  if (!r.ok) return r;
  const preview = parseAptUpgrade(r.outputs.get("aptsim") ?? "");
  if (preview.unreadable > 0) return fail("OUTPUT_INVALID");
  return {
    ok: true,
    preview,
    installed: parseInstalled(r.outputs.get("installed") ?? ""),
    changedConffiles: changedConffiles(parseConffiles(r.outputs.get("conffiles") ?? ""), parseMd5sums(r.outputs.get("conffilesums") ?? "")),
  };
}

/** Installed packages only (verification after an update): does not depend on apt being able to simulate. */
export async function collectInstalledViaSsh(target: SshTarget, options: SshOptions, deps: PreviewDeps = {}): Promise<InstalledResult> {
  const r = await runSections(target, options, INSTALLED_SECTIONS, deps);
  if (!r.ok) return r;
  return { ok: true, installed: parseInstalled(r.outputs.get("installed") ?? "") };
}
