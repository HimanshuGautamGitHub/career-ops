"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, RefreshCw, ShieldCheck, SendHorizonal } from "lucide-react";
import { pageFrameWidthClass } from "@/components/page-frame";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { instrumentSerif } from "@/lib/fonts";
import { actionsFor, prefillPct, STATE_ORDER, stateMeta } from "@/lib/apply-queue-ui.mjs";
import type { QueueItem } from "@/lib/apply-queue";

type Tone = "good" | "warn" | "bad" | "info" | "muted";

function orderIndex(state: string): number {
  const i = STATE_ORDER.indexOf(state);
  return i === -1 ? STATE_ORDER.length : i;
}

function ItemRow({ item }: { item: QueueItem }) {
  const meta = stateMeta(item.state);
  const pct = prefillPct(item.prefill);
  const knockouts = item.prefill?.knockoutFlags ?? [];
  const needsReview = item.state === "NEEDS_REVIEW" || item.state === "PREFILLED";
  return (
    <li>
      <Link
        href={`/apply-queue/${encodeURIComponent(item.id)}`}
        className="co-rise flex items-center gap-4 rounded-xl border border-border bg-surface/40 p-4 transition-colors hover:border-brand/30 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{item.company}</span>
            <Badge tone={meta.tone as Tone}>{meta.label}</Badge>
            {knockouts.length > 0 ? (
              <Badge tone="bad">
                {knockouts.length} knockout{knockouts.length === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">{item.role}</p>
        </div>
        {item.prefill?.fieldsTotal ? (
          <div className="hidden w-28 shrink-0 sm:block" aria-hidden="true">
            <div className="flex items-center justify-between text-[11px] text-faint">
              <span>Prefilled</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-hover">
              <div
                className={cn("h-full rounded-full", needsReview ? "bg-brand" : "bg-emerald-500")}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : null}
        <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden="true" />
      </Link>
    </li>
  );
}

export function ApplyQueueView() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/apply-queue", { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = (await res.json()) as { items?: QueueItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the apply queue.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          orderIndex(a.state) - orderIndex(b.state) ||
          Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      ),
    [items],
  );
  const awaiting = useMemo(
    () => items.filter((i) => actionsFor(i.state).some((a: { attest?: boolean }) => a.attest)).length,
    [items],
  );

  return (
    <div className={`mx-auto px-5 py-8 md:px-8 space-y-6 ${pageFrameWidthClass.default}`}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <SendHorizonal className="size-6 text-brand-text" aria-hidden="true" />
            <h1 className={`${instrumentSerif.className} text-3xl text-foreground`}>Apply Review</h1>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            Applications the agents prepared, ready for you to review. {awaiting > 0 ? `${awaiting} waiting on you.` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-60"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" /> Refresh
        </button>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-soft p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-text" aria-hidden="true" />
        <p className="text-sm text-foreground">
          <span className="font-semibold">career-ops never submits an application for you.</span> Each item
          here is prefilled and waiting. You open the form, submit it yourself, then confirm it here.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading apply queue">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-surface/40" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">Could not load the apply queue</p>
          <p className="mt-1 text-xs text-muted">{error}</p>
          <button
            type="button"
            onClick={() => void loadData()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-medium text-brand-foreground shadow"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" /> Try again
          </button>
        </div>
      ) : sorted.length === 0 ? (
        <div role="status" className="rounded-2xl border border-dashed border-border p-12 text-center">
          <SendHorizonal className="mx-auto size-8 text-faint" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold text-foreground">Nothing to review</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted">
            When the agents prepare an application from a high-fit match, it lands here for your review
            before anything is sent.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {sorted.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
