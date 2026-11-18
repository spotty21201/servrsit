import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTitle, onAnnounce, resetPageTitleState, setPageTitle } from "./pageTitle";

test("titles are descriptive and end with the product name", () => {
  assert.equal(formatTitle("Plan review: Update packages on Nabire"), "Plan review: Update packages on Nabire · ServrSit");
  assert.equal(formatTitle("  "), "ServrSit");
});

test("the first title of a page load is silent; later changes are announced once each", () => {
  resetPageTitleState();
  const heard: string[] = [];
  onAnnounce((m) => heard.push(m));
  const doc = { title: "ServrSit" };
  setPageTitle("Sign in", true, doc);
  assert.equal(doc.title, "Sign in · ServrSit");
  assert.deepEqual(heard, []);
  setPageTitle("Sign in", true, doc); // same title: nothing new to say
  setPageTitle("Sign in: enter your code", true, doc);
  assert.equal(doc.title, "Sign in: enter your code · ServrSit");
  assert.deepEqual(heard, ["Navigated to Sign in: enter your code"]);
});

test("loading placeholders set the title but are never spoken, and do not use up the silent first title", () => {
  resetPageTitleState();
  const heard: string[] = [];
  onAnnounce((m) => heard.push(m));
  const doc = { title: "" };
  setPageTitle("Loading the plan", false, doc);
  assert.equal(doc.title, "Loading the plan · ServrSit");
  setPageTitle("Plan review: Update packages on Nabire", true, doc);
  assert.deepEqual(heard, []); // this was the first announced title of the load
  setPageTitle("Approvals paused", true, doc);
  assert.deepEqual(heard, ["Navigated to Approvals paused"]);
});
