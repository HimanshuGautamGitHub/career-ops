import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDiscardResult } from "../../src/lib/liveness-discard.mjs";

// AGEN-252: POST /api/liveness/discard shells `check-liveness.mjs --tracker
// --discard-expired --json` and hands its stdout object to this normalizer,
// which produces the HTTP contract { planned, applied, errors, unreadable }.
// The safety guarantee the whole feature rests on — a live posting is never
// discarded — lives in the CLI (tests/liveness-core.test.mjs,
// tests/liveness-discard-json.test.mjs). These tests pin only the mapping:
// applied means a row the CLI actually wrote, never one it merely planned.

const EXPIRED_URL = "https://job-boards.greenhouse.io/acme/jobs/1";

test("dry-run: planned rows surface, nothing is reported as applied", () => {
  const cli = {
    mode: "dry-run",
    summary: { active: 1, expired: 1, uncertain: 0, viaApi: 2 },
    planned: [{ num: 1, company: "Acme", role: "Engineer", url: EXPIRED_URL }],
    results: [{ num: 1, company: "Acme", role: "Engineer", url: EXPIRED_URL, changed: true, dryRun: true }],
    unreadable: [],
  };
  const out = normalizeDiscardResult(cli);
  assert.deepEqual(out.planned, [{ num: 1, company: "Acme", role: "Engineer", url: EXPIRED_URL }]);
  // changed:true in a dry-run means "would change" — it is NOT a write, so
  // applied must stay empty. This is the line that keeps the UI honest.
  assert.deepEqual(out.applied, []);
  assert.deepEqual(out.errors, []);
});

test("apply: only a row the CLI actually wrote counts as applied", () => {
  const cli = {
    mode: "apply",
    summary: { active: 1, expired: 1, uncertain: 0, viaApi: 2 },
    planned: [{ num: 1, company: "Acme", role: "Engineer", url: EXPIRED_URL }],
    results: [{ num: 1, company: "Acme", role: "Engineer", url: EXPIRED_URL, changed: true, dryRun: false }],
    unreadable: [],
  };
  const out = normalizeDiscardResult(cli);
  assert.deepEqual(out.applied, [{ num: 1, company: "Acme", role: "Engineer", url: EXPIRED_URL }]);
  assert.deepEqual(out.errors, []);
});

test("a per-row CLI error is surfaced and never counted as applied", () => {
  const cli = {
    mode: "apply",
    summary: { active: 0, expired: 1, uncertain: 0, viaApi: 1 },
    planned: [{ num: 1, company: "Acme", role: "Engineer", url: EXPIRED_URL }],
    results: [{ num: 1, company: "Acme", role: "Engineer", url: EXPIRED_URL, changed: false, dryRun: false, error: "tracker locked" }],
    unreadable: [],
  };
  const out = normalizeDiscardResult(cli);
  assert.deepEqual(out.applied, []);
  assert.deepEqual(out.errors, [{ num: 1, url: EXPIRED_URL, reason: "tracker locked" }]);
});

test("unreadable (confirmed-uncertain) postings pass through untouched", () => {
  const cli = {
    mode: "dry-run",
    summary: { active: 0, expired: 0, uncertain: 1, viaApi: 0 },
    planned: [],
    results: [],
    unreadable: [{ num: 2, company: "Globex", role: "Engineer", url: "https://example.test/globex" }],
  };
  const out = normalizeDiscardResult(cli);
  assert.deepEqual(out.planned, []);
  assert.deepEqual(out.applied, []);
  assert.deepEqual(out.unreadable, [{ num: 2, company: "Globex", role: "Engineer", url: "https://example.test/globex" }]);
});

test("a malformed or empty object normalizes to empty arrays, never throws", () => {
  for (const bad of [null, undefined, {}, { planned: "nope", results: 7 }]) {
    const out = normalizeDiscardResult(bad);
    assert.deepEqual(out, { planned: [], applied: [], errors: [], unreadable: [] });
  }
});
