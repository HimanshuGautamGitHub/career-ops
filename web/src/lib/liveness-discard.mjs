// AGEN-252: the mapping POST /api/liveness/discard applies to the JSON object
// `check-liveness.mjs --tracker --discard-expired --json` prints. Kept pure and
// here so it is testable without spawning the CLI (see
// tests/lib/liveness-discard.test.mjs).
//
// The confirmed-dead-only safety guarantee is NOT this file's job: the CLI
// decides what is expired and never plans a live posting for discard
// (tests/liveness-core.test.mjs). This normalizer only shapes what the CLI
// already decided into the HTTP contract, and keeps one honesty invariant:
// `applied` is a row the CLI actually WROTE, never one it merely planned.

/**
 * @typedef {{ num: number, company: string, role: string, url: string }} DiscardRow
 * @typedef {{ num: number, url: string, reason: string }} DiscardError
 * @typedef {{ planned: DiscardRow[], applied: DiscardRow[], errors: DiscardError[], unreadable: DiscardRow[] }} DiscardResult
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toRow(entry) {
  return { num: entry.num, company: entry.company, role: entry.role, url: entry.url };
}

/**
 * @param {unknown} cli the parsed stdout object from check-liveness.mjs --json
 * @returns {DiscardResult}
 */
export function normalizeDiscardResult(cli) {
  const source = cli && typeof cli === "object" ? cli : {};
  const planned = asArray(source.planned).map(toRow);
  const results = asArray(source.results);
  // A real write: the row changed AND it was not a dry-run. In dry-run every
  // result carries dryRun:true (changed:true there means "would change"), so
  // applied is empty and the UI never claims a write that did not happen.
  const applied = results
    .filter((r) => r && r.changed === true && r.dryRun === false)
    .map(toRow);
  // Genuine per-row failures the CLI surfaced (e.g. a locked tracker). A
  // `skipped` row — one that moved out of Evaluated between plan and write — is
  // a benign safety no-op, not an error: it shows as planned-but-not-applied.
  const errors = results
    .filter((r) => r && r.error)
    .map((r) => ({ num: r.num, url: r.url, reason: r.error }));
  // Confirmed-uncertain postings the CLI could not verify. Passed through so the
  // UI can say "couldn't check N" without ever discarding them.
  const unreadable = asArray(source.unreadable).map(toRow);
  return { planned, applied, errors, unreadable };
}
