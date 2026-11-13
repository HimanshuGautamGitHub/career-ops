// AGEN-252: how long ago a tracker row was last evaluated, for the Today tab's
// recency indicator and stale flag. Pure and here so it is testable with an
// injected clock (see tests/lib/evaluation-recency.test.mjs).

// A role sitting in Evaluated longer than this is "stale" — old enough that the
// posting may have closed underneath it (the exact case this feature exists for).
export const STALE_AFTER_DAYS = 30;

const ISO_DATE = /(\d{4}-\d{2}-\d{2})/;
const MS_PER_DAY = 86_400_000;

function parseIsoDay(value) {
  const match = typeof value === "string" ? value.match(ISO_DATE) : null;
  if (!match) return null;
  const ms = Date.parse(`${match[1]}T00:00:00Z`);
  return Number.isNaN(ms) ? null : { day: match[1], ms };
}

/**
 * @param {{ date?: string, report?: string }} app a tracker row
 * @param {string} today an ISO YYYY-MM-DD day, injected for determinism
 * @returns {{ lastEvaluated: string | null, daysAgo: number | null, stale: boolean }}
 */
export function evaluationRecency(app, today) {
  // The report file is named at evaluation time with its own date, so it is the
  // truer "last evaluated" signal; the tracker Date column is the fallback.
  const evaluated = parseIsoDay(app?.report) ?? parseIsoDay(app?.date);
  const now = parseIsoDay(today);
  if (!evaluated || !now) return { lastEvaluated: evaluated?.day ?? null, daysAgo: null, stale: false };
  const daysAgo = Math.floor((now.ms - evaluated.ms) / MS_PER_DAY);
  return { lastEvaluated: evaluated.day, daysAgo, stale: daysAgo > STALE_AFTER_DAYS };
}
