// AGEN-251 (Gap 1): last-scan recency + results for the Portals page.
//
// Two sources feed "when did I last scan, and what did it find":
//   - data/scan-runs.tsv  — one row per non-dry CLI/manual scan (scan.mjs →
//     appendScanRunSummary). The manual "Scan for new jobs" button lands here.
//   - data/scheduled-jobs.json — per-job lastRunAt + rolesFoundCount, set by the
//     scheduled runner after each run.
//
// The read API surfaces whichever is most recent. Pure functions here; the
// route (app/api/scan-history/route.ts) wires them to the filesystem.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { readScheduledStore } from "@/lib/scheduled-jobs-store.mjs";
import { scheduledStorePath } from "@/lib/scheduled-runner-path.mjs";

/**
 * @typedef {Object} ScanRunRecord
 * @property {string} timestamp  ISO timestamp of the run.
 * @property {string} status     "completed" | "failed" | whatever scan.mjs wrote.
 * @property {number} found       Roles matched this run.
 * @property {number} newAdded    Roles newly added to the pipeline this run.
 * @property {"cli"|"scheduled"} source  Which store the run came from.
 */

/**
 * Parse data/scan-runs.tsv into the last run + a total count.
 *
 * Header-name parsing, NEVER positional: scan.mjs may append columns in later
 * versions, so a positional slice would silently miscount once the schema grows.
 * Torn rows (crash mid-append) and rows with a bad timestamp are skipped. Rows
 * WIDER than the header are kept, unlike stats.mjs computeRunStats: the fields
 * this feature reads all precede any appended column, and those wider rows are
 * the newest scans — discarding them is exactly the "last-scan date not
 * retained" bug this exists to fix.
 *
 * @param {string|null|undefined} content Raw scan-runs.tsv text.
 * @returns {{ lastRun: ScanRunRecord|null, totalRuns: number, driftedRows: number }}
 *   driftedRows counts rows wider than the stored header (appended columns) —
 *   still valid runs, but a signal the on-disk header predates scan.mjs's schema.
 */
export function parseScanRunHistory(content) {
  const lines = String(content ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim());
  if (lines.length < 2) return { lastRun: null, totalRuns: 0, driftedRows: 0 };

  const header = lines[0].split("\t");
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  if (idx.timestamp == null || idx.found == null) return { lastRun: null, totalRuns: 0, driftedRows: 0 };

  let lastRun = null;
  let totalRuns = 0;
  let driftedRows = 0;
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    // scan.mjs (appendScanRunSummary) writes SCAN_RUNS_HEADER only at file
    // creation and appends new counters at the END, so after an upgrade the
    // NEWEST rows are WIDER than a pre-upgrade stored header. The fields we read
    // (timestamp, status, found, new_added) all precede any appended column, so
    // a wider row is valid data — NOT drift to discard. Dropping it was the
    // AGEN-251 "Never scanned / stale date" defect. We still count it as drift
    // (the on-disk header is older than the data) so callers can flag staleness.
    if (cols.length < header.length) continue; // torn row (crash mid-append)
    const timestamp = cols[idx.timestamp] || "";
    if (!/^\d{4}-\d{2}-\d{2}/.test(timestamp)) continue; // bad timestamp
    if (cols.length > header.length) driftedRows += 1;
    const num = (name) => {
      const v = Number(cols[idx[name]]);
      return Number.isNaN(v) ? 0 : v;
    };
    totalRuns += 1;
    const record = {
      timestamp,
      status: idx.status != null ? cols[idx.status] || "completed" : "completed",
      found: num("found"),
      newAdded: idx.new_added != null ? num("new_added") : 0,
      source: "cli",
    };
    // Newest-by-timestamp, not last-in-file, so an out-of-order ledger still
    // surfaces the true most-recent scan.
    if (!lastRun || Date.parse(record.timestamp) >= Date.parse(lastRun.timestamp)) {
      lastRun = record;
    }
  }
  return { lastRun, totalRuns, driftedRows };
}

/**
 * The most recent completed scheduled run, derived from per-job lastRunAt /
 * rolesFoundCount (the fields the scheduled runner sets and job-card.tsx shows).
 *
 * @param {{ jobs?: Array<{lastRunAt?: string, rolesFoundCount?: number, lastError?: string}> }|null|undefined} store
 * @returns {ScanRunRecord|null}
 */
export function scheduledLastRun(store) {
  const jobs = store && Array.isArray(store.jobs) ? store.jobs : [];
  let best = null;
  for (const job of jobs) {
    if (!job || typeof job.lastRunAt !== "string" || !job.lastRunAt) continue;
    if (!best || Date.parse(job.lastRunAt) > Date.parse(best.lastRunAt)) best = job;
  }
  if (!best) return null;
  const found = Number.isFinite(best.rolesFoundCount) ? best.rolesFoundCount : 0;
  return {
    timestamp: best.lastRunAt,
    status: best.lastError ? "failed" : "completed",
    found,
    newAdded: found,
    source: "scheduled",
  };
}

/**
 * Return whichever record is newer. Nulls lose.
 * @param {ScanRunRecord|null} a
 * @param {ScanRunRecord|null} b
 * @returns {ScanRunRecord|null}
 */
export function mostRecent(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(b.timestamp) > Date.parse(a.timestamp) ? b : a;
}

/**
 * Read both scan sources from a resolved CAREER_OPS_ROOT and merge them into the
 * read-API shape. Read-only; one small file read per source.
 *
 * The data root is a required argument — the route resolves careerOpsRoot() (a
 * TS module that pulls in js-yaml) and passes it in, so this .mjs stays free of
 * that dependency and is unit-testable over a temp directory.
 *
 * @param {string} root Resolved data root.
 * @returns {{ lastRun: ScanRunRecord|null, totalRuns: number, driftedRows: number }}
 */
export function readScanHistory(root) {
  const tsvPath = path.join(root, "data", "scan-runs.tsv");
  const content = existsSync(tsvPath) ? readFileSync(tsvPath, "utf8") : "";
  const cli = parseScanRunHistory(content);

  let scheduled = null;
  try {
    scheduled = scheduledLastRun(readScheduledStore(scheduledStorePath(root)));
  } catch {
    // A missing or unreadable scheduled store just means no scheduled runs to
    // merge — the CLI history still stands on its own.
    scheduled = null;
  }

  return {
    lastRun: mostRecent(cli.lastRun, scheduled),
    totalRuns: cli.totalRuns,
    driftedRows: cli.driftedRows,
  };
}
