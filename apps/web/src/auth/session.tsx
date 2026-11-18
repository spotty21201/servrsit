/**
 * Session context: who is signed in and how to sign out. Components outside
 * the gate (tests, fixtures) get null and render no sign-out control.
 */
import { createContext, useContext } from "react";

export interface SessionApi {
  readonly username: string;
  /** Resolves to null when signed out, or a short fixed message if sign-out failed. */
  readonly signOut: () => Promise<string | null>;
}

export const SessionContext = createContext<SessionApi | null>(null);
export const useSession = (): SessionApi | null => useContext(SessionContext);
