/**
 * apply-queue-ui.mjs
 *
 * Pure presentation helpers for the apply-review UI: per-state labels/tones and
 * the user-facing review actions for each state. Kept as a plain .mjs so
 * `node --test` can pin the actions to the store's state machine — the UI must
 * never offer a transition the server would reject, and the one attested action
 * (the user confirming THEY submitted) must be the only path to SUBMITTED.
 */

export const STATE_META = Object.freeze({
  QUEUED: { label: "Queued", tone: "muted" },
  PREFILLED: { label: "Prefilled", tone: "info" },
  NEEDS_REVIEW: { label: "Needs review", tone: "warn" },
  BLOCKED: { label: "Blocked", tone: "bad" },
  SUBMITTED: { label: "Submitted", tone: "good" },
  APPLIED: { label: "Applied", tone: "good" },
  DISCARDED: { label: "Discarded", tone: "muted" },
  ARCHIVED: { label: "Archived", tone: "muted" },
});

export function stateMeta(state) {
  return STATE_META[state] ?? { label: state ?? "Unknown", tone: "muted" };
}

// Actions surfaced in the review UI per state. `attest: true` marks the single
// action that requires the user to confirm they performed the submission
// themselves; the server rejects it without { submittedByUser: true }.
const ACTIONS = Object.freeze({
  QUEUED: [{ to: "DISCARDED", label: "Discard", tone: "ghost" }],
  PREFILLED: [
    { to: "SUBMITTED", label: "I submitted this myself", tone: "primary", attest: true },
    { to: "NEEDS_REVIEW", label: "Flag for changes", tone: "outline" },
    { to: "BLOCKED", label: "Block", tone: "outline", requireReason: true },
    { to: "DISCARDED", label: "Discard", tone: "ghost" },
  ],
  NEEDS_REVIEW: [
    { to: "SUBMITTED", label: "I submitted this myself", tone: "primary", attest: true },
    { to: "PREFILLED", label: "Mark ready", tone: "outline" },
    { to: "BLOCKED", label: "Block", tone: "outline", requireReason: true },
    { to: "DISCARDED", label: "Discard", tone: "ghost" },
  ],
  BLOCKED: [
    { to: "QUEUED", label: "Unblock", tone: "outline" },
    { to: "DISCARDED", label: "Discard", tone: "ghost" },
  ],
  SUBMITTED: [
    { to: "APPLIED", label: "Confirm applied", tone: "outline" },
    { to: "ARCHIVED", label: "Archive", tone: "ghost" },
  ],
  APPLIED: [{ to: "ARCHIVED", label: "Archive", tone: "ghost" }],
  DISCARDED: [],
  ARCHIVED: [],
});

export function actionsFor(state) {
  return ACTIONS[state] ?? [];
}

/** Percent of prefilled fields ready (0 when nothing is known). */
export function prefillPct(prefill) {
  if (!prefill || !prefill.fieldsTotal) return 0;
  return Math.round((prefill.fieldsReady / prefill.fieldsTotal) * 100);
}

/** Ordering for the list view: things needing attention first. */
export const STATE_ORDER = Object.freeze([
  "NEEDS_REVIEW",
  "PREFILLED",
  "QUEUED",
  "BLOCKED",
  "SUBMITTED",
  "APPLIED",
  "DISCARDED",
  "ARCHIVED",
]);
