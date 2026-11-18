/**
 * Care-loop request contracts (T-048), shared by the API and, later, the web.
 * Strict: unknown fields are rejected, so nothing extra (for example a
 * "writesEnabled" flag) can ride along in a request.
 */

import { z } from "zod";

export const CARE_OPERATIONS = ["apply.packages.v1"] as const;

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

export const PlanRequestSchema = z
  .object({
    operation: z.enum(CARE_OPERATIONS),
    serverId: z.string().uuid(),
  })
  .strict();

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
  "TARGET_BUSY",
  "OUTCOME_UNKNOWN",
  "ALREADY_APPROVED",
] as const;

export type PlanRequest = z.infer<typeof PlanRequestSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type CareErrorCode = (typeof CARE_ERROR_CODES)[number];
