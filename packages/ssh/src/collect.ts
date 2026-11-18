/**
 * Read-only collection over SSH or locally.
 *
 * The SSH path refuses to run unless the host key is pinned (ADR-012 limit 2).
 * The check happens here, inside the library, so that no caller can skip it.
 * An unpinned host is not contacted: no connection, no DNS lookup.
 */

import { randomBytes } from "node:crypto";
import {
  InspectionObservationSchema,
  LIMITS,
  OBSERVATION_SCHEMA_VERSION,
  type InspectionObservation,
} from "./schema.js";
import {
  fromSection,
  parseArchitecture,
  parseAptSimulation,
  parseAptStamp,
  parseBootId,
  parseClock,
  parseMachineId,
  correctTargetTime,
  parseCpuCount,
  parseDf,
  parseDfInodes,
  parseFailedUnits,
  parseHostname,
  parseLoad,
  parseMeminfo,
  parseOsRelease,
  parseUptime,
  rebootRequiredFrom,
  splitSections,
  type AptSimulation,
  type RawSection,
} from "./parse.js";
import { unavailable, ok, type Field } from "./schema.js";
import { buildCollectorScript } from "./script.js";
import { spawnRunner, type CommandRunner } from "./runner.js";
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

export const SSH_BINARY = "/usr/bin/ssh";
export const LOCAL_SHELL = "/bin/sh";
/** Lightweight collector wall-clock budget (Technical Spec §6.4). */
export const COLLECTOR_BUDGET_MS = 30_000;
const MAX_STDERR_BYTES = 8 * 1024;

export interface CollectionFailure {
  readonly code: FailureCode;
  /** Fixed text from this library. Never contains remote output. */
  readonly message: string;
}

export type CollectionResult =
  | { readonly ok: true; readonly observation: InspectionObservation }
  | {
      readonly ok: false;
      readonly failure: CollectionFailure;
      readonly attemptedAt: string;
      /** False when the host was never contacted (for example, not pinned). */
      readonly contacted: boolean;
    };

export interface CollectDeps {
  readonly runner?: CommandRunner | undefined;
  readonly now?: (() => Date) | undefined;
  readonly nonce?: (() => string) | undefined;
  readonly sshBinary?: string | undefined;
  readonly timeoutMs?: number | undefined;
  /** Replace DNS validation (tests). Production uses the real resolver. */
  readonly checkResolution?: ((host: string) => Promise<void>) | undefined;
}

function failure(code: FailureCode, at: Date, contacted: boolean): CollectionResult {
  return {
    ok: false,
    failure: { code, message: FAILURE_MESSAGES[code] },
    attemptedAt: at.toISOString(),
    contacted,
  };
}

function newNonce(): string {
  return randomBytes(16).toString("hex");
}

export interface BuildInput {
  readonly stdout: string;
  readonly nonce: string;
  readonly source: "ssh" | "local";
  /** When ServrSit started the collection (T-061: the clock is measured against [startedAt, collectedAt]). */
  readonly startedAt: Date;
  readonly collectedAt: Date;
  readonly durationMs: number;
  readonly outputTruncated: boolean;
}

