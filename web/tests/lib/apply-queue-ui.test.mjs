import { test } from "node:test";
import assert from "node:assert/strict";

import { actionsFor, prefillPct, STATE_META, STATE_ORDER, stateMeta } from "../../src/lib/apply-queue-ui.mjs";
import { QUEUE_STATES } from "../../src/lib/apply-queue-store.mjs";

// Re-declare the store's edges here and assert the UI never offers a transition
// the server would reject. Importing the private constant isn't possible, so we
// mirror it and let transitionApplyItem's own test guard the store side.
const ALLOWED = {
  QUEUED: ["PREFILLED", "BLOCKED", "DISCARDED"],
  PREFILLED: ["NEEDS_REVIEW", "SUBMITTED", "BLOCKED", "DISCARDED"],
  NEEDS_REVIEW: ["PREFILLED", "SUBMITTED", "BLOCKED", "DISCARDED"],
  BLOCKED: ["QUEUED", "DISCARDED"],
  SUBMITTED: ["APPLIED", "ARCHIVED"],
  APPLIED: ["ARCHIVED"],
  DISCARDED: [],
  ARCHIVED: [],
};

test("every state has metadata", () => {
  for (const state of QUEUE_STATES) {
    assert.ok(STATE_META[state], `missing meta for ${state}`);
    assert.ok(stateMeta(state).label);
  }
});

test("stateMeta falls back gracefully for an unknown state", () => {
  assert.deepEqual(stateMeta("WAT"), { label: "WAT", tone: "muted" });
});

test("actionsFor only offers transitions the store allows", () => {
  for (const state of QUEUE_STATES) {
    for (const action of actionsFor(state)) {
      assert.ok(
        ALLOWED[state].includes(action.to),
        `UI offers illegal ${state} -> ${action.to}`,
      );
    }
  }
});

test("SUBMITTED is only reachable through an attested action", () => {
  for (const state of QUEUE_STATES) {
    for (const action of actionsFor(state)) {
      if (action.to === "SUBMITTED") {
        assert.equal(action.attest, true, `${state} -> SUBMITTED must require attestation`);
      }
    }
  }
});

test("BLOCK actions require a reason", () => {
  for (const state of QUEUE_STATES) {
    for (const action of actionsFor(state)) {
      if (action.to === "BLOCKED") assert.equal(action.requireReason, true);
    }
  }
});

test("prefillPct computes a rounded percentage and guards divide-by-zero", () => {
  assert.equal(prefillPct({ fieldsReady: 0, fieldsTotal: 0 }), 0);
  assert.equal(prefillPct(null), 0);
  assert.equal(prefillPct({ fieldsReady: 3, fieldsTotal: 4 }), 75);
  assert.equal(prefillPct({ fieldsReady: 1, fieldsTotal: 3 }), 33);
});

test("STATE_ORDER is a permutation of the store states", () => {
  assert.deepEqual([...STATE_ORDER].sort(), [...QUEUE_STATES].sort());
});
