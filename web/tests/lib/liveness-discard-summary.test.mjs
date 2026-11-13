import { test } from "node:test";
import assert from "node:assert/strict";
import { discardSummary } from "../../src/lib/home/liveness-discard-summary.mjs";

// AGEN-252: the Today tab's "Discard expired" control. The route answers with
// { dryRun, planned, applied, errors, unreadable }; this helper turns that into
// the one line the button shows and a flag for whether there is anything to act
// on. The safety story lives in the CLI (confirmed-dead only); here we only make
// sure a dry-run never *claims* a write, and that "nothing expired" reads as a
// calm all-clear rather than an error.

test("a dry-run with expired rows offers them without claiming a write happened", () => {
  const s = discardSummary({
    dryRun: true,
    planned: [{ num: 1, company: "Acme", role: "Engineer", url: "u1" }],
    applied: [],
    errors: [],
    unreadable: [],
  });
  assert.equal(s.actionable, true);
  assert.equal(s.plannedCount, 1);
  assert.equal(s.appliedCount, 0);
  assert.match(s.message, /1 expired/i);
  assert.doesNotMatch(s.message, /discarded/i); // nothing was written yet
});

test("a dry-run with nothing expired is a calm all-clear, not an error", () => {
  const s = discardSummary({ dryRun: true, planned: [], applied: [], errors: [], unreadable: [] });
  assert.equal(s.actionable, false);
  assert.equal(s.plannedCount, 0);
  assert.equal(s.tone, "clear");
  assert.match(s.message, /no expired/i);
});

test("after apply, it reports what was actually discarded", () => {
  const s = discardSummary({
    dryRun: false,
    planned: [{ num: 1, company: "Acme", role: "Engineer", url: "u1" }],
    applied: [{ num: 1, company: "Acme", role: "Engineer", url: "u1" }],
    errors: [],
    unreadable: [],
  });
  assert.equal(s.appliedCount, 1);
  assert.equal(s.tone, "done");
  assert.match(s.message, /discarded 1/i);
});

test("surfaces per-row failures without swallowing them", () => {
  const s = discardSummary({
    dryRun: false,
    planned: [{ num: 1, company: "Acme", role: "Engineer", url: "u1" }],
    applied: [],
    errors: [{ num: 1, url: "u1", reason: "tracker locked" }],
    unreadable: [],
  });
  assert.equal(s.errorCount, 1);
  assert.equal(s.tone, "error");
  assert.match(s.message, /1 posting could not be discarded/i);
});

test("malformed or empty input never throws and reads as nothing-to-do", () => {
  for (const bad of [null, undefined, {}, { planned: 7, applied: "x" }]) {
    const s = discardSummary(bad);
    assert.equal(s.actionable, false);
    assert.equal(s.plannedCount, 0);
    assert.equal(s.appliedCount, 0);
    assert.equal(s.errorCount, 0);
  }
});
