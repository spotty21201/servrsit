import type { ReactNode } from "react";
import "./fonts.css";
import styles from "./Bellroad.module.css";

const pages = [
  { label: "Overview", href: "/overview", art: "house" },
  { label: "Findings", href: "/findings", art: "lantern" },
  { label: "Activity", href: "/activity", art: "bat" },
  { label: "Baselines", href: "/baselines", art: "book" },
  { label: "Settings", href: "/settings", art: "potion" },
] as const;

const scenes = {
  Findings: "findings",
  Activity: "activity",
  Baselines: "baselines",
  Settings: "settings",
} as const;

type Scene = keyof typeof scenes;
const artRoot = "/bellroad";

export function isBellroadPage(section: string): section is Scene {
  return Object.prototype.hasOwnProperty.call(scenes, section);
}

export function BellroadMark() {
  return (
    <a href="/overview" className={styles.mark} aria-label="ServrSit overview">
      <img src={artRoot + "/milley-icon.webp"} alt="" width="96" height="96" />
      <span>ServerSitter version 1.0</span>
    </a>
  );
}

export function BellroadLinks({ current, className, itemClassName, activeClassName, labelClassName }: {
  current: string;
  className?: string;
  itemClassName?: string;
  activeClassName?: string;
  labelClassName?: string;
}) {
  return (
    <ul className={[styles.links, className].filter(Boolean).join(" ")}>
      {pages.map(({ label, href, art }) => (
        <li key={href}>
          <a
            href={href}
            aria-current={label === current ? "page" : undefined}
            className={[styles.link, itemClassName, label === current && activeClassName].filter(Boolean).join(" ")}
          >
            <span className={styles.navIcon} aria-hidden="true" style={{ maskImage: "url(" + artRoot + "/nav-" + art + ".png)" }} />
            <span className={labelClassName}>{label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function BellroadRack({ state }: { state: string }) {
  return (
    <span className={styles.rack} data-state={state} aria-hidden="true">
      <span className={styles.bay}><span className={styles.lamp} /></span>
      <span className={styles.bay}><span className={`${styles.lamp} ${styles.pulse}`} /></span>
    </span>
  );
}

export function BellroadHouse() {
  return <img className={styles.house} src={artRoot + "/bellroad-sprite.webp"} alt="" width="456" height="153" />;
}

export function BellroadPageHeader({ scene, children }: { scene: Scene; children: ReactNode }) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageCopy}>{children}</div>
      <img className={styles.pageScene} src={artRoot + "/scene-" + scenes[scene] + ".webp"} alt="" width="144" height="88" />
    </header>
  );
}

export function BellroadComposer({ children }: { children: ReactNode }) {
  return (
    <div className={styles.composer}>
      <img className={styles.milley} src={artRoot + "/milley.webp"} alt="" />
      <div className={styles.composerBody}>{children}</div>
      <img className={styles.agnes} src={artRoot + "/agnes.webp"} alt="" />
      <img className={styles.otis} src={artRoot + "/otis.webp"} alt="" />
    </div>
  );
}
