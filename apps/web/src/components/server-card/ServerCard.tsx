/**
 * ServerCard — server identity card for the fleet roster
 *
 * UX Spec §8.2:
 * "In reading order: identity emblem; server name link; purpose and production
 * label; primary status label; one most useful finding or checked result; last
 * successful health check; selected routine action."
 *
 * "A server card is an article with a heading link and separate action controls.
 * Do not implement the entire card as a button containing other buttons."
 */
import type { ServerFixture, ServerEmblemVariant } from "../../fixtures/overview.js";
import { StatusBadge } from "../StatusBadge/index.js";
import styles from "./ServerCard.module.css";

// ── Server emblem ──────────────────────────────────────────────────────────
// UX Spec §4.4: "A server emblem is a small abstract arrangement of blocks or
// rounded geometric shapes. Its color represents identity, never current health."
// Colors: identity from Lilac/Citron/Tangerine — not health/semantic colors.

const EMBLEM_COLORS: Record<ServerEmblemVariant, string> = {
  lilac: "var(--color-lilac)",
  citron: "var(--color-citron)",
  tangerine: "var(--color-tangerine)",
};

interface EmblemProps {
  variant: ServerEmblemVariant;
  serverName: string;
}

function ServerEmblem({ variant, serverName }: EmblemProps) {
  const color = EMBLEM_COLORS[variant];
  // Abstract geometric arrangement — 3 blocks in an asymmetric cluster.
  // Color is identity only; this emblem does NOT change with health state.
  return (
    <svg
      className={styles.emblem}
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
      role="img"
    >
      <title>{serverName} identity emblem</title>
      {/* Large primary block */}
      <rect x="4" y="4" width="20" height="20" rx="4" fill={color} opacity="0.9" />
      {/* Small offset block — top right */}
      <rect x="22" y="4" width="14" height="14" rx="3" fill={color} opacity="0.5" />
      {/* Small offset block — bottom right */}
      <rect x="22" y="22" width="14" height="14" rx="3" fill={color} opacity="0.7" />
      {/* Small pip — bottom left */}
      <rect x="4" y="28" width="14" height="8" rx="3" fill={color} opacity="0.4" />
    </svg>
  );
}

// ── Freshness indicator ────────────────────────────────────────────────────

function FreshnessIcon({ isFresh }: { isFresh: boolean }) {
  if (isFresh) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
        <circle cx="6" cy="6" r="5" stroke="var(--color-state-passed-fg)" strokeWidth="1.5" />
        <path d="M4 6L5.5 7.5L8.5 4.5" stroke="var(--color-state-passed-fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
      <circle cx="6" cy="6" r="5" stroke="var(--color-state-unknown-fg)" strokeWidth="1.5" />
      <path d="M6 3.5V6L7.5 7.5" stroke="var(--color-state-unknown-fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface ServerCardProps {
  server: ServerFixture;
}

export function ServerCard({ server }: ServerCardProps) {
  const {
    name,
    role,
    isProduction,
    emblemVariant,
    statusLabel,
    statusSemanticKey,
    primaryFinding,
    lastHealthCheckRelative,
    isFresh,
    primaryActionLabel,
    primaryActionHref,
  } = server;

  return (
    <article
      className={`${styles.card} ${styles[server.cardState]}`}
      aria-label={`${name} — ${statusLabel}`}
    >
      {/* ── Identity row ───────────────────────────────────────────────── */}
      <header className={styles.header}>
        <ServerEmblem variant={emblemVariant} serverName={name} />
        <div className={styles.identity}>
          <div className={styles.nameRow}>
            <h2 className={styles.name}>
              <a href={`/servers/${server.id}`} className={styles.nameLink}>
                {name}
              </a>
            </h2>
            {isProduction && (
              <span className={styles.productionLabel} aria-label="Production server">
                Production
              </span>
            )}
          </div>
          <span className={styles.role}>{role}</span>
        </div>
      </header>

      {/* ── Status ─────────────────────────────────────────────────────── */}
      <div className={styles.statusRow}>
        <StatusBadge state={statusSemanticKey} label={statusLabel} />
      </div>

      {/* ── Primary finding ────────────────────────────────────────────── */}
      <p className={styles.finding}>{primaryFinding}</p>

      {/* ── Last check ─────────────────────────────────────────────────── */}
      <div className={styles.checkRow}>
        <FreshnessIcon isFresh={isFresh} />
        <span className={styles.checkTime}>
          {isFresh ? "Checked" : "Last checked"}{" "}
          <time
            dateTime={server.lastHealthCheckAt ?? undefined}
            className={styles.timestamp}
          >
            {lastHealthCheckRelative}
          </time>
        </span>
      </div>

      {/* ── Primary action ─────────────────────────────────────────────── */}
      <div className={styles.actions}>
        <a
          href={primaryActionHref}
          className={styles.primaryAction}
          aria-label={`${primaryActionLabel} — ${name}`}
        >
          {primaryActionLabel}
        </a>
      </div>
    </article>
  );
}
