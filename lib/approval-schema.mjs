/**
 * approval-schema.mjs — INTERFACE STUB (architecture handoff, AGEN-202).
 *
 * This file is the single source of truth for the approval-queue data model:
 * the category table (loaded from templates/approval-categories.yml), the
 * stable id minter, the inbox-line (de)serializer, and the ledger-row
 * (de)serializer. It is PURE (no file I/O of the queue/ledger themselves) so it
 * can be imported by the writer (agent-inbox.mjs), the ledger (lib/approval-log.mjs),
 * and the reader (dashboard / web).
 *
 * The backend stage implements the bodies. Signatures, typedefs, and the three
 * load-bearing INVARIANTS are fixed here so backend and frontend start without
 * a follow-up. Priority ORDERING is delegated to lib/inbox-rank.mjs and is NOT
 * re-implemented here (see orderApprovals in agent-inbox.mjs).
 *
 * Mirrors the states.yml / set-status.mjs discipline: closed vocabulary parsed
 * from one yml, `-` sentinels for unknowns, atomic newline-safe ledger append
 * via tracker-utils.appendLedgerRows.
 */

// Reserved for the real implementation (reader for the taxonomy yml):
// import { readFileSync } from 'fs';

/**
 * @typedef {'submit'|'borderline'|'message'|'resume'|'profile'|'targeting'} ApprovalCategory
 * @typedef {'form-submit'|'email'|'linkedin'|'file'|'none'} ApprovalSink
 * @typedef {'self-submitted'|'approved'|'edited'|'rejected'|'deferred'|'pursue'|'discard'} ApprovalResolution
 * @typedef {'queued'|'approved'|'edited'|'rejected'|'deferred'|'pursue'|'discard'|'self-submitted'|'superseded'} LedgerEvent
 * @typedef {'user'|'agent'|'dashboard'|'cron'} LedgerActor
 */

/**
 * One parked approval. The inbox line is a lean PROJECTION of this; the full
 * history lives in the ledger. `id` is the join key across both.
 *
 * @typedef {Object} ApprovalItem
 * @property {string}            id          Stable opaque id, `apr_<8 hex>`. Minted once at queue time.
 * @property {ApprovalCategory}  category    Closed vocabulary from approval-categories.yml.
 * @property {string}            headline    One human line (company — role, or the fact/targeting summary).
 * @property {string}            ref         Artifact pointer: report number, output/ path, tracker #, or user-file path.
 * @property {string|null}       sha         sha256 of the exact bytes to approve (null for BORDERLINE / no-artifact).
 * @property {ApprovalSink}      sink        Where it goes if approved — the "what crosses a boundary" audit axis.
 * @property {string}            producer    Mode that queued it (apply, pdf, cover, ...).
 * @property {boolean}           batchable   Derived from the category — NEVER a free per-item field. false iff category==='submit'.
 * @property {string}            queuedAt    Local stamp, same clock as agent-inbox stamp().
 * @property {string|null}       sourceProv  For PROFILE: the claim's source (document / user-stated date / derived-unverified).
 */

/**
 * One append-only ledger row. Mirrors status-log.tsv:
 *   id \t ts \t event \t category \t producer \t sink \t ref \t sha \t actor \t note
 * Unknown cells are `-` (never empty). The reader skips a malformed line quietly.
 *
 * @typedef {Object} LedgerRow
 * @property {string}       id
 * @property {string}       ts
 * @property {LedgerEvent}  event
 * @property {ApprovalCategory|'general'} category
 * @property {string}       producer
 * @property {ApprovalSink} sink
 * @property {string}       ref
 * @property {string}       sha
 * @property {LedgerActor}  actor
 * @property {string}       note
 */

/** Closed vocabulary — validated on every write, skipped-with-warning on read. */
export const LEDGER_EVENTS = Object.freeze([
  'queued', 'approved', 'edited', 'rejected', 'deferred',
  'pursue', 'discard', 'self-submitted', 'superseded',
]);
export const LEDGER_ACTORS = Object.freeze(['user', 'agent', 'dashboard', 'cron']);

/** Events that constitute an APPROVAL (a thing crossing a boundary or a fact changing). */
export const APPROVING_EVENTS = Object.freeze(['approved', 'edited', 'self-submitted', 'pursue']);

