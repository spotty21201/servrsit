/**
 * AuthGate — the route guard (UX-01). Children render only with a session.
 *
 *   checking     asking /api/auth/session; nothing else is shown or requested
 *   unreachable  the API did not answer: say so, never guess "signed out"
 *   signin       password, then code (or recovery code)
 *   setup        first-run enrolment
 *   authed       children, inside the session context
 *
 * The URL never changes while signed out, so after signing in the owner is
 * on the page they asked for. A 401 from any data call, or the 8-hour limit,
 * moves to sign-in with the "session ended" notice. Signing out unmounts the
 * app, so no data stays in memory.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionInfo } from "@servrsit/contracts";
import { getSession, logout } from "../api/auth";
import { AuthFrame, Notice } from "./AuthFrame";
import { setPageTitle } from "../lib/pageTitle";
import { SessionContext, type SessionApi } from "./session";
import { SetupScreen } from "./SetupScreen";
import { SignInScreen, type SignInNotice } from "./SignInScreen";
import { watchUnauthorized } from "./unauthorized";
import styles from "./auth.module.css";

type Mode =
  | { kind: "checking" }
  | { kind: "unreachable" }
  | { kind: "signin"; notice: SignInNotice }
  | { kind: "setup" }
  | { kind: "authed"; session: SessionInfo };

export function AuthGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>({ kind: "checking" });
  // Only the gate's own screens set a title here; every other mode's screen sets its own.
  useEffect(() => {
    if (mode.kind === "checking") setPageTitle("Checking your session", false);
    if (mode.kind === "unreachable") setPageTitle("Can't reach ServrSit", true);
  }, [mode.kind]);

  const check = useCallback(async () => {
    setMode({ kind: "checking" });
    const r = await getSession();
    if (!r.ok) setMode({ kind: "unreachable" });
    else if (r.data.authenticated) setMode({ kind: "authed", session: r.data });
    else setMode({ kind: "signin", notice: null });
  }, []);

  useEffect(() => { void check(); }, [check]);

  const authed = mode.kind === "authed";
  const absolute = mode.kind === "authed" ? mode.session.absoluteExpiresAt : null;

  useEffect(() => {
    if (!authed) return;
    return watchUnauthorized(() => setMode((m) => (m.kind === "authed" ? { kind: "signin", notice: "expired" } : m)));
  }, [authed]);

  useEffect(() => {
    if (!absolute) return;
    const ms = Date.parse(absolute) - Date.now();
    if (!Number.isFinite(ms)) return;
    const t = globalThis.setTimeout(() => setMode((m) => (m.kind === "authed" ? { kind: "signin", notice: "expired" } : m)), Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => globalThis.clearTimeout(t);
  }, [absolute]);

  const signOut = useCallback(async (): Promise<string | null> => {
    const r = await logout();
    if (r.ok || r.error.kind === "UNAUTHENTICATED" || r.error.kind === "CSRF_INVALID") {
      setMode({ kind: "signin", notice: "signed-out" });
      return null;
    }
    return "Couldn't sign out. Check the connection and try again. You are still signed in.";
  }, []);

  const api: SessionApi | null = useMemo(
    () => (mode.kind === "authed" ? { username: mode.session.username, signOut } : null),
    [mode, signOut],
  );

  switch (mode.kind) {
    case "checking":
      return (
        <AuthFrame title="ServrSit" scene={false}>
          <p className={styles.p} role="status">Checking your session…</p>
        </AuthFrame>
      );
    case "unreachable":
      return (
        <AuthFrame title="Can't reach ServrSit" scene={false}>
          <Notice tone="unknown" alert>The ServrSit API did not answer, so it isn&rsquo;t known whether you are signed in. Nothing was changed.</Notice>
          <button type="button" className={styles.primary} onClick={() => void check()}>Try again</button>
        </AuthFrame>
      );
    case "signin":
      return <SignInScreen notice={mode.notice} onSignedIn={(session) => setMode({ kind: "authed", session })} onSetup={() => setMode({ kind: "setup" })} />;
    case "setup":
      return <SetupScreen onDone={(session) => setMode({ kind: "authed", session })} onBack={() => setMode({ kind: "signin", notice: null })} />;
    case "authed":
      return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
  }
}
