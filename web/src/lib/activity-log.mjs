/**
 * activity-log.mjs
 *
 * Read-only reader for the daily activity log that powers the activity
 * dashboard (AGEN-187 / FORK_SAFE_AUTOMATION.md §4.2).
 *
 * Contract:
 *   Path:  {dataRoot}/data/activity/YYYY-MM-DD.ndjson  (one file per local day)
 *   Event: { ts: ISO8601, source, kind, summary, ref: { reportNum?, queueId?, url? } }
 *
 * The pure logic lives in this .mjs so `node --test` can exercise it directly
 * (mirrors apply-queue-store.mjs / scheduled-jobs-store.mjs). This module only
 * READS — the event emitters (scheduled-scan, email-import, apply-queue, etc.)
 * are a separate backend concern and write these files; the dashboard never
 * writes them.
 */

import fs from "node:fs";
import path from "node:path";

// Closed vocabulary of known sources (FORK_SAFE_AUTOMATION.md §4.2). Unknown
// sources are tolerated gracefully and bucketed under "other" rather than
// dropped — an emitter added later must still surface in the feed.
export const ACTIVITY_SOURCES = Object.freeze([
  "scheduled-scan",
  "email-import",
  "apply-queue",
  "gap-plan",
  "evaluation",
]);

const SOURCES_SET = new Set(ACTIVITY_SOURCES);
const NDJSON_EXT = ".ndjson";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `v` is a calendar date string `YYYY-MM-DD` that actually exists. */
export function isActivityDate(v) {
  return (
    typeof v === "string" &&
    DATE_RE.test(v) &&
    Number.isFinite(Date.parse(`${v}T00:00:00Z`))
  );
}

/**
 * Resolve the activity log directory under a data root.
 * `CAREER_OPS_ACTIVITY_DIR` overrides (absolute, or relative to the root).
 */
export function activityDirPath(root, configured = process.env.CAREER_OPS_ACTIVITY_DIR) {
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(root, configured);
  }
  return path.join(root, "data", "activity");
}

/** Path to a single day's NDJSON file. Throws on an invalid date (no traversal). */
export function dayFilePath(dir, date) {
  if (!isActivityDate(date)) {
    throw new Error(`invalid activity date "${date}" (expected YYYY-MM-DD)`);
  }
  return path.join(dir, `${date}${NDJSON_EXT}`);
}

function normalizeRef(ref) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return {};
  const out = {};
  if (typeof ref.reportNum === "string" || typeof ref.reportNum === "number") {
    out.reportNum = String(ref.reportNum);
  }
  if (typeof ref.queueId === "string" && ref.queueId) out.queueId = ref.queueId;
  if (typeof ref.url === "string" && ref.url) out.url = ref.url;
  return out;
}

/**
 * Parse one NDJSON line into an ActivityEvent, or null when the line is blank
 * or malformed. A malformed line never throws — a single corrupt write must
 * not blank the whole day.
 *
 * @param {string} line
 * @param {string} date  The day file this line came from (fallback ts).
 */
export function parseEventLine(line, date) {
  const trimmed = typeof line === "string" ? line.trim() : "";
  if (!trimmed) return null;

  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;

  const ts =
    typeof obj.ts === "string" && Number.isFinite(Date.parse(obj.ts)) ? obj.ts : null;
  const kind = typeof obj.kind === "string" ? obj.kind : "";
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const source = typeof obj.source === "string" && obj.source ? obj.source : "unknown";

  // An event with no timestamp, kind, or summary carries no information.
  if (!ts && !kind && !summary) return null;

  return {
    ts: ts ?? `${date}T00:00:00.000Z`,
    source,
    knownSource: SOURCES_SET.has(source),
    kind,
    summary,
    ref: normalizeRef(obj.ref),
    date,
  };
}

/**
 * Read a single day's events, newest first. Returns [] when the file is absent
 * (a day with no activity is not an error).
 */
export function readDay(dir, date) {
  const file = dayFilePath(dir, date);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const events = [];
  for (const line of raw.split("\n")) {
    const ev = parseEventLine(line, date);
    if (ev) events.push(ev);
  }
  events.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return events;
}

/** Count events per source, bucketing unknown sources under "other". */
export function countBySource(events) {
  const out = {};
  for (const ev of events) {
    const key = ev.knownSource ? ev.source : "other";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * List available day strings (`YYYY-MM-DD`), newest first. Returns [] when the
 * directory does not exist yet (nothing has been logged).
 */
export function listActivityDays(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  return names
    .filter((n) => n.endsWith(NDJSON_EXT) && isActivityDate(n.slice(0, -NDJSON_EXT.length)))
    .map((n) => n.slice(0, -NDJSON_EXT.length))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/**
 * Read a range of days, grouped per day and newest-day first. `from`/`to` are
 * inclusive `YYYY-MM-DD` bounds; omit either to leave that side open. Days with
 * no file are skipped. Each group carries its events and per-source counts.
 *
 * @param {string} dir
 * @param {string | null} [from]
 * @param {string | null} [to]
 * @returns {{ date: string, count: number, bySource: Record<string, number>, events: object[] }[]}
 */
export function readRange(dir, from = null, to = null) {
  if (from && !isActivityDate(from)) throw new Error(`invalid "from" date "${from}"`);
  if (to && !isActivityDate(to)) throw new Error(`invalid "to" date "${to}"`);

  return listActivityDays(dir)
    .filter((d) => (!from || d >= from) && (!to || d <= to))
    .map((date) => {
      const events = readDay(dir, date);
      return { date, count: events.length, bySource: countBySource(events), events };
    });
}
