import { test } from "node:test";
import assert from "node:assert/strict";
import { livenessRowStatus } from "../../src/lib/liveness-row-status.mjs";

// AGEN-252: the pipeline table shows a per-row liveness badge. The dry-run probe
// of /api/liveness/discard returns a normalized DiscardResult; this pure helper
// maps one tracker row (by its tracker number) onto a badge state so the
// component stays dumb. "dead" = the CLI confirmed the posting closed (planned
// or actually applied), "uncertain" = the CLI could not read it (unreadable),
// "active" = an Evaluated row the probe covered without flagging, null = no
// badge (non-Evaluated row, or no probe yet).

const probe = {
  planned: [{ num: 3, company: "Acme", role: "Platform Engineer", url: "https://x.test/3" }],
  applied: [],
  errors: [],
  unreadable: [{ num: 7, company: "Globex", role: "Engineer", url: "https://x.test/7" }],
};

test("flags a planned-discard row as dead", () => {
  assert.equal(livenessRowStatus({ n: "3", status: "Evaluated", url: "https://x.test/3" }, probe), "dead");
});

test("flags an applied-discard row as dead", () => {
  const applied = { ...probe, planned: [], applied: [{ num: 3, url: "https://x.test/3" }] };
  assert.equal(livenessRowStatus({ n: "3", status: "Evaluated", url: "https://x.test/3" }, applied), "dead");
});

test("flags an unreadable row as uncertain", () => {
  assert.equal(livenessRowStatus({ n: "7", status: "Evaluated", url: "https://x.test/7" }, probe), "uncertain");
});

test("an Evaluated row the probe did not flag is active", () => {
  assert.equal(livenessRowStatus({ n: "9", status: "Evaluated", url: "https://x.test/9" }, probe), "active");
});

test("an Evaluated row with no posting URL gets no badge", () => {
  assert.equal(livenessRowStatus({ n: "9", status: "Evaluated", url: "" }, probe), null);
});

test("a non-Evaluated row never gets a badge, even if the posting is dead elsewhere", () => {
  // Status gates the badge: the sweep only touches Evaluated rows, so an Applied
  // row sharing a dead posting must not be painted dead here.
  assert.equal(livenessRowStatus({ n: "3", status: "Applied", url: "https://x.test/3" }, probe), null);
});

test("no probe yet means no badge", () => {
  assert.equal(livenessRowStatus({ n: "3", status: "Evaluated", url: "https://x.test/3" }, null), null);
});

test("matches tracker number as a string, tolerating numeric probe nums", () => {
  assert.equal(livenessRowStatus({ n: "3", status: "evaluated", url: "https://x.test/3" }, probe), "dead");
});
