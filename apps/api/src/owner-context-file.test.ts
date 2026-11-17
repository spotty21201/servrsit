import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_OWNER_CONTEXT_PATH, OwnerContextFile } from "./owner-context-file.js";

function logger() {
  const lines: Array<{ level: string; obj: object; msg: string }> = [];
  return {
    lines,
    text: () => JSON.stringify(lines),
    info: (obj: object, msg: string) => lines.push({ level: "info", obj, msg }),
    warn: (obj: object, msg: string) => lines.push({ level: "warn", obj, msg }),
  };
}

test("the shipped assistant-context.md loads and is logged by size only", () => {
  const log = logger();
  const text = new OwnerContextFile(DEFAULT_OWNER_CONTEXT_PATH, [], log).get();
  assert.ok(text !== null && text.includes("## Voice"));
  assert.match(log.lines.at(-1)!.msg, /owner context loaded/);
  assert.equal(log.text().includes("Spotty"), false, "the file's text is never logged");
});

test("a secret in the file: no owner context, a warning, and the secret is not logged", () => {
  const file = join(mkdtempSync(join(tmpdir(), "servrsit-oc-")), "assistant-context.md");
  writeFileSync(file, "## Owner\nSpotty\npassword=hunter2-real-value\n");
  const log = logger();
  assert.equal(new OwnerContextFile(file, [], log).get(), null);
  const warn = log.lines.find((l) => l.level === "warn");
  assert.match(warn?.msg ?? "", /REJECTED/);
  assert.equal(log.text().includes("hunter2"), false);
});

test("missing file: none; edited file: re-read on change; unchanged: not re-read", () => {
  const dir = mkdtempSync(join(tmpdir(), "servrsit-oc-"));
  const file = join(dir, "assistant-context.md");
  const log = logger();
  const src = new OwnerContextFile(file, [], log);
  assert.equal(src.get(), null);
  writeFileSync(file, "## Owner\nFirst version\n");
  assert.match(src.get() ?? "", /First version/);
  const loads = log.lines.filter((l) => l.msg === "owner context loaded").length;
  src.get();
  assert.equal(log.lines.filter((l) => l.msg === "owner context loaded").length, loads, "not re-read when unchanged");
  writeFileSync(file, "## Owner\nSecond, longer version\n");
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.match(src.get() ?? "", /Second, longer version/);
});

test("a known secret value (the configured API key) in the file rejects it", () => {
  const file = join(mkdtempSync(join(tmpdir(), "servrsit-oc-")), "assistant-context.md");
  writeFileSync(file, "## Owner\nplainvaluewithnoprefix0123456789\n");
  assert.equal(new OwnerContextFile(file, ["plainvaluewithnoprefix0123456789"], logger()).get(), null);
});
