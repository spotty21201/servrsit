/**
 * AuthFrame: the centred surface for sign-in and setup. White page, Ink
 * border, Lilac offset shadow, pixel title. No fixed elements, no 100vw.
 */
import type { ReactNode } from "react";
import styles from "./auth.module.css";

export function AuthFrame({ title, titleRef, children }: { title: string; titleRef?: React.Ref<HTMLHeadingElement>; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <p className={`${styles.brand} pixel-text`}>ServrSit</p>
        <section className={styles.card} aria-labelledby="auth-title">
          <h1 id="auth-title" ref={titleRef} tabIndex={-1} className={`${styles.title} pixel-text`}>{title}</h1>
          {children}
        </section>
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
