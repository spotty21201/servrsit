/**
 * Baselines, comparison and server preparation (T-078, PRD FR-09/FR-15, UX Spec §12).
 *
 *   GET    /api/baselines/servers                          -> 200 { servers: BaselineServer[] }
 *   GET    /api/baselines                                  -> 200 { baselines: Baseline[] } (latest version of each)
 *   GET    /api/baselines/candidates?reference=:id         -> 200 CandidatesResponse (read-only inventory of the reference, now)
 *   POST   /api/baselines              SaveBaselineRequest -> 201 Baseline (a new baseline, or the next version of `baselineId`)
 *   GET    /api/baselines/:id                              -> 200 Baseline (latest version)
 *   POST   /api/baselines/:id/compare  CompareRequest      -> 200 Comparison (read-only inventory of the target, now)
 *   PUT    /api/baselines/:id/exceptions  ExceptionRequest -> 200 Comparison (records "intentional"; changes no server)
 *   DELETE /api/baselines/:id/exceptions/:targetId/:conventionId -> 200 Comparison
 *   GET    /api/baselines/:id/history?target=:id           -> 200 { events: HistoryEvent[] } (append-only)
 *   POST   /api/baselines/:id/setup-plan  CompareRequest   -> 201 SetupPlanResult (a canonical plan: /plans/:planId)
 *
 * Rules:
 *  - The reference machine is evidence, never a clone source. A baseline
 *    holds directory conventions (path under /srv or the login user's home,
 *    owner, group, mode) and Ubuntu-archive package names with versions.
 *    It never holds credentials, SSH host keys, file contents, application
 *    data, databases, personal files or network settings.
 *  - A comparison copies and deletes nothing. Marking intentional changes
 *    only the exception record.
 *  - A setup plan creates missing directories only (prepare.directories.v1).
 *    It never changes an existing directory. Package installation has no
 *    supported operation yet, so missing packages are listed as not included.
 *  - Every plan for a real server is blocked by writesEnabled=false.
 */

import { z } from "zod";

export const ConventionKindSchema = z.enum(["directory", "package"]);
export type ConventionKind = z.infer<typeof ConventionKindSchema>;

export const BaselineServerSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().max(64),
    role: z.string().max(64).nullable(),
    production: z.boolean(),
    /** False for every real server (ADR-014): a setup plan for it opens blocked. */
    writesEnabled: z.boolean(),
    simulated: z.boolean(),
    /** When ServrSit last observed this server (health check), or null. */
    observedAt: z.string().datetime().nullable(),
  })
  .strict();
export type BaselineServer = z.infer<typeof BaselineServerSchema>;

export const CandidateSchema = z
  .object({
    /** Stable across versions: "dir:srv:app", "dir:home:projects", "pkg:nginx". */
    id: z.string().max(300),
    kind: ConventionKindSchema,
    /** "/srv/app", "~/projects" or a package name. */
    label: z.string().max(300),
    /** For example "owner deploy:deploy, mode 0755" or "Ubuntu archive, version 1.24.0". */
    detail: z.string().max(200),
    eligible: z.boolean(),
    ineligibleReason: z.string().max(300).nullable(),
  })
  .strict();
export type Candidate = z.infer<typeof CandidateSchema>;

export const InventorySourceSchema = z.enum(["ssh", "local", "simulated"]);

export const CandidatesResponseSchema = z
  .object({
    referenceId: z.string().uuid(),
    observedAt: z.string().datetime(),
    source: InventorySourceSchema,
    candidates: z.array(CandidateSchema).max(7000),
    /** Our own statements about what could not be read (partial listings, unavailable parts). */
    notes: z.array(z.string().max(300)).max(10),
  })
  .strict();
export type CandidatesResponse = z.infer<typeof CandidatesResponseSchema>;

export const BaselineSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().max(64),
    version: z.number().int().positive(),
    referenceId: z.string().uuid(),
    referenceName: z.string().max(64),
    source: InventorySourceSchema,
    sourceObservedAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    conventions: z.array(CandidateSchema).max(200),
  })
  .strict();
export type Baseline = z.infer<typeof BaselineSchema>;

export const BASELINE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,63}$/;

export const SaveBaselineRequestSchema = z
  .object({
    name: z.string().regex(BASELINE_NAME),
    referenceId: z.string().uuid(),
    conventionIds: z.array(z.string().max(300)).min(1).max(200),
    /** Set to save the next version of an existing baseline. */
    baselineId: z.string().uuid().optional(),
  })
  .strict();
export type SaveBaselineRequest = z.infer<typeof SaveBaselineRequestSchema>;

export const CompareRequestSchema = z.object({ targetId: z.string().uuid() }).strict();
export type CompareRequest = z.infer<typeof CompareRequestSchema>;

export const CompareStatusSchema = z.enum(["matches", "missing", "different-by-design", "conflict", "not-checked"]);
export type CompareStatus = z.infer<typeof CompareStatusSchema>;

export const ComparisonRowSchema = z
  .object({
    conventionId: z.string().max(300),
    kind: ConventionKindSchema,
    label: z.string().max(300),
    expected: z.string().max(300),
    /** What the target has, or null when nothing was found or it was not checked. */
    found: z.string().max(300).nullable(),
    status: CompareStatusSchema,
    /** Our own explanation of the status. */
    reason: z.string().max(300),
    /** True when a setup plan can act on it (a missing directory). */
    actionable: z.boolean(),
    intentional: z.object({ reason: z.string().max(200).nullable(), markedAt: z.string().datetime() }).strict().nullable(),
  })
  .strict();
export type ComparisonRow = z.infer<typeof ComparisonRowSchema>;

export const ComparisonSchema = z
  .object({
    baselineId: z.string().uuid(),
    version: z.number().int().positive(),
    targetId: z.string().uuid(),
    observedAt: z.string().datetime(),
    source: InventorySourceSchema,
    rows: z.array(ComparisonRowSchema).max(200),
  })
  .strict();
export type Comparison = z.infer<typeof ComparisonSchema>;

export const ExceptionRequestSchema = z
  .object({
    targetId: z.string().uuid(),
    conventionId: z.string().max(300),
    reason: z.string().regex(/^[\p{L}\p{N} .,'()/:-]{1,200}$/u).nullable(),
  })
  .strict();
export type ExceptionRequest = z.infer<typeof ExceptionRequestSchema>;

export const HistoryEventSchema = z.object({ at: z.string().datetime(), text: z.string().max(400) }).strict();
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;

export const SetupPlanResultSchema = z
  .object({
    /** Opens at /plans/:planId, the same Plan review used for updates. */
    planId: z.string().uuid(),
    /** Directories the plan would create. */
    included: z.number().int().nonnegative(),
    notIncluded: z.array(z.object({ label: z.string().max(300), reason: z.string().max(300) }).strict()).max(200),
  })
  .strict();
export type SetupPlanResult = z.infer<typeof SetupPlanResultSchema>;

export const BaselineErrorCodeSchema = z.enum(["INVALID_INPUT", "NOT_FOUND", "NOT_ALLOWED", "UNAVAILABLE", "STALE_CANDIDATES"]);
export type BaselineErrorCode = z.infer<typeof BaselineErrorCodeSchema>;
export const BaselineErrorSchema = z.object({ error: BaselineErrorCodeSchema, reason: z.string().max(300).optional() }).strict();
export type BaselineError = z.infer<typeof BaselineErrorSchema>;
