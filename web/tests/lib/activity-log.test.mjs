import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ACTIVITY_SOURCES,
  activityDirPath,
  countBySource,
  dayFilePath,
  isActivityDate,
  listActivityDays,
  parseEventLine,
  readDay,
  readRange,
} from "../../src/lib/activity-log.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "activity-log-"));
}

function writeDay(dir, date, lines) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${date}.ndjson`), lines.join("\n") + "\n", "utf8");
}

test("isActivityDate accepts real YYYY-MM-DD and rejects junk", () => {
  assert.equal(isActivityDate("2026-11-12"), true);
  assert.equal(isActivityDate("2026-13-01"), false); // no month 13
  assert.equal(isActivityDate("2026-2-1"), false); // not zero-padded
  assert.equal(isActivityDate("nope"), false);
  assert.equal(isActivityDate(""), false);
  assert.equal(isActivityDate(null), false);
});

test("activityDirPath defaults under the data root and honors the override", () => {
  assert.equal(activityDirPath("/root", undefined), path.join("/root", "data", "activity"));
  assert.equal(activityDirPath("/root", "/abs/elsewhere"), "/abs/elsewhere");
  assert.equal(activityDirPath("/root", "rel/dir"), path.resolve("/root", "rel/dir"));
});

test("dayFilePath rejects traversal via an invalid date", () => {
  assert.throws(() => dayFilePath("/x", "../../etc/passwd"));
  assert.throws(() => dayFilePath("/x", "2026-99-99"));
  assert.equal(dayFilePath("/x", "2026-11-12"), path.join("/x", "2026-11-12.ndjson"));
});

test("parseEventLine parses a well-formed event and normalizes ref", () => {
  const ev = parseEventLine(
    JSON.stringify({
      ts: "2026-11-12T09:30:00.000Z",
      source: "scheduled-scan",
      kind: "scan.completed",
      summary: "Scanned 42 boards, 3 new matches",
      ref: { reportNum: 64, queueId: "abc", url: "https://x.test/j/1", extra: "drop" },
    }),
    "2026-11-12",
  );
  assert.equal(ev.source, "scheduled-scan");
  assert.equal(ev.knownSource, true);
  assert.equal(ev.summary, "Scanned 42 boards, 3 new matches");
  assert.deepEqual(ev.ref, { reportNum: "64", queueId: "abc", url: "https://x.test/j/1" });
});

test("parseEventLine tolerates blank and malformed lines without throwing", () => {
  assert.equal(parseEventLine("", "2026-11-12"), null);
  assert.equal(parseEventLine("   ", "2026-11-12"), null);
  assert.equal(parseEventLine("{not json", "2026-11-12"), null);
  assert.equal(parseEventLine("[1,2,3]", "2026-11-12"), null);
  assert.equal(parseEventLine("{}", "2026-11-12"), null); // no ts/kind/summary
});

test("parseEventLine marks an unknown source and falls back ts to the day", () => {
  const ev = parseEventLine(JSON.stringify({ kind: "x", summary: "hi", source: "mystery" }), "2026-11-12");
  assert.equal(ev.source, "mystery");
  assert.equal(ev.knownSource, false);
  assert.equal(ev.ts, "2026-11-12T00:00:00.000Z");
});

test("readDay returns [] when the day file is absent", () => {
  const dir = tmpDir();
  assert.deepEqual(readDay(dir, "2026-11-12"), []);
});

test("readDay returns events newest-first and skips corrupt lines", () => {
  const dir = tmpDir();
  writeDay(dir, "2026-11-12", [
    JSON.stringify({ ts: "2026-11-12T08:00:00Z", source: "evaluation", kind: "eval", summary: "early" }),
    "{{ corrupt",
    JSON.stringify({ ts: "2026-11-12T18:00:00Z", source: "apply-queue", kind: "prefill", summary: "late" }),
  ]);
  const events = readDay(dir, "2026-11-12");
  assert.equal(events.length, 2);
  assert.equal(events[0].summary, "late"); // newest first
  assert.equal(events[1].summary, "early");
});

test("countBySource buckets unknown sources under 'other'", () => {
  const events = [
    { source: "evaluation", knownSource: true },
    { source: "evaluation", knownSource: true },
    { source: "mystery", knownSource: false },
  ];
  assert.deepEqual(countBySource(events), { evaluation: 2, other: 1 });
});

test("listActivityDays returns newest-first and [] when dir is missing", () => {
  assert.deepEqual(listActivityDays(path.join(tmpDir(), "nope")), []);
  const dir = tmpDir();
  writeDay(dir, "2026-11-10", ["{}"]);
  writeDay(dir, "2026-11-12", ["{}"]);
  fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");
  assert.deepEqual(listActivityDays(dir), ["2026-11-12", "2026-11-10"]);
});

test("readRange groups per day newest-first with counts and respects bounds", () => {
  const dir = tmpDir();
  writeDay(dir, "2026-11-10", [
    JSON.stringify({ ts: "2026-11-10T09:00:00Z", source: "scheduled-scan", kind: "scan", summary: "a" }),
  ]);
  writeDay(dir, "2026-11-11", [
    JSON.stringify({ ts: "2026-11-11T09:00:00Z", source: "evaluation", kind: "eval", summary: "b" }),
    JSON.stringify({ ts: "2026-11-11T10:00:00Z", source: "evaluation", kind: "eval", summary: "c" }),
  ]);
  writeDay(dir, "2026-11-12", [
    JSON.stringify({ ts: "2026-11-12T09:00:00Z", source: "apply-queue", kind: "prefill", summary: "d" }),
  ]);

  const all = readRange(dir);
  assert.deepEqual(all.map((g) => g.date), ["2026-11-12", "2026-11-11", "2026-11-10"]);
  assert.equal(all[1].count, 2);
  assert.deepEqual(all[1].bySource, { evaluation: 2 });

  const bounded = readRange(dir, "2026-11-11", "2026-11-11");
  assert.deepEqual(bounded.map((g) => g.date), ["2026-11-11"]);
});

test("ACTIVITY_SOURCES is the documented closed set", () => {
  assert.deepEqual(
    [...ACTIVITY_SOURCES],
    ["scheduled-scan", "email-import", "apply-queue", "gap-plan", "evaluation"],
  );
});
