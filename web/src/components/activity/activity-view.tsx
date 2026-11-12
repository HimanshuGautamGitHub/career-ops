"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarSearch,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Mail,
  Radar,
  RefreshCw,
  SendHorizonal,
  Target,
} from "lucide-react";
import { pageFrameWidthClass } from "@/components/page-frame";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { instrumentSerif } from "@/lib/fonts";
import type { ActivityDay, ActivityEvent } from "@/lib/activity";

type SourceMeta = { label: string; icon: React.ReactNode };

// Known sources → label + icon. Unknown sources fall back to the generic
// Activity glyph so a later emitter still reads in the feed.
const SOURCE_META: Record<string, SourceMeta> = {
  "scheduled-scan": { label: "Scan", icon: <Radar className="size-4" /> },
  "email-import": { label: "Email import", icon: <Mail className="size-4" /> },
  "apply-queue": { label: "Apply queue", icon: <SendHorizonal className="size-4" /> },
  "gap-plan": { label: "Gap plan", icon: <Target className="size-4" /> },
  evaluation: { label: "Evaluation", icon: <ClipboardCheck className="size-4" /> },
};

function sourceMeta(source: string, known: boolean): SourceMeta {
  if (known && SOURCE_META[source]) return SOURCE_META[source];
  return { label: "Activity", icon: <Activity className="size-4" /> };
}

function dayLabel(date: string): string {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(
    yesterday.getDate(),
  ).padStart(2, "0")}`;
  if (date === todayStr) return "Today";
  if (date === yStr) return "Yesterday";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function eventTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function EventRow({ event }: { event: ActivityEvent }) {
  const meta = sourceMeta(event.source, event.knownSource);
  return (
    <li className="flex gap-3 py-3">
      <div
        className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-text"
        aria-hidden="true"
      >
        {meta.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted">{meta.label}</span>
          {event.kind ? <Badge tone="muted">{event.kind}</Badge> : null}
          <time className="ml-auto text-[11px] tabular-nums text-faint" dateTime={event.ts}>
            {eventTime(event.ts)}
          </time>
        </div>
        <p className="mt-1 text-sm text-foreground">{event.summary || "—"}</p>
        {(event.ref.reportNum || event.ref.queueId || event.ref.url) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            {event.ref.reportNum ? (
              <span className="inline-flex items-center gap-1 text-muted">
                <FileText className="size-3.5" aria-hidden="true" /> Report {event.ref.reportNum}
              </span>
            ) : null}
            {event.ref.queueId ? (
              <a
                href={`/apply-queue/${encodeURIComponent(event.ref.queueId)}`}
                className="inline-flex items-center gap-1 text-brand-text underline-offset-2 hover:underline"
              >
                <SendHorizonal className="size-3.5" aria-hidden="true" /> Review application
              </a>
            ) : null}
            {event.ref.url ? (
              <a
                href={event.ref.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-brand-text underline-offset-2 hover:underline"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" /> Posting
              </a>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

function DayGroup({ day }: { day: ActivityDay }) {
  const chips = Object.entries(day.bySource);
  return (
    <section aria-label={`Activity on ${day.date}`} className="co-rise">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border pb-2">
        <h2 className="text-sm font-semibold text-foreground">{dayLabel(day.date)}</h2>
        <span className="text-xs tabular-nums text-faint">
          {day.count} {day.count === 1 ? "event" : "events"}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {chips.map(([source, n]) => (
            <Badge key={source} tone="muted">
              {sourceMeta(source, source !== "other").label} {n}
            </Badge>
          ))}
        </div>
      </div>
      <ul className="divide-y divide-border/70">
        {day.events.map((event, i) => (
          <EventRow key={`${event.ts}-${i}`} event={event} />
        ))}
      </ul>
    </section>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="co-rise flex items-center justify-between rounded-xl border border-border bg-surface/40 p-4 shadow-sm">
      <div>
        <span className="text-xs font-medium text-muted">{label}</span>
        <div className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</div>
      </div>
      <div
        className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-text"
        aria-hidden="true"
      >
        {icon}
      </div>
    </div>
  );
}

export function ActivityView() {
  const [days, setDays] = useState<ActivityDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/activity", { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = (await res.json()) as { days?: ActivityDay[] };
      setDays(Array.isArray(data.days) ? data.days : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load activity.");
      setDays([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const totals = useMemo(() => {
    const flat = days.flatMap((d) => d.events);
    const today = days[0];
    return {
      todayCount: today?.count ?? 0,
      scans: flat.filter((e) => e.source === "scheduled-scan").length,
      prepared: flat.filter((e) => e.source === "apply-queue").length,
      evaluations: flat.filter((e) => e.source === "evaluation").length,
    };
  }, [days]);

  return (
    <div className={`mx-auto px-5 py-8 md:px-8 space-y-8 ${pageFrameWidthClass.default}`}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <Activity className="size-6 text-brand-text" aria-hidden="true" />
            <h1 className={`${instrumentSerif.className} text-3xl text-foreground`}>Daily Activity</h1>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            What the agents did on your behalf — scans run, new matches found, and applications
            prepared for your review. Nothing here was submitted automatically.
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

      {!loading && !error && days.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Most recent day" value={totals.todayCount} icon={<CalendarSearch className="size-5" />} />
          <StatCard label="Scans run" value={totals.scans} icon={<Radar className="size-5" />} />
          <StatCard label="Evaluations" value={totals.evaluations} icon={<ClipboardCheck className="size-5" />} />
          <StatCard label="Applications prepared" value={totals.prepared} icon={<SendHorizonal className="size-5" />} />
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading activity">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-surface/40" />
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center"
        >
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">Could not load activity</p>
          <p className="mt-1 text-xs text-muted">{error}</p>
          <button
            type="button"
            onClick={() => void loadData()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-medium text-brand-foreground shadow"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" /> Try again
          </button>
        </div>
      ) : days.length === 0 ? (
        <div role="status" className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Activity className="mx-auto size-8 text-faint" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold text-foreground">No activity yet</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted">
            Once scheduled scans, email imports, or application prep run, each day&apos;s work shows
            up here as a timeline. Nothing is logged until the agents do something on your behalf.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {days.map((day) => (
            <DayGroup key={day.date} day={day} />
          ))}
        </div>
      )}
    </div>
  );
}
