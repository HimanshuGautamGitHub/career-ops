#!/usr/bin/env node

/**
 * tests/agent-inbox-approval.test.mjs — the approval-queue surface of
 * agent-inbox.mjs (AGEN-203, backend of AGEN-15).
 *
 * The legacy inbox (add/list/resolve) is covered elsewhere and MUST stay
 * byte-identical; this file locks the NEW behavior layered on top:
 *
 * Seams under test (pre-agreed in docs/designs/APPROVAL_QUEUE_DESIGN.md §6, §8):
 *   - enqueue (and `add --category`): a categorized item lands in the inbox as a
 *     line that parses back to its category/id/ref/sink, and a `queued` ledger
 *     row (actor=agent) is appended beside it.
 *   - bare `list` / `list --all`: unchanged, no category headers (regression guard).
 *   - `list --grouped` / `list --category`: grouped by category, ordered by
 *     category weight then fit (orderApprovals → scorePosting, no second ranker).
 *   - dispositions approve/edit/reject/snooze: append the right ledger event with
 *     actor=user; SUBMIT approve is `self-submitted`; snooze leaves the item pending.
 *   - batch-approve / multi-item approve: refuses when a SUBMIT item is present
 *     (invariant 2), and writes nothing.
 *   - orderApprovals (direct import): category weight precedes fit; intra-tier
 *     order comes from scorePosting.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

import { orderApprovals } from '../agent-inbox.mjs';
import { loadApprovalCategories } from '../lib/approval-schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'agent-inbox.mjs');
const YML = join(ROOT, 'templates', 'approval-categories.yml');

function tmp() {
  return mkdtempSync(join(tmpdir(), 'apr-inbox-'));
}

// Run the CLI against an isolated inbox + ledger in `dir`. The repo-default
// category yml is resolved by the module relative to itself, so no override.
function cli(dir, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CAREER_OPS_INBOX: join(dir, 'agent-inbox.md'),
      CAREER_OPS_APPROVAL_LOG: join(dir, 'approval-log.tsv'),
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function ledgerRows(dir) {
  const p = join(dir, 'approval-log.tsv');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const c = l.split('\t');
      return { id: c[0], ts: c[1], event: c[2], category: c[3], producer: c[4], sink: c[5], ref: c[6], sha: c[7], actor: c[8], note: c[9] };
    });
}

function inboxLines(dir) {
  const p = join(dir, 'agent-inbox.md');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter((l) => /^- \[[ xX]\]/.test(l.trim()));
}

test('enqueue queues a categorized line that parses back, and a queued ledger row', () => {
  const dir = tmp();
  try {
    const r = cli(dir, ['enqueue', '--category', 'submit', '--ref', '042', '--sink', 'form-submit', '--producer', 'apply', 'Acme — Senior ML Engineer']);
    assert.equal(r.code, 0, r.err);
    const lines = inboxLines(dir);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes('[SUBMIT]'), lines[0]);
    assert.ok(/\{id=apr_[0-9a-f]{8} ref=042 sink=form-submit\}/.test(lines[0]), lines[0]);

    const rows = ledgerRows(dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, 'queued');
    assert.equal(rows[0].category, 'submit');
    assert.equal(rows[0].producer, 'apply');
    assert.equal(rows[0].sink, 'form-submit');
    assert.equal(rows[0].ref, '042');
    assert.equal(rows[0].actor, 'agent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('`add --category` is an alias for enqueue', () => {
  const dir = tmp();
  try {
    const r = cli(dir, ['add', '--category', 'resume', '--ref', 'output/cv.pdf', 'Globex — Staff MLE']);
    assert.equal(r.code, 0, r.err);
    const lines = inboxLines(dir);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes('[RESUME]'), lines[0]);
    assert.equal(ledgerRows(dir)[0].category, 'resume');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy `add` + bare `list` stay byte-identical (no category headers, no ledger)', () => {
  const dir = tmp();
  try {
    assert.equal(cli(dir, ['add', 'evaluate https://acme.com/jobs/42']).code, 0);
    assert.equal(cli(dir, ['add', 'draft a follow-up for #7']).code, 0);
    const r = cli(dir, ['list']);
    assert.equal(r.code, 0, r.err);
    // Legacy format is `NN. [ ] <stamp> — <request>`; the stamp is the wall
    // clock, so match structure, not the exact minute. No category header leaks in.
    assert.match(
      r.out,
      /^ 1\. \[ \] \d{4}-\d{2}-\d{2} \d{2}:\d{2} — evaluate https:\/\/acme\.com\/jobs\/42\n 2\. \[ \] \d{4}-\d{2}-\d{2} \d{2}:\d{2} — draft a follow-up for #7\n$/,
      r.out,
    );
    assert.ok(!/\b(SUBMIT|RESUME|MESSAGE|TARGETING|BORDERLINE|PROFILE|GENERAL)\b/.test(r.out), r.out);
    // A legacy add writes no ledger row.
    assert.equal(ledgerRows(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy `list --all` with a resolved item is unchanged', () => {
  const dir = tmp();
  try {
    cli(dir, ['add', 'one']);
    cli(dir, ['add', 'two']);
    cli(dir, ['resolve', '1', '--result', 'done']);
    const r = cli(dir, ['list', '--all']);
    assert.equal(r.code, 0, r.err);
    assert.match(
      r.out,
      /^ 1\. \[x\] \d{4}-\d{2}-\d{2} \d{2}:\d{2} — one → result: done\n 2\. \[ \] \d{4}-\d{2}-\d{2} \d{2}:\d{2} — two\n$/,
      r.out,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('`list --grouped` groups by category and orders by weight (submit before message before targeting)', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'targeting', '--ref', 'portals.yml', 'add fintech keywords']);
    cli(dir, ['enqueue', '--category', 'submit', '--ref', '042', '--sink', 'form-submit', 'Acme — MLE']);
    cli(dir, ['enqueue', '--category', 'message', '--ref', 'output/cover.md', '--sink', 'email', 'Beta — cover letter']);
    const r = cli(dir, ['list', '--grouped']);
    assert.equal(r.code, 0, r.err);
    const iSubmit = r.out.indexOf('SUBMIT');
    const iMessage = r.out.indexOf('MESSAGE');
    const iTargeting = r.out.indexOf('TARGETING');
    assert.ok(iSubmit >= 0 && iMessage >= 0 && iTargeting >= 0, r.out);
    assert.ok(iSubmit < iMessage, `SUBMIT before MESSAGE:\n${r.out}`);
    assert.ok(iMessage < iTargeting, `MESSAGE before TARGETING:\n${r.out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('`list --category submit` shows only SUBMIT items', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'submit', '--ref', '042', '--sink', 'form-submit', 'Acme — MLE']);
    cli(dir, ['enqueue', '--category', 'resume', '--ref', 'output/cv.pdf', 'Beta — CV']);
    const r = cli(dir, ['list', '--category', 'submit']);
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes('Acme'), r.out);
    assert.ok(!r.out.includes('Beta'), r.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('approve a RESUME item: ticks it, records event=approved actor=user', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'resume', '--ref', 'output/cv.pdf', 'Globex — Staff MLE']);
    const r = cli(dir, ['approve', '1']);
    assert.equal(r.code, 0, r.err);
    assert.ok(inboxLines(dir)[0].includes('[x]'), inboxLines(dir)[0]);
    assert.ok(/→ result: approved/.test(inboxLines(dir)[0]), inboxLines(dir)[0]);
    const last = ledgerRows(dir).at(-1);
    assert.equal(last.event, 'approved');
    assert.equal(last.actor, 'user');
    assert.equal(last.category, 'resume');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('approve a SUBMIT item (single): records self-submitted, never `approved`', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'submit', '--ref', '042', '--sink', 'form-submit', 'Acme — MLE']);
    const r = cli(dir, ['approve', '1']);
    assert.equal(r.code, 0, r.err);
    const last = ledgerRows(dir).at(-1);
    assert.equal(last.event, 'self-submitted');
    assert.equal(last.actor, 'user');
    assert.ok(inboxLines(dir)[0].includes('→ result: self-submitted'), inboxLines(dir)[0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reject a BORDERLINE item records `discard`; a RESUME reject records `rejected`', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'borderline', 'Acme — grey-zone role']);
    cli(dir, ['enqueue', '--category', 'resume', '--ref', 'output/cv.pdf', 'Beta — CV']);
    assert.equal(cli(dir, ['reject', '1']).code, 0);
    assert.equal(cli(dir, ['reject', '2']).code, 0);
    const events = ledgerRows(dir).filter((r) => r.actor === 'user').map((r) => r.event);
    assert.ok(events.includes('discard'), JSON.stringify(events));
    assert.ok(events.includes('rejected'), JSON.stringify(events));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('snooze leaves the item pending and records event=deferred', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'resume', '--ref', 'output/cv.pdf', 'Globex — CV']);
    const r = cli(dir, ['snooze', '1']);
    assert.equal(r.code, 0, r.err);
    // Still pending — no [x], no result suffix.
    assert.ok(inboxLines(dir)[0].includes('[ ]'), inboxLines(dir)[0]);
    assert.ok(!/→ result:/.test(inboxLines(dir)[0]), inboxLines(dir)[0]);
    assert.equal(ledgerRows(dir).at(-1).event, 'deferred');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --expect is the same loud-failure "right command, wrong target" guard `resolve`
// honors. A disposition (approve/edit/reject/snooze/batch-approve) that silently
// swallows it is a safety regression: the caller asked to confirm the target and
// the queue skipped the check. These lock it in for the disposition verbs.
test('disposition --expect: a mismatched substring aborts loudly, writing no tick and no ledger row', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'resume', '--ref', 'output/cv.pdf', 'Globex — Staff MLE']);
    const before = ledgerRows(dir).length;
    const r = cli(dir, ['approve', '1', '--expect', 'Acme']);
    assert.notEqual(r.code, 0, 'approve with a mismatched --expect must fail');
    assert.ok(/expect/i.test(r.err), r.err);
    // Nothing written: item still pending, no new ledger row.
    assert.ok(inboxLines(dir)[0].includes('[ ]'), inboxLines(dir)[0]);
    assert.ok(!/→ result:/.test(inboxLines(dir)[0]), inboxLines(dir)[0]);
    assert.equal(ledgerRows(dir).length, before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('disposition --expect: a matching substring proceeds and records the event', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'resume', '--ref', 'output/cv.pdf', 'Globex — Staff MLE']);
    const r = cli(dir, ['approve', '1', '--expect', 'Globex']);
    assert.equal(r.code, 0, r.err);
    assert.ok(inboxLines(dir)[0].includes('[x]'), inboxLines(dir)[0]);
    assert.equal(ledgerRows(dir).at(-1).event, 'approved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('disposition --expect: a bare --expect (no value) is a usage error, never a skipped guard', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'resume', '--ref', 'output/cv.pdf', 'Globex — CV']);
    const r = cli(dir, ['approve', '1', '--expect']);
    assert.notEqual(r.code, 0, 'a bare --expect must fail, not silently pass');
    assert.ok(inboxLines(dir)[0].includes('[ ]'), inboxLines(dir)[0]);
    assert.equal(ledgerRows(dir).length, 1); // only the queued row
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('batch-approve honors --expect against every picked item', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'resume', '--ref', 'output/a.pdf', 'Acme — CV']);
    cli(dir, ['enqueue', '--category', 'resume', '--ref', 'output/b.pdf', 'Beta — CV']);
    const before = ledgerRows(dir).length;
    // 'Acme' is in item 1 but not item 2 — the batch must abort whole.
    const r = cli(dir, ['batch-approve', '1', '2', '--expect', 'Acme']);
    assert.notEqual(r.code, 0, 'batch-approve with an --expect that misses one item must fail');
    assert.ok(inboxLines(dir)[0].includes('[ ]'), inboxLines(dir)[0]);
    assert.ok(inboxLines(dir)[1].includes('[ ]'), inboxLines(dir)[1]);
    assert.equal(ledgerRows(dir).length, before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('batch-approve refuses when a SUBMIT item is present and writes nothing', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'resume', '--ref', 'output/cv.pdf', 'Beta — CV']);
    cli(dir, ['enqueue', '--category', 'submit', '--ref', '042', '--sink', 'form-submit', 'Acme — MLE']);
    const before = ledgerRows(dir).length;
    const r = cli(dir, ['batch-approve', '1', '2']);
    assert.notEqual(r.code, 0);
    assert.ok(/SUBMIT/i.test(r.err), r.err);
    // No approving rows appended, both items still pending.
    assert.equal(ledgerRows(dir).length, before);
    assert.ok(inboxLines(dir).every((l) => l.includes('[ ]')), inboxLines(dir).join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('batch-approve of non-SUBMIT items approves them all', () => {
  const dir = tmp();
  try {
    cli(dir, ['enqueue', '--category', 'resume', '--ref', 'output/cv.pdf', 'Beta — CV']);
    cli(dir, ['enqueue', '--category', 'message', '--ref', 'output/cover.md', '--sink', 'email', 'Gamma — cover']);
    const r = cli(dir, ['batch-approve', '1', '2']);
    assert.equal(r.code, 0, r.err);
    assert.ok(inboxLines(dir).every((l) => l.includes('[x]')), inboxLines(dir).join('\n'));
    const userEvents = ledgerRows(dir).filter((x) => x.actor === 'user').map((x) => x.event);
    assert.deepEqual(userEvents.sort(), ['approved', 'approved']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orderApprovals: category weight precedes fit (direct import, no second ranker)', () => {
  const categories = loadApprovalCategories(YML);
  // targeting has a perfect-fit headline; submit does not — submit still wins on weight.
  const profile = { target_roles: { primary: ['ML Engineer'] } };
  const items = [
    { num: 1, done: false, category: 'targeting', headline: 'Senior ML Engineer targeting tweak', line: 0 },
    { num: 2, done: false, category: 'submit', headline: 'Acme — Office Manager', line: 1 },
  ];
  const ordered = orderApprovals(items, { profile, categories });
  assert.equal(ordered[0].category, 'submit', 'category weight must precede fit');
  assert.equal(ordered[1].category, 'targeting');
});

test('orderApprovals: within a tier, higher scorePosting fit sorts first', () => {
  const categories = loadApprovalCategories(YML);
  const profile = { target_roles: { primary: ['ML Engineer'] } };
  const items = [
    { num: 1, done: false, category: 'message', headline: 'Beta — Office Clerk', line: 0 },
    { num: 2, done: false, category: 'message', headline: 'Acme — Senior ML Engineer', line: 1 },
  ];
  const ordered = orderApprovals(items, { profile, categories });
  assert.equal(ordered[0].headline, 'Acme — Senior ML Engineer', 'the fitter posting leads its tier');
} );
