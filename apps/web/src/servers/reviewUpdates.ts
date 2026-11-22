/**
 * Review updates (T-093): ask the API for an update plan for this server, then
 * open it at /plans/:id. Pure orchestration with the client and the navigation
 * injected, so it is tested without a browser.
 *
 * Rules:
 *   - one request at a time: a second click while one is pending does nothing;
 *   - the browser never decides whether writes are allowed. A server without
 *     writes still gets a plan, and the plan page shows its blocked state;
 *   - creating a plan changes nothing on the server, so a failure can say so;
 *   - API bodies are never shown: only fixed text chosen from the error code.
 */
import type { CareClient, CareFailureKind } from "../api/care";
import { planPath } from "../lib/router";

export type ReviewPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "pending" }
  | { readonly phase: "failed"; readonly text: string };

export const REVIEW_PENDING_LABEL = "Preparing plan…";

/** Fixed, display-safe text for a failed plan request. */
export function reviewErrorText(failure: { kind: CareFailureKind; code?: string }): string {
  if (failure.kind === "http") {
    switch (failure.code) {
      case "NOT_FOUND": return "ServrSit could not find this server. Reload the page. Nothing was changed on the server.";
      case "ROUTE_UNAVAILABLE": return "ServrSit could not reach the server to prepare the plan. Nothing was changed on the server. Try again in a moment.";
      case "UNAUTHENTICATED": return "You are signed out. Sign in again, then try again.";
      case "CSRF_INVALID": return "Your session needs a refresh. Reload the page, then try again. Nothing was changed on the server.";
      case "INVALID_INPUT": return "ServrSit could not prepare a plan for this server. Nothing was changed on the server.";
      default: return "ServrSit could not prepare the plan. Nothing was changed on the server. Try again in a moment.";
    }
  }
  return "ServrSit did not get a clear answer, so no plan was opened. Nothing was changed on the server. Try again.";
}

export interface ReviewRunner {
  /** Starts a request unless one is already pending. Resolves when it has finished. */
  run(): Promise<void>;
  readonly pending: boolean;
}

export function createReviewRunner(o: {
  readonly client: Pick<CareClient, "createPlan">;
  readonly serverId: string;
  readonly onPhase: (p: ReviewPhase) => void;
  readonly navigate: (path: string) => void;
}): ReviewRunner {
  let pending = false;
  return {
    get pending() { return pending; },
    async run() {
      if (pending) return;
      pending = true;
      o.onPhase({ phase: "pending" });
      try {
        const r = await o.client.createPlan(o.serverId);
        if (r.ok) {
          // Stay "pending" while the browser moves to the plan page.
          o.navigate(planPath(r.data.id));
          return;
        }
        if (r.kind === "aborted") { o.onPhase({ phase: "idle" }); return; }
        o.onPhase({ phase: "failed", text: reviewErrorText(r.code === undefined ? { kind: r.kind } : { kind: r.kind, code: r.code }) });
      } finally {
        pending = false;
      }
    },
  };
}
