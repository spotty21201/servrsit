/**
 * AuthFrame: the centred surface for sign-in and setup. White page, Ink
 * border, Lilac offset shadow, pixel title. No fixed elements, no 100vw.
 */
import type { ReactNode } from "react";
import styles from "./auth.module.css";

export function AuthFrame({ title, titleRef, children }: { title: string; titleRef?: React.Ref<HTMLHeadingElement>; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <main id="main-content" className={styles.main}>
        <p className={`${styles.brand} pixel-text`} aria-label="ServrSit">ServrSit</p>
        <section className={styles.card} aria-labelledby="auth-title">
          <h1 id="auth-title" ref={titleRef} tabIndex={-1} className={`${styles.title} pixel-text`}>{title}</h1>
          {children}
        </section>
        <p className={styles.tagline}>Your servers have a sitter.</p>
      </main>
    </div>
  );
}

export function Notice({ tone, title, children, alert = false }: { tone: "failed" | "attention" | "passed" | "unknown" | "progress"; title?: string; children: ReactNode; alert?: boolean }) {
  const cls = { failed: styles.nFailed, attention: styles.nAttention, passed: styles.nPassed, unknown: styles.nUnknown, progress: styles.nProgress }[tone];
  return (
    <div className={`${styles.notice} ${cls}`} role={alert ? "alert" : "status"}>
      {title && <p className={styles.noticeTitle}>{title}</p>}
      <p>{children}</p>
    </div>
  );
}