/**
 * Load + freeze the category table from templates/approval-categories.yml.
 * @param {string} ymlPath
 * @returns {Map<ApprovalCategory, object>}
 */
export function loadApprovalCategories(/* ymlPath */) {
  throw new Error('approval-schema: not implemented (AGEN-202 handoff stub)');
}

/** Mint a collision-resistant, parallel-safe id. No central counter (avoids the #749 race). */
export function mintApprovalId(/* rng = randomBytes */) {
  throw new Error('approval-schema: not implemented (AGEN-202 handoff stub)');
}

/**
 * Serialize an ApprovalItem into ONE agent-inbox checklist line whose leading
 * `- [ ] <stamp> — ` prefix is byte-identical to a legacy item, so the existing
 * agent-inbox.mjs parser and tests see it as an ordinary checklist item. The
 * category tag + minimal meta live INSIDE the existing free-text field:
 *   - [ ] 2026-11-11 14:30 — [SUBMIT] Acme — Senior ML Engineer {id=apr_1a2b3c4d ref=042 sink=form-submit}
 * @param {ApprovalItem} item
 * @returns {string}
 */
export function serializeInboxLine(/* item */) {
  throw new Error('approval-schema: not implemented (AGEN-202 handoff stub)');
}

/**
 * Parse the meta out of a checklist line's free-text field. A line with no
 * `[CATEGORY]` tag parses as the GENERAL lane (legacy intent) — never throws.
 * @param {string} text  The capture after `- [ ] <stamp> — `.
 * @returns {{category: ApprovalCategory|'general', headline: string, id: string|null, meta: object}}
 */
export function parseInboxText(/* text */) {
  throw new Error('approval-schema: not implemented (AGEN-202 handoff stub)');
}

/** TSV-encode a LedgerRow (tabs stripped from free cells; `-` for unknowns). */
export function serializeLedgerRow(/* row */) {
  throw new Error('approval-schema: not implemented (AGEN-202 handoff stub)');
}

// ───────────────────────── INVARIANTS (the ethical boundary, in code) ─────────────────────────

/**
 * INVARIANT 1 — SUBMIT is never batchable.
 * `batchable` is derived from the category, never trusted from an item.
 * @param {ApprovalCategory} category
 * @returns {boolean}
 */
export function isBatchable(category) {
  return category !== 'submit';
}

/**
 * INVARIANT 2 — a batch/multi-select approve must refuse if it touches SUBMIT.
 * Loud failure, in the --expect-guard spirit. Backend calls this before any
 * multi-item disposition.
 * @param {ApprovalItem[]} items
 * @throws if any item is category 'submit'
 */
export function assertBatchApprovable(items) {
  const bad = (items || []).filter((i) => i && i.category === 'submit');
  if (bad.length) {
    throw new Error(
      `refusing batch approve: ${bad.length} SUBMIT item(s) must each be confirmed individually ` +
      `(ids: ${bad.map((i) => i.id).join(', ')}). You submit applications yourself, one at a time.`,
    );
  }
}

/**
 * INVARIANT 3 — an approving ledger event must be actor=user, and SUBMIT may
 * only be approved via `self-submitted` (never `approved`, never an automated sink).
 * The agent may write `queued` / `superseded`; it may NEVER write an approving event.
 * @param {Pick<LedgerRow,'event'|'actor'|'category'>} row
 * @throws if the row would record a machine-made approval
 */
export function assertLedgerRowLegal(row) {
  if (!LEDGER_EVENTS.includes(row.event)) throw new Error(`unknown ledger event: ${row.event}`);
  if (!LEDGER_ACTORS.includes(row.actor)) throw new Error(`unknown ledger actor: ${row.actor}`);
  if (APPROVING_EVENTS.includes(row.event) && row.actor !== 'user') {
    throw new Error(`approving event '${row.event}' requires actor=user, got '${row.actor}' — nothing auto-approves`);
  }
  if (row.category === 'submit' && row.event === 'approved') {
    throw new Error(`SUBMIT has no 'approved' resolution — the user attests 'self-submitted'; the system never submits`);
  }
}
