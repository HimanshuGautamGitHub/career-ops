// tests/lib/draft-flush.test.mjs — AGEN-261 (Gap 4)
//
// Reproduces the Stage-4 PE root cause: in Pipeline > Find roles > Discover
// (free), a "Roles to find" title typed into the KeywordField but never
// committed to a chip (no blur / Enter / separator) stayed in local draft
// state, so `filters.positive` reached /api/explore EMPTY. buildTitleFilter
// then ran in match-everything mode and surfaced the ATS directory's dominant
// tech/sales postings instead of the user's HR targets.
//
// The fix extracts KeywordField's commit semantics into a pure flush helper the
// provider runs at the start of discover(), merging any pending draft into the
// filter arrays before the request is assembled. These tests pin that helper.

import { test } from "node:test";
import assert from "node:assert/strict";

import { flushDraftsIntoFilters, DRAFT_FIELDS } from "../../src/lib/draft-flush.mjs";

const baseFilters = () => ({
  positive: [],
  negative: [],
  allow: [],
  alwaysAllow: [],
  block: [],
  blockHard: [],
});

test("flushes a pending HR 'Roles to find' draft into positive (the PE scenario)", () => {
  const filters = baseFilters();
  const next = flushDraftsIntoFilters(filters, { positive: "Talent Management" });
  assert.deepEqual(next.positive, ["Talent Management"]);
});

test("without the draft, positive stays empty — the reported bug's precondition", () => {
  // This is what reached the scanner before the fix: the draft never merged, so
  // positive was [] and the title filter matched everything.
  const filters = baseFilters();
  assert.deepEqual(filters.positive, []);
});

test("appends the draft to already-committed chips without dropping them", () => {
  const filters = { ...baseFilters(), positive: ["Succession Planning"] };
  const next = flushDraftsIntoFilters(filters, { positive: "Leadership Development" });
  assert.deepEqual(next.positive, ["Succession Planning", "Leadership Development"]);
});

test("mirrors KeywordField commit(): splits on item separators, not bare spaces", () => {
  const next = flushDraftsIntoFilters(baseFilters(), {
    positive: "Talent Management, Succession Planning",
  });
  assert.deepEqual(next.positive, ["Talent Management", "Succession Planning"]);
});

test("flushes drafts across multiple fields in one pass without clobbering", () => {
  const next = flushDraftsIntoFilters(baseFilters(), {
    positive: "Talent Management",
    negative: "Sales",
  });
  assert.deepEqual(next.positive, ["Talent Management"]);
  assert.deepEqual(next.negative, ["Sales"]);
});

test("returns the SAME object when no draft has content (callers skip a no-op onChange)", () => {
  const filters = baseFilters();
  assert.equal(flushDraftsIntoFilters(filters, {}), filters);
  assert.equal(flushDraftsIntoFilters(filters, { positive: "   " }), filters);
  assert.equal(flushDraftsIntoFilters(filters, undefined), filters);
});

test("does not mutate the input filters (immutability)", () => {
  const filters = baseFilters();
  flushDraftsIntoFilters(filters, { positive: "Talent Management" });
  assert.deepEqual(filters.positive, []);
});

test("case-insensitive de-dupe against existing chips (cleanChips semantics)", () => {
  const filters = { ...baseFilters(), positive: ["Talent Management"] };
  const next = flushDraftsIntoFilters(filters, { positive: "talent management" });
  assert.deepEqual(next.positive, ["Talent Management"]);
});

test("DRAFT_FIELDS covers every KeywordField-backed array in the filter form", () => {
  assert.deepEqual(
    [...DRAFT_FIELDS].sort(),
    ["allow", "alwaysAllow", "block", "blockHard", "negative", "positive"].sort(),
  );
});
