/**
 * [FIXTURE DATA]
 *
 * Synthetic /api/fleet responses for unit tests. They describe no real server.
 */

import type { FleetResponse, FleetServer } from "@servrsit/contracts";

export function fixtureServer(overrides: Partial<FleetServer> = {}): FleetServer {
  return {
    id: "11111111-1111-4111-a111-111111111111",
    name: "Fixture One",
    role: null,
    production: false,
    importantServices: [],
    access: "ssh",
    source: "fixture",
    status: "fresh",
    statusReason: "[FIXTURE DATA] Synthetic fresh server.",
    observedAt: "2026-11-17T08:00:00.000Z",
    freshUntil: "2026-11-17T08:30:00.000Z",
    coverage: null,
    latestAttempt: null,
    findings: [],
    observation: null,
    ...overrides,
  };
}

export function fixtureFleet(overrides: Partial<FleetResponse> = {}): FleetResponse {
  return {
    mode: "fixture",
    generatedAt: "2026-11-17T08:05:00.000Z",
    healthIntervalMinutes: 15,
    ownerTimeZone: "Asia/Jakarta",
    nextCheckAt: null,
    servers: [
      fixtureServer(),
      fixtureServer({
        id: "22222222-2222-4222-a222-222222222222",
        name: "Fixture Two",
        status: "unreachable",
        statusReason: "[FIXTURE DATA] Synthetic unreachable server.",
        latestAttempt: {
          at: "2026-11-17T08:04:00.000Z",
          succeeded: false,
          failure: { code: "ROUTE_UNAVAILABLE", message: "The host could not be reached." },
          consecutiveFailures: 2,
        },
      }),
    ],
    ...overrides,
  };
}

/** A fetch that answers once with the given body. */
export function respondWith(body: string, init: { status?: number; headers?: Record<string, string> } = {}): typeof fetch {
  return (async () =>
    new Response(body, {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...init.headers },
    })) as typeof fetch;
}
