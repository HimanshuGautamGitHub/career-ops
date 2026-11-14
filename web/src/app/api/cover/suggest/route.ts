import fs from "node:fs";
import path from "node:path";
import { cliUnavailableError, resolveCliOrFallback } from "@/lib/clis";
import { careerOpsRoot, findApplication, findReportFile } from "@/lib/career-ops";
import { profileRef } from "@/lib/core/profile-path.mjs";
import { buildCoverSuggestPrompt } from "@/lib/cover-suggest-prompt.mjs";
import { COVER_TONES } from "@/lib/cover-tones.mjs";
import { runPlanner } from "@/lib/apply/planner";
import { extractJsonObject } from "@/lib/extract-json-object.mjs";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 320;

/**
 * Cover-letter "Suggest with AI" (AGEN-265).
 *
 * The report page's cover drawer asks the candidate four Step 6 planning
 * answers (why / problem / approach / tone) before it can run the real `cover`
 * mode. Typing them from blank is the friction the ticket names. This route
 * drafts a FIRST PASS of those four answers with the user's own read-only CLI,
 * grounded ONLY in the in-scope user-layer files plus the evaluation report.
 * The suggestion lands in the editable brief fields; the user reviews and edits
 * before anything is drafted or sent (Ethical Use — never auto-send).
 *
 * Source-of-Truth Boundary (AGENTS.md, hard constraint): unlike apply/prefill
 * and explore/ai, this path NEVER injects readMemory() and the prompt builder
 * has no memory channel. "Context about the user" means the in-scope files,
 * never auto-memory or any cross-session / cross-project / out-of-scope read.
 */

type CoverSuggestion = {
  why: string;
  problem: string;
  approach: string;
  tone?: keyof typeof COVER_TONES;
};

type CoverSuggestResponse =
  | { success: true; data: { suggestion: CoverSuggestion; truncated: boolean } }
  | { success: false; error: string; code?: "ONBOARDING_NEEDED" };

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request): Promise<Response> {
  const body = await readJsonObject<{ n?: string; cliId?: string; company?: string }>(req);
  if (!body) return json({ success: false, error: "bad json" }, 400);
  const { n, cliId: requestedCliId, company } = body;

  if (typeof n !== "string" || !/^\d+$/.test(n)) {
    return json({ success: false, error: `Invalid report selector: "${String(n)}"` }, 400);
  }
  if (company !== undefined && typeof company !== "string") {
    return json({ success: false, error: "company must be a string" }, 400);
  }

  let root: string;
  try {
    root = careerOpsRoot();
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : "Could not resolve the career-ops data root." }, 500);
  }

  // Onboarding gate: no résumé means no grounded "context about the user", and
  // the boundary forbids inventing it. Point the user at setup instead of
  // drafting from nothing.
  const cvPath = path.join(root, "cv.md");
  if (!fs.existsSync(cvPath)) {
    return json(
      {
        success: false,
        code: "ONBOARDING_NEEDED",
        error: "No cv.md found yet. Add your résumé in onboarding so the draft can be grounded in your real experience.",
      },
      200,
    );
  }

  const reportFileAbs = findReportFile(n);
  if (!reportFileAbs) {
    return json({ success: false, error: `No report #${n} found. Evaluate this posting first.` }, 404);
  }
  const reportFile = path.relative(root, reportFileAbs).split(path.sep).join("/");

  const resolved = requestedCliId ? resolveCliOrFallback(requestedCliId) : null;
  if (!resolved) return json({ success: false, error: cliUnavailableError(requestedCliId ?? "").error }, 400);
  const { spec, binPath } = resolved;

  const role = findApplication(n)?.role;
  const prompt = buildCoverSuggestPrompt({ input: n, reportFile, company, role, profile: profileRef(root) });

  const t0 = Date.now();
  const logPath = path.join(root, ".career-ops-web", "cover-suggest.log");
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  } catch {
    /* ignore */
  }
  const log = (m: string): void => {
    try {
      fs.appendFileSync(logPath, `${new Date().toISOString()} [+${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}\n`);
    } catch {
      /* ignore */
    }
  };
  log(`cover-suggest report=#${n} cli=${spec.id} prompt=${prompt.length} chars`);

  const result = await runPlanner({
    cliId: spec.id,
    spec,
    binPath,
    prompt,
    // Four planning answers — the smallest form the planner timeout scales for.
    fieldCount: 4,
    cwd: root,
    t0,
    log,
  });

  if (result.refused) return json({ success: false, error: result.refused }, 502);
  if (!result.buf.trim()) {
    return json(
      {
        success: false,
        error: result.signal ? "The suggestion was cut off before any output. Try again." : "The CLI produced no output. Check it runs in this folder.",
      },
      502,
    );
  }

  const { obj, truncated } = extractJsonObject(result.buf);
  if (!obj) {
    return json({ success: false, error: "Couldn't read the suggestion as JSON. You can still fill the fields by hand." }, 502);
  }

  const toneRaw = str(obj.tone);
  const suggestion: CoverSuggestion = {
    why: str(obj.why),
    problem: str(obj.problem),
    approach: str(obj.approach),
    // Only accept a tone inside the COVER_TONES enum; otherwise leave it unset
    // and let the drawer keep its current selection — never invent one.
    ...(Object.hasOwn(COVER_TONES, toneRaw) ? { tone: toneRaw as keyof typeof COVER_TONES } : {}),
  };

  log(`parsed suggestion${truncated ? " (recovered from truncated output)" : ""}: tone=${suggestion.tone ?? "(unset)"}`);
  return json({ success: true, data: { suggestion, truncated } }, 200);
}

function json(payload: CoverSuggestResponse, status: number): Response {
  return Response.json(payload, { status });
}
