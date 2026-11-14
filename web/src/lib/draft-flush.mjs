// draft-flush.mjs — AGEN-261 (Gap 4).
//
// Pure JS (no TypeScript types) so it can be imported directly by both
// explore filter components (.tsx) and by draft-flush.test.mjs, which can't
// import a .ts module without a runner — the same arrangement clean-chips.mjs
// uses.
//
// A KeywordField (filter-builder.tsx) holds text the user has typed but not yet
// committed to a chip in local `draft` state. It is only committed on blur /
// Enter / an item separator. If the user types a "Roles to find" title and
// clicks Discover before that commit lands, the draft never reaches
// `filters.positive`, so the scan runs with an empty positive list and
// buildTitleFilter falls into its documented match-everything mode. That is the
// Gap 4 bug: HR targets typed in, tech/sales postings out.
//
// The provider runs flushDraftsIntoFilters() at the start of discover(), before
// it reads the filters ref, so any pending draft is merged into the filter
// arrays first. The merge mirrors KeywordField's commit() exactly: split on
// UNAMBIGUOUS item separators (comma / newline / semicolon / tab), never bare
// spaces (multi-word entries like "Talent Management" stay one chip), then
// cleanChips to trim and de-dupe.

import { cleanChips } from "./clean-chips.mjs";

/**
 * The ExploreFilters array fields a KeywordField can hold an uncommitted draft
 * for — one per chip input in the filter form (filter-builder.tsx).
 * @type {readonly string[]}
 */
export const DRAFT_FIELDS = Object.freeze([
  "positive",
  "negative",
  "allow",
  "alwaysAllow",
  "block",
  "blockHard",
]);

// Mirror KeywordField.commit(): split only on comma / newline / semicolon / tab
// / carriage-return, never bare spaces (#1147).
const ITEM_SEPARATORS = /[,\n;\t\r]+/;

/**
 * Merge any pending (typed-but-not-committed) KeywordField drafts into the
 * filter arrays. Returns the SAME filters object when no draft has content, so
 * the caller can skip a no-op onChange; otherwise returns a new object with the
 * affected fields replaced (the input is never mutated).
 *
 * @template {Record<string, unknown>} F
 * @param {F} filters - current ExploreFilters
 * @param {Record<string, string> | undefined | null} drafts - per-field draft text
 * @returns {F}
 */
export function flushDraftsIntoFilters(filters, drafts) {
  if (!drafts) return filters;
  let next = filters;
  for (const field of DRAFT_FIELDS) {
    const text = drafts[field];
    if (typeof text !== "string" || !text.trim()) continue;
    const parts = text.split(ITEM_SEPARATORS);
    const existing = Array.isArray(next[field]) ? next[field] : [];
    next = { ...next, [field]: cleanChips([...existing, ...parts]) };
  }
  return next;
}
