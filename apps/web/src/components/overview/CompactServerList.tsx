/**
 * CompactServerList — the dense roster for 6 to 20 servers (T-075, UX Spec
 * §5.2): the same information as a card, one row per server. Name link with a
 * stretched hit area, role and Production label, status badge (icon + text),
 * the most useful line, when it was observed, the latest failure, and the
 * routine action. Identity colour only in the small pixel icon and the left
 * edge; health only in the badge, the failure text and the border style
 * (dashed = uncertain, dotted = nothing observed). Rows wrap; nothing clips.
 */
import type { CSSProperties } from "react";
import { StatusBadge } from "../StatusBadge/index.js";
import { PixelServerIcon } from "../server-card/PixelServerIcon.js";
import type { ServerCardVM } from "./fleetViewModel.js";
import styles from "./CompactServerList.module.css";

const IDENTITY_VAR: Record<ServerCardVM["identity"], string> = {
  lilac: "var(--color-lilac)", citron: "var(--color-citron)", tangerine: "var(--color-tangerine)", bubblegum: "var(--color-bubblegum)",
};

export function CompactServerList({ servers }: { servers: readonly ServerCardVM[] }) {
  return (
    <ul className={styles.list} aria-label="Servers">
      {servers.map((s) => (
        <li key={s.id} className={styles.row} data-tone={s.tone} style={{ "--row-identity": IDENTITY_VAR[s.identity] } as CSSProperties}>
          <div className={styles.who}>
            <PixelServerIcon variant={s.identity} size={32} className={styles.icon} />
            <div className={styles.names}>
              <a href={`/servers/${encodeURIComponent(s.id)}`} className={styles.name}>{s.name}</a>
              <span className={styles.role}>
                {s.role}
                {s.isProduction && <span className={styles.prod}>Production</span>}
              </span>
            </div>
          </div>
          <div className={styles.status}><StatusBadge state={s.statusKey} label={s.statusLabel} {...(s.statusIcon ? { icon: s.statusIcon } : {})} /></div>
          <div className={styles.detail}>
            <p className={styles.line}>{s.historical && <span className={styles.hist}>Historical</span>}{s.primaryLine}</p>
            <p className={styles.when}>
              {s.observedAt ? <time dateTime={s.observedAt}>{s.observedText}</time> : s.observedText}
              {s.freshUntil && s.freshUntilText && <> · <time dateTime={s.freshUntil}>{s.freshUntilText}</time></>}
            </p>
            {s.latestFailure && <p className={styles.fail}>{s.latestFailure.text}</p>}
          </div>
          <a href={s.actionHref} className={styles.action}>{s.actionLabel}<span className="sr-only"> for {s.name}</span></a>
        </li>
      ))}
    </ul>
  );
}
