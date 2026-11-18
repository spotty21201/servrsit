/**
 * The control-plane clock shape is the shared contract (Coder's T-063,
 * `ControllerClockSchema` in @servrsit/contracts). This alias keeps the
 * banner code's name stable.
 */
import type { ControllerClock } from "@servrsit/contracts";

export type ControllerClockView = ControllerClock;
