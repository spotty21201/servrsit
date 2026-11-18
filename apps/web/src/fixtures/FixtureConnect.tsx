/**
 * [FIXTURE DATA] /fixtures/connect: the real Connect screen on the in-memory
 * registration fixture, so every step (and the duplicate, unreachable and
 * ?state=error paths) can be reviewed with no backend and no SSH.
 */
import { useMemo } from "react";
import { ConnectScreen } from "../connect/ConnectScreen";
import { createFixtureServersClient } from "./serversFixture";

export function FixtureConnect() {
  const client = useMemo(() => createFixtureServersClient(), []);
  return <ConnectScreen client={client} fixture />;
}
