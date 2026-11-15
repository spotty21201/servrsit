/**
 * ServrSit — Fixture data type utilities
 *
 * Enforces the fixture labeling invariant from the Structure steering:
 *
 *   "Any screen, component, or data snapshot that uses synthetic/fixture data
 *   must carry a visible [FIXTURE DATA] label in the UI and in the file. This
 *   label is never removed until the surface is connected to a real, authorized
 *   data source. This is a product invariant, not a development convenience."
 *
 * Usage:
 *
 *   import type { WithFixtureLabel, FixtureData } from "@servrsit/ui";
 *
 *   // Wrap any fixture data object with the marker:
 *   const serverFixture: WithFixtureLabel<Server> = {
 *     _fixture: "[FIXTURE DATA]",
 *     data: { id: "sentani", name: "Sentani", ... },
 *   };
 *
 *   // Or use the FixtureData<T> shorthand:
 *   const fleet: FixtureData<Server[]> = {
 *     _fixture: "[FIXTURE DATA]",
 *     data: [...],
 *   };
 *
 *   // At render time, check before displaying:
 *   if (isFixtureData(fleet)) {
 *     // show [FIXTURE DATA] label in UI
 *   }
 */

/**
 * The exact string marker required by the fixture labeling rule.
 * Do not use any other value.
 */
export const FIXTURE_LABEL = "[FIXTURE DATA]" as const;
export type FixtureLabel = typeof FIXTURE_LABEL;

/**
 * Wraps any data type T with a mandatory fixture marker.
 *
 * The `_fixture` field MUST equal `"[FIXTURE DATA]"` exactly.
 * Any object without this field, or with a different string, is not
 * fixture data and must not display the fixture label.
 */
export type WithFixtureLabel<T> = {
  /**
   * Fixture marker. Must be exactly `"[FIXTURE DATA]"`.
   * Present on every synthetic/mock data object used during development
   * or in tests. Remove only when the data source becomes a live,
   * authorized API response.
   */
  readonly _fixture: FixtureLabel;
  readonly data: T;
};

/**
 * Alias: FixtureData<T> is identical to WithFixtureLabel<T>.
 * Use whichever reads more clearly at the call site.
 */
export type FixtureData<T> = WithFixtureLabel<T>;

/**
 * Type guard: returns true if `value` carries the fixture marker.
 *
 * Use this at render boundaries to decide whether to show the
 * [FIXTURE DATA] label. Never suppress the label when this returns true.
 *
 * @example
 *   if (isFixtureData(props.server)) {
 *     return <FixtureBanner />;
 *   }
 */
export function isFixtureData<T>(
  value: unknown
): value is WithFixtureLabel<T> {
  return (
    value !== null &&
    typeof value === "object" &&
    "_fixture" in value &&
    (value as Record<string, unknown>)["_fixture"] === FIXTURE_LABEL
  );
}

/**
 * Creates a fixture-labeled wrapper around any data value.
 *
 * @example
 *   const fixture = asFixture({ id: "nabire", name: "Nabire" });
 *   // fixture._fixture === "[FIXTURE DATA]"
 *   // fixture.data === { id: "nabire", name: "Nabire" }
 */
export function asFixture<T>(data: T): WithFixtureLabel<T> {
  return { _fixture: FIXTURE_LABEL, data };
}

/**
 * Extracts the data from a fixture wrapper.
 *
 * Prefer using `value.data` directly when you already know the type.
 * This helper is useful when the wrapper type is unknown at the call site.
 */
export function getFixtureData<T>(fixture: WithFixtureLabel<T>): T {
  return fixture.data;
}
