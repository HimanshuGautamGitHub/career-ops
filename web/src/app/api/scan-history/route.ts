import { careerOpsRoot } from "@/lib/career-ops";
import { readScanHistory } from "@/lib/scan-history.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AGEN-251 (Gap 1): last-scan recency + results for the Portals page. Thin
// wrapper — resolve the data root here (careerOpsRoot() is a TS module that
// pulls in app deps), then let the dependency-free scan-history.mjs read and
// merge data/scan-runs.tsv with the scheduled-jobs store. Read-only, never
// cached: a fresh scan must show up on the next page load.
export async function GET(): Promise<Response> {
  try {
    const root = careerOpsRoot();
    const history = readScanHistory(root);
    return Response.json(history, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json(
      { lastRun: null, totalRuns: 0, error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
