// docs/AUTOMATION_SETUP.md is the candidate-facing automation runbook. It names
// web UI pages, repo scripts, sibling docs, and two AUTOMATION.md anchors. Each of
// those is a thing that can be renamed or moved out from under the doc, so this
// guards the doc against silent drift: a renamed nav label, a moved installer
// script, or a reworded AUTOMATION.md heading fails CI here instead of handing a
// candidate a dead link or a page that no longer exists.
//
// Run: node --test tests/automation-setup-doc.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const doc = readFileSync(join(ROOT, 'docs', 'AUTOMATION_SETUP.md'), 'utf8');

test('every web page the runbook lists is a real nav item', () => {
  const navItems = readFileSync(join(ROOT, 'web', 'src', 'lib', 'nav-items.ts'), 'utf8');
  // The runbook documents each page as `**Name** (`/href`)` in its table.
  const documented = [...doc.matchAll(/\*\*([^*]+)\*\*\s*\(`(\/[a-z-]*)`\)/g)]
    .map((m) => ({ label: m[1].trim(), href: m[2] }));
  assert.ok(documented.length >= 6, `expected the page table to list >=6 pages, found ${documented.length}`);
  for (const { href } of documented) {
    assert.match(
      navItems,
      new RegExp(`href:\\s*"${href.replace(/[/]/g, '\\/')}"`),
      `runbook documents page "${href}" but web/src/lib/nav-items.ts has no such nav item`,
    );
  }
});

test('every repo script and doc the runbook references exists', () => {
  const referenced = [
    'scan.mjs',
    'scan-ats-full.mjs',
    'web/scripts/scheduled-jobs-runner.mjs',
    'web/scripts/install-scan-schedule.sh',
    'web/scripts/uninstall-scan-schedule.sh',
    'web/scripts/install-scan-schedule.ps1',
    'docs/AUTOMATION.md',
    'docs/WEB_UI.md',
    'docs/SETUP.md',
    'DATA_CONTRACT.md',
    'AGENTS.md',
  ];
  for (const rel of referenced) {
    assert.ok(doc.includes(rel.split('/').pop()) || doc.includes(rel),
      `runbook should reference ${rel} but does not mention it`);
    assert.ok(existsSync(join(ROOT, rel)), `runbook references ${rel} but that path does not exist`);
  }
});

test('the two AUTOMATION.md anchors the runbook links to are real headings', () => {
  const automation = readFileSync(join(ROOT, 'docs', 'AUTOMATION.md'), 'utf8');
  const slug = (heading) =>
    heading.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  const headingSlugs = new Set(
    [...automation.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slug(m[1])),
  );
  const linkedAnchors = [...doc.matchAll(/\(AUTOMATION\.md#([a-z0-9-]+)\)/g)].map((m) => m[1]);
  assert.ok(linkedAnchors.length >= 2, `expected >=2 AUTOMATION.md anchor links, found ${linkedAnchors.length}`);
  for (const anchor of linkedAnchors) {
    assert.ok(headingSlugs.has(anchor),
      `runbook links AUTOMATION.md#${anchor} but no heading in AUTOMATION.md slugifies to that`);
  }
});

test('the verification snippet uses CAREER_OPS_ROOT so it never touches real user data', () => {
  assert.match(doc, /CAREER_OPS_ROOT=/, 'the verify snippet must run against a throwaway CAREER_OPS_ROOT');
  assert.match(doc, /mktemp/, 'the verify snippet should build a scratch data root with mktemp');
});
