// AGEN-254 Gap 4: roleType / workSetup filter fields — codec, scan expansion,
// and URL round-trip. Pure logic in explore.ts, so testable without a runner.
//
// Run:  node --experimental-strip-types --test tests/lib/explore-role-worksetup.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FILTERS,
  ROLE_TYPES,
  WORK_SETUPS,
  parseExplorePatch,
  expandFiltersForScan,
  filtersToParams,
  paramsToFilters,
} from "../../src/lib/explore.ts";

test("DEFAULT_FILTERS leaves the new axes unset (no filter)", () => {
  assert.equal(DEFAULT_FILTERS.roleType, undefined);
  assert.equal(DEFAULT_FILTERS.workSetup, undefined);
});

test("parseExplorePatch keeps only known roleType values", () => {
  const out = parseExplorePatch({ roleType: ["senior", "lead", "wizard", "intern"] });
  assert.deepEqual(out.roleType, ["senior", "lead", "intern"]);
});

test("parseExplorePatch keeps only known workSetup values", () => {
  const out = parseExplorePatch({ workSetup: ["remote", "nope", "hybrid"] });
  assert.deepEqual(out.workSetup, ["remote", "hybrid"]);
});

test("parseExplorePatch dedupes repeated values", () => {
  const out = parseExplorePatch({ roleType: ["senior", "senior"], workSetup: ["remote", "remote"] });
  assert.deepEqual(out.roleType, ["senior"]);
  assert.deepEqual(out.workSetup, ["remote"]);
});

test("parseExplorePatch normalizes empty / all-invalid arrays to undefined", () => {
  assert.equal(parseExplorePatch({ roleType: [] }).roleType, undefined);
  assert.equal(parseExplorePatch({ workSetup: [] }).workSetup, undefined);
  assert.equal(parseExplorePatch({ roleType: ["wizard"] }).roleType, undefined);
  assert.equal(parseExplorePatch({ roleType: "senior" }).roleType, undefined); // non-array
});

test("parseExplorePatch leaves the fields alone when the patch omits them (backward compat)", () => {
  const base = { ...DEFAULT_FILTERS, roleType: ["staff"], workSetup: ["onsite"] };
  const out = parseExplorePatch({ positive: ["engineer"] }, base);
  assert.deepEqual(out.roleType, ["staff"]);
  assert.deepEqual(out.workSetup, ["onsite"]);
});

test("ROLE_TYPES / WORK_SETUPS expose the full enum", () => {
  assert.equal(ROLE_TYPES.length, 11);
  assert.deepEqual(WORK_SETUPS, ["remote", "hybrid", "onsite"]);
});

test("expandFiltersForScan appends roleType keywords to positive, additively", () => {
  const out = expandFiltersForScan({ ...DEFAULT_FILTERS, positive: ["engineer"], roleType: ["senior", "lead"] });
  assert.deepEqual(out.positive, ["engineer", "senior", "lead"]);
});

test("expandFiltersForScan maps remote/hybrid onto the allow list, onsite is a no-op", () => {
  const remote = expandFiltersForScan({ ...DEFAULT_FILTERS, allow: ["Berlin"], workSetup: ["remote"] });
  assert.deepEqual(remote.allow, ["Berlin", "Remote", "Worldwide"]);
  const hybrid = expandFiltersForScan({ ...DEFAULT_FILTERS, allow: [], workSetup: ["hybrid"] });
  assert.deepEqual(hybrid.allow, ["Hybrid"]);
  const onsite = expandFiltersForScan({ ...DEFAULT_FILTERS, allow: ["Berlin"], workSetup: ["onsite"] });
  assert.deepEqual(onsite.allow, ["Berlin"]);
});

test("expandFiltersForScan is idempotent and dedupes case-insensitively", () => {
  const out = expandFiltersForScan({ ...DEFAULT_FILTERS, allow: ["remote"], positive: ["senior"], roleType: ["senior"], workSetup: ["remote"] });
  assert.deepEqual(out.positive, ["senior"]);
  assert.deepEqual(out.allow, ["remote", "Worldwide"]);
});

test("expandFiltersForScan returns filters unchanged when no new axes are set", () => {
  const base = { ...DEFAULT_FILTERS, positive: ["engineer"], allow: ["Berlin"] };
  const out = expandFiltersForScan(base);
  assert.deepEqual(out.positive, ["engineer"]);
  assert.deepEqual(out.allow, ["Berlin"]);
});

test("URL codec round-trips roleType and workSetup", () => {
  const f = { ...DEFAULT_FILTERS, roleType: ["senior", "lead"], workSetup: ["remote", "hybrid"] };
  const restored = paramsToFilters(new URLSearchParams(filtersToParams(f)));
  assert.deepEqual(restored.roleType, ["senior", "lead"]);
  assert.deepEqual(restored.workSetup, ["remote", "hybrid"]);
});
