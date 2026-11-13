import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluationRecency, STALE_AFTER_DAYS } from "../../src/lib/evaluation-recency.mjs";

// AGEN-252: the Today tab shows how long ago each awaiting-decision role was
// evaluated, and flags the ones gone stale (the project owner had two roles
// sitting Evaluated long enough that the postings closed underneath them).
// `today` is injected so the test is deterministic; the component passes the
// real clock.
const TODAY = "2026-11-13";

test("prefers the date in the report filename over the tracker date column", () => {
  const r = evaluationRecency({ date: "2026-01-01", report: "[1](reports/001-acme-2026-11-03.md)" }, TODAY);
  assert.equal(r.lastEvaluated, "2026-11-03");
  assert.equal(r.daysAgo, 10);
  assert.equal(r.stale, false);
});

test("falls back to the tracker date column when the report link carries no date", () => {
  const r = evaluationRecency({ date: "2026-11-10", report: "—" }, TODAY);
  assert.equal(r.lastEvaluated, "2026-11-10");
  assert.equal(r.daysAgo, 3);
  assert.equal(r.stale, false);
});

test("flags a role evaluated longer ago than the stale threshold", () => {
  const old = evaluationRecency({ date: "2026-09-01", report: "[1](reports/001-acme-2026-09-01.md)" }, TODAY);
  assert.equal(old.daysAgo, 73);
  assert.equal(old.stale, true);
  // the boundary: exactly STALE_AFTER_DAYS ago is not yet stale, one day past is.
  const boundary = evaluationRecency({ date: `2026-10-14`, report: "—" }, TODAY);
  assert.equal(boundary.daysAgo, STALE_AFTER_DAYS);
  assert.equal(boundary.stale, false);
});

test("no parseable date anywhere yields a null recency, never a crash or a false 'stale'", () => {
  const r = evaluationRecency({ date: "", report: "" }, TODAY);
  assert.equal(r.lastEvaluated, null);
  assert.equal(r.daysAgo, null);
  assert.equal(r.stale, false);
});
