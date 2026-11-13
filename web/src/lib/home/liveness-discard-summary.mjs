// AGEN-252: turn POST /api/liveness/discard's answer into the one line the
// Today tab's "Discard expired" control shows, plus the flags it needs to pick a
// tone and decide whether there is anything to act on. Pure and here so it is
// testable without React (see tests/lib/liveness-discard-summary.test.mjs).
//
// The confirmed-dead-only guarantee is the CLI's, not this helper's. The only
// honesty rule enforced here: a dry-run never says "discarded" — it offers, it
// does not claim a write that has not happened.

const count = (value) => (Array.isArray(value) ? value.length : 0);

/**
 * @typedef {{ actionable: boolean, tone: "clear"|"ready"|"done"|"error",
 *   plannedCount: number, appliedCount: number, errorCount: number,
 *   unreadableCount: number, message: string }} DiscardSummary
 */

/**
 * @param {unknown} result the parsed /api/liveness/discard response body
 * @returns {DiscardSummary}
 */
export function discardSummary(result) {
  const r = result && typeof result === "object" ? result : {};
  const dryRun = r.dryRun !== false;
  const plannedCount = count(r.planned);
  const appliedCount = count(r.applied);
  const errorCount = count(r.errors);
  const unreadableCount = count(r.unreadable);

  const suffix = unreadableCount > 0 ? ` (${unreadableCount} couldn't be checked)` : "";

  // An error on a write attempt is the loudest state — a row we meant to retire
  // and could not.
  if (errorCount > 0) {
    const noun = errorCount === 1 ? "posting" : "postings";
    return summary("error", false, {
      plannedCount,
      appliedCount,
      errorCount,
      unreadableCount,
      message: `${errorCount} ${noun} could not be discarded${suffix}.`,
    });
  }

  if (!dryRun) {
    const noun = appliedCount === 1 ? "posting" : "postings";
    return summary("done", false, {
      plannedCount,
      appliedCount,
      errorCount,
      unreadableCount,
      message: appliedCount > 0
        ? `Discarded ${appliedCount} expired ${noun}${suffix}.`
        : `No expired postings to discard${suffix}.`,
    });
  }

  // Dry-run: offer what is ready, or report an all-clear.
  if (plannedCount > 0) {
    const noun = plannedCount === 1 ? "posting" : "postings";
    return summary("ready", true, {
      plannedCount,
      appliedCount,
      errorCount,
      unreadableCount,
      message: `${plannedCount} expired ${noun} ready to discard${suffix}.`,
    });
  }
  return summary("clear", false, {
    plannedCount,
    appliedCount,
    errorCount,
    unreadableCount,
    message: `No expired postings${suffix}.`,
  });
}

function summary(tone, actionable, rest) {
  return { tone, actionable, ...rest };
}
