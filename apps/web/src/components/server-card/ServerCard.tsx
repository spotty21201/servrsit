/**
 * ServerCard — server identity card for the fleet roster
 *
 * Anatomy unchanged (founder approved, ADR-011 F6), in reading order:
 * identity icon; server name link; role, production and data-source badge;
 * status badge; one most useful line; observed / fresh-until; latest failure
 * (only when the latest attempt failed); one routine action.
 *
 * T-046: renders ServerCardVM from fleetViewModel.ts (live /api/fleet data).
 * All text is plain text from the API; nothing is rendered as HTML.
 *
 * Identity vs health:
 *   - Identity color appears only in the pixel icon and the offset shadow.
 *   - Health appears in the StatusBadge (icon + text), the Historical chip,
 *     the failure line, and the border style (dashed = uncertain, dotted =
 *     nothing observed). Never color alone.
 */
import type { CSSProperties } from "react";
import type { DataSourceVM, IdentityColor, ServerCardVM } from "../overview/fleetViewModel.js";
import { StatusBadge } from "../StatusBadge/index.js";
import { PixelServerIcon } from "./PixelServerIcon.js";
import { BellroadRack } from "../../bellroad/Bellroad";
import styles from "./ServerCard.module.css";

const IDENTITY_VAR: Record<IdentityColor, string> = {
  lilac: "var(--color-lilac)",
  citron: "var(--color-citron)",
  tangerine: "var(--color-tangerine)",
  bubblegum: "var(--color-bubblegum)",
};

const TONE_CLASS: Record<ServerCardVM["tone"], string | undefined> = {
  normal: undefined,
  uncertain: styles.uncertain,
  "no-data": styles.noData,
};

function FreshnessIcon({ fresh }: { fresh: boolean }) {
  return fresh ? (
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

function FailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="2" height="2" fill="currentColor" />
      <rect x="5" y="1" width="2" height="2" fill="currentColor" />
      <rect x="3" y="3" width="2" height="2" fill="currentColor" />
      <rect x="1" y="5" width="2" height="2" fill="currentColor" />
      <rect x="5" y="5" width="2" height="2" fill="currentColor" />
    </svg>
  );
}

/**
 * Per-card data-source badge: text + icon, never color alone.
 * FIXTURE: informational pair (matches the page banner).
 * LIVE: neutral Ink outline — "live" is not a health claim.
 * NO DATA: unknown pair — nothing has been observed for this card.
 */
function SourceBadge({ source }: { source: DataSourceVM }) {
  const cls =
    source === "live" ? styles.sourceLive : source === "fixture" ? styles.sourceFixture : styles.sourceNone;
  const text = source === "live" ? "Live" : source === "fixture" ? "Fixture" : "No data";
  return (
    <span className={`${styles.sourceBadge} ${cls}`}>
      {source === "live" ? (
        <svg width="12" height="12" viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
          <rect x="2" y="2" width="2" height="2" fill="currentColor" />
          <rect x="0" y="1" width="1" height="4" fill="currentColor" />
          <rect x="5" y="1" width="1" height="4" fill="currentColor" />
        </svg>
      ) : source === "fixture" ? (
        <svg width="12" height="12" viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
          <rect x="2" y="0" width="2" height="2" fill="currentColor" />
          <rect x="1" y="2" width="4" height="1" fill="currentColor" />
          <rect x="0" y="3" width="6" height="3" fill="currentColor" />
        </svg>
      ) : (
        // empty box: nothing observed
        <svg width="12" height="12" viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
          <rect x="0" y="0" width="6" height="1" fill="currentColor" />
          <rect x="0" y="5" width="6" height="1" fill="currentColor" />
          <rect x="0" y="1" width="1" height="4" fill="currentColor" />
          <rect x="5" y="1" width="1" height="4" fill="currentColor" />
        </svg>
      )}
      <span className="sr-only">Data source: </span>
      {text}
    </span>
  );
}

/**
 * Rack lights are presentation only and follow the existing status: green for passed, amber for attention.
 * Anything that is overdue, unobserved, historical or in another state stays dim.
 */
function rackState(s: ServerCardVM): "passed" | "attention" | "dim" {
  if (s.tone === "no-data" || s.historical) return "dim";
  return s.statusKey === "passed" || s.statusKey === "attention" ? s.statusKey : "dim";
}

interface ServerCardProps {
  server: ServerCardVM;
  appearance?: "bellroad";
}

export function ServerCard({ server: s, appearance }: ServerCardProps) {
  const headingId = `server-${s.id}-name`;
  const isFresh = s.status === "fresh" || s.status === "partial";

  return (
    <article
      className={`${styles.card} ${TONE_CLASS[s.tone] ?? ""}`}
      aria-labelledby={headingId}
      style={{ "--card-identity": IDENTITY_VAR[s.identity] } as CSSProperties}
    >
      <header className={styles.header}>
        {appearance === "bellroad" ? <BellroadRack state={rackState(s)} /> : <PixelServerIcon variant={s.identity} className={styles.icon} />}
        <div className={styles.identity}>
          <h2 id={headingId} className={`${styles.name} pixel-text`}>
            <a href={`/servers/${encodeURIComponent(s.id)}`} className={styles.nameLink} title={s.name}>
              {s.name}
            </a>
          </h2>
          <div className={styles.meta}>
            <span className={styles.role}>{s.role}</span>
            {s.isProduction && <span className={styles.productionLabel}>Production</span>}
            <SourceBadge source={s.source} />
          </div>
        </div>
      </header>

      <div className={styles.statusRow}>
        <StatusBadge
          state={s.statusKey}
          label={s.statusLabel}
          {...(s.statusIcon ? { icon: s.statusIcon } : {})}
        />
      </div>

      <p className={styles.finding}>
        {s.historical && <span className={styles.historical}>Historical</span>}
        {s.primaryLine}
      </p>

      <p className={styles.checkRow}>
        <FreshnessIcon fresh={isFresh} />
        <span>
          {s.observedAt ? (
            <time dateTime={s.observedAt} className={styles.timestamp}>{s.observedText}</time>
          ) : (
            s.observedText
          )}
          {s.freshUntil && s.freshUntilText && (
            <>
              {" · "}
              <time dateTime={s.freshUntil} className={styles.timestamp}>{s.freshUntilText}</time>
            </>
          )}
        </span>
      </p>

      {s.latestFailure && (
        <p className={styles.failureRow}>
          <FailIcon />
          <span>{s.latestFailure.text}</span>
        </p>
      )}

      <div className={styles.actions}>
        <a href={s.actionHref} className={styles.primaryAction}>
          {s.actionLabel}
          <span className="sr-only"> for {s.name}</span>
        </a>
      </div>
    </article>
  );
}
