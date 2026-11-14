import { NextRequest } from "next/server";
import fs from "node:fs";
import { careerOpsRoot, findApplication, readReport } from "@/lib/career-ops";
import { reportNumberFor } from "@/lib/apply-checklist.mjs";
import { cvPdfDisposition } from "@/lib/content-disposition.mjs";
import { resolveAppliedCv } from "@/lib/apply/applied-cv-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AGEN-262, Gap 5: serve the FROZEN resume version an application was sent with
// (AGEN-256 Item D store), as a stable link distinct from /api/cv-pdf, which
// serves the live tailored CV that changes on regenerate. Read-only: it only
// reads bytes the apply-time freeze already wrote under the user layer.

function servePdf(file: string, downloadFlag: string | null): Response {
  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": cvPdfDisposition(file, downloadFlag),
      "Cache-Control": "no-store",
    },
  });
}

/** Resolve the report number this request targets: an explicit `report`, or a
 *  tracker `application` number mapped the same way the apply flow maps it. */
function resolveReport(params: URLSearchParams): string | null {
  const report = params.get("report")?.trim();
  if (report) return report;

  const application = params.get("application")?.trim();
  if (!application) return null;
  const app = findApplication(application);
  const reportData = readReport(application);
  const reportNumber = reportNumberFor(application, app ?? null, reportData?.file ?? null);
  return reportNumber == null ? null : String(reportNumber);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const report = resolveReport(params);
  if (!report) return new Response("no applied-CV report resolved", { status: 404 });

  const resolved = resolveAppliedCv({ root: careerOpsRoot(), report });
  if (!resolved) return new Response("no saved resume version for this application", { status: 404 });

  try {
    return servePdf(resolved.file, params.get("download"));
  } catch {
    return new Response("could not read the saved resume version", { status: 500 });
  }
}
