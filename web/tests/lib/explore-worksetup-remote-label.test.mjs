// AGEN-260 Gap 3: "Remote" vs "Remote-anywhere". The Stage-4 PE (AGEN-256
// Item B) concluded worldwide-remote is ALREADY reachable — the "remote"
// work-setup appends both "Remote" and "Worldwide" to the location allow-list,
// and scan.mjs matches worldwide-remote on "Worldwide". The only gap was that
// the UI label "Remote" read as if it meant only the word "Remote" in a
// location, so the minimal change is a label rename + helper text. These tests
// pin the label and guard the behavioral invariant the rename must NOT change.
//
// Run:  node --experimental-strip-types --test tests/lib/explore-worksetup-remote-label.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FILTERS,
  WORK_SETUP_LABEL,
  WORK_SETUP_ALLOW,
  expandFiltersForScan,
} from "../../src/lib/explore.ts";

test("the remote work-setup label reads as worldwide-remote", () => {
  assert.equal(WORK_SETUP_LABEL.remote, "Remote (anywhere)");
});

test("hybrid / onsite labels are unchanged by the rename", () => {
  assert.equal(WORK_SETUP_LABEL.hybrid, "Hybrid");
  assert.equal(WORK_SETUP_LABEL.onsite, "In-office");
});

test("the label rename does not touch the allow-list expansion (worldwide-remote still reachable)", () => {
  // Behavioral invariant: "remote" still adds both entries, "Worldwide" is what
  // scan.mjs matches worldwide-remote on. Bare "Remote" is NOT a worldwide label
  // on its own (scan.mjs WORLDWIDE_LOCATION_LABELS excludes it) — AGENTS.md hard
  // constraint — so the pair is load-bearing: never collapse it to bare "Remote".
  assert.deepEqual(WORK_SETUP_ALLOW.remote, ["Remote", "Worldwide"]);
  const out = expandFiltersForScan({ ...DEFAULT_FILTERS, allow: ["Berlin"], workSetup: ["remote"] });
  assert.deepEqual(out.allow, ["Berlin", "Remote", "Worldwide"]);
});
