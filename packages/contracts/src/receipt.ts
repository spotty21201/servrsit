/**
 * T-094: what an operation receipt can show beyond "installed versions match".
 * The API writes these into operation event payloads and plan scopes; the web
 * parses them with the same schemas. Every field is optional on old records:
 * absent means "not recorded", which the receipt must say, never read as "no".
 *
 * Where each one lives:
 *  - plan `scope.selfRestarts` / `scope.systemdReexec`   (before approval, item 4)
 *  - `remote_finished` event `payload.helperReport`        (items 2 and 5)
 *  - `verification_recorded` event `payload.reboot`,
 *    `payload.rebootRequired` and `payload.serviceRestarts` (items 1 and 3)
 *
 * All text from a server (unit names, paths, output lines) is untrusted: it is
 * validated or sanitised by the API and must be shown as plain text.
 */

import { z } from "zod";

const UNIT = z.string().regex(/^[A-Za-z0-9:_.\\@-]{1,200}\.service$/);
const PACKAGE_KEY = z.string().regex(/^[a-z0-9][a-z0-9+.-]{0,99}(:[a-z0-9-]{1,32})?$/);
const ETC_PATH = z.string().regex(/^\/etc\/[A-Za-z0-9._@+/-]{1,250}$/);

/** Bounds for the helper's output lines in the transcript (item 5). */
export const HELPER_OUTPUT_LIMITS = { maxLines: 20, maxLineChars: 300 } as const;

/**
 * Item 4, in the package plan's scope (present only when non-empty, so older
 * plans keep their digest): services the packages ship, which their own
 * install scripts usually restart during the update. ServrSit does not restart
 * them; the package does.
 */
export const SelfRestartSchema = z.object({ package: PACKAGE_KEY, units: z.array(UNIT).min(1).max(50) }).strict();
export type SelfRestart = z.infer<typeof SelfRestartSchema>;
/** Item 4: the update includes `systemd`, which re-executes the service manager (PID 1) itself. */
export const SystemdReexecSchema = z.literal(true);

/** Items 2 and 5: the helper's own account, from its ledger. Never the verification. */
export const HelperReportSchema = z
  .object({
    helperVersion: z.string().max(32),
    outcome: z.enum(["succeeded", "failed", "partially_succeeded"]).nullable(),
    reasonCode: z.string().regex(/^[A-Z_]{1,64}$/).nullable(),
    /** "Services that may need a restart": left for a separate restart approval. */
    restartNeeded: z.array(UNIT).max(200),
    keptFiles: z.array(z.object({ path: ETC_PATH, newDefault: ETC_PATH.nullable() }).strict()).max(200),
    /**
     * The helper's last output lines, sanitised (control characters removed),
     * secrets redacted, at most HELPER_OUTPUT_LIMITS. Untrusted text. Absent on
     * records made before T-094.
     */
    output: z.array(z.string().max(HELPER_OUTPUT_LIMITS.maxLineChars + 1)).max(HELPER_OUTPUT_LIMITS.maxLines).optional(),
  })
  .strict();
export type HelperReport = z.infer<typeof HelperReportSchema>;

/** Item 1: read after the update from /var/run/reboot-required(.pkgs), read-only. */
export const RebootEvidenceSchema = z.discriminatedUnion("checked", [
  z.object({ checked: z.literal(true), required: z.boolean(), packages: z.array(z.string().max(100)).max(100) }).strict(),
  z.object({ checked: z.literal(false), reason: z.string().max(200) }).strict(),
]);
export type RebootEvidence = z.infer<typeof RebootEvidenceSchema>;

/**
 * Item 3: services whose systemd InvocationID changed between just before the
 * update was sent and the check after it (a restart always makes a new one),
 * and services active before and not active after. Read-only. Something else
 * on the server could also restart a service in that window, so the receipt
 * says "restarted while the update ran", attributed to the packages' own
 * scripts because ServrSit restarted nothing.
 */
export const ServiceRestartsSchema = z.discriminatedUnion("checked", [
  z.object({ checked: z.literal(true), restarted: z.array(UNIT).max(500), stopped: z.array(UNIT).max(500) }).strict(),
  z.object({ checked: z.literal(false), reason: z.string().max(200) }).strict(),
]);
export type ServiceRestarts = z.infer<typeof ServiceRestartsSchema>;

/** The verification_recorded payload for a package operation (fields after T-094 are optional). */
export const PackageVerificationPayloadSchema = z
  .object({
    verified: z.array(z.string()),
    notVerified: z.array(z.string()),
    exitCode: z.number().int().nullable(),
    /** Kept for the earlier web check `payload.rebootRequired === true`; same fact as `reboot`. */
    rebootRequired: z.boolean().optional(),
    reboot: RebootEvidenceSchema.optional(),
    serviceRestarts: ServiceRestartsSchema.optional(),
  })
  .passthrough();
export type PackageVerificationPayload = z.infer<typeof PackageVerificationPayloadSchema>;
