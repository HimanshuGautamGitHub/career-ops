"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { pageFrameWidthClass } from "@/components/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { instrumentSerif } from "@/lib/fonts";
import { actionsFor, prefillPct, stateMeta } from "@/lib/apply-queue-ui.mjs";
import type { QueueItem, TransitionPatch } from "@/lib/apply-queue";

type Tone = "good" | "warn" | "bad" | "info" | "muted";
type Variant = "primary" | "outline" | "ghost" | "secondary";

type QueueAction = {
  to: string;
  label: string;
  tone: Variant;
  attest?: boolean;
  requireReason?: boolean;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function ApplyReviewView({ id }: { id: string }) {
  const [item, setItem] = useState<QueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  const [blockReason, setBlockReason] = useState("");

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apply-queue/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (res.status === 404) throw new Error("This application is no longer in the queue.");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setItem((await res.json()) as QueueItem);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this application.");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [id]);

  async function runAction(action: QueueAction) {
    setActionError(null);
    if (action.attest && !attested) {
      setActionError("Please confirm you submitted the application yourself.");
      return;
    }
    if (action.requireReason && !blockReason.trim()) {
      setActionError("Add a short reason before blocking this application.");
      return;
    }
    const patch: TransitionPatch = { to: action.to as QueueItem["state"] };
    if (action.attest) patch.attestation = { submittedByUser: true };
    if (action.requireReason) patch.reason = blockReason.trim();

    setPending(action.to);
    try {
      const res = await fetch(`/api/apply-queue/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Update failed (${res.status})`);
      }
      setItem((await res.json()) as QueueItem);
      setAttested(false);
      setBlockReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update this application.");
    } finally {
      setPending(null);
    }
  }

  const backLink = (
    <Link
      href="/apply-queue"
      className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" /> Apply review
    </Link>
  );

  if (loading) {
    return (
      <div className={`mx-auto px-5 py-8 md:px-8 ${pageFrameWidthClass.default}`}>
        {backLink}
        <div className="mt-6 h-64 animate-pulse rounded-2xl border border-border bg-surface/40" aria-busy="true" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className={`mx-auto px-5 py-8 md:px-8 ${pageFrameWidthClass.default}`}>
        {backLink}
        <div role="alert" className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">Could not load this application</p>
          <p className="mt-1 text-xs text-muted">{error}</p>
          <button
            type="button"
            onClick={() => void loadData()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-medium text-brand-foreground shadow"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" /> Try again
          </button>
        </div>
      </div>
    );
  }

  const meta = stateMeta(item.state);
  const actions = actionsFor(item.state) as QueueAction[];
  const pct = prefillPct(item.prefill);
  const knockouts = item.prefill?.knockoutFlags ?? [];
  const hasAttest = actions.some((a) => a.attest);
  const hasBlock = actions.some((a) => a.requireReason);

  return (
    <div className={`mx-auto px-5 py-8 md:px-8 space-y-6 ${pageFrameWidthClass.default}`}>
      {backLink}

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className={`${instrumentSerif.className} text-3xl text-foreground`}>{item.company}</h1>
            <Badge tone={meta.tone as Tone}>{meta.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{item.role}</p>
        </div>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground shadow transition-colors hover:bg-brand-200"
          >
            <ExternalLink className="size-4" aria-hidden="true" /> Open application form
          </a>
        ) : null}
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-soft p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-text" aria-hidden="true" />
        <p className="text-sm text-foreground">
          career-ops prepared this application but will not send it. Open the form, submit it yourself,
          then record it below.
        </p>
      </div>

      {knockouts.length > 0 ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">Knockout questions to check</h2>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-muted">
            {knockouts.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-surface/40 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Prefill</h2>
          <span className="text-xs tabular-nums text-muted">
            {item.prefill?.fieldsReady ?? 0}/{item.prefill?.fieldsTotal ?? 0} fields · {pct}%
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-hover">
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          {item.reportNum ? <Field label="Report" value={item.reportNum} /> : null}
          {item.atsVendor ? <Field label="ATS" value={item.atsVendor} /> : null}
          {item.artifacts?.cvPath ? <Field label="CV used" value={item.artifacts.cvPath} /> : null}
          {item.artifacts?.coverPath ? <Field label="Cover letter" value={item.artifacts.coverPath} /> : null}
        </dl>
        {item.blockReason ? (
          <p className="mt-4 rounded-lg bg-surface-hover px-3 py-2 text-xs text-muted">
            <span className="font-medium text-foreground">Blocked:</span> {item.blockReason}
          </p>
        ) : null}
      </section>

      {actions.length > 0 ? (
        <section className="rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-sm font-semibold text-foreground">Record what you did</h2>
          {hasAttest ? (
            <label className="mt-3 flex items-start gap-2.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                className="mt-0.5 size-4 rounded border-border accent-brand"
              />
              <span>I opened the application form and submitted it myself.</span>
            </label>
          ) : null}
          {hasBlock ? (
            <div className="mt-3">
              <label htmlFor="block-reason" className="text-xs font-medium text-faint">
                Reason (required to block)
              </label>
              <input
                id="block-reason"
                type="text"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="e.g. waiting on a referral, needs a portfolio link"
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              />
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.to}
                variant={action.tone}
                size="sm"
                disabled={pending !== null}
                onClick={() => void runAction(action)}
              >
                {pending === action.to ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {action.label}
              </Button>
            ))}
          </div>
          {actionError ? (
            <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-400">
              {actionError}
            </p>
          ) : null}
        </section>
      ) : null}

      {item.history?.length > 0 ? (
        <section className="rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-sm font-semibold text-foreground">History</h2>
          <ol className="mt-3 space-y-2">
            {[...item.history].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`} className="flex items-center gap-2 text-xs text-muted">
                <FileText className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
                <span className="tabular-nums">{new Date(h.at).toLocaleString()}</span>
                <span className="text-faint">·</span>
                <span>
                  {stateMeta(h.from).label} <span className="text-faint">→</span> {stateMeta(h.to).label}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
