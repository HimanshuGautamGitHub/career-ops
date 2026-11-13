"use client";

import { useEffect, useState } from "react";

/**
 * The normalized DiscardResult the /api/liveness/discard route returns, reduced
 * to the fields a per-row badge needs. Rows are keyed by tracker number.
 */
export interface LivenessProbe {
  planned: { num: number }[];
  applied: { num: number }[];
  errors: unknown[];
  unreadable: { num: number }[];
}

/**
 * Dry-run probe of /api/liveness/discard, run once on mount. Returns the
 * normalized result for per-row liveness badges, or null until it resolves. A
 * dry run writes nothing — the confirmed-dead-only write stays behind the
 * explicit "Discard expired" action. A failed probe stays null: badges are a
 * convenience, never a gate, so nothing is surfaced to act on.
 */
export function useLivenessProbe(): LivenessProbe | null {
  const [probe, setProbe] = useState<LivenessProbe | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/liveness/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (live && body && typeof body === "object") setProbe(body as LivenessProbe);
      })
      .catch(() => {
        if (live) setProbe(null);
      });
    return () => {
      live = false;
    };
  }, []);
  return probe;
}
