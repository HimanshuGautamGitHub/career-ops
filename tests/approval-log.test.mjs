#!/usr/bin/env node

/**
 * tests/approval-log.test.mjs — the append-only provenance ledger
 * (lib/approval-log.mjs), mirroring set-status.mjs → status-log.tsv.
 *
 * Seams under test (docs/designs/APPROVAL_QUEUE_DESIGN.md §4.2, §6):
 *   - resolveApprovalLogPath: sibling of the inbox file, CAREER_OPS_APPROVAL_LOG override.
 *   - appendApprovalRows: validates every row through assertLedgerRowLegal before
 *     writing (a machine-made approval never reaches disk), serializes via the
 *     schema, newline-safe append.
 *   - readApprovalLog: round-trips the rows back; a malformed line is skipped quietly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  resolveApprovalLogPath,
  appendApprovalRows,
  readApprovalLog,
} from '../lib/approval-log.mjs';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'apr-log-'));
}

test('resolveApprovalLogPath: sibling approval-log.tsv of the inbox file', () => {
  assert.equal(
    resolveApprovalLogPath('/x/data/agent-inbox.md'),
    join('/x/data', 'approval-log.tsv'),
  );
});

test('resolveApprovalLogPath: CAREER_OPS_APPROVAL_LOG overrides', () => {
  const prev = process.env.CAREER_OPS_APPROVAL_LOG;
  process.env.CAREER_OPS_APPROVAL_LOG = '/custom/ledger.tsv';
  try {
    assert.equal(resolveApprovalLogPath('/x/data/agent-inbox.md'), '/custom/ledger.tsv');
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_APPROVAL_LOG;
    else process.env.CAREER_OPS_APPROVAL_LOG = prev;
  }
});

test('appendApprovalRows then readApprovalLog round-trips the rows', () => {
  const dir = tmp();
  try {
    const log = join(dir, 'approval-log.tsv');
    appendApprovalRows(log, [
      { id: 'apr_1', ts: '2026-11-11 14:30', event: 'queued', category: 'submit', producer: 'apply', sink: 'form-submit', ref: '042', sha: '9c1f', actor: 'agent', note: 'filled 7 fields' },
      { id: 'apr_1', ts: '2026-11-11 15:02', event: 'self-submitted', category: 'submit', producer: 'apply', sink: 'form-submit', ref: '042', sha: '9c1f', actor: 'user', note: '' },
    ]);
    const rows = readApprovalLog(log);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].event, 'queued');
    assert.equal(rows[0].actor, 'agent');
    assert.equal(rows[0].note, 'filled 7 fields');
    assert.equal(rows[1].event, 'self-submitted');
    assert.equal(rows[1].actor, 'user');
    assert.equal(rows[1].note, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appendApprovalRows refuses a machine-made approval (invariant 3) and writes nothing', () => {
  const dir = tmp();
  try {
    const log = join(dir, 'approval-log.tsv');
    assert.throws(
      () => appendApprovalRows(log, [
        { id: 'apr_2', ts: 't', event: 'approved', category: 'resume', producer: 'pdf', sink: 'file', ref: 'output/cv.pdf', sha: '-', actor: 'agent', note: '' },
      ]),
      /actor=user/,
    );
    // Nothing partial on disk: the whole batch is validated before any write.
    assert.throws(() => readFileSync(log, 'utf-8'), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appendApprovalRows is newline-safe on a file missing a trailing newline', () => {
  const dir = tmp();
  try {
    const log = join(dir, 'approval-log.tsv');
    writeFileSync(log, 'apr_0\tt\tqueued\tresume\tpdf\tfile\tref\t-\tagent\t-', 'utf-8'); // no trailing \n
    appendApprovalRows(log, [
      { id: 'apr_1', ts: 't', event: 'queued', category: 'resume', producer: 'pdf', sink: 'file', ref: 'ref', sha: '-', actor: 'agent', note: '' },
    ]);
    const rows = readApprovalLog(log);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 'apr_0');
    assert.equal(rows[1].id, 'apr_1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readApprovalLog skips a malformed line quietly', () => {
  const dir = tmp();
  try {
    const log = join(dir, 'approval-log.tsv');
    writeFileSync(
      log,
      [
        'apr_1\t2026-11-11 14:30\tqueued\tresume\tpdf\tfile\tref\t-\tagent\t-',
        'this is not a ledger row',
        '', // blank
        'apr_2\t2026-11-11 14:40\tapproved\tresume\tpdf\tfile\tref\t-\tuser\t-',
      ].join('\n'),
      'utf-8',
    );
    const rows = readApprovalLog(log);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.id), ['apr_1', 'apr_2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readApprovalLog on a missing file returns []', () => {
  assert.deepEqual(readApprovalLog(join(tmpdir(), 'does-not-exist-approval-log.tsv')), []);
});
