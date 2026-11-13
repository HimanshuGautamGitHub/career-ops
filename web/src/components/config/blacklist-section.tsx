"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

// Editor for data/blacklist.md — the user's do-not-apply list (USER-LAYER,
// opt-in). Reads and writes through /api/blacklist, which owns the atomic file
// write and preserves any prose the user wrote around the table. A blacklist
// entry is a hard gate on the scanner and apply flow, never a scoring signal.

type Entry = {
  company: string;
  since: string;
  scope: string;
  reason: string;
};

type Scope = "company" | "domain";

const LABEL = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-muted";
const INPUT =
  "w-full rounded-xl border border-border bg-surface/50 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-faint focus:border-brand/50 max-sm:min-h-[44px]";

export function BlacklistSection() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState("");
  const [scope, setScope] = useState<Scope>("company");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/blacklist")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (Array.isArray(d?.entries)) setEntries(d.entries);
      })
      .catch(() => {
        /* an unreadable list must not break the settings screen */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function addEntry() {
    setError(null);
    const name = company.trim();
    if (!name) {
      setError("Enter a company or domain to block.");
      return;
    }
    if (name.includes("|") || reason.includes("|")) {
      setError("The '|' character isn't allowed — it would corrupt the list.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: name, scope, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Could not add to the blacklist.");
        return;
      }
      if (Array.isArray(data?.entries)) setEntries(data.entries);
      setCompany("");
      setReason("");
      setScope("company");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: Entry) {
    setError(null);
    const key = `${entry.scope}:${entry.company}`;
    setDeleting(key);
    try {
      const res = await fetch("/api/blacklist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: entry.company, scope: entry.scope }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Could not remove the entry.");
        return;
      }
      if (Array.isArray(data?.entries)) setEntries(data.entries);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section aria-labelledby="blacklist-heading" className="mt-10">
      <h2
        id="blacklist-heading"
        className="text-xs font-semibold uppercase tracking-[0.18em] text-muted"
      >
        Blacklist
      </h2>
      <p className="mt-1 mb-4 text-xs text-faint">
        Companies and domains you never want to see. Scans skip them and the apply flow stops on a
        match. Blocking never changes a score — it&apos;s an on/off gate.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading your blacklist…
        </div>
      ) : (
        <div className="space-y-5">
          {entries.length > 0 ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface/50">
              {entries.map((entry) => {
                const key = `${entry.scope}:${entry.company}`;
                return (
                  <li key={key} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {entry.company}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            entry.scope === "domain"
                              ? "bg-brand-soft text-brand-text"
                              : "bg-surface text-muted",
                          )}
                        >
                          {entry.scope}
                        </span>
                      </div>
                      {entry.reason && <p className="mt-0.5 text-xs text-muted">{entry.reason}</p>}
                      {entry.since && (
                        <p className="mt-0.5 text-[11px] text-faint">Since {entry.since}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(entry)}
                      disabled={deleting === key}
                      aria-label={`Remove ${entry.company}`}
                      className="shrink-0 rounded-lg p-2 text-muted transition-colors hover:bg-surface hover:text-red-500 disabled:opacity-50 max-sm:min-h-[44px] max-sm:min-w-[44px]"
                    >
                      {deleting === key ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-6 text-center text-sm text-muted">
              Nothing blocked yet. Add a company or domain below.
            </p>
          )}

          <div className="rounded-xl border border-border bg-surface/30 p-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div>
                <label htmlFor="bl-company" className={LABEL}>
                  Company or domain
                </label>
                <input
                  id="bl-company"
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addEntry();
                    }
                  }}
                  placeholder={scope === "domain" ? "example.com" : "Acme Corp"}
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="bl-scope" className={LABEL}>
                  Match by
                </label>
                <select
                  id="bl-scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as Scope)}
                  className={cn(INPUT, "sm:w-36")}
                >
                  <option value="company">Company name</option>
                  <option value="domain">Domain</option>
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="bl-reason" className={LABEL}>
                Reason <span className="font-normal normal-case tracking-normal text-faint">(optional)</span>
              </label>
              <input
                id="bl-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEntry();
                  }
                }}
                placeholder="Why you're skipping them"
                className={INPUT}
              />
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm text-red-500">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={addEntry}
              disabled={busy}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60 max-sm:min-h-[44px]"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {busy ? "Adding…" : "Add to blacklist"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
