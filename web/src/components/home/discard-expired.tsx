"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { discardSummary } from "@/lib/home/liveness-discard-summary.mjs";

type Summary = ReturnType<typeof discardSummary>;

// AGEN-252: "Discard expired" — the one-tap retirement of dead postings the
// project owner kept finding in Evaluated. On mount it asks the route for a
// DRY RUN (writes nothing) so the button only appears when something is
// actually expired; the click opts into the write ({ dryRun: false }). The
// confirmed-dead-only guarantee lives in check-liveness.mjs, not here.
export function DiscardExpired({ onChanged }: { onChanged?: () => void }): React.JSX.Element | null {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (dryRun: boolean): Promise<Summary | null> => {
    const res = await fetch("/api/liveness/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(typeof body?.error === "string" ? body.error : "The liveness check failed.");
    }
    return discardSummary(body);
  };

  // Probe once on mount. A failed probe simply leaves the control hidden — it is
  // a convenience, and there is nothing for the user to act on yet. Errors on a
  // user-initiated discard (below) are surfaced, never swallowed.
  useEffect(() => {
    let live = true;
    call(true)
      .then((s) => {
        if (live) setSummary(s);
      })
      .catch(() => {
        if (live) setSummary(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const discard = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await call(false);
      setSummary(s);
      if (s && s.appliedCount > 0) onChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "The liveness check failed.");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return <p className="mb-2 text-xs text-red-700 dark:text-red-400">{error}</p>;
  }
  // A completed run (tone "done"/"error") reports its outcome; an all-clear
  // dry-run shows nothing so the section stays quiet when nothing is expired.
  if (summary?.tone === "done") {
    return <p className="mb-2 text-xs text-muted">{summary.message}</p>;
  }
  if (!summary?.actionable) return null;

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
      <p className="text-xs text-amber-800 dark:text-amber-400">{summary.message}</p>
      <button
        type="button"
        disabled={busy}
        onClick={discard}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-500/40 px-2.5 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-500/10 disabled:opacity-60 dark:text-amber-300 max-sm:min-h-[44px]"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Discard expired
      </button>
    </div>
  );
}
