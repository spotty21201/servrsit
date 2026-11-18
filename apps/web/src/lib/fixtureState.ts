/**
 * Fixture-only preview of loading and API-down states (T-075 audit).
 *
 * Fixture clients read `?state=loading` or `?state=error` from the page URL:
 * "loading" never answers, "error" fails the way a down API does. Real clients
 * never read this, so a real screen cannot be made to look broken or healthy
 * by editing the URL. The screens show the usual [FIXTURE DATA] banner, so a
 * preview is never mistaken for live data.
 */
export type PreviewState = "loading" | "error" | null;

export function previewStateFrom(search: string): PreviewState {
  const v = new URLSearchParams(search).get("state");
  return v === "loading" || v === "error" ? v : null;
}

export const previewState = (): PreviewState => previewStateFrom(globalThis.location?.search ?? "");

/** Resolves with `value`, never resolves ("loading"), or rejects-as-value via `onError` ("error"). */
export async function gate<T>(value: () => T, onError: () => T): Promise<T> {
  const s = previewState();
  if (s === "loading") return new Promise<T>(() => undefined);
  if (s === "error") return onError();
  return value();
}
