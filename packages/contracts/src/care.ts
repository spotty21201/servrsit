/**
 * Care-loop request contracts (T-048), shared by the API and, later, the web.
 * Strict: unknown fields are rejected, so nothing extra (for example a
 * "writesEnabled" flag) can ride along in a request.
 */

import { z } from "zod";

export const CARE_OPERATIONS = ["apply.packages.v1", "restart.service.v1", "reboot.host.v1", "prepare.directories.v1"] as const;

/**
 * T-057 (UX Spec §10.2): a production approval needs BOTH of these owner
 * confirmations, each shown as its own unselected control with this exact
 * text. They are recorded as the owner's confirmation, never as "backup
 * verified".
 */
export const ACK_RECOVERY_ROUTE = "recovery-route-confirmed" as const;
export const ACK_INTERRUPTION_RISK = "interruption-risk-understood" as const;
export const PRODUCTION_ACKNOWLEDGEMENTS = [ACK_RECOVERY_ROUTE, ACK_INTERRUPTION_RISK] as const;
export type ProductionAcknowledgement = (typeof PRODUCTION_ACKNOWLEDGEMENTS)[number];
export const PRODUCTION_ACKNOWLEDGEMENT_TEXT: Readonly<Record<ProductionAcknowledgement, string>> = {
  [ACK_RECOVERY_ROUTE]: "I have a way to recover this server if the change goes wrong (for example the provider's console or a snapshot).",
  [ACK_INTERRUPTION_RISK]: "I understand this change can interrupt the services on this production server while it runs.",
};

const ServerId = z.string().uuid();

/** T-059: one directory to create. Shape only; the domain applies the path, owner and mode rules. */
export const DirectorySpecSchema = z
  .object({
    path: z.string().min(2).max(255),
    owner: z.string().max(32),
    group: z.string().max(32),
    mode: z.string().regex(/^0?[0-7]{3}$/),
  })
  .strict();

/** A plan request names one operation and only that operation's parameters. */
export const PlanRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("apply.packages.v1"), serverId: ServerId }).strict(),
  z.object({ operation: z.literal("restart.service.v1"), serverId: ServerId, unit: z.string().min(1).max(100) }).strict(),
  z.object({ operation: z.literal("reboot.host.v1"), serverId: ServerId }).strict(),
  z
    .object({ operation: z.literal("prepare.directories.v1"), serverId: ServerId, directories: z.array(DirectorySpecSchema).min(1).max(20) })
    .strict(),
]);

export const ApprovalRequestSchema = z
  .object({
    planVersion: z.number().int().min(1),
    planDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    /** Client-generated, stable across retries of the same approval click. */
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    acknowledgements: z.array(z.string().max(64)).max(10),
  })
  .strict();

export const CARE_ERROR_CODES = [
  "INVALID_INPUT",
  "NOT_FOUND",
  "CSRF_INVALID",
  "PLAN_NOT_FOUND",
  "PLAN_CHANGED",
  "PLAN_EXPIRED",
  "PLAN_BLOCKED",
  "WRITES_DISABLED",
  "ACK_REQUIRED",
  /** T-058: the target could not be reached while preparing or checking a plan (503). */
  "ROUTE_UNAVAILABLE",
  "TARGET_BUSY",
  "OUTCOME_UNKNOWN",
  "ALREADY_APPROVED",
] as const;

export type PlanRequest = z.infer<typeof PlanRequestSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type CareErrorCode = (typeof CARE_ERROR_CODES)[number];
