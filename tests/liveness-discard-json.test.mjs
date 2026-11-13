import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

// AGEN-252: the web route POST /api/liveness/discard shells `check-liveness.mjs
// --tracker --discard-expired --json` and parses stdout. The route is the only
// place a dead posting is auto-retired, so its input must be an unambiguous
// machine contract — never human text scraped with a regex. These tests pin
// that contract: stdout is exactly one JSON object, and the confirmed-only
// safety the library already enforces (tests/liveness-core.test.mjs) survives
// serialization — a live posting is never planned for discard.

const EXPIRED_URL = 'https://job-boards.greenhouse.io/acme/jobs/1';
const LIVE_URL = 'https://job-boards.greenhouse.io/globex/jobs/2';

function sandbox(t, rows, reportUrls) {
  const root = mkdtempSync(join(tmpdir(), 'liveness-json-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, 'data');
  const reportsDir = join(root, 'reports');
  mkdirSync(data, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  const trackerPath = join(data, 'applications.md');
  writeFileSync(trackerPath, [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...rows,
    '',
  ].join('\n'));
  for (const [name, url] of Object.entries(reportUrls)) writeFileSync(join(reportsDir, name), `**URL:** ${url}\n`);
  // Same stubbed-ATS harness tracker-liveness.test.mjs uses: the Greenhouse
  // board API answers 404 for acme/jobs/1 (hard-expired) and 200 JSON for the
  // rest (active), so every verdict resolves via the API rung — no browser.
  const stub = join(root, 'ats-stub.mjs');
  writeFileSync(stub, [
    `globalThis.fetch = async (url) => String(url).endsWith('/boards/acme/jobs/1')`,
    `  ? new Response('', { status: 404 })`,
    `  : new Response('{"id":2}', { status: 200, headers: { 'content-type': 'application/json' } });`,
  ].join('\n'));
  const run = (...flags) => spawnSync(
    process.execPath,
    ['--import', pathToFileURL(stub).href, join(ROOT, 'check-liveness.mjs'),
      '--tracker', '--discard-expired', '--no-record', '--no-fallback', '--json', ...flags],
    { env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: data }, encoding: 'utf8', timeout: 60_000 },
  );
  return { trackerPath, run };
}

test('--json emits exactly one JSON object on stdout, no human text', (t) => {
  const { run } = sandbox(t, [
    '| 1 | 2026-09-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme.md) | |',
    '| 2 | 2026-09-02 | Globex | Engineer | 4.0/5 | Evaluated | ❌ | [2](../reports/002-globex.md) | |',
  ], { '001-acme.md': EXPIRED_URL, '002-globex.md': LIVE_URL });
  const result = run();
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout.trim()); },
    `stdout was not a single JSON object:\n${result.stdout}\n---stderr---\n${result.stderr}`);
  assert.equal(typeof parsed, 'object');
  assert.equal(parsed.mode, 'dry-run');
});

test('--json plans only the confirmed-dead Evaluated row, never the live one', (t) => {
  const { trackerPath, run } = sandbox(t, [
    '| 1 | 2026-09-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme.md) | |',
    '| 2 | 2026-09-02 | Globex | Engineer | 4.0/5 | Evaluated | ❌ | [2](../reports/002-globex.md) | |',
    '| 3 | 2026-09-03 | Acme | Engineer | 4.0/5 | Applied | ❌ | [3](../reports/003-acme.md) | |',
  ], { '001-acme.md': EXPIRED_URL, '002-globex.md': LIVE_URL, '003-acme.md': EXPIRED_URL });
  const before = readFileSync(trackerPath, 'utf8');
  const parsed = JSON.parse(run().stdout.trim());
  assert.deepEqual(parsed.planned, [
    { num: 1, company: 'Acme', role: 'Engineer', url: EXPIRED_URL },
  ]);
  assert.equal(parsed.results.length, 1);
  // dryRun:true is the "nothing written" signal; changed:true means "would
  // change" (set-status --dry-run reports the write it would make). The real
  // safety guarantee is the byte-identical tracker below.
  assert.equal(parsed.results[0].dryRun, true);
  assert.equal(parsed.results[0].changed, true);
  // dry-run writes nothing.
  assert.equal(readFileSync(trackerPath, 'utf8'), before);
  // summary reflects the real sweep: the live posting counted active.
  assert.equal(parsed.summary.expired, 1);
  assert.equal(parsed.summary.active, 1);
});

test('--json --apply reports the written change', (t) => {
  const { trackerPath, run } = sandbox(t, [
    '| 1 | 2026-09-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme.md) | |',
    '| 2 | 2026-09-02 | Globex | Engineer | 4.0/5 | Evaluated | ❌ | [2](../reports/002-globex.md) | |',
  ], { '001-acme.md': EXPIRED_URL, '002-globex.md': LIVE_URL });
  const parsed = JSON.parse(run('--apply').stdout.trim());
  assert.equal(parsed.mode, 'apply');
  assert.equal(parsed.results.length, 1);
  assert.equal(parsed.results[0].num, 1);
  assert.equal(parsed.results[0].changed, true);
  assert.equal(parsed.results[0].dryRun, false);
  const row1 = readFileSync(trackerPath, 'utf8').split('\n').find((l) => /^\| 1 \|/.test(l));
  assert.match(row1, /\| Discarded \|.*posting closed \d{4}-\d{2}-\d{2}/);
});
