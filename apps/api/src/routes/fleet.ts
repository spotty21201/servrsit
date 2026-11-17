/**
 * GET /api/fleet
 *
 * Returns the cached fleet view. This route never contacts a server; checks
 * run on the FleetService schedule. In fixture mode (SERVRSIT_FLEET_MODE=fixture)
 * every server is labelled source "fixture" and the response mode is "fixture".
 *
 * Technical Spec §13: GET /api/fleet.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { buildFixtureFleet } from "../fleet/fixture.js";
import type { FleetConfig } from "../fleet/config.js";
import { FleetResponseSchema } from "../fleet/schema.js";
import type { FleetService } from "../fleet/service.js";

export interface FleetRouteOptions {
  readonly mode: "live" | "fixture";
  readonly service: FleetService;
  readonly config: FleetConfig;
}

export const fleetPlugin: FastifyPluginAsyncZod<FleetRouteOptions> = async (fastify, options) => {
  fastify.get(
    "/api/fleet",
    { schema: { response: { 200: FleetResponseSchema } } },
    async () =>
      options.mode === "fixture"
        ? buildFixtureFleet(options.config, new Date())
        : options.service.snapshot(),
  );
};

export default fleetPlugin;
