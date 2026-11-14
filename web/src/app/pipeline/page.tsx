import { Suspense } from "react";
import { careerOpsRoot, pdfReadyReportNumbers, pipelineSummary, readTrackerShape, withCloseDates, type InboxJob } from "@/lib/career-ops";
import { reportNumberFromCell } from "@/lib/apply/cv-selection.mjs";
import { appliedCvReportSet } from "@/lib/apply/applied-cv-store.mjs";
import { pendingInbox } from "@/lib/inbox-pending.mjs";
import { PipelineView } from "@/components/pipeline-view";
import { pipelineTab } from "@/lib/pipeline-navigation.mjs";
import { scorePosting } from "@/lib/core/inbox-rank.mjs";
import { applyInboxFit, loadFitTargets } from "@/lib/inbox-fit-profile.mjs";

export const dynamic = "force-dynamic"; // always read fresh local files

// Tracker tabs show the inbox only as a count, so they get the count and not
// the postings. The inbox is most of the page payload on a large pipeline.
export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;
  const onInbox = pipelineTab(tab) === "INBOX";
  const summary = pipelineSummary();
  const applications = await withCloseDates(summary.applications);
  const { inbox } = summary;
  const pending = pendingInbox(inbox);
  const fitted = onInbox ? withInboxFit(pending) : null;
  const trackerShape = readTrackerShape();
  // Tracker row numbers whose tailored CV is indexed (data/pdf-index.tsv) AND on
  // disk; the tracker's own PDF emoji can drift from what output/ really holds.
  // Rows are keyed the way /api/cv-pdf?application= resolves them: through the
  // report cell, so a row with no resolvable report never gets a dead link.
  // Skipped on the inbox tab, which has no table.
  // One manifest read for the whole table, not one per row (#6974: per-row
  // lookups took 8 s on a 5,000-row tracker).
  const cvRows: string[] = [];
  // Rows whose FROZEN resume version (the exact CV sent at apply time, AGEN-262
  // Gap 5) is on disk. Keyed on the same report number as cvRows, but resolved
  // through the applied-CV store rather than the live pdf-index, so the "· used"
  // link only appears when a real retained artifact exists — never dead.
  const appliedCvRows: string[] = [];
  if (!onInbox) {
    const rowReports = applications.flatMap((a) => {
      const report = reportNumberFromCell(a.report);
      return report !== null && report > 0 ? [{ n: a.n, report }] : [];
    });
    const ready = await pdfReadyReportNumbers(new Set(rowReports.map((r) => r.report)));
    for (const r of rowReports) if (ready.has(r.report)) cvRows.push(r.n);
    const applied = appliedCvReportSet(careerOpsRoot());
    for (const r of rowReports) if (applied.has(String(r.report))) appliedCvRows.push(r.n);
  }
  return (
    <Suspense>
      <PipelineView
        applications={applications}
        inbox={fitted ? fitted.jobs : null}
        inboxCount={pending.length}
        inboxFitError={fitted?.error ?? null}
        trackerShape={trackerShape}
        cvRows={cvRows}
        appliedCvRows={appliedCvRows}
      />
    </Suspense>
  );
}

function withInboxFit(jobs: InboxJob[]): { jobs: InboxJob[]; error: string | null } {
  return applyInboxFit(jobs, loadFitTargets, (job, targets) => ({
    ...job,
    fit: scorePosting({
      title: job.role,
      location: job.location ?? "",
      pay: job.compensation ?? "",
      rankStamp: job.rankStamp ?? null,
    }, targets),
  }));
}
