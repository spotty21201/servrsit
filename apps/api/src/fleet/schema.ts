/**
 * Response contract for GET /api/fleet. The schema lives in @servrsit/contracts
 * so the web client validates against the same definition. Re-exported here so
 * existing API imports keep working.
 */

export {
  FindingSchema,
  FleetResponseSchema,
  FleetServerSchema,
  FleetStatusSchema,
} from "@servrsit/contracts";
export type { Finding, FleetResponse, FleetServer, FleetStatus } from "@servrsit/contracts";
