// AGEN-251 (Gap 1): the Portals page needs last-scan recency + results. These
// cover the pure read/merge logic behind GET /api/scan-history.
//
// Run: npm test -- tests/lib/scan-history.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

// Dynamic import so the "@/…" resolver hook (installed by the helper above) is
// in place before scan-history.mjs's own aliased specifiers are resolved.
const { parseScanRunHistory, scheduledLastRun, mostRecent, readScanHistory } = await import(
  "../../src/lib/scan-history.mjs"
);

const HEADER =
  "timestamp\tstatus\tcompanies\tboards\tfound\tfiltered_title\tfiltered_tier\tfiltered_location\tfiltered_posting_age\tfiltered_salary\tfiltered_content\tfiltered_cooldown\tdupes\tnew_added\terrors\tfiltered_blacklist\tfiltered_visa\tfiltered_posted_date\tfiltered_country_eligibility";

// A row matching HEADER's 19 columns. Only timestamp/status/found/new_added matter.
function row({ timestamp, status = "completed", found = 0, newAdded = 0 }) {
  const cols = new Array(19).fill("0");
  cols[0] = timestamp;
  cols[1] = status;
  cols[4] = String(found);
  cols[13] = String(newAdded);
  return cols.join("\t");
}

test("parseScanRunHistory: empty / header-only / missing content → no runs", () => {
  assert.deepEqual(parseScanRunHistory(""), { lastRun: null, totalRuns: 0 });
  assert.deepEqual(parseScanRunHistory(null), { lastRun: null, totalRuns: 0 });
  assert.deepEqual(parseScanRunHistory(HEADER + "\n"), { lastRun: null, totalRuns: 0 });
});

test("parseScanRunHistory: returns the LAST valid row and counts all valid rows", () => {
  const content = [
    HEADER,
    row({ timestamp: "2026-11-10T09:00:00Z", found: 12, newAdded: 3 }),
    row({ timestamp: "2026-11-12T14:30:00Z", found: 42, newAdded: 7 }),
  ].join("\n");
  const out = parseScanRunHistory(content);
  assert.equal(out.totalRuns, 2);
  assert.deepEqual(out.lastRun, {
    timestamp: "2026-11-12T14:30:00Z",
    status: "completed",
    found: 42,
    newAdded: 7,
    source: "cli",
  });
});

test("parseScanRunHistory: parses by header name, not position (column prepended)", () => {
  // A future scan.mjs prepends a column; name-based lookup must still be correct.
  const shiftedHeader = "run_id\t" + HEADER;
  const shiftedRow = "abc\t" + row({ timestamp: "2026-11-12T14:30:00Z", found: 42, newAdded: 7 });
  const out = parseScanRunHistory([shiftedHeader, shiftedRow].join("\n"));
  assert.equal(out.lastRun.found, 42);
  assert.equal(out.lastRun.newAdded, 7);
  assert.equal(out.lastRun.timestamp, "2026-11-12T14:30:00Z");
});

test("parseScanRunHistory: skips torn rows and rows with a bad timestamp", () => {
  const content = [
    HEADER,
    row({ timestamp: "2026-11-10T09:00:00Z", found: 12, newAdded: 3 }),
    "not-a-timestamp\tcompleted\t0", // bad timestamp + torn
    "2026-11-11T10:00:00Z\tcompleted", // torn (too few columns)
  ].join("\n");
  const out = parseScanRunHistory(content);
  assert.equal(out.totalRuns, 1);
  assert.equal(out.lastRun.timestamp, "2026-11-10T09:00:00Z");
});

test("parseScanRunHistory: skips drifted rows wider than the header", () => {
  const content = [
    HEADER,
    row({ timestamp: "2026-11-10T09:00:00Z", found: 12, newAdded: 3 }),
    row({ timestamp: "2026-11-12T14:30:00Z", found: 42, newAdded: 7 }) + "\textra\tcols",
  ].join("\n");
  const out = parseScanRunHistory(content);
  assert.equal(out.totalRuns, 1);
  assert.equal(out.lastRun.timestamp, "2026-11-10T09:00:00Z");
});

test("parseScanRunHistory: unknown schema (no timestamp/found column) → no runs", () => {
  const out = parseScanRunHistory("foo\tbar\n1\t2");
  assert.deepEqual(out, { lastRun: null, totalRuns: 0 });
});

test("scheduledLastRun: picks the job with the newest lastRunAt", () => {
  const store = {
    jobs: [
      { id: "a", lastRunAt: "2026-11-09T08:00:00Z", rolesFoundCount: 5 },
      { id: "b", lastRunAt: "2026-11-12T20:00:00Z", rolesFoundCount: 9 },
      { id: "c" }, // never run — ignored
    ],
    runs: [],
    queue: [],
  };
  assert.deepEqual(scheduledLastRun(store), {
    timestamp: "2026-11-12T20:00:00Z",
    status: "completed",
    found: 9,
    newAdded: 9,
    source: "scheduled",
  });
});

