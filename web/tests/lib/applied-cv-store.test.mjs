/**
 * applied-cv-store.test.mjs — persistence + resolution tests for the
 * apply-time resume-version store (AGEN-262, Gap 5).
 *
 * The store implements AGEN-256 Item D: at apply time the resolved CV is
 * frozen into a content-addressed, user-layer file under
 * `data/applied-cvs/{report}-{date}-{sha}.pdf` with an append-only
 * `data/applied-cvs.tsv` index, so the version actually sent survives a later
 * regenerate (which supersedes the live `output/` PDF). The web route resolves
 * a stable link from this index.
 *
 * Pure `.mjs`, no `@/` alias needed — imported by relative path. Lives under
 * web/tests/ so the web CI collects it (see apply-cv-resolver.test.mjs header).
 *
 * Run (from web/):  node --test tests/lib/applied-cv-store.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, "..", "..", "src", "lib", "apply", "applied-cv-store.mjs");

const {
  freezeAppliedCv,
  resolveAppliedCv,
  appliedCvReportSet,
  parseAppliedCvTsv,
  appliedCvsDir,
  appliedCvsTsvPath,
} = await import(STORE);

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "applied-cv-"));
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "output"), { recursive: true });
  return root;
}

function writePdf(root, name, bytes) {
  const p = join(root, "output", name);
  writeFileSync(p, bytes);
  return p;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

test("freezeAppliedCv copies the PDF to a content-addressed path and writes a TSV header + row", () => {
  const root = tempRoot();
  try {
    const bytes = Buffer.from("%PDF-1.4 resume v1");
    const src = writePdf(root, "cv-acme.pdf", bytes);

    const res = freezeAppliedCv({ root, report: "42", date: "2026-11-14", sourcePdf: src, company: "Acme", role: "ML Engineer" });

    const sha = sha256(bytes);
    assert.equal(res.created, true);
    assert.equal(res.sha, sha);
    // filename shape: {report}-{date}-{sha12}.pdf
    assert.equal(basename(res.file), `42-2026-11-14-${sha.slice(0, 12)}.pdf`);
    assert.ok(existsSync(res.file), "frozen file exists on disk");
    assert.deepEqual([...readFileSync(res.file)], [...bytes], "frozen bytes match the source exactly");
    assert.ok(res.file.startsWith(appliedCvsDir(root)), "file lives under data/applied-cvs/");

    const tsv = readFileSync(appliedCvsTsvPath(root), "utf8");
    const rows = parseAppliedCvTsv(tsv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].report, "42");
    assert.equal(rows[0].date, "2026-11-14");
    assert.equal(rows[0].sha, sha);
    assert.equal(rows[0].file, basename(res.file));
    assert.equal(rows[0].company, "Acme");
    assert.equal(rows[0].role, "ML Engineer");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("freezeAppliedCv is idempotent for identical content (same report + sha): one file, one row", () => {
  const root = tempRoot();
  try {
    const bytes = Buffer.from("%PDF-1.4 resume v1");
    const src = writePdf(root, "cv-acme.pdf", bytes);

    const first = freezeAppliedCv({ root, report: "42", date: "2026-11-14", sourcePdf: src });
    const again = freezeAppliedCv({ root, report: "42", date: "2026-11-20", sourcePdf: src });

    assert.equal(first.created, true);
    assert.equal(again.created, false, "second freeze of identical content creates nothing new");
    assert.equal(again.file, first.file, "content-addressed path is stable for identical bytes");

    const rows = parseAppliedCvTsv(readFileSync(appliedCvsTsvPath(root), "utf8"));
    assert.equal(rows.length, 1, "no duplicate index row for identical content");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a regenerated (different) CV frozen for the same report adds a new version; resolve returns the latest", () => {
  const root = tempRoot();
  try {
    const v1 = Buffer.from("%PDF-1.4 resume v1");
    const v2 = Buffer.from("%PDF-1.4 resume v2 — regenerated");

    const src1 = writePdf(root, "cv-acme.pdf", v1);
    freezeAppliedCv({ root, report: "42", date: "2026-11-14", sourcePdf: src1 });

    // user regenerates, output/ PDF changes, applies again later
    const src2 = writePdf(root, "cv-acme.pdf", v2);
    const r2 = freezeAppliedCv({ root, report: "42", date: "2026-11-15", sourcePdf: src2 });

    const rows = parseAppliedCvTsv(readFileSync(appliedCvsTsvPath(root), "utf8"));
    assert.equal(rows.length, 2, "two distinct versions retained");

    const resolved = resolveAppliedCv({ root, report: "42" });
    assert.ok(resolved, "resolves to a frozen version");
    assert.equal(resolved.sha, sha256(v2), "latest appended version wins");
    assert.equal(resolved.file, r2.file);
    assert.ok(existsSync(resolved.file));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveAppliedCv returns null when nothing is frozen for the report", () => {
  const root = tempRoot();
  try {
    assert.equal(resolveAppliedCv({ root, report: "42" }), null);
    const src = writePdf(root, "cv-acme.pdf", Buffer.from("%PDF x"));
    freezeAppliedCv({ root, report: "42", date: "2026-11-14", sourcePdf: src });
    assert.equal(resolveAppliedCv({ root, report: "99" }), null, "a different report has no version");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveAppliedCv skips an index row whose frozen file was deleted (no dead link)", () => {
  const root = tempRoot();
  try {
    const src = writePdf(root, "cv-acme.pdf", Buffer.from("%PDF gone"));
    const res = freezeAppliedCv({ root, report: "42", date: "2026-11-14", sourcePdf: src });
    rmSync(res.file, { force: true });
    assert.equal(resolveAppliedCv({ root, report: "42" }), null, "missing file is not resolved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("appliedCvReportSet returns only reports with an existing frozen file", () => {
  const root = tempRoot();
  try {
    assert.equal(appliedCvReportSet(root).size, 0, "empty before anything is frozen");

    const a = writePdf(root, "cv-a.pdf", Buffer.from("%PDF a"));
    const b = writePdf(root, "cv-b.pdf", Buffer.from("%PDF b"));
    freezeAppliedCv({ root, report: "7", date: "2026-11-14", sourcePdf: a });
    const rb = freezeAppliedCv({ root, report: "8", date: "2026-11-14", sourcePdf: b });

    let set = appliedCvReportSet(root);
    assert.deepEqual([...set].sort(), ["7", "8"]);

    rmSync(rb.file, { force: true });
    set = appliedCvReportSet(root);
    assert.deepEqual([...set].sort(), ["7"], "report whose file was deleted drops out");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("freezeAppliedCv never fabricates: a missing source PDF yields no file and no row", () => {
  const root = tempRoot();
  try {
    assert.throws(() => freezeAppliedCv({ root, report: "42", date: "2026-11-14", sourcePdf: join(root, "output", "nope.pdf") }));
    assert.equal(existsSync(appliedCvsTsvPath(root)), false, "no index row written on a failed freeze");
    assert.equal(appliedCvReportSet(root).size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parseAppliedCvTsv tolerates a trailing newline and ignores a blank line", () => {
  const header = "report\tdate\tsha\tfile\tcompany\trole\turl";
  const row = "42\t2026-11-14\tabc123\t42-2026-11-14-abc123.pdf\tAcme\tML Engineer\t";
  const rows = parseAppliedCvTsv(`${header}\n${row}\n\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].report, "42");
  assert.equal(rows[0].file, "42-2026-11-14-abc123.pdf");
});
