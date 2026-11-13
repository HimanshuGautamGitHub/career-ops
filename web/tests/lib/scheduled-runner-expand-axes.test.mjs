/**
 * scheduled-runner-expand-axes.test.mjs — proves the SCHEDULED-scan path folds
 * the coarse roleType / workSetup axes (AGEN-254) into the title/location
 * filters the scanner actually reads, exactly as the ephemeral Explorer path
 * does (portals-expand-axes.test.mjs). The scheduled runner (.mjs) runs in
 * production as plain `node`, so the fold has to reach it through the shared
 * explore-expand.mjs, not the TypeScript codec in explore.ts.
 *
 * Mechanism mirrors the overlay-capture pattern already used in
 * scheduled-jobs-runner.test.mjs: a stub spawnFn reads back the portals overlay
 * executeJob -> writeJobPortals wrote to CAREER_OPS_PORTALS.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";

import { executeJob } from "../../scripts/scheduled-jobs-runner.mjs";

/** Run executeJob against a throwaway root and return the portals overlay the
 *  runner wrote (the stub spawnFn captures it, then reports a clean scan). */
function overlayFor(filters) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-scheduled-axes-"));
  fs.writeFileSync(
    path.join(temp, "portals.yml"),
    "title_filter:\n  positive: [engineer]\nlocation_filter: {}\n",
    "utf8",
  );
  try {
    let overlay;
    const result = executeJob(
      temp,
      { id: "22222222-2222-4222-8222-222222222222", engine: "full", filters },
      {
        spawnFn: (_node, _args, options) => {
          overlay = yaml.load(fs.readFileSync(options.env.CAREER_OPS_PORTALS, "utf8"));
          return { status: 0, stdout: JSON.stringify({ postingsKept: 0 }), stderr: "" };
        },
      },
    );
    assert.equal(result.state, "success");
    return overlay;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test("scheduled overlay folds roleType into title_filter.positive and workSetup into location_filter.allow", () => {
  const overlay = overlayFor({
    positive: ["engineer"],
    allow: [],
    roleType: ["senior"],
    workSetup: ["remote"],
  });
  // roleType APPENDS seniority keywords; the user's explicit "engineer" survives.
  assert.ok(overlay.title_filter.positive.includes("engineer"), "keeps explicit keyword");
  assert.ok(overlay.title_filter.positive.includes("senior"), "folds senior keyword");
  // workSetup APPENDS allow-list entries.
  assert.ok(overlay.location_filter.allow.includes("Remote"), "folds Remote allow entry");
  assert.ok(overlay.location_filter.allow.includes("Worldwide"), "folds Worldwide allow entry");
});

test("scheduled overlay is untouched when no roleType / workSetup axes are set", () => {
  const overlay = overlayFor({ positive: ["designer"], allow: ["Berlin"] });
  assert.deepEqual(overlay.title_filter.positive, ["designer"]);
  assert.deepEqual(overlay.location_filter.allow, ["Berlin"]);
});

test("scheduled overlay folds multiple axes and de-dupes against explicit chips", () => {
  const overlay = overlayFor({
    positive: ["senior"],
    allow: ["Remote"],
    roleType: ["senior", "staff"],
    workSetup: ["remote", "hybrid"],
  });
  // "senior" already present, so the fold must not duplicate it.
  assert.equal(
    overlay.title_filter.positive.filter((t) => t === "senior").length,
    1,
    "no duplicate senior",
  );
  assert.ok(overlay.title_filter.positive.includes("staff"), "folds staff keyword");
  assert.equal(
    overlay.location_filter.allow.filter((l) => l === "Remote").length,
    1,
    "no duplicate Remote",
  );
  assert.ok(overlay.location_filter.allow.includes("Hybrid"), "folds Hybrid allow entry");
});
