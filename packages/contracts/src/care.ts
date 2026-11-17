/**
 * Care-loop request contracts (T-048), shared by the API and, later, the web.
 * Strict: unknown fields are rejected, so nothing extra (for example a
 * "writesEnabled" flag) can ride along in a request.
 */

import { z } from "zod";

export const CARE_OPERATIONS = ["apply.packages.v1"] as const;

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
