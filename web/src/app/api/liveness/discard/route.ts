import { runCoreCli } from "@/lib/core-cli";
import { parseCliJson } from "@/lib/status-cli.mjs";
import { normalizeDiscardResult } from "@/lib/liveness-discard.mjs";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs"; // delegates to check-liveness.mjs via child_process

// AGEN-252: auto-retire dead postings. This is the ONLY place a tracker row is
// moved to Discarded on a liveness verdict, so every safety decision is pushed
// down into the core CLI rather than reimplemented here:
//
//   check-liveness.mjs --tracker --discard-expired --no-fallback --json
//
// - --discard-expired moves a row ONLY on a confirmed-dead verdict (explicit
//   expired signal, 404, 410) and ONLY while it is still Evaluated; an
//   `uncertain` posting is never touched (tests/liveness-core.test.mjs). A
//   false "dead" would silently lose a real job, so the CLI owns that line.
// - --no-fallback keeps the sweep on the free ATS-API rung — no Playwright, so
//   it finishes inside the 30s HTTP budget, and the safe direction: skipping
//   the headed retry can only yield FEWER discards, never a false death.
// - --json makes stdout a single machine object; we never scrape human text.
//
// The write happens only when the caller opts in with { dryRun: false }. The
// default is a dry run: the UI shows "N would be discarded" and the user
// confirms before anything is written.

const CONTRACT = ["--tracker", "--discard-expired", "--no-fallback", "--json"] as const;

export async function POST(req: Request): Promise<Response> {
  // Body is optional; an absent or malformed body is a default dry run, never a
  // 400 — the safe reading is "don't write".
  const body = await readJsonObject<{ dryRun?: boolean }>(req);
  const dryRun = body?.dryRun !== false;

  const args = dryRun ? [...CONTRACT] : [...CONTRACT, "--apply"];
  const result = await runCoreCli("check-liveness", args);

  if (result.spawnFailed) {
    return Response.json({ error: "Could not start the liveness checker." }, { status: 503 });
  }
  if (result.timedOut) {
    return Response.json({ error: "The liveness check took too long. Try again." }, { status: 503 });
  }

  // Parse stdout regardless of exit code: the CLI can exit non-zero when an
  // individual set-status write fails yet still print a valid document that
  // carries that failure in `results[].error`. We lose nothing by reading it.
  const parsed = parseCliJson(result.stdout);
  if (!parsed) {
    return Response.json({ error: "The liveness check returned no result." }, { status: 502 });
  }

  return Response.json({ dryRun, ...normalizeDiscardResult(parsed) });
}
