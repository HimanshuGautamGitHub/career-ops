"use client";

import { useEffect, useState, type ReactElement } from "react";
import { Clock, History, Loader2 } from "lucide-react";

// AGEN-251 (Gap 1): surface when the portals were last scanned and what that
// scan found, so the page answers "is this list fresh?" at a glance. Reads the
// read-only GET /api/scan-history (CLI scan-runs.tsv merged with the scheduled
// store, most-recent wins).

type ScanRun = {
  timestamp: string;
  status: string;
  found: number;
  newAdded: number;
  source: "cli" | "scheduled";
};

type ScanHistory = {
  lastRun: ScanRun | null;
  totalRuns: number;
};

function formatWhen(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LastScanSummary(): ReactElement | null {
  const [history, setHistory] = useState<ScanHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/scan-history")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: ScanHistory) => {
        if (active) setHistory(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-faint">
        <Loader2 className="size-3.5 animate-spin" /> Checking last scan…
      </p>
    );
  }

  // A failed read shouldn't eat the page — the portal list below still stands.
  if (failed) return null;

  const lastRun = history?.lastRun ?? null;

  if (!lastRun) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <History className="size-4 text-faint" />
        Never scanned — run a scan to start tracking new roles.
      </p>
    );
  }

  const matches = lastRun.newAdded;
  const matchLabel =
    matches > 0
      ? `${matches} new ${matches === 1 ? "match" : "matches"} found`
      : "No new matches";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="flex items-center gap-2 text-muted">
        <Clock className="size-4 text-faint" />
        Last scanned {formatWhen(lastRun.timestamp)}
      </span>
      <span className="text-faint">·</span>
      <span
        className={
          matches > 0
            ? "font-medium text-emerald-800 dark:text-emerald-400"
            : "text-muted"
        }
      >
        {matchLabel}
      </span>
      {lastRun.status === "failed" && (
        <>
          <span className="text-faint">·</span>
          <span className="text-rose-600 dark:text-rose-400">last scan failed</span>
        </>
      )}
    </div>
  );
}
