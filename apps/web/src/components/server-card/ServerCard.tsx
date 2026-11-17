/**
 * ServerCard — server identity card for the fleet roster
 *
 * Anatomy unchanged from v1 (founder approved, ADR-011 F6), in reading order:
 * identity icon; server name link; purpose and production label; status badge;
 * one most useful finding; last health check; one routine action.
 *
 * An <article> with a heading link and a separate action link — never one big
 * button containing other controls (UX Spec §8.2).
 *
 * Identity vs health:
 *   - Identity color (Lilac/Citron/Tangerine) appears in the pixel icon and the
 *     card's offset shadow. It never changes with health.
 *   - Health appears only in the StatusBadge (icon + text), the "Historical"
 *     chip, and a dashed border for unreachable/stale (a non-color cue).
 */
import type { CSSProperties } from "react";
import type { DataSource, ServerFixture, ServerEmblemVariant } from "../../fixtures/overview.js";
import { StatusBadge } from "../StatusBadge/index.js";
import { PixelServerIcon } from "./PixelServerIcon.js";
import styles from "./ServerCard.module.css";

const IDENTITY_VAR: Record<ServerEmblemVariant, string> = {
  lilac: "var(--color-lilac)",
  citron: "var(--color-citron)",
  tangerine: "var(--color-tangerine)",
  bubblegum: "var(--color-bubblegum)",
};

function FreshnessIcon({ isFresh }: { isFresh: boolean }) {
  // Pixel clock / check, drawn in muted ink (not a health color on its own;
  // the adjacent text carries the meaning).
  return isFresh ? (
    <svg width="16" height="16" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect x="6" y="1" width="1" height="1" fill="currentColor" />
      <rect x="5" y="2" width="1" height="1" fill="currentColor" />
      <rect x="4" y="3" width="1" height="1" fill="currentColor" />
      <rect x="3" y="4" width="1" height="1" fill="currentColor" />
      <rect x="2" y="3" width="1" height="1" fill="currentColor" />
      <rect x="1" y="2" width="1" height="1" fill="currentColor" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect x="2" y="0" width="4" height="1" fill="currentColor" />
      <rect x="1" y="1" width="1" height="1" fill="currentColor" />
      <rect x="6" y="1" width="1" height="1" fill="currentColor" />
      <rect x="0" y="2" width="1" height="4" fill="currentColor" />
      <rect x="7" y="2" width="1" height="4" fill="currentColor" />
      <rect x="1" y="6" width="1" height="1" fill="currentColor" />
      <rect x="6" y="6" width="1" height="1" fill="currentColor" />
      <rect x="2" y="7" width="4" height="1" fill="currentColor" />
      <rect x="3" y="2" width="1" height="3" fill="currentColor" />
      <rect x="4" y="4" width="2" height="1" fill="currentColor" />
    </svg>
  );
}

interface ServerCardProps {
  server: ServerFixture;
}

/**
 * Per-card data-source badge (T-040): text + icon, never color alone.
 * FIXTURE uses the informational (progress) pair, matching the page banner.
 * LIVE is neutral (Ink outline on white) — "live" is not a health claim.
 */
function SourceBadge({ source }: { source: DataSource }) {
  const isLive = source === "live";
  return (
    <span className={`${styles.sourceBadge} ${isLive ? styles.sourceLive : styles.sourceFixture}`}>
      {isLive ? (
        // pixel "signal": dot with two arcs
        <svg width="12" height="12" viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
          <rect x="2" y="2" width="2" height="2" fill="currentColor" />
          <rect x="0" y="1" width="1" height="4" fill="currentColor" />
          <rect x="5" y="1" width="1" height="4" fill="currentColor" />
        </svg>
      ) : (
        // pixel flask: synthetic / test data
        <svg width="12" height="12" viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
          <rect x="2" y="0" width="2" height="2" fill="currentColor" />
          <rect x="1" y="2" width="4" height="1" fill="currentColor" />
          <rect x="0" y="3" width="6" height="3" fill="currentColor" />
        </svg>
      )}
      <span className="sr-only">Data source: </span>
      {isLive ? "Live" : "Fixture"}
    </span>
  );
}

export function ServerCard({ server }: ServerCardProps) {
  const {
    id,
    name,
    role,
    isProduction,
    emblemVariant,
    cardState,
    statusLabel,
    statusSemanticKey,
    primaryFinding,
    lastHealthCheckAt,
    lastHealthCheckRelative,
    isFresh,
    primaryActionLabel,
    primaryActionHref,
    source,
  } = server;

  const headingId = `server-${id}-name`;
  const isUnverifiedHost = cardState === "unverified-host";
  // "Historical" only when there IS an older result being shown. An
  // unverified host has never been contacted, so it has no history.
  const showHistorical = !isFresh && lastHealthCheckAt !== null && !isUnverifiedHost;

  return (
    <article
      className={`${styles.card} ${styles[cardState] ?? ""}`}
      aria-labelledby={headingId}
      style={{ "--card-identity": IDENTITY_VAR[emblemVariant] } as CSSProperties}
    >
      <header className={styles.header}>
        <PixelServerIcon variant={emblemVariant} className={styles.icon} />
        <div className={styles.identity}>
          <h2 id={headingId} className={`${styles.name} pixel-text`}>
            <a href={`/servers/${id}`} className={styles.nameLink} title={name}>
              {name}
            </a>
          </h2>
          <div className={styles.meta}>
            <span className={styles.role}>{role}</span>
            {isProduction && <span className={styles.productionLabel}>Production</span>}
            <SourceBadge source={source} />
          </div>
        </div>
      </header>

      <div className={styles.statusRow}>
        <StatusBadge
          state={statusSemanticKey}
          label={statusLabel}
          {...(isUnverifiedHost ? { icon: "lock" as const } : {})}
        />
      </div>

      <p className={styles.finding}>
        {showHistorical && <span className={styles.historical}>Historical</span>}
        {primaryFinding}
      </p>

      <p className={styles.checkRow}>
        <FreshnessIcon isFresh={isFresh} />
        {lastHealthCheckAt === null ? (
          <span>Not checked yet</span>
        ) : (
          <span>
            {isFresh ? "Checked" : "Last successful check"}{" "}
            <time dateTime={lastHealthCheckAt} className={styles.timestamp}>
              {lastHealthCheckRelative}
            </time>
          </span>
        )}
      </p>

      <div className={styles.actions}>
        <a href={primaryActionHref} className={styles.primaryAction}>
          {primaryActionLabel}
          <span className="sr-only"> for {name}</span>
        </a>
      </div>
    </article>
  );
}
