/**
 * applied-cv-store.mjs — apply-time resume-version store (AGEN-262, Gap 5).
 *
 * Implements the AGEN-256 Item D storage contract: at apply time, the resolved
 * tailored CV is FROZEN into a content-addressed, user-layer file so the exact
 * version sent survives a later regenerate. The live `output/` PDF is
 * supersede-on-regenerate and gitignored; this store is the durable record.
 *
 *   - frozen files: {root}/data/applied-cvs/{report}-{date}-{sha12}.pdf
 *   - append-only index: {root}/data/applied-cvs.tsv
 *       columns: report  date  sha  file  company  role  url   (tab-separated)
 *
 * Data Contract: writes ONLY to the user layer (`data/`), never overwrites an
 * existing frozen file (content-addressed + append-only), and introduces no
 * factual claim about the candidate (Source-of-Truth boundary) — it copies
 * bytes the user already generated and sent.
 *
 * No fabrication: a frozen file is a byte-for-byte copy of a real source PDF.
 * `freezeAppliedCv` throws (and writes nothing) when the source PDF is absent,
 * and `resolveAppliedCv` / `appliedCvReportSet` skip index rows whose file has
 * since been deleted, so a resolved link always points at bytes on disk.
 *
 * Pure Node (no `@/` alias), takes `root` as an argument per the path-resolver
 * convention — the web route supplies `careerOpsRoot()`.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";

const TSV_HEADER = "report\tdate\tsha\tfile\tcompany\trole\turl";
const TSV_COLUMNS = ["report", "date", "sha", "file", "company", "role", "url"];

/** Directory holding the frozen per-application CV snapshots. */
export function appliedCvsDir(root) {
  return join(root, "data", "applied-cvs");
}

/** The append-only index of frozen snapshots. */
export function appliedCvsTsvPath(root) {
  return join(root, "data", "applied-cvs.tsv");
}

/** Keep a value on a single TSV cell: strip tabs and newlines. */
function cell(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

/**
 * Parse the append-only TSV into rows. Tolerant of a trailing newline and
 * blank lines; skips the header. Returns objects keyed by TSV_COLUMNS.
 * @param {string} text
 * @returns {Array<{report:string,date:string,sha:string,file:string,company:string,role:string,url:string}>}
 */
export function parseAppliedCvTsv(text) {
  if (!text) return [];
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (line === TSV_HEADER) continue;
    const parts = line.split("\t");
    // A header written by a future version may reorder; here the writer owns
    // the file and always emits TSV_COLUMNS order, so positional read is safe.
    const row = {};
    TSV_COLUMNS.forEach((col, i) => {
      row[col] = parts[i] ?? "";
    });
    if (!row.report || !row.file) continue;
    rows.push(row);
  }
  return rows;
}

function readRows(root) {
  const tsv = appliedCvsTsvPath(root);
  if (!existsSync(tsv)) return [];
  return parseAppliedCvTsv(readFileSync(tsv, "utf8"));
}

/**
 * Freeze the resolved CV for an application into the content-addressed store.
 * Idempotent on (report, content): re-freezing identical bytes creates nothing.
 *
 * @param {object} args
 * @param {string} args.root        career-ops data root
 * @param {string|number} args.report  report number (identity of the snapshot)
 * @param {string} args.date        apply date (YYYY-MM-DD)
 * @param {string} args.sourcePdf   absolute path to the live tailored PDF
 * @param {string} [args.company]
 * @param {string} [args.role]
 * @param {string} [args.url]
 * @returns {{file:string, sha:string, relPath:string, created:boolean}}
 */
export function freezeAppliedCv({ root, report, date, sourcePdf, company = "", role = "", url = "" }) {
  if (!sourcePdf || !existsSync(sourcePdf)) {
    // No fabrication: never synthesize a snapshot for a missing artifact.
    throw new Error(`applied-cv: source PDF does not exist: ${sourcePdf}`);
  }
  const reportKey = String(report);
  const bytes = readFileSync(sourcePdf);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const name = `${reportKey}-${date}-${sha.slice(0, 12)}.pdf`;
  const dir = appliedCvsDir(root);
  const file = join(dir, name);
  const relPath = join("data", "applied-cvs", name);

  // Idempotent on content: identical bytes for the same report map to the
  // already-frozen snapshot (matched on report + sha), whatever today's date
  // is — a re-apply of the same CV writes nothing new and keeps the original
  // file name (and its first-seen date).
  const existing = readRows(root);
  const priorRow = existing.find((r) => r.report === reportKey && r.sha === sha);
  if (priorRow) {
    const priorFile = join(dir, priorRow.file);
    if (existsSync(priorFile)) {
      return {
        file: priorFile,
        sha,
        relPath: join("data", "applied-cvs", priorRow.file),
        created: false,
      };
    }
  }
  const already = Boolean(priorRow);

  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) copyFileSync(sourcePdf, file);

  const tsv = appliedCvsTsvPath(root);
  if (!existsSync(tsv)) writeFileSync(tsv, `${TSV_HEADER}\n`);
  if (!already) {
    const row = [reportKey, date, sha, name, cell(company), cell(role), cell(url)].join("\t");
    appendFileSync(tsv, `${row}\n`);
  }
  return { file, sha, relPath, created: true };
}

/**
 * Resolve the latest frozen snapshot for a report. Returns the most recently
 * appended row whose file still exists, or null. Skips dead index rows so a
 * returned link always points at bytes on disk (no dead link).
 *
 * @param {object} args
 * @param {string} args.root
 * @param {string|number} args.report
 * @returns {{file:string, sha:string, date:string, relPath:string}|null}
 */
export function resolveAppliedCv({ root, report }) {
  const reportKey = String(report);
  const rows = readRows(root).filter((r) => r.report === reportKey);
  // Append-only: later rows are newer. Walk from the end to the first live file.
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const file = join(appliedCvsDir(root), r.file);
    if (existsSync(file)) {
      return { file, sha: r.sha, date: r.date, relPath: join("data", "applied-cvs", r.file) };
    }
  }
  return null;
}

/**
 * Set of report keys that have at least one frozen snapshot still on disk.
 * Used by the tracker view to decide which rows get the "used" affordance.
 *
 * @param {string} root
 * @returns {Set<string>}
 */
export function appliedCvReportSet(root) {
  const set = new Set();
  for (const r of readRows(root)) {
    if (set.has(r.report)) continue;
    if (existsSync(join(appliedCvsDir(root), r.file))) set.add(r.report);
  }
  return set;
}
