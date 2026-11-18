import { test } from "node:test";
import assert from "node:assert/strict";
import { previewStateFrom } from "./fixtureState";

test("only 'loading' and 'error' are recognised; anything else is the normal fixture", () => {
  assert.equal(previewStateFrom("?state=loading"), "loading");
  assert.equal(previewStateFrom("?state=error"), "error");
  for (const s of ["", "?state=ok", "?state=", "?state=ERROR", "?x=loading", "?state=loading%20"]) assert.equal(previewStateFrom(s), null, s);
});
