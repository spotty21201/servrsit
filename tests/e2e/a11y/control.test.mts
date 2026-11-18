/** Positive control: if axe can't see known problems in this jsdom setup, "no violations" elsewhere means nothing. */
import test from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./support/env.mts";
import { runAxe } from "./support/axe.mts";

test("control: axe in this jsdom setup reports known-bad markup", async () => {
  const dom = installDom();
  document.getElementById("root")!.innerHTML = `
    <img src="x.png">
    <input type="text" id="a">
    <button></button>
    <a href="#"></a>
    <ul role="log"><li>one</li></ul>
    <h3>skipped level</h3>
    <div id="dup"></div><div id="dup"></div>
    <select><option>1</option></select>
    <p aria-label="named paragraph">text</p>`;
  const r = await runAxe();
  const ids = new Set(r.violations.map((v) => v.id));
  for (const want of ["image-alt", "label", "button-name", "link-name", "listitem"]) assert.ok(ids.has(want), `axe did not report ${want}; got ${[...ids].join(", ")}`);
  assert.ok(r.passes > 5);
  dom.window.close();
});
