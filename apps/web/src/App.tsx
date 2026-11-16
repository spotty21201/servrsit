/**
 * App — root component
 *
 * Renders the Overview screen with fixture data.
 * The isFixture prop ensures the [FIXTURE DATA] banner is shown.
 *
 * Router and authenticated routes are added in later tasks (T-023+).
 * For now this is a single-screen fixture render.
 */
import { OverviewScreen } from "./components/overview/index.js";
import { overviewFixture } from "./fixtures/overview.js";

export default function App() {
  return (
    <OverviewScreen
      data={overviewFixture.data}
      isFixture={true}
    />
  );
}
