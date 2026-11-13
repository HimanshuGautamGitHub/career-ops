// Pure JS implementation of the roleType / workSetup fold (AGEN-254) — no
// TypeScript types so it can be imported directly by BOTH explore.ts (the
// client/server Explorer codec, which re-exports it with types) AND the
// scheduled-jobs-runner.mjs, which runs in production as plain `node` with no
// bundler and so cannot import explore.ts. This is the single source of truth
// for the fold and its keyword maps; duplicating them in the runner would let
// the two scan paths drift.

import { cleanChips } from "./clean-chips.mjs";

/** Keywords a RoleType injects into title_filter.positive. The value itself is
 *  the default; multi-word / ambiguous families get hand-picked substrings. */
export const ROLE_TYPE_KEYWORDS = {
  intern: ["intern"],
  junior: ["junior"],
  mid: ["mid-level", "mid level"],
  senior: ["senior"],
  staff: ["staff"],
  principal: ["principal"],
  lead: ["lead"],
  manager: ["manager"],
  director: ["director"],
  vp: ["vice president", "vp"],
  "c-level": ["chief", "cto", "ceo", "cfo"],
};

/** Location allow-list entries a WorkSetup adds. "onsite" is the absence of a
 *  remote/hybrid signal, so it adds nothing — the location allow/block already
 *  governs it. */
export const WORK_SETUP_ALLOW = {
  remote: ["Remote", "Worldwide"],
  hybrid: ["Hybrid"],
  onsite: [],
};

/** Fold the coarse roleType/workSetup axes into the scanner's keyword/location
 *  lists (AGEN-249 contract). roleType APPENDS seniority keywords to positive;
 *  workSetup APPENDS allow-list entries. Both are additive — the user's explicit
 *  chips always survive — idempotent, and case-insensitively de-duped via
 *  cleanChips. Returns a new object; the input is never mutated. positive/allow
 *  default to [] so a partial (e.g. a legacy persisted job) folds safely. */
export function expandFiltersForScan(f) {
  const roleType = Array.isArray(f.roleType) ? f.roleType : [];
  const workSetup = Array.isArray(f.workSetup) ? f.workSetup : [];
  if (!roleType.length && !workSetup.length) return f;
  const basePositive = Array.isArray(f.positive) ? f.positive : [];
  const baseAllow = Array.isArray(f.allow) ? f.allow : [];
  const positive = roleType.length
    ? cleanChips([...basePositive, ...roleType.flatMap((r) => ROLE_TYPE_KEYWORDS[r] ?? [r])])
    : f.positive;
  const allow = workSetup.length
    ? cleanChips([...baseAllow, ...workSetup.flatMap((w) => WORK_SETUP_ALLOW[w] ?? [])])
    : f.allow;
  return { ...f, positive, allow };
}
