#!/usr/bin/env node

/**
 * tests/approval-schema.test.mjs — unit tests for lib/approval-schema.mjs.
 *
 * Locks the pure data-model seam for the approval queue (AGEN-203, backend of
 * AGEN-15). Nothing here touches the filesystem except reading the canonical
 * taxonomy yml that ships in the repo.
 *
 * Seams under test (pre-agreed in docs/designs/APPROVAL_QUEUE_DESIGN.md §8):
 *   - loadApprovalCategories: the six categories load from the yml, frozen,
 *     keyed by id; SUBMIT is non-batchable by construction.
 *   - mintApprovalId: `apr_<8 hex>`, collision-resistant, injectable rng.
 *   - serializeInboxLine → parseInboxText round-trip preserves category/id/ref/
 *     sink; a legacy (untagged) line parses as GENERAL and never throws.
 *   - serializeLedgerRow: tab-joined, `-` sentinel for empties, newline-safe.
 *   - the three ethical invariants (isBatchable / assertBatchApprovable /
 *     assertLedgerRowLegal).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  loadApprovalCategories,
  mintApprovalId,
  serializeInboxLine,
  parseInboxText,
  serializeLedgerRow,
  isBatchable,
  assertBatchApprovable,
  assertLedgerRowLegal,
} from '../lib/approval-schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YML = join(ROOT, 'templates', 'approval-categories.yml');

test('loadApprovalCategories: the six categories load, frozen, keyed by id', () => {
  const cats = loadApprovalCategories(YML);
  assert.ok(cats instanceof Map);
  for (const id of ['submit', 'borderline', 'message', 'resume', 'profile', 'targeting']) {
    assert.ok(cats.has(id), `missing category ${id}`);
  }
  const submit = cats.get('submit');
  assert.equal(submit.label, 'SUBMIT');
  assert.equal(submit.weight, 100);
  assert.equal(submit.batchable, false);
  // Frozen so no consumer can mutate the shared vocabulary.
  assert.ok(Object.isFrozen(submit));
  assert.throws(() => { submit.weight = 1; });
});

test('loadApprovalCategories: SUBMIT is non-batchable by construction (defensive)', () => {
  const cats = loadApprovalCategories(YML);
  assert.equal(cats.get('submit').batchable, false);
  // every other category is batchable
  for (const id of ['borderline', 'message', 'resume', 'profile', 'targeting']) {
    assert.equal(cats.get(id).batchable, true, `${id} should be batchable`);
  }
});

test('mintApprovalId: apr_ + 8 hex, injectable rng', () => {
  // Independent source of truth: a fixed 4-byte buffer → a known hex string.
  const fixed = () => Buffer.from([0x1a, 0x2b, 0x3c, 0x4d]);
  assert.equal(mintApprovalId(fixed), 'apr_1a2b3c4d');
  // Default path produces the right shape.
  assert.match(mintApprovalId(), /^apr_[0-9a-f]{8}$/);
});

test('serializeInboxLine → parseInboxText round-trips category/id/ref/sink', () => {
  const item = {
    id: 'apr_1a2b3c4d',
    category: 'submit',
    headline: 'Acme — Senior ML Engineer',
    ref: '042',
    sink: 'form-submit',
    queuedAt: '2026-11-11 14:30',
  };
  const line = serializeInboxLine(item);
  // The leading prefix must be byte-identical to a legacy checklist item so the
  // existing agent-inbox parser sees it unchanged.
  assert.ok(line.startsWith('- [ ] 2026-11-11 14:30 — '), line);
  assert.ok(line.includes('[SUBMIT]'), line);

  // parseInboxText takes the free-text field (everything after the prefix).
  const text = line.replace(/^- \[ \] 2026-11-11 14:30 — /, '');
  const parsed = parseInboxText(text);
  assert.equal(parsed.category, 'submit');
  assert.equal(parsed.id, 'apr_1a2b3c4d');
  assert.equal(parsed.headline, 'Acme — Senior ML Engineer');
  assert.equal(parsed.meta.ref, '042');
  assert.equal(parsed.meta.sink, 'form-submit');
});

test('parseInboxText: a legacy untagged line parses as GENERAL and never throws', () => {
  const parsed = parseInboxText('evaluate https://acme.com/jobs/42');
  assert.equal(parsed.category, 'general');
  assert.equal(parsed.id, null);
  assert.equal(parsed.headline, 'evaluate https://acme.com/jobs/42');
});

test('parseInboxText: tolerates a resolved line (strips the → result: suffix)', () => {
  const parsed = parseInboxText('[RESUME] Globex — Staff MLE {id=apr_9f8e7d6c ref=output/cv.pdf sink=file} → result: approved');
  assert.equal(parsed.category, 'resume');
  assert.equal(parsed.id, 'apr_9f8e7d6c');
  assert.equal(parsed.headline, 'Globex — Staff MLE');
  assert.equal(parsed.meta.sink, 'file');
});

test('serializeLedgerRow: tab-joined, `-` sentinel for empty cells, newline-terminated', () => {
  const row = {
    id: 'apr_1a2b3c4d',
    ts: '2026-11-11 14:30',
    event: 'queued',
    category: 'submit',
    producer: 'apply',
    sink: 'form-submit',
    ref: '042',
    sha: '',
    actor: 'agent',
    note: '',
  };
  const out = serializeLedgerRow(row);
  assert.ok(out.endsWith('\n'));
  const cells = out.slice(0, -1).split('\t');
  assert.deepEqual(cells, [
    'apr_1a2b3c4d', '2026-11-11 14:30', 'queued', 'submit',
    'apply', 'form-submit', '042', '-', 'agent', '-',
  ]);
});

test('serializeLedgerRow: sanitizes embedded tabs/newlines in the note so a row stays one line', () => {
  const out = serializeLedgerRow({
    id: 'apr_x', ts: 't', event: 'queued', category: 'resume', producer: 'pdf',
    sink: 'file', ref: 'output/cv.pdf', sha: '-', actor: 'agent',
    note: 'filled\t7\nfields',
  });
  assert.equal(out.split('\n').filter(Boolean).length, 1);
  assert.ok(!out.slice(0, -1).includes('\t\t'));
});

test('INVARIANT 1 — SUBMIT is never batchable', () => {
  assert.equal(isBatchable('submit'), false);
  for (const id of ['borderline', 'message', 'resume', 'profile', 'targeting']) {
    assert.equal(isBatchable(id), true);
  }
});

test('INVARIANT 2 — a batch approve refuses when a SUBMIT item is present', () => {
  assert.throws(
    () => assertBatchApprovable([
      { id: 'apr_1', category: 'resume' },
      { id: 'apr_2', category: 'submit' },
    ]),
    /SUBMIT/,
  );
  // A batch with no SUBMIT item is fine.
  assert.doesNotThrow(() => assertBatchApprovable([
    { id: 'apr_1', category: 'resume' },
    { id: 'apr_2', category: 'message' },
  ]));
});

test('INVARIANT 3 — an approving ledger event must be actor=user', () => {
  assert.throws(
    () => assertLedgerRowLegal({ event: 'approved', actor: 'agent', category: 'resume' }),
    /actor=user/,
  );
  assert.throws(
    () => assertLedgerRowLegal({ event: 'self-submitted', actor: 'cron', category: 'submit' }),
    /actor=user/,
  );
  // SUBMIT has no 'approved' resolution even for the user.
  assert.throws(
    () => assertLedgerRowLegal({ event: 'approved', actor: 'user', category: 'submit' }),
    /self-submitted/,
  );
  // The agent MAY write a non-approving event (queued / superseded).
  assert.doesNotThrow(() => assertLedgerRowLegal({ event: 'queued', actor: 'agent', category: 'submit' }));
  assert.doesNotThrow(() => assertLedgerRowLegal({ event: 'self-submitted', actor: 'user', category: 'submit' }));
});
