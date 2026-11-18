import { installDom, webRequire } from "./env.mts";

export interface Mounted { container: HTMLElement; unmount(): Promise<void> }
type Act = (fn: () => void | Promise<void>) => Promise<void>;

let reactApi: { createElement: Function; act: Act; createRoot: (el: Element) => { render(n: unknown): void; unmount(): void } } | null = null;
function react() {
  if (reactApi) return reactApi;
  const React = webRequire("react");
  const { createRoot } = webRequire("react-dom/client");
  reactApi = { createElement: React.createElement, act: React.act, createRoot };
  return reactApi!;
}

export async function mount(path: string, element: () => unknown): Promise<Mounted> {
  const dom = installDom(`http://127.0.0.1:5173${path}`);
  const r = react();
  const container = dom.window.document.getElementById("root")!;
  const root = r.createRoot(container);
  await r.act(async () => { root.render(element()); });
  return { container, unmount: async () => { await r.act(async () => { root.unmount(); }); dom.window.close(); } };
}

export const act = (fn: () => void | Promise<void>) => react().act(fn);
export const h = (...a: unknown[]) => (react().createElement as Function)(...a);

/** Let promises, timers and effects settle. */
export async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}
export async function waitFor(cond: () => boolean, what: string, timeout = 3000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for: ${what}`);
    await act(async () => { await new Promise((r) => setTimeout(r, 15)); });
  }
}

// ---- user actions (React listens to native events; value must go through the native setter)
export async function type(el: HTMLInputElement, text: string): Promise<void> {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => { setter.call(el, text); el.dispatchEvent(new window.Event("input", { bubbles: true })); });
}
export async function click(el: Element): Promise<void> { await act(async () => { (el as HTMLElement).click(); }); }
export const $ = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
export const byText = (sel: string, text: RegExp | string): HTMLElement | undefined =>
  $$(sel).find((e) => (typeof text === "string" ? (e.textContent ?? "").trim() === text : text.test(e.textContent ?? "")));
