/**
 * portals-expand-axes.test.mjs — proves writeTempPortals folds the coarse
 * roleType / workSetup axes (AGEN-254) into the title/location filters the
 * scanner actually reads, end to end: the pure fold lives in explore.ts and is
 * unit-tested separately; this confirms the EPHEMERAL file on disk carries the
 * expansion.
 *
 * core/portals.ts imports through the `@/` alias, which Node does not resolve on
 * its own, so each case runs in a child process with the web alias loader
 * registered (mirrors web-ts-alias-loader.test.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..", "..");
const LOADER = pathToFileURL(path.join(HERE, "..", "helpers", "web-ts-alias-loader.mjs")).href;

/** Run writeTempPortals in a child with the given filters, return the YAML text
 *  it wrote (the child prints the file to stdout, then deletes it). */
function writtenPortals(filters) {
  // An empty CAREER_OPS_ROOT means no real portals.yml → ENOENT → no workplace
  // policy overlay, so the output is purely the serialized (expanded) filters.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "portals-expand-"));
  const src = `
    import { writeTempPortals, cleanupTempPortals } from "@/lib/core/portals";
    import fs from "node:fs";
    const file = writeTempPortals(${JSON.stringify(filters)});
    process.stdout.write(fs.readFileSync(file, "utf8"));
    cleanupTempPortals(file);
  `;
  try {
    return execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--import", LOADER, "--input-type=module", "-e", src],
      { cwd: WEB, encoding: "utf8", timeout: 60000, env: { ...process.env, CAREER_OPS_ROOT: root } },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const base = {
  preset: "custom",
  employers: [],
  positive: ["engineer"],
  negative: [],
  allow: ["Berlin"],
  block: [],
  alwaysAllow: [],
  blockHard: [],
  ats: [],
};

test("writeTempPortals folds roleType keywords into title_filter.positive", () => {
  const yaml = writtenPortals({ ...base, roleType: ["senior", "lead"] });
  assert.match(yaml, /positive:/);
  assert.match(yaml, /"engineer"/);
  assert.match(yaml, /"senior"/);
  assert.match(yaml, /"lead"/);
});

test("writeTempPortals folds workSetup onto location_filter.allow", () => {
  const yaml = writtenPortals({ ...base, workSetup: ["remote"] });
  assert.match(yaml, /"Berlin"/);
  assert.match(yaml, /"Remote"/);
  assert.match(yaml, /"Worldwide"/);
});

test("writeTempPortals is unchanged when the new axes are unset", () => {
  const yaml = writtenPortals({ ...base });
  assert.match(yaml, /"engineer"/);
  assert.match(yaml, /"Berlin"/);
  assert.doesNotMatch(yaml, /"senior"|"Worldwide"/);
});
