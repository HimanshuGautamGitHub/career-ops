import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { readJsonObject } from "@/lib/json-body";
import {
  parseBlacklist,
  serializeBlacklist,
  upsertBlacklistEntry,
  removeBlacklistEntry,
  blacklistEntryError,
} from "@/lib/core/blacklist-file.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read/write editor for data/blacklist.md — the user's do-not-apply list
// (USER-LAYER, opt-in; DATA_CONTRACT in AGENTS.md). The canonical on-disk shape
// is the markdown table `| Company | Since | Scope | Reason |`; all parsing and
// serialization lives in blacklist-file.mjs so the scanner and the web agree.
// Writes go through atomicWriteWithBackup (temp + rename, timestamped .bak) so a
// crash mid-write can never truncate the list.

interface BlacklistEntry {
  company: string;
  since: string;
  scope: string;
  reason: string;
}

function blacklistPath(): string {
  return path.join(careerOpsRoot(), "data", "blacklist.md");
}

function readRaw(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/** Current entries + the raw text they came from (needed to preserve prose on write). */
function load(): { entries: BlacklistEntry[]; raw: string } {
  const raw = readRaw(blacklistPath());
  return { entries: parseBlacklist(raw) as BlacklistEntry[], raw };
}

export async function GET() {
  try {
    const { entries } = load();
    return Response.json({ entries });
  } catch {
    return Response.json({ error: "could not read blacklist" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // readJsonObject yields null for non-object bodies; blacklistEntryError turns
  // that into the route's own 400 instead of a property-read 500.
  const payload = await readJsonObject(req);
  const error = blacklistEntryError(payload);
  if (error) return Response.json({ error }, { status: 400 });

  const entry = payload as Partial<BlacklistEntry>;
  const normalized: BlacklistEntry = {
    company: String(entry.company ?? "").trim(),
    // Default the "Since" column to today when the user didn't supply one.
    since: String(entry.since ?? "").trim() || new Date().toISOString().slice(0, 10),
    scope: String(entry.scope ?? "company").trim().toLowerCase(),
    reason: String(entry.reason ?? "").trim(),
  };

  try {
    const { entries, raw } = load();
    const next = upsertBlacklistEntry(entries, normalized) as BlacklistEntry[];
    atomicWriteWithBackup(blacklistPath(), serializeBlacklist(next, raw));
    return Response.json({ entries: next });
  } catch {
    return Response.json({ error: "could not write blacklist" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const payload = await readJsonObject(req);
  if (!payload) {
    return Response.json({ error: "delete requires a company and scope" }, { status: 400 });
  }
  const { company, scope } = payload as { company?: unknown; scope?: unknown };
  if (typeof company !== "string" || !company.trim()) {
    return Response.json({ error: "company is required" }, { status: 400 });
  }

  try {
    const { entries, raw } = load();
    const next = removeBlacklistEntry(
      entries,
      company,
      typeof scope === "string" ? scope : "company",
    ) as BlacklistEntry[];
    atomicWriteWithBackup(blacklistPath(), serializeBlacklist(next, raw));
    return Response.json({ entries: next });
  } catch {
    return Response.json({ error: "could not write blacklist" }, { status: 500 });
  }
}