/** Turn captured output into a validated, size-bounded observation. */
export function buildObservation(input: BuildInput): InspectionObservation {
  const sections = splitSections(input.stdout, input.nonce);
  const get = (name: string): RawSection | undefined => sections.get(name);

  const truncatedSections = [...sections.values()].filter((s) => s.truncated).map((s) => s.name);

  const apt = fromSection(get("apt"), (lines) => parseAptSimulation(lines));
  const clock = fromSection(get("clock"), (lines) => parseClock(lines, input.startedAt, input.collectedAt));
  // The stamp is written by the target's clock; put it into ServrSit's time (T-061).
  const aptStamp = correctTargetTime(
    fromSection(get("aptstamp"), (lines) => parseAptStamp(lines, input.collectedAt)),
    clock,
  );

  const observation = {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    collectedAt: input.collectedAt.toISOString(),
    source: input.source,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    truncated: input.outputTruncated || truncatedSections.length > 0,
    truncatedSections,
    host: {
      collector: "inspect.host.v1" as const,
      hostname: fromSection(get("hostname"), parseHostname),
      os: fromSection(get("os"), parseOsRelease),
      architecture: fromSection(get("arch"), parseArchitecture),
      bootId: fromSection(get("bootid"), parseBootId),
      machineId: fromSection(get("machineid"), parseMachineId),
      uptimeSeconds: fromSection(get("uptime"), parseUptime),
      load: fromSection(get("load"), parseLoad),
      cpuCount: fromSection(get("nproc"), parseCpuCount),
      memory: fromSection(get("meminfo"), parseMeminfo),
      filesystems: fromSection(get("df"), parseDf),
      inodes: fromSection(get("dfi"), parseDfInodes),
      clock,
    },
    services: {
      collector: "inspect.services.v1" as const,
      failedUnits: fromSection(get("failed"), parseFailedUnits),
    },
    packages: {
      collector: "inspect.packages.v1" as const,
      pendingCount:
        apt.status === "ok" ? ok(apt.value.pendingCount) : unavailable<number>(apt.reason),
      heldBackCount:
        apt.status === "ok" ? ok(apt.value.heldBackCount) : unavailable<number>(apt.reason),
      pendingOutsideUbuntu:
        apt.status === "ok" ? ok(apt.value.outsideUbuntu) : unavailable<AptSimulation["outsideUbuntu"]>(apt.reason),
      metadataUpdatedAt: aptStamp.stamp,
      metadataClock: aptStamp.basis,
      rebootRequired: rebootRequiredFrom(get("rebootreq")),
    },
  };

  const parsed = InspectionObservationSchema.parse(observation);
  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > LIMITS.maxObservationBytes) {
    throw new Error("observation exceeds payload size cap");
  }
  return parsed;
}

async function runCollector(
  file: string,
  args: readonly string[],
  source: "ssh" | "local",
  deps: CollectDeps,
): Promise<CollectionResult> {
  const now = deps.now ?? (() => new Date());
  const runner = deps.runner ?? spawnRunner;
  const nonce = (deps.nonce ?? newNonce)();
  const started = now();

  const result = await runner({
    file,
    args,
    stdin: buildCollectorScript(nonce),
    timeoutMs: deps.timeoutMs ?? COLLECTOR_BUDGET_MS,
    maxStdoutBytes: LIMITS.maxTotalOutputBytes,
    maxStderrBytes: MAX_STDERR_BYTES,
  });
  const finished = now();

  if (result.spawnFailed) return failure("COLLECTION_FAILED", finished, false);
  if (result.timedOut) return failure("TIMEOUT", finished, true);

  const sawAnySection = result.stdout.includes(`@@BEGIN ${nonce} `);
  if (source === "ssh" && result.exitCode === 255 && !sawAnySection) {
    return failure(classifySshFailure(result.stderr), finished, true);
  }
  if (!sawAnySection) {
    return failure(
      source === "ssh" ? classifySshFailure(result.stderr) : "COLLECTION_FAILED",
      finished,
      true,
    );
  }

  try {
    const observation = buildObservation({
      stdout: result.stdout,
      nonce,
      source,
      startedAt: started,
      collectedAt: finished,
      durationMs: finished.getTime() - started.getTime(),
      outputTruncated: result.stdoutTruncated,
    });
    return { ok: true, observation };
  } catch {
    return failure("OUTPUT_INVALID", finished, true);
  }
}

/**
 * Collect from a remote host over SSH. Never contacts a host whose key is not
 * pinned in `options.knownHostsFile`.
 */
export async function collectViaSsh(
  target: SshTarget,
  options: SshOptions,
  deps: CollectDeps = {},
): Promise<CollectionResult> {
  const now = deps.now ?? (() => new Date());
  try {
    validateTarget(target, options);
  } catch (error) {
    if (error instanceof TargetRejectedError) return failure("TARGET_REJECTED", now(), false);
    throw error;
  }

  const pin = await pinStateFor(options.knownHostsFile, target.host, target.port);
  if (pin !== "pinned") return failure("HOST_UNTRUSTED", now(), false);

  try {
    await (deps.checkResolution ?? assertResolvesToAllowedAddress)(target.host);
  } catch (error) {
    if (error instanceof TargetRejectedError) return failure("TARGET_REJECTED", now(), false);
    return failure("ROUTE_UNAVAILABLE", now(), false);
  }

  return runCollector(deps.sshBinary ?? SSH_BINARY, buildSshArgv(target, options), "ssh", deps);
}

/** Collect from this machine with the same script and parsers. No SSH is involved. */
export async function collectLocal(deps: CollectDeps = {}): Promise<CollectionResult> {
  return runCollector(LOCAL_SHELL, ["-s"], "local", deps);
}
