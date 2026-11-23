/**
 * AuthFrame: the centred surface for sign-in and setup, in the Bellroad theme (round 5): dark green page, bone text,
 * amber main action. Otis stands on the top edge of the card as decoration only (founder: Otis only, no Agnes): he is
 * outside the card, so he never touches a field, a button, an error or the QR code. He is smaller on phones, and
 * `scene={false}` leaves him out (the loading and "can't reach ServrSit" screens).
 */
import type { ReactNode } from "react";
import bellroad from "../bellroad/Bellroad.module.css";
import "../bellroad/fonts.css";
import styles from "./auth.module.css";

export function AuthFrame({ title, titleRef, children, scene = true }: { title: string; titleRef?: React.Ref<HTMLHeadingElement>; children: ReactNode; scene?: boolean }) {
  return (
    <div className={`${styles.page} ${bellroad.theme} bellroad-theme`}>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <p className={styles.brand}>ServrSit</p>
        <div className={scene ? `${styles.cardWrap} ${styles.withScene}` : styles.cardWrap}>
          {scene && <img className={styles.otis} src="/bellroad/otis.webp" alt="" width="245" height="166" />}
          <section className={styles.card} aria-labelledby="auth-title">
            <h1 id="auth-title" ref={titleRef} tabIndex={-1} className={styles.title}>{title}</h1>
            {children}
          </section>
        </div>
        <p className={styles.tagline}>Your servers have a sitter.</p>
      </main>
    </div>
  );
}

export function Notice({ tone, title, children, alert = false, id }: { tone: "failed" | "attention" | "passed" | "unknown" | "progress"; title?: string; children: ReactNode; alert?: boolean; id?: string }) {
  const cls = { failed: styles.nFailed, attention: styles.nAttention, passed: styles.nPassed, unknown: styles.nUnknown, progress: styles.nProgress }[tone];
  return (
    <div id={id} className={`${styles.notice} ${cls}`} role={alert ? "alert" : "status"}>
      {title && <p className={styles.noticeTitle}>{title}</p>}
      <p>{children}</p>
    </div>
  );
}

/**
 * A button that stays focusable when it cannot be used yet (D-U4).
 * `reason` non-null: aria-disabled, the click is ignored, and the reason is
 * visible text tied to the button with aria-describedby, so a keyboard or
 * screen reader user can reach it and read why. `busy` is a real disabled
 * state for the short time a request is in flight.
 */
export function ReasonButton({ reason, busy = false, id, className, type = "button", onClick, children }: {
  reason: string | null; busy?: boolean; id: string; className: string | undefined; type?: "button" | "submit"; onClick?: () => void; children: ReactNode;
}) {
  return (
    <>
      <button
        type={type}
        className={className}
        disabled={busy}
        aria-disabled={reason ? true : undefined}
        aria-describedby={reason ? `${id}-why` : undefined}
        onClick={(e) => { if (reason) { e.preventDefault(); return; } onClick?.(); }}
      >
        {children}
      </button>
      {reason && <p id={`${id}-why`} className={styles.help}>{reason}</p>}
    </>
  );
}
