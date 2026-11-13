import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

// AGEN-252: POST /api/liveness/discard is the ONLY place a dead posting is
// auto-retired. It shells `check-liveness.mjs --tracker --discard-expired
// --no-fallback --json` (the confirmed-dead-only sweep — never Playwright,
// never uncertain) and normalizes its stdout into { planned, applied, errors,
// unreadable }. These tests drive the real handler against a stand-in CLI so
// the flag assembly and the dryRun default are pinned: the write flag (--apply)
// must appear only when the caller explicitly asks for it.

const codeRoot = mkdtempSync(join(tmpdir(), "co-liveness-route-code-"));
const dataRoot = mkdtempSync(join(tmpdir(), "co-liveness-route-data-"));
const ENV_KEYS = ["CAREER_OPS_CODE_ROOT", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const realExecFile = childProcess.execFile;
let launches = [];

// A stand-in for the core CLI: emits the JSON contract Slice 1 pins, and
// branches on --apply so the test can see dry-run vs apply shaping.
const STAND_IN = `
const apply = process.argv.includes('--apply');
const row = { num: 1, company: 'Acme', role: 'Engineer', url: 'https://job-boards.greenhouse.io/acme/jobs/1' };
process.stdout.write(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  summary: { active: 1, expired: 1, uncertain: 0, viaApi: 2 },
  planned: [row],
  results: [{ ...row, changed: true, dryRun: !apply }],
  unreadable: [],
}) + '\\n');
`;

before(() => {
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  process.env.CAREER_OPS_ROOT = dataRoot;
  process.env.CAREER_OPS_DATA_DIR = "";
  process.env.CAREER_OPS_TRACKER = "";
  writeFileSync(join(codeRoot, "check-liveness.mjs"), STAND_IN);
  childProcess.execFile = function recordingExecFile(file, args, options, callback) {
    launches.push({ file, args });
    return realExecFile.call(this, file, args, options, callback);
  };
  syncBuiltinESMExports();
});

after(() => {
  childProcess.execFile = realExecFile;
  syncBuiltinESMExports();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(codeRoot, { recursive: true, force: true });
  rmSync(dataRoot, { recursive: true, force: true });
});

const loadRoute = () => import("@/app/api/liveness/discard/route.ts");
const post = (body) =>
  new Request("http://localhost/api/liveness/discard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? "" : JSON.stringify(body),
  });

async function call(body) {
  launches = [];
  const { POST } = await loadRoute();
  const res = await POST(post(body));
  return { status: res.status, body: await res.json(), args: launches[0]?.args ?? [] };
}

test("default (no body) is a dry-run: never passes --apply, applies nothing", async () => {
  const { status, body, args } = await call(undefined);
  assert.equal(status, 200);
  assert.ok(args.includes("--tracker") && args.includes("--discard-expired"), args.join(" "));
  assert.ok(args.includes("--no-fallback"), `must skip Playwright: ${args.join(" ")}`);
  assert.ok(args.includes("--json"), args.join(" "));
  assert.ok(!args.includes("--apply"), `dry-run must never write: ${args.join(" ")}`);
  assert.deepEqual(body.planned, [{ num: 1, company: "Acme", role: "Engineer", url: "https://job-boards.greenhouse.io/acme/jobs/1" }]);
  assert.deepEqual(body.applied, []);
});

test("dryRun:false opts into the write: passes --apply and reports it applied", async () => {
  const { status, body, args } = await call({ dryRun: false });
  assert.equal(status, 200);
  assert.ok(args.includes("--apply"), `explicit apply must write: ${args.join(" ")}`);
  assert.deepEqual(body.applied, [{ num: 1, company: "Acme", role: "Engineer", url: "https://job-boards.greenhouse.io/acme/jobs/1" }]);
});

test("dryRun:true is explicit dry-run: same as default, no --apply", async () => {
  const { args } = await call({ dryRun: true });
  assert.ok(!args.includes("--apply"), args.join(" "));
});
