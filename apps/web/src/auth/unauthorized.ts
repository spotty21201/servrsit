/**
 * Notices a 401 UNAUTHENTICATED from any /api call (except /api/auth/*) so the
 * app can move to the "session ended" sign-in at once, wherever the owner was.
 * Wraps globalThis.fetch once; returns a function that restores it.
 * The response is passed through untouched (it is cloned only to be counted).
 */
export function watchUnauthorized(onUnauthorized: () => void, target: { fetch: typeof fetch } = globalThis): () => void {
  const original = target.fetch;
  const wrapped: typeof fetch = async (input, init) => {
    const response = await original.call(globalThis, input, init);
    if (response.status === 401) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const path = url.startsWith("http") ? new URL(url).pathname : url;
      if (path.startsWith("/api/") && !path.startsWith("/api/auth/")) onUnauthorized();
    }
    return response;
  };
  target.fetch = wrapped;
  return () => { if (target.fetch === wrapped) target.fetch = original; };
}
