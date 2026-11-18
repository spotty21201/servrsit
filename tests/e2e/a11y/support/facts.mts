/** Plain DOM facts about the rendered page, computed independently of axe. */
export interface Tabbable { tag: string; type: string | null; name: string; visibleText: string; disabled: boolean }
export interface Facts {
  title: string; lang: string | null;
  h1: string[]; headings: { level: number; text: string }[];
  mains: number; banners: number; navs: (string | null)[];
  tabbables: Tabbable[]; positiveTabindex: string[]; skipLink: string | null;
  live: { role: string | null; live: string | null; text: string }[];
  active: string; unnamed: string[]; nameMismatch: string[]; brokenRefs: string[]; noAutocomplete: string[];
  placeholderOnly: string[]; bodyText: string;
}
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const hiddenByAria = (el: Element) => !!el.closest("[aria-hidden='true'], [hidden]");

function visibleText(el: Element): string {
  let out = "";
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.textContent ?? "";
    else if (n.nodeType === 1) { const e = n as Element; if (e.getAttribute("aria-hidden") === "true" || e.hasAttribute("hidden")) return; e.childNodes.forEach(walk); }
  };
  el.childNodes.forEach(walk);
  return norm(out);
}
export function accessibleName(el: Element): string {
  const ids = el.getAttribute("aria-labelledby");
  if (ids) return norm(ids.split(/\s+/).map((i) => document.getElementById(i)?.textContent ?? "").join(" "));
  const al = el.getAttribute("aria-label"); if (al) return norm(al);
  if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type)) return norm(el.value);
  if ("labels" in el && (el as HTMLInputElement).labels?.length) return norm([...(el as HTMLInputElement).labels!].map((l) => l.textContent).join(" "));
  if (["BUTTON", "A", "SUMMARY"].includes(el.tagName) || el.getAttribute("role") === "button") { const t = visibleText(el); if (t) return t; }
  return norm(el.getAttribute("title"));
}
const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className ? "." + String((el as HTMLElement).className).split(" ")[0] : ""}`;

export function collectFacts(): Facts {
  const q = (s: string) => [...document.querySelectorAll<HTMLElement>(s)];
  const tabbableEls = q("a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]").filter((e) => !hiddenByAria(e) && e.getAttribute("tabindex") !== "-1");
  const tabbables = tabbableEls.map((e) => ({ tag: e.tagName.toLowerCase(), type: e.getAttribute("type"), name: accessibleName(e), visibleText: ["BUTTON", "A", "SUMMARY"].includes(e.tagName) ? visibleText(e) : "", disabled: (e as HTMLButtonElement).disabled === true }));
  const named = tabbableEls.filter((e) => !(e as HTMLButtonElement).disabled);
  const unnamed = named.filter((e) => accessibleName(e) === "").map(describe);
  const nameMismatch = named.filter((e) => ["BUTTON", "A"].includes(e.tagName)).filter((e) => { const v = visibleText(e).toLowerCase(); return v !== "" && !accessibleName(e).toLowerCase().includes(v); }).map((e) => `${describe(e)}: visible "${visibleText(e)}" vs name "${accessibleName(e)}"`);
  const brokenRefs: string[] = [];
  for (const e of q("[aria-describedby], [aria-labelledby], [aria-controls]")) for (const a of ["aria-describedby", "aria-labelledby", "aria-controls"]) { const v = e.getAttribute(a); if (v) for (const id of v.split(/\s+/)) if (!document.getElementById(id)) brokenRefs.push(`${describe(e)} ${a}=${id}`); }
  const identity = q("input[type=text], input[type=password], input:not([type])");
  const noAutocomplete = identity.filter((e) => !e.getAttribute("autocomplete") && /user|pass|code|token/i.test(`${e.id} ${e.getAttribute("name")}`)).map(describe);
  const placeholderOnly = q("input[placeholder], textarea[placeholder]").filter((e) => accessibleName(e) === "").map(describe);
  const skip = q("a[href^='#']").find((a) => /skip/i.test(a.textContent ?? ""));
  return {
    title: document.title, lang: document.documentElement.getAttribute("lang"),
    h1: q("h1").map((e) => norm(e.textContent)),
    headings: q("h1,h2,h3,h4,h5,h6").map((e) => ({ level: Number(e.tagName[1]), text: norm(e.textContent) })),
    mains: q("main, [role=main]").length, banners: q("header, [role=banner]").length,
    navs: q("nav, [role=navigation]").map((e) => e.getAttribute("aria-label")),
    tabbables, positiveTabindex: q("[tabindex]").filter((e) => Number(e.getAttribute("tabindex")) > 0).map(describe),
    skipLink: skip ? norm(skip.textContent) : null,
    live: q("[role=alert], [role=status], [aria-live]").map((e) => ({ role: e.getAttribute("role"), live: e.getAttribute("aria-live"), text: norm(e.textContent).slice(0, 80) })),
    active: document.activeElement ? describe(document.activeElement) : "none",
    unnamed, nameMismatch, brokenRefs, noAutocomplete, placeholderOnly, bodyText: norm(document.body.textContent),
  };
}
