"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileText, Loader2, Mail, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";
import { coverDraftButtonState } from "@/lib/pdf-button-state.mjs";
import { COVER_TONES } from "@/lib/cover-tones.mjs";
import { pipelineQuery } from "@/lib/pipeline-navigation.mjs";
import { resolveCliId } from "@/lib/saved-cli";

// Fires the real career-ops `cover` mode (worker kind "cover") for THIS
// application. cover.md will not draft until the candidate answers its four
// Step 6 prompts, so the button opens those questions first. The draft lands in
// the run log. Rendering it to PDF is still the CLI's Step 9.
const QUESTIONS = [
  { name: "why", label: "Why this role or company?", hint: "One or two angles: scale, mission, stage, or what you would learn." },
  { name: "problem", label: "What problem would you solve for them?", hint: "The research step checks this against what the company says publicly." },
  { name: "approach", label: "How would you approach it on day one?", hint: "One or two sentences. This is the most specific part of the letter." },
] as const;

const fieldClass =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand/50 focus:outline-none disabled:opacity-60";

type QuestionName = (typeof QUESTIONS)[number]["name"];
type CoverBrief = Record<QuestionName, string> & { tone: string };

const EMPTY_BRIEF: CoverBrief = { why: "", problem: "", approach: "", tone: "mirror" };

// What /api/cover/suggest returns. The suggestion fills the brief fields as an
// editable starting point; the user still reviews and runs the draft (Ethical
// Use — nothing is sent). ONBOARDING_NEEDED means there is no résumé to ground
// the draft in, so we point at onboarding instead of inventing one.
type CoverSuggestResponse =
  | { success: true; data: { suggestion: { why?: string; problem?: string; approach?: string; tone?: string }; truncated: boolean } }
  | { success: false; error: string; code?: "ONBOARDING_NEEDED" };

type SuggestMessage = { kind: "error" | "onboarding"; text: string };

export function CoverDraftButton({ n, company }: { n: string; company: string }) {
  const { jobs, startJob } = useJobs();
  const listQuery = pipelineQuery(useSearchParams().toString());
  const jobQuery = listQuery ? `?${listQuery}` : "";
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<CoverBrief>(EMPTY_BRIEF);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestMsg, setSuggestMsg] = useState<SuggestMessage | null>(null);
  const job = useMemo(
    () => jobs.filter((j) => j.kind === "cover" && j.input === n).sort((a, b) => b.startedAt - a.startedAt)[0],
    [jobs, n],
  );
  const state = coverDraftButtonState(job);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    startJob({ title: `Cover letter · ${company}`, subtitle: "draft for this role", kind: "cover", input: n, page: `/pipeline/${n}`, brief });
    setOpen(false);
  };

  // Draft a FIRST PASS of the four answers from the user's own résumé + this
  // role's report, via their read-only CLI. Fills only the fields the model
  // returned; the user edits everything before the real draft runs.
  const suggest = async (): Promise<void> => {
    setSuggesting(true);
    setSuggestMsg(null);
    try {
      const cliId = await resolveCliId();
      const res = await fetch("/api/cover/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n, cliId, company }),
      });
      const data = (await res.json()) as CoverSuggestResponse;
      if (!data.success) {
        setSuggestMsg({ kind: data.code === "ONBOARDING_NEEDED" ? "onboarding" : "error", text: data.error });
        return;
      }
      const s = data.data.suggestion;
      setBrief((b) => ({
        why: s.why?.trim() || b.why,
        problem: s.problem?.trim() || b.problem,
        approach: s.approach?.trim() || b.approach,
        tone: s.tone && Object.hasOwn(COVER_TONES, s.tone) ? s.tone : b.tone,
      }));
    } catch {
      setSuggestMsg({ kind: "error", text: "Couldn't reach the suggestion service. You can still fill the fields by hand." });
    } finally {
      setSuggesting(false);
    }
  };

  if (state.kind === "running")
    return (
      <Link href={`/jobs/${state.jobId}${jobQuery}`} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-3 py-1 text-xs font-medium text-brand-text max-sm:min-h-[44px]">
        <Loader2 className="size-3.5 motion-safe:animate-spin" /> Drafting cover letter…
      </Link>
    );

  return (
    <>
      {state.kind === "ready" && job ? (
        <span className="inline-flex items-center gap-1">
          <Link
            href={`/jobs/${job.id}${jobQuery}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400 max-sm:min-h-[44px]"
          >
            <FileText className="size-3.5" /> View cover letter draft
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            title="Draft the cover letter again"
            aria-expanded={open}
            className="inline-flex items-center justify-center rounded-full p-1 text-faint transition-colors hover:text-brand-text max-sm:min-h-[44px] max-sm:min-w-[44px]"
          >
            <RotateCcw className="size-3" />
          </button>
        </span>
      ) : (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand-text max-sm:min-h-[44px]"
          title="Draft a cover letter for this role with your AI CLI"
        >
          <Mail className="size-3.5" /> Draft cover letter
        </button>
      )}
      {state.failure && (
        <Link
          href={`/jobs/${state.failure.jobId}${jobQuery}`}
          role="alert"
          title="Open the run log"
          className="inline-flex max-w-md items-start gap-1 text-xs text-red-700 hover:underline dark:text-red-400"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>Cover letter not drafted. {state.failure.reason}</span>
        </Link>
      )}
      {open && (
        <form onSubmit={submit} aria-label="Cover letter questions" className="basis-full rounded-2xl border border-border bg-surface/50 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">Answer these, or let AI draft a starting point from your résumé and this role&apos;s report. You review and edit before anything is drafted.</p>
            <button
              type="button"
              onClick={suggest}
              disabled={suggesting}
              aria-busy={suggesting}
              title="Fill these answers from your résumé and this role's report, using your AI CLI. Nothing is sent — you review and edit first."
              className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand-text transition-colors hover:bg-brand/10 disabled:opacity-60 max-sm:min-h-[44px]"
            >
              {suggesting ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : <Sparkles className="size-3.5" />}
              {suggesting ? "Suggesting…" : "Suggest with AI"}
            </button>
          </div>
          <div aria-live="polite" className="mb-3 empty:mb-0">
            {suggestMsg?.kind === "onboarding" && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {suggestMsg.text}{" "}
                  <Link href="/cv" className="font-medium underline">Add your résumé</Link>.
                </span>
              </p>
            )}
            {suggestMsg?.kind === "error" && (
              <p role="alert" className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{suggestMsg.text}</span>
              </p>
            )}
          </div>
          {QUESTIONS.map((q) => (
            <label key={q.name} className="mb-3 block text-sm font-medium text-foreground">
              {q.label}
              <span className="block text-xs font-normal text-muted">{q.hint}</span>
              <textarea
                name={q.name}
                required
                maxLength={1000}
                rows={2}
                value={brief[q.name]}
                onChange={(e) => setBrief((b) => ({ ...b, [q.name]: e.target.value }))}
                disabled={suggesting}
                className={fieldClass}
              />
            </label>
          ))}
          <label className="mb-4 block text-sm font-medium text-foreground">
            Tone
            <select
              name="tone"
              value={brief.tone}
              onChange={(e) => setBrief((b) => ({ ...b, tone: e.target.value }))}
              disabled={suggesting}
              className={fieldClass}
            >
              {Object.entries(COVER_TONES).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={suggesting} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground shadow-sm transition-colors hover:bg-brand-200 disabled:opacity-60 max-sm:min-h-[44px]">
              <Mail className="size-3.5" /> Draft letter
            </button>
            <CostBadge kind="spend" size="xs" />
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-brand-text max-sm:min-h-[44px]">
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  );
}