test("scheduledLastRun: a job with lastError reports failed status", () => {
  const store = { jobs: [{ id: "a", lastRunAt: "2026-11-12T20:00:00Z", lastError: "boom" }] };
  assert.equal(scheduledLastRun(store).status, "failed");
  assert.equal(scheduledLastRun(store).found, 0);
});

test("scheduledLastRun: no jobs / no runs → null", () => {
  assert.equal(scheduledLastRun({ jobs: [] }), null);
  assert.equal(scheduledLastRun({}), null);
  assert.equal(scheduledLastRun(null), null);
});

test("mostRecent: returns the record with the newer timestamp, handling nulls", () => {
  const older = { timestamp: "2026-11-10T09:00:00Z", source: "cli" };
  const newer = { timestamp: "2026-11-12T20:00:00Z", source: "scheduled" };
  assert.equal(mostRecent(older, newer), newer);
  assert.equal(mostRecent(newer, older), newer);
  assert.equal(mostRecent(null, newer), newer);
  assert.equal(mostRecent(older, null), older);
  assert.equal(mostRecent(null, null), null);
});

// readScanHistory reads a resolved root (the route passes careerOpsRoot()), so
// it's exercised over a temp dir — no CAREER_OPS_ROOT, no app deps.
function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "co-scan-history-"));
  mkdirSync(join(root, "data"), { recursive: true });
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// A store that passes readScheduledStore's validator (the shape the scheduled
// runner actually writes), with the lastRunAt/rolesFoundCount fields we read.
function scheduledStore(job) {
  const iso = "2026-11-01T00:00:00.000Z";
  return {
    jobs: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Scheduled scan",
        status: "active",
        startAt: iso,
        createdAt: iso,
        updatedAt: iso,
        ...job,
      },
    ],
    runs: [],
    queue: [],
  };
}

test("readScanHistory: neither source present → no runs", () => {
  withRoot((root) => {
    assert.deepEqual(readScanHistory(root), { lastRun: null, totalRuns: 0 });
  });
});

test("readScanHistory: scan-runs.tsv only → CLI last run + count", () => {
  withRoot((root) => {
    const content = [
      HEADER,
      row({ timestamp: "2026-11-10T09:00:00Z", found: 12, newAdded: 3 }),
      row({ timestamp: "2026-11-12T14:30:00Z", found: 42, newAdded: 7 }),
    ].join("\n");
    writeFileSync(join(root, "data/scan-runs.tsv"), content);
    const out = readScanHistory(root);
    assert.equal(out.totalRuns, 2);
    assert.equal(out.lastRun.source, "cli");
    assert.equal(out.lastRun.found, 42);
    assert.equal(out.lastRun.timestamp, "2026-11-12T14:30:00Z");
  });
});

test("readScanHistory: merges both sources, newest run wins", () => {
  withRoot((root) => {
    // CLI ran on the 10th; a scheduled job ran on the 12th → scheduled is newest.
    writeFileSync(
      join(root, "data/scan-runs.tsv"),
      [HEADER, row({ timestamp: "2026-11-10T09:00:00Z", found: 12, newAdded: 3 })].join("\n"),
    );
    const store = scheduledStore({ lastRunAt: "2026-11-12T20:00:00Z", rolesFoundCount: 9 });
    writeFileSync(join(root, "data/scheduled-jobs.json"), JSON.stringify(store));
    const out = readScanHistory(root);
    assert.equal(out.lastRun.source, "scheduled");
    assert.equal(out.lastRun.timestamp, "2026-11-12T20:00:00Z");
    assert.equal(out.lastRun.found, 9);
    // totalRuns counts the CLI history, which is the only append-per-run ledger.
    assert.equal(out.totalRuns, 1);
  });
});

test("readScanHistory: CLI newer than scheduled → CLI wins", () => {
  withRoot((root) => {
    writeFileSync(
      join(root, "data/scan-runs.tsv"),
      [HEADER, row({ timestamp: "2026-11-14T09:00:00Z", found: 20, newAdded: 5 })].join("\n"),
    );
    const store = scheduledStore({ lastRunAt: "2026-11-12T20:00:00Z", rolesFoundCount: 9 });
    writeFileSync(join(root, "data/scheduled-jobs.json"), JSON.stringify(store));
    const out = readScanHistory(root);
    assert.equal(out.lastRun.source, "cli");
    assert.equal(out.lastRun.timestamp, "2026-11-14T09:00:00Z");
  });
});
