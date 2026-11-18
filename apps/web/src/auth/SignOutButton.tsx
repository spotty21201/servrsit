/**
 * SignOutButton: the sign-out control in each page's top line.
 *   variant "bar":  "owner · Sign out" in the Care pages' top bar
 *   variant "rail": icon + "Sign out" in the Overview's navigation rail/row
 * 44 px target, text label, aria-label names the signed-in user.
 */
import { useState } from "react";
import { useSession } from "./session";
import styles from "./auth.module.css";

function ExitGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="4" height="1" fill="currentColor" />
      <rect x="0" y="1" width="1" height="6" fill="currentColor" />
      <rect x="0" y="7" width="4" height="1" fill="currentColor" />
      <rect x="3" y="3" width="4" height="1" fill="currentColor" />
      <rect x="5" y="2" width="1" height="3" fill="currentColor" />
      <rect x="6" y="3" width="1" height="1" fill="currentColor" />
    </svg>
  );
}

export function SignOutButton({ variant }: { variant: "bar" | "rail" }) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!session) return null;

  async function click(): Promise<void> {
    if (busy || !session) return;
    setBusy(true);
    setProblem(null);
    const result = await session.signOut();
    // On success the gate unmounts this page; only a failure lands here.
    setBusy(false);
    if (result) setProblem(result);
  }

  return (
    <span className={variant === "bar" ? styles.signOutBar : styles.signOutRail}>
      {variant === "bar" && <span className={styles.signedInAs}>{session.username}</span>}
      <button type="button" className={variant === "bar" ? styles.signOutBtnBar : styles.signOutBtnRail} onClick={() => void click()} disabled={busy} aria-label={`Sign out (signed in as ${session.username})`}>
        {variant === "rail" && <ExitGlyph />}
        <span>{busy ? "Signing out" : "Sign out"}</span>
      </button>
      {problem && <span className={styles.signOutProblem} role="alert">{problem}</span>}
    </span>
  );
}
