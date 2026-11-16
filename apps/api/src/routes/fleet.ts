/**
 * GET /api/fleet
 *
 * Returns the owner's fleet summary with server states, observation coverage,
 * and freshness indicators.
 *
 * This response is FIXTURE DATA. It represents the three founder servers
 * (Timika, Nabire, Sentani) in a mixed state for UI development.
 * The `fixture: true` field must remain until this route is connected to a
 * real database — the frontend uses it to display the [FIXTURE DATA] label
 * required by the structure steering invariant.
 *
 * Technical Spec §13: GET /api/fleet
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  ObservationFreshnessSchema,
  OperationState,
  type ObservationFreshness,
} from "@servrsit/contracts";

// ---------------------------------------------------------------------------
// Response schema
// ---------------------------------------------------------------------------

const ServerRoleSchema = z.enum(["production", "staging", "development", "general"]);

const ServerSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: ServerRoleSchema,
  /** Short human-readable description of what this server does. */
  description: z.string(),
  /**
   * Geometric emblem identifier. Used to render a stable visual identity
   * for each server — never tied to health state (design steering rule).
   */
  emblemId: z.string(),
  /** Whether this server is classified as a production system. */
  isProduction: z.boolean(),
  /** Current reachability state. */
  reachable: z.boolean(),
  /** Current host-key trust state. */
  hostKeyTrust: z.enum(["trusted", "changed", "unverified"]),
  /** Freshness of the latest health check observation. */
  healthFreshness: ObservationFreshnessSchema,
  /** Freshness of the latest inventory/package observation. */
  inventoryFreshness: ObservationFreshnessSchema,
  /**
   * Plain-language status summary suitable for display on the server card.
   * Reflects actual observed state — never invented.
   */
  statusSummary: z.string(),
  /** Finding count by severity at time of last observation. */
  findings: z.object({
    critical: z.number().int().min(0),
    warning: z.number().int().min(0),
    advisory: z.number().int().min(0),
  }),
  /**
   * Active operation on this server, if any. Null when no unresolved
   * mutation is in progress.
   */
  activeOperation: z
    .object({
      id: z.string().uuid(),
      state: z.enum([
        OperationState.QUEUED,
        OperationState.RUNNING,
        OperationState.VERIFYING,
        OperationState.SUCCEEDED,
        OperationState.PARTIALLY_SUCCEEDED,
        OperationState.FAILED,
        OperationState.CANCELLED_BEFORE_START,
        OperationState.OUTCOME_UNKNOWN,
      ]),
      label: z.string(),
    })
    .nullable(),
});

const FleetResponseSchema = z.object({
  /**
   * Always true in this response. Signals to the frontend that this data
   * is synthetic fixture data and must be labeled [FIXTURE DATA] in the UI.
   * Structure steering invariant: fixture data and live data must remain
   * clearly distinguishable at all times.
   */
  fixture: z.literal(true),
  /** ISO-8601 timestamp of when this response was generated. */
  generatedAt: z.string().datetime(),
  /** Scheduled next health check time (fixture value). */
  nextHealthCheckAt: z.string().datetime(),
  servers: z.array(ServerSummarySchema),
});

export type FleetResponse = z.infer<typeof FleetResponseSchema>;
export type ServerSummary = z.infer<typeof ServerSummarySchema>;

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

/**
 * [FIXTURE DATA] — Synthetic server snapshots for UI development.
 * These represent the founder's three servers in a mixed state:
 *   - Timika:  fresh health and inventory, all clear
 *   - Nabire:  fresh health, stale inventory, one disk warning
 *   - Sentani: unreachable, stale data from last successful check
 *
 * None of this data reflects the real state of any live server.
 * This fixture must be replaced with database-backed data before any
 * real server is connected to the application.
 */
