import { careerOpsRoot, findApplication, readReport } from "@/lib/career-ops";
import { reportNumberFor } from "@/lib/apply-checklist.mjs";
import { resolveTailoredCv } from "@/lib/apply/cv";
import { freezeAppliedCv } from "@/lib/apply/applied-cv-store.mjs";

/**
 * Freeze the tailored CV an application is about to be sent with, at the moment
 * the tracker row transitions into "Applied" (AGEN-262, Gap 5 / AGEN-256 Item D).
 *
 * The live `output/` PDF is supersede-on-regenerate and gitignored; this call
 * snapshots the exact bytes into the content-addressed, user-layer store so the
 * version sent survives a later regenerate. It resolves the SAME tailored PDF
 * the apply flow uploads (`resolveTailoredCv`) and keys the snapshot on the
 * SAME report number the tracker row maps to (`reportNumberFor`), so the read
 * route and the pipeline affordance resolve the identical snapshot.
 *
 * Best-effort and no-fabrication: returns null (never throws, never invents a
 * snapshot) when the row has no report number or no tailored CV on disk. The
 * caller treats null as "nothing to freeze" and must never fail the status
 * write on it.
 *
 * @param id tracker application number (the row's `#`)
 */
export async function freezeAppliedCvForApplication(
  id: string,
): Promise<{ file: string; sha: string; created: boolean } | null> {
  const app = findApplication(id);
  const report = readReport(id);
  const reportNumber = reportNumberFor(id, app ?? null, report?.file ?? null);
  if (reportNumber == null) return null;

  const sourcePdf = await resolveTailoredCv(undefined, id);
  if (!sourcePdf) return null;

  const date = new Date().toISOString().slice(0, 10);
  const { file, sha, created } = freezeAppliedCv({
    root: careerOpsRoot(),
    report: String(reportNumber),
    date,
    sourcePdf,
    company: app?.company ?? "",
    role: app?.role ?? "",
    url: app?.url ?? "",
  });
  return { file, sha, created };
}
