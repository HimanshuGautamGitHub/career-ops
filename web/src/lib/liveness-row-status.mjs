// AGEN-252: map one tracker row onto a per-row liveness badge state from the
// dry-run probe of /api/liveness/discard. Pure and here so the pipeline table
// stays dumb and this is testable without React (see
// tests/lib/liveness-row-status.test.mjs).
//
// Safety mirrors the CLI: the sweep only touches Evaluated rows, so a row in any
// other status never gets a liveness badge here — an Applied row that happens to
// share a dead posting URL must not be painted dead. "dead" comes only from the
// CLI's confirmed-dead decision (planned/applied), never inferred locally.

/**
 * @typedef {{ n?: string, status?: string, url?: string }} TrackerRowLike
 * @typedef {{ num: number }} ProbeRow
 * @typedef {{ planned?: ProbeRow[], applied?: ProbeRow[], errors?: unknown[], unreadable?: ProbeRow[] }} DiscardProbe
 */

function hasNum(list, num) {
  return Array.isArray(list) && list.some((entry) => entry && String(entry.num) === num);
}

/**
 * @param {TrackerRowLike} row a tracker row (the web Application shape)
 * @param {DiscardProbe | null | undefined} probe normalized /api/liveness/discard result
 * @returns {"dead" | "uncertain" | "active" | null}
 */
export function livenessRowStatus(row, probe) {
  if (!probe || typeof probe !== "object") return null;
  const status = String(row?.status ?? "").trim().toLowerCase();
  if (status !== "evaluated") return null;
  const num = String(row?.n ?? "").trim();
  if (!num) return null;
  if (hasNum(probe.planned, num) || hasNum(probe.applied, num)) return "dead";
  if (hasNum(probe.unreadable, num)) return "uncertain";
  // Evaluated, probe-covered, unflagged: live — but only if the row actually has
  // a posting URL the sweep could have checked. A URL-less Evaluated row was
  // never in the probe's scope, so it gets no claim.
  if (String(row?.url ?? "").trim()) return "active";
  return null;
}