function buildFixtureFleet(): z.infer<typeof FleetResponseSchema> {
  const now = new Date();

  // Health interval = 15 min; fresh window = 2 × 15 min = 30 min
  const healthFreshCutoff = new Date(now.getTime() - 12 * 60 * 1000); // 12 min ago — fresh
  const healthStaleCutoff = new Date(now.getTime() - 45 * 60 * 1000); // 45 min ago — stale

  // Inventory interval = 24 h; fresh window = 2 × 24 h = 48 h
  const inventoryFreshCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 h ago — fresh
  const inventoryStaleCutoff = new Date(now.getTime() - 50 * 60 * 60 * 1000); // 50 h ago — stale

  const freshHealthStaleAfter = new Date(now.getTime() + 18 * 60 * 1000); // 18 min from now
  const staleHealthStaleAfter = new Date(now.getTime() - 15 * 60 * 1000); // already past
  const freshInventoryStaleAfter = new Date(now.getTime() + 46 * 60 * 60 * 1000); // 46 h from now
  const staleInventoryStaleAfter = new Date(now.getTime() - 2 * 60 * 60 * 1000); // already past

  const nextCheck = new Date(now.getTime() + 3 * 60 * 1000); // 3 min from now

  const freshHealth: ObservationFreshness = {
    lastSuccessAt: healthFreshCutoff.toISOString(),
    staleAfter: freshHealthStaleAfter.toISOString(),
    lastAttemptSucceeded: true,
    isFresh: true,
  };

  const staleHealth: ObservationFreshness = {
    lastSuccessAt: healthStaleCutoff.toISOString(),
    staleAfter: staleHealthStaleAfter.toISOString(),
    lastAttemptSucceeded: false, // last attempt failed (unreachable)
    isFresh: false,
  };

  const freshInventory: ObservationFreshness = {
    lastSuccessAt: inventoryFreshCutoff.toISOString(),
    staleAfter: freshInventoryStaleAfter.toISOString(),
    lastAttemptSucceeded: true,
    isFresh: true,
  };

  const staleInventory: ObservationFreshness = {
    lastSuccessAt: inventoryStaleCutoff.toISOString(),
    staleAfter: staleInventoryStaleAfter.toISOString(),
    lastAttemptSucceeded: false,
    isFresh: false,
  };

  const neverObserved: ObservationFreshness = {
    lastSuccessAt: null,
    staleAfter: null,
    lastAttemptSucceeded: null,
    isFresh: false,
  };

  return {
    fixture: true,
    generatedAt: now.toISOString(),
    nextHealthCheckAt: nextCheck.toISOString(),
    servers: [
      // ---- Timika — fresh, all clear -----------------------------------------
      {
        id: "11111111-1111-4111-a111-111111111111",
        name: "Timika",
        role: "production",
        description: "Primary production server",
        emblemId: "hexagon",
        isProduction: true,
        reachable: true,
        hostKeyTrust: "trusted",
        healthFreshness: freshHealth,
        inventoryFreshness: freshInventory,
        statusSummary: "All checks passed. No pending packages.",
        findings: { critical: 0, warning: 0, advisory: 0 },
        activeOperation: null,
      },
      // ---- Nabire — needs attention (disk warning, stale inventory) ----------
      {
        id: "22222222-2222-4222-a222-222222222222",
        name: "Nabire",
        role: "production",
        description: "Secondary production server",
        emblemId: "diamond",
        isProduction: true,
        reachable: true,
        hostKeyTrust: "trusted",
        healthFreshness: freshHealth,
        inventoryFreshness: staleInventory,
        statusSummary: "Disk usage at 87%. Inventory data is stale.",
        findings: { critical: 0, warning: 1, advisory: 0 },
        activeOperation: null,
      },
      // ---- Sentani — unreachable, stale data ---------------------------------
      {
        id: "33333333-3333-4333-a333-333333333333",
        name: "Sentani",
        role: "production",
        description: "Tertiary production server",
        emblemId: "circle",
        isProduction: true,
        reachable: false,
        hostKeyTrust: "trusted",
        healthFreshness: staleHealth,
        inventoryFreshness: neverObserved,
        statusSummary: "Unreachable from ServrSit. Last successful check 45 minutes ago.",
        findings: { critical: 0, warning: 0, advisory: 0 },
        activeOperation: null,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const fleetPlugin: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/fleet",
    {
      schema: {
        response: {
          200: FleetResponseSchema,
        },
      },
    },
    async (_request, _reply) => {
      return buildFixtureFleet();
    }
  );
};

export default fleetPlugin;
