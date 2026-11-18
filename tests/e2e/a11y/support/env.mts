/**
 * A jsdom page built from the REAL apps/web/index.html (lang, title, viewport), installed as the
 * globals the React app expects. Import this module FIRST, before React or any component.
 * jsdom has no layout engine: nothing here can check real colours, sizes or visual order.
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "../../../..");
export const WEB = join(ROOT, "apps/web");
register(pathToFileURL(join(here, "css-hook.mjs")));

const toolRequire = createRequire(join(here, "../package.json"));
// jsdom ships no type declarations and adding @types/jsdom is not needed for this narrow use.
interface JsdomWindow { document: Document; close(): void; [k: string]: any }
const { JSDOM } = toolRequire("jsdom") as { JSDOM: new (html: string, options: object) => { window: JsdomWindow } };
export const webRequire = createRequire(join(WEB, "package.json"));

export const indexHtml = readFileSync(join(WEB, "index.html"), "utf8").replace(/<script[^>]*><\/script>/g, "");

export function installDom(url = "http://127.0.0.1:5173/"): InstanceType<typeof JSDOM> {
  const dom = new JSDOM(indexHtml, { url, pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window as unknown as Record<string, unknown>;
  const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  for (const k of ["window", "document", "navigator", "location", "history", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Node", "Element", "Event", "KeyboardEvent", "MouseEvent", "InputEvent", "FocusEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CustomEvent", "DocumentFragment", "SVGElement", "Text"]) {
    define(k, k === "window" ? dom.window : w[k]);
  }
  define("IS_REACT_ACT_ENVIRONMENT", true);
  return dom;
}
