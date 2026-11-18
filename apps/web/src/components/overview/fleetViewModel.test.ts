import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureFleet, fixtureServer } from "../../api/fleet.fixtures";
import { initialFleetState, type FleetState } from "../../api/fleetState";
import { toOverviewVM } from "./fleetViewModel";

const NOW = new Date("2026-11-17T08:10:00Z"); // 15:10 WIB

function ready(data = fixtureFleet()): FleetState {
  return { ...initialFleetState, phase: "ready", data, receivedAt: "2026-11-17T08:09:00Z" };
}

test("every time uses ownerTimeZone, with zone label and age where it stands alone", () => {
  const vm = toOverviewVM(ready(fixtureFleet({ nextCheckAt: "2026-11-17T08:15:00Z" })), NOW);
  assert.equal(vm.timeZone, "Asia/Jakarta");
  assert.equal(vm.receivedText, "15:09 WIB (1 min ago)");
  assert.equal(vm.nextCheckText, "15:15 WIB");
  assert.equal(vm.servers[0]?.observedText, "Observed 10 min ago");
  assert.equal(vm.servers[0]?.freshUntilText, "fresh until 15:30 WIB");
  assert.match(vm.servers[1]?.latestFailure?.text ?? "", /^Latest check failed 6 min ago \(2 in a row\)/);
});

test("a different ownerTimeZone changes the rendered clock and label", () => {
  const vm = toOverviewVM(ready(fixtureFleet({ ownerTimeZone: "Asia/Jayapura" })), NOW);
  assert.equal(vm.receivedText, "17:09 WIT (1 min ago)");
});

test("no data yet: default zone Asia/Jakarta", () => {
  assert.equal(toOverviewVM(initialFleetState, NOW).timeZone, "Asia/Jakarta");
});

test("role and production flag come from the API; missing role is stated, not invented", () => {
  const vm = toOverviewVM(
    ready(fixtureFleet({ servers: [fixtureServer({ role: "Remote client-facing VPS (Europe)", production: true }), fixtureServer({ id: "33333333-3333-4333-a333-333333333333" })] })),
    NOW,
  );
  assert.equal(vm.servers[0]?.role, "Remote client-facing VPS (Europe)");
  assert.equal(vm.servers[0]?.isProduction, true);
  assert.equal(vm.servers[1]?.role, "No role set");
  assert.equal(vm.servers[1]?.isProduction, false);
});

const obs = (value: number) =>
  ({ packages: { pendingCount: { status: "ok", value } } }) as unknown as NonNullable<ReturnType<typeof fixtureServer>["observation"]>;

test("voice: light cheek only for a fresh server with nothing pending; plain everywhere else", () => {
  const vm = toOverviewVM(
    ready(fixtureFleet({
      servers: [
        fixtureServer({ observation: obs(0) }),
        fixtureServer({ id: "44444444-4444-4444-a444-444444444444", observation: obs(3) }),
        fixtureServer({ id: "55555555-5555-4555-a555-555555555555", status: "unreachable", observation: obs(0), statusReason: "Could not connect." }),
      ],
    })),
    NOW,
  );
  assert.equal(vm.servers[0]?.primaryLine, "No pending updates. Nothing to babysit.");
  assert.equal(vm.servers[1]?.primaryLine, "3 packages can be updated");
  assert.equal(vm.servers[2]?.primaryLine, "No pending updates");
  assert.doesNotMatch(vm.servers[2]?.primaryLine ?? "", /babysit/);
});

test("ServrSit's clock untrusted: relative ages carry ≈, clock times do not", () => {
  const vm = toOverviewVM(ready(), NOW, true);
  assert.equal(vm.servers[0]?.observedText, "Observed ≈ 10 min ago");
  assert.equal(vm.receivedText, "15:09 WIB (≈ 1 min ago)");
  assert.equal(vm.servers[0]?.freshUntilText, "fresh until 15:30 WIB");
  assert.equal(toOverviewVM(ready(), NOW).servers[0]?.observedText, "Observed 10 min ago");
});
