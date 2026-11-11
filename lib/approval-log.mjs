/**
 * approval-log.mjs — the approval queue's append-only provenance ledger.
 *
 * Mirrors set-status.mjs → status-log.tsv exactly: a sibling TSV of the live
 * file, append-only, closed vocabulary, newline-safe atomic append through
 * tracker-utils.appendLedgerRows. One row per transition. The inbox line is a
 * rebuildable projection; THIS is the durable record of what crossed a boundary
 * and when the user said yes (APPROVAL_QUEUE_DESIGN.md §4.2).
 *
 * Every row is validated through assertLedgerRowLegal BEFORE anything is
 * written — invariant 3 (no machine-made approval) is enforced at the sink, not
 * trusted from the caller. A malformed row read back is skipped quietly, the
 * same discipline funnel-velocity.mjs applies to status-log.tsv.
 *
 * The caller holds the pipeline lock (withPipelineLock on the inbox path), the
 * same window the inbox write happens in — this module never locks on its own,
 * so the inbox line and its `queued` row commit together.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';

import { appendLedgerRows } from '../tracker-utils.mjs';
import { serializeLedgerRow, assertLedgerRowLegal } from './approval-schema.mjs';

/** The 10 columns, in order, matching serializeLedgerRow. */
const LEDGER_COLUMNS = Object.freeze([
  'id', 'ts', 'event', 'category', 'producer', 'sink', 'ref', 'sha', 'actor', 'note',
]);

/**
 * The ledger lives beside the inbox (data/approval-log.tsv next to
 * data/agent-inbox.md), with an explicit env override for tests and relocations.
 * @param {string} inboxPath
 * @returns {string}
 */
export function resolveApprovalLogPath(inboxPath) {
  const override = process.env.CAREER_OPS_APPROVAL_LOG;
  if (override && override.trim()) return override.trim();
  return join(dirname(inboxPath), 'approval-log.tsv');
}

/**
 * Append one or more ledger rows. Validates the WHOLE batch first (invariant 3,
 * closed vocabulary) so a bad row never leaves a partial write behind, then
 * serializes and appends newline-safely.
 * @param {string} logPath
 * @param {import('./approval-schema.mjs').LedgerRow[]} rows
 */
export function appendApprovalRows(logPath, rows) {
  const list = rows || [];
  // Validate everything before touching disk — loud failure, all-or-nothing.
  for (const row of list) assertLedgerRowLegal(row);
  if (!list.length) return;
  const text = list.map(serializeLedgerRow).join('');
  appendLedgerRows(logPath, text);
}

/**
 * Read the ledger back into rows. A line without the expected column count is
 * skipped quietly (the status-log read discipline); a missing file is [].
 * @param {string} logPath
 * @returns {import('./approval-schema.mjs').LedgerRow[]}
 */
export function readApprovalLog(logPath) {
  let raw;
  try {
    raw = readFileSync(logPath, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const cells = line.split('\t');
    if (cells.length !== LEDGER_COLUMNS.length) continue; // malformed — skip quietly
    const row = {};
    LEDGER_COLUMNS.forEach((col, i) => {
      // `-` is the on-disk sentinel for an empty cell; map note/sha back to ''.
      row[col] = cells[i] === '-' && (col === 'note' || col === 'sha') ? '' : cells[i];
    });
    rows.push(row);
  }
  return rows;
}
