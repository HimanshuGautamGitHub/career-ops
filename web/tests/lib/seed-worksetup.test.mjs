// Carryover C0 (AGEN-263): the scheduled-scan form's work-setup input must
// pre-fill from the saved preference. AGEN-253 writes `work_setup` as a
// top-level string key in config/profile.yml; seedExploreFilters() is the seam
// that round-trips it into filters.workSetup (an enum array per the AGEN-249
// ExploreFilters contract). These cases run the REAL seeder against a data root.
//
// Run:  node --test tests/lib/seed-worksetup.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import "../helpers/web-ts-alias-loader.mjs";

const { seedExploreFilters } = await import("../../src/lib/core/portals.ts");

/** A data root with config/profile.yml holding the given body. */
async function withProfile(body, fn) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "career-ops-seed-ws-")));
  mkdirSync(path.join(root, "config"));
  writeFileSync(path.join(root, "config", "profile.yml"), body);
  writeFileSync(path.join(root, "config", "profile.example.yml"), "candidate:\n  full_name: Template Person\n");
  const saved = { root: process.env.CAREER_OPS_ROOT, profile: process.env.CAREER_OPS_PROFILE };
  process.env.CAREER_OPS_ROOT = root;
  delete process.env.CAREER_OPS_PROFILE;
  try {
    await fn();
  } finally {
    for (const [key, value] of [["CAREER_OPS_ROOT", saved.root], ["CAREER_OPS_PROFILE", saved.profile]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

test("seedExploreFilters seeds workSetup from the saved work_setup preference", async () => {
  await withProfile("target_roles:\n  primary: [Engineer]\nwork_setup: hybrid\n", () => {
    assert.deepEqual(seedExploreFilters().filters.workSetup, ["hybrid"]);
  });
});

test("seedExploreFilters reports profile.yml as a seed source when work_setup is set", async () => {
  await withProfile("work_setup: remote\n", () => {
    assert.ok(seedExploreFilters().seededFrom.includes("profile.yml"));
  });
});

test("seedExploreFilters leaves workSetup unset when the profile has no work_setup key", async () => {
  await withProfile("target_roles:\n  primary: [Engineer]\n", () => {
    assert.equal(seedExploreFilters().filters.workSetup, undefined);
  });
});

test("seedExploreFilters ignores an out-of-enum work_setup value", async () => {
  await withProfile("work_setup: anywhere\n", () => {
    assert.equal(seedExploreFilters().filters.workSetup, undefined);
  });
});
