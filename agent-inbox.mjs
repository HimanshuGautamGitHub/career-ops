#!/usr/bin/env node

/**
 * agent-inbox.mjs — a tiny bridge between *looking at* the pipeline and
 * *acting on* it.
 *
 * career-ops is driven from an AI session, but there's no durable place to drop
 * a request when you're not in one — e.g. while glancing at the tracker (or a
 * dashboard) you think "evaluate this URL" or "draft a follow-up for #7". This
 * is that place: an append-only queue the agent drains at the start of a
 * session.
 *
 *   data/agent-inbox.md
 *     - [ ] <stamp> — <request>          (pending)
 *     - [x] <stamp> — <request> → result: <one line>   (resolved)
 *
 * Fully local-first and human-in-the-loop: nothing here auto-submits. Queued
 * items are *intents* for the agent to action and the user to review. Markdown
 * checklist, no database, no server, no dependencies — edit it by hand or via
 * this CLI, and any tool (a dashboard, a script, cron) can append to it. The
 * protocol an agent follows is documented in modes/agent-inbox.md.
 *
 * Item numbers are *file positions*, not positions in the pending list: `add`
 * only ever appends, so a number never changes meaning once printed. `list`
 * therefore shows gaps as items get resolved (2, 4, 5) — the gaps are the
 * receipt that something was already handled, and a whole batch of resolves can
 * be read off a single `list` without drifting.
 *
 * Usage:
 *   node agent-inbox.mjs add "evaluate https://acme.com/jobs/42"
 *   node agent-inbox.mjs list [--all]                 # pending only, or every item
 *   node agent-inbox.mjs resolve 1 [--expect "Acme"] [--result "scored 4.3 — report 012"]
 */

import {
  readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync,
  openSync, fstatSync, readSync, closeSync, realpathSync, statSync,
} from 'fs';
import { createHash } from 'crypto';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { withPipelineLock } from './pipeline-lock.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import { localToday } from './lib/local-today.mjs';
import { loadYaml } from './lib/yaml-document.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getProfilePath } from './path-resolver.mjs';
import {
  loadApprovalCategories, mintApprovalId, serializeInboxLine,
  parseInboxText, assertBatchApprovable, assertLedgerRowLegal,
} from './lib/approval-schema.mjs';
import { resolveApprovalLogPath, appendApprovalRows, readApprovalLog } from './lib/approval-log.mjs';
import { scorePosting, fitTargetsFromProfile } from './lib/inbox-rank.mjs';

const PATH = process.env.CAREER_OPS_INBOX || 'data/agent-inbox.md';

// The GENERAL lane is not one of the six approval categories; its ordering
// weight lives in approval-categories.yml (general_lane.weight: 50). It is a
// legacy intent-to-run, not a human-approval gate, so it carries no ledger row.
const GENERAL_WEIGHT = 50;

const HEADER = [
  '# Agent Inbox',
  '',
  '> **Agent protocol:** at the start of a career-ops session, read this file.',
  '> Run each unchecked item top-to-bottom. After each, mark it `[x]` and append',
  '> `→ result: <one line>`. Items that need live user input (a mock, a paste, a',
  '> decision) → ask the user to start them instead of running them.',
  '>',
  '> Nothing here auto-submits — queued items are *intents* for you to action and',
  '> the user to review. Appended by hand, by a dashboard, or by agent-inbox.mjs.',
  '',
].join('\n');

// Local date and time, the clock the person queuing the item is looking at.
// toISOString() is UTC, and this stamp carries no zone marker, so a request
// queued at 10:30 on the 18th east of Greenwich read "2026-08-17 20:30".
function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${localToday(now)} ${p(now.getHours())}:${p(now.getMinutes())}`;
}

function ensureGitignored() {
  // The inbox is personal data. On installs whose .gitignore predates this
  // feature, make sure the default path is ignored so a first `add` can't
  // accidentally commit it. Only manages the default, non-overridden path.
  if (process.env.CAREER_OPS_INBOX || PATH !== 'data/agent-inbox.md') return;
  try {
    if (!existsSync('.gitignore')) return; // not a git checkout we should touch
    const text = readFileSync('.gitignore', 'utf8');
    if (text.split('\n').some((l) => l.trim() === PATH)) return; // already ignored
    writeFileSync('.gitignore', text.replace(/\s*$/, '') + `\n${PATH}\n`);
  } catch { /* best effort — never block queuing on this */ }
}

function oneLine(s) {
  // markdown-checklist-safe: collapse to a single bullet line
  return String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();
}

// MUST be called with the queue lock held — see add(). Creating the file is
// only half of it; the file is not usable until the header is IN it, and that
// is two syscalls, not one.
function ensureFile() {
  if (existsSync(PATH)) return;
  ensureGitignored();
  mkdirSync(dirname(PATH), { recursive: true });
  // 'wx': atomic create-exclusive. Two concurrent first-time `add` calls can
  // both pass the existsSync check above before either writes; without an
  // exclusive flag, the second writeFileSync (default 'w', which truncates)
  // lands after the first has already appended its item and wipes it back to
  // just the header. 'wx' makes only one of them win the create — the loser
  // gets EEXIST and does nothing, same as if it had seen existsSync === true.
  //
  // 'wx' settles the two-creator case and nothing else. It makes the CREATE
  // atomic, not the INITIALISATION: writeFileSync is open() then write(), and
  // between those two syscalls the file EXISTS and is ZERO BYTES. Measured on
  // Windows, a second process polling existsSync and stat-ing the moment the
  // file appeared saw it at 0 bytes in 303 of 400 rounds.
  //
  // So there is a third participant the exclusive flag cannot see: a writer
  // that arrives INSIDE that window, finds existsSync === true, skips creation,
  // and appends — into a file this call is about to overwrite from offset 0.
  // Its item is gone, with no error anywhere; the write below simply lands on
  // top of it. That is why the caller holds the lock across this function
  // rather than around the append alone.
  try {
    writeFileSync(PATH, HEADER, { flag: 'wx' });
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }
}

// Whether appending to `path` needs a leading newline first, i.e. the file is
// non-empty and doesn't already end in one. Reads only the last byte instead
// of the whole file — the full-file read this replaced was only ever used to
// check one byte.
function needsLeadingNewline(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return false;
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, size - 1);
    return buf[0] !== 0x0a; // '\n'
  } finally {
    closeSync(fd);
  }
}

// Parse the checklist into items, in file order. `num` is the stable 1-based
// item number used by `list` and `resolve` — it is the position in the FULL
// list, so resolving an item never renumbers the others.
function parseItems() {
  if (!existsSync(PATH)) return [];
  const items = [];
  readFileSync(PATH, 'utf8').split('\n').forEach((line, i) => {
    const m = /^- \[([ xX])\]\s*(.*)$/.exec(line.trim());
    if (m) items.push({ num: items.length + 1, line: i, done: m[1].toLowerCase() === 'x', text: m[2] });
  });
  return items;
}

function opt(name, def = '') {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : def;
}

// Every value given for a repeatable flag, in argv order. An occurrence with no
// value yields '' rather than being dropped, so the caller can reject it:
// opt() reads only the first occurrence and would never see a later bare one.
function optAll(name) {
  const values = [];
  process.argv.forEach((arg, i) => {
    if (arg !== '--' + name) return;
    const v = process.argv[i + 1];
    values.push(v && !v.startsWith('--') ? v : '');
  });
  return values;
}

async function add() {
  // `add --category <cat> ...` is the documented producer interface (design §6);
  // it queues a categorized approval item through the same path as `enqueue`.
  if (process.argv.includes('--category')) return enqueue();
  const text = oneLine(process.argv.slice(3).join(' '));
  if (!text) fail('add needs a request, e.g. node agent-inbox.mjs add "evaluate https://..."');
  // Append rather than rewrite. This is the queue's concurrent path — anything
  // running in the background can drop an item in — and a read-whole-file /
  // write-whole-file cycle loses every request that lands between the two. With
  // 30 concurrent `add` calls, half the queue vanished silently.
  //
  // POSIX guarantees an O_APPEND write is atomic below PIPE_BUF, and one
  // checklist line is far under it, so concurrent appends interleave instead of
  // clobbering. WINDOWS IS NOT POSIX, and that is the whole reason for the lock
  // below: with 30 concurrent adds on windows-latest this dropped exactly one
  // item (#2777), silently, which is the same failure this function exists to
  // remove — it just moved to the one platform the guarantee does not cover.
  //
  // The lock is the repo's existing one rather than a second mechanism: the
  // same `withPipelineLock` that scan.mjs uses for scan-history appends. Two
  // lock implementations would drift, and the append is short enough that
  // serializing it costs nothing next to spawning the process that calls it.
  //
  // Checking the last byte still happens INSIDE the lock: it decides whether a
  // separating newline is needed, and reading it outside would race with
  // another writer's append between the check and the write.
  //
  // timeoutMs is raised from the shared 8s default because this queue's whole
  // point is bursty concurrent writers (a dashboard, a script, cron all drop
  // items at once), and lock acquisition is a retry lottery, not a fair queue.
  // Serving N herded waiters is the coupon-collector problem: ~N·H(N) rounds,
  // so 30 concurrent adds need ~120 rounds while 8000/80 = 100 only affords
  // ~100. On the slow, contended windows-latest runner that shortfall makes one
  // waiter time out and its item is LOST, the exact #2777 drop, reappearing as
  // a loud LockTimeoutError instead of a silent overwrite. Jitter in
  // pipeline-lock.mjs cuts the collision rate ~6x but is explicitly "not a
  // cure"; the fit-for-purpose budget for a burst-write queue is the contained
  // fix. 30s gives ~375 rounds of headroom, well past the herd's worst case,
  // while the critical section itself is a single sub-millisecond append.
  //
  // ensureFile() is INSIDE the lock, not before it. Seeding the file is a
  // check-create-initialise sequence, and run unlocked it loses items the same
  // way the unlocked append did: a writer that observes the file between the
  // creator's open() and its write() sees a zero-byte file, appends into it,
  // and has its line overwritten when the header lands at offset 0. Every
  // writer exits 0 and the queue is left perfectly well-formed, one item
  // shorter — the silent drop the lock was added to end, one step earlier in
  // the same function.
  //
  // Holding the lock across the seed makes the window unreachable rather than
  // narrow: no writer can observe the file until the creator has released, and
  // the creator writes the header before it releases. 'wx' above stays as the
  // guard against writers that are not this function.
  await withPipelineLock(PATH, () => {
    ensureFile();
    const separator = needsLeadingNewline(PATH) ? '\n' : '';
    appendFileSync(PATH, `${separator}- [ ] ${stamp()} — ${text}\n`);
  }, { timeoutMs: 30_000 });
  process.stdout.write(`Queued: ${text}\n`);
}

function list() {
  // Opt-in approval-queue view. Bare `list` / `list --all` keep the legacy
  // output byte-identical (regression-guarded) so every existing caller and
  // test is unaffected.
  if (process.argv.includes('--grouped') || process.argv.includes('--category')) {
    return listGrouped();
  }
  const all = process.argv.includes('--all');
  const parsed = parseItems();
  const items = parsed.filter((it) => all || !it.done);
  if (!items.length) return process.stdout.write(all ? 'Inbox is empty.\n' : 'No pending items.\n');
  items.forEach((it) => {
    process.stdout.write(`${String(it.num).padStart(2)}. [${it.done ? 'x' : ' '}] ${it.text}\n`);
  });
  // Explain the gaps rather than let them read as a display bug.
  if (items.length < parsed.length) {
    process.stdout.write(
      `\n(${parsed.length - items.length} resolved item(s) hidden — numbers are stable file positions, so gaps are expected. \`list --all\` shows everything.)\n`,
    );
  }
}

async function resolve() {
  const n = Number(process.argv[3]);
  if (!Number.isInteger(n) || n < 1) fail('resolve needs a 1-based item number (see `list`)');
  const outcome = await withPipelineLock(PATH, () => {
    // The item snapshot, line lookup, and rewrite are one transaction. An
    // add between the old read and write was acknowledged, then overwritten by
    // this stale snapshot even though add itself correctly held this same lock.
    // Number inside the critical section too, so the selected item and the
    // rewritten line always come from one locked view.
    //
    // Number against the FULL item list, not the pending subset. `add` only ever
    // appends, so an item's position is stable for the life of the file and a
    // batch of resolves read off one `list` stays correct. Numbering against the
    // pending view instead made each resolve shift every higher number down by
    // one — silently stamping later results onto the wrong items.
    const items = parseItems();
    const target = items[n - 1];
    if (!target) {
      const pending = items.filter((it) => !it.done).length;
      return { error: `no item #${n} — inbox has ${items.length} item(s), ${pending} pending. Run \`list --all\`.` };
    }
    // Already-resolved is an error, not a silent re-stamp: it is what a stale
    // number from an older `list` most often lands on.
    if (target.done) return { error: `item #${n} is already resolved — refusing to overwrite it:\n  #${n}: ${target.text}` };
    // Optional caller-side guard: abort unless the target says what the caller
    // thinks it says. Catches "right command, wrong target" generally.
    // Every --expect given must hold, and every one must carry a value: a bare
    // --expect anywhere on the line is a guard the caller meant to set and did
    // not, so it fails instead of being skipped behind an earlier valid one.
    const expects = optAll('expect');
    if (expects.includes('')) return { error: '--expect needs a substring, e.g. --expect "Dana-Farber"' };
    const missing = expects.find((expect) => !target.text.toLowerCase().includes(expect.toLowerCase()));
    if (missing !== undefined) {
      return { error: `item #${n} does not contain --expect ${JSON.stringify(missing)} — refusing to resolve:\n  #${n}: ${target.text}` };
    }
    const result = oneLine(opt('result'));
    const lines = readFileSync(PATH, 'utf8').split('\n');
    let updated = lines[target.line].replace('[ ]', '[x]');
    if (result && !/→ result:/.test(updated)) updated += ` → result: ${result}`;
    lines[target.line] = updated;
    // Replace, don't rewrite in place. The lock serialises writers, but `list`
    // and anything reading the file by hand do not take it, and writeFileSync
    // truncates before it writes: a reader in that window, or a crash inside
    // it, sees a queue with items missing. A same-directory temp file renamed
    // over the original is the repo's existing helper for exactly this.
    //
    // A rename replaces the directory entry it is given and installs a new
    // file, so two things the in-place write got for free have to be asked
    // for: write THROUGH a symlinked inbox (rename over the link would swap it
    // for a regular file and leave its target stale), and keep the queue's
    // permissions (a 0600 inbox must not come back 0644 under the umask).
    const real = realpathSync(PATH);
    writeFileAtomic(real, lines.join('\n'), { mode: statSync(real).mode & 0o7777 });
    return { target };
  }, { timeoutMs: 30_000 });
  // Fail only after withPipelineLock has released. process.exit() inside the
  // callback would bypass the lock's finally block and strand the directory.
  if (outcome.error) fail(outcome.error);
  process.stdout.write(`Resolved #${n}: ${outcome.target.text}\n`);
}

// ───────────────────────── approval queue (AGEN-203) ─────────────────────────
//
// A thin categorized/prioritized layer over the same append-only checklist.
// Every disposition is recorded in an append-only provenance ledger
// (lib/approval-log.mjs), the mirror of set-status.mjs → status-log.tsv. See
// docs/designs/APPROVAL_QUEUE_DESIGN.md.

// The canonical taxonomy ships beside this file; an env override lets tests and
// relocations point elsewhere. Loaded once, then cached.
let CATS = null;
function categoriesPath() {
  return process.env.CAREER_OPS_APPROVAL_CATEGORIES
    || fileURLToPath(new URL('./templates/approval-categories.yml', import.meta.url));
}
function loadCats() {
  if (!CATS) CATS = loadApprovalCategories(categoriesPath());
  return CATS;
}

// Flags that consume the following token as their value; used when separating
// positional free text (a headline) and item numbers from flags in argv.
const VALUE_FLAGS = new Set(['category', 'ref', 'sink', 'producer', 'note', 'result', 'expect']);

// Everything on the command line that is not a flag or a flag value, joined —
// the free-text headline for `enqueue`.
function positionalFreeText(from = 3) {
  const parts = [];
  for (let i = from; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const next = process.argv[i + 1];
      if (VALUE_FLAGS.has(a.slice(2)) && next !== undefined && !next.startsWith('--')) i++;
      continue;
    }
    parts.push(a);
  }
  return oneLine(parts.join(' '));
}

// The 1-based item numbers on the command line (for a disposition), skipping
// flags and their values.
function collectNums() {
  const out = [];
  for (let i = 3; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const next = process.argv[i + 1];
      if (VALUE_FLAGS.has(a.slice(2)) && next !== undefined && !next.startsWith('--')) i++;
      continue;
    }
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1) out.push(n);
  }
  return out;
}

// parseItems() captures the whole free-text field after `- [ ] `, which still
// carries the leading `<stamp> — ` both legacy items and serializeInboxLine
// write. parseInboxText expects the text WITHOUT that prefix, so strip it first.
const STAMP_PREFIX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s*—\s*/u;
function parseItemText(text) {
  return parseInboxText(String(text == null ? '' : text).replace(STAMP_PREFIX, ''));
}

// sha256 of the exact bytes behind a ref, when the ref is a readable file;
// otherwise `-`. A report number or tracker # is not a file, so it hashes to `-`.
function shaOfRefMaybe(ref) {
  if (!ref || ref === '-') return '-';
  try {
    if (!existsSync(ref) || !statSync(ref).isFile()) return '-';
    return createHash('sha256').update(readFileSync(ref)).digest('hex');
  } catch { return '-'; }
}

// The one disposition each category allows for a given CLI action. Validated
// against the category's own `resolutions` set before anything is written.
function resolutionFor(category, action) {
  switch (action) {
    case 'snooze': return 'deferred';
    case 'edit': return 'edited';
    case 'approve':
      if (category === 'submit') return 'self-submitted'; // the system never submits
      if (category === 'borderline') return 'pursue';
      return 'approved';
    case 'reject':
      return category === 'borderline' ? 'discard' : 'rejected';
    default:
      throw new Error(`unknown disposition '${action}'`);
  }
}

const DISPOSITION_LABEL = {
  approve: 'Approved', 'batch-approve': 'Approved', edit: 'Edited',
  reject: 'Rejected', snooze: 'Snoozed',
};

// Queue a categorized approval item: an inbox line (parseable back to its
// category/id/ref/sink) plus a `queued` ledger row (actor=agent), committed
// together under the inbox lock.
async function enqueue() {
  const cats = loadCats();
  const category = (opt('category') || '').toLowerCase();
  if (!cats.has(category)) {
    fail(`enqueue needs --category <one of: ${[...cats.keys()].join(', ')}>, got ${JSON.stringify(opt('category') || '(none)')}`);
  }
  const headline = positionalFreeText();
  if (!headline) {
    fail('enqueue needs a headline, e.g. node agent-inbox.mjs enqueue --category resume --ref output/cv.pdf "Acme — Senior MLE"');
  }
  const catRow = cats.get(category);
  const ref = opt('ref') || '-';
  const sink = opt('sink') || catRow.sink || 'none';
  const producer = opt('producer') || '-';
  const note = oneLine(opt('note'));
  const id = mintApprovalId();
  const sha = shaOfRefMaybe(ref);
  const queuedAt = stamp();
  const line = serializeInboxLine({ id, category, headline, ref, sink, queuedAt });
  const logPath = resolveApprovalLogPath(PATH);

  await withPipelineLock(PATH, () => {
    ensureFile();
    const separator = needsLeadingNewline(PATH) ? '\n' : '';
    appendFileSync(PATH, `${separator}${line}\n`);
    appendApprovalRows(logPath, [{
      id, ts: queuedAt, event: 'queued', category, producer, sink, ref, sha, actor: 'agent', note,
    }]);
  }, { timeoutMs: 30_000 });

  process.stdout.write(`Queued [${category.toUpperCase()}] ${headline} {id=${id}}\n`);
}

// Clear one or more items. approve/edit/reject tick the item and append an
// actor=user ledger event; snooze records `deferred` and leaves the item
// pending. A multi-item path (or `batch-approve`) refuses if any item is SUBMIT
// (invariant 2). General-lane items tick but write no ledger row.
async function disposition(action) {
  const nums = collectNums();
  if (!nums.length) fail(`${action} needs at least one item number (see \`list\`)`);
  const note = oneLine(opt('note'));
  const logPath = resolveApprovalLogPath(PATH);
  const cats = loadCats();

  // Same loud-failure "right command, wrong target" guard `resolve` honors: every
  // --expect given must carry a value and must hold against every picked item, or
  // the whole disposition aborts with nothing written. Silently swallowing it (it
  // is a VALUE_FLAG, so collectNums() already skips its value) would turn an
  // explicit safety confirmation into a no-op.
  const expects = optAll('expect');

  const outcome = await withPipelineLock(PATH, () => {
    if (expects.includes('')) return { error: '--expect needs a substring, e.g. --expect "Dana-Farber"' };
    const items = parseItems();
    const picked = [];
    for (const n of nums) {
      const target = items[n - 1];
      if (!target) return { error: `no item #${n} — inbox has ${items.length} item(s). Run \`list --all\`.` };
      if (target.done) return { error: `item #${n} is already resolved — refusing to overwrite it:\n  #${n}: ${target.text}` };
      const missing = expects.find((expect) => !target.text.toLowerCase().includes(expect.toLowerCase()));
      if (missing !== undefined) {
        return { error: `item #${n} does not contain --expect ${JSON.stringify(missing)} — refusing to ${action}:\n  #${n}: ${target.text}` };
      }
      picked.push({ n, target, parsed: parseItemText(target.text) });
    }

    const multiSelect = action === 'batch-approve' || nums.length > 1;
    const act = action === 'batch-approve' ? 'approve' : action;

    try {
      if (multiSelect) {
        assertBatchApprovable(picked.map((p) => ({ id: p.parsed.id, category: p.parsed.category })));
      }

      // Build + validate every ledger row BEFORE touching either file, so an
      // illegal combination fails loudly with nothing written.
      const rows = [];
      for (const { n, parsed } of picked) {
        const category = parsed.category;
        if (category === 'general') continue; // legacy intent — ticks, no ledger
        const catRow = cats.get(category);
        if (!catRow) throw new Error(`item #${n} has an unknown category '${category}'`);
        const resolution = resolutionFor(category, act);
        if (!catRow.resolutions.includes(resolution)) {
          throw new Error(`'${act}' is not allowed for ${category.toUpperCase()} (allowed: ${catRow.resolutions.join(', ')})`);
        }
        const prior = latestLedgerRow(logPath, parsed.id);
        const row = {
          id: parsed.id || mintApprovalId(),
          ts: stamp(),
          event: resolution,
          category,
          producer: (prior && prior.producer) || '-',
          sink: (prior && prior.sink) || parsed.meta.sink || catRow.sink || 'none',
          ref: (prior && prior.ref) || parsed.meta.ref || '-',
          sha: (prior && prior.sha) || '-',
          actor: 'user',
          note,
        };
        assertLedgerRowLegal(row);
        rows.push(row);
      }

      // snooze never ticks the item — it stays pending by design.
      if (act !== 'snooze') {
        const lines = readFileSync(PATH, 'utf8').split('\n');
        for (const { parsed, target } of picked) {
          const resolution = resolutionFor(parsed.category, act);
          let updated = lines[target.line].replace('[ ]', '[x]');
          if (!/→\s*result:/.test(updated)) updated += ` → result: ${resolution}`;
          lines[target.line] = updated;
        }
        const real = realpathSync(PATH);
        writeFileAtomic(real, lines.join('\n'), { mode: statSync(real).mode & 0o7777 });
      }

      if (rows.length) appendApprovalRows(logPath, rows);
      return { picked };
    } catch (err) {
      return { error: err.message };
    }
  }, { timeoutMs: 30_000 });

  if (outcome.error) fail(outcome.error);
  const label = DISPOSITION_LABEL[action] || action;
  for (const { n, target } of outcome.picked) {
    process.stdout.write(`${label} #${n}: ${target.text}\n`);
  }
}

// The most recent ledger row for an id (producer/sink/ref/sha are inherited
// from the item's `queued` row so a disposition need not repeat them).
function latestLedgerRow(logPath, id) {
  if (!id) return null;
  let found = null;
  for (const row of readApprovalLog(logPath)) if (row.id === id) found = row;
  return found;
}

function labelForCategory(category, cats) {
  if (category === 'general') return 'GENERAL';
  const row = cats.get(category);
  return (row && row.label) || category.toUpperCase();
}

function loadProfileMaybe() {
  try { return loadYaml(readFileSync(getProfilePath(), 'utf8')); } catch { return null; }
}

/**
 * Order approval items for display: pending before resolved, then by category
 * weight (a static tier, NOT a score), then by fit WITHIN a tier via
 * scorePosting (lib/inbox-rank.mjs — no second ranker), then recency, then a
 * stable file position. See APPROVAL_QUEUE_DESIGN.md §5.
 * @param {Array} items  items carrying {num, done, category, headline|text, line}
 * @param {{profile?: unknown, categories: Map}} ctx
 */
export function orderApprovals(items, { profile, categories } = {}) {
  const cats = categories || loadCats();
  const targets = fitTargetsFromProfile(profile || {});
  const weightOf = (category) => {
    if (category === 'general') return GENERAL_WEIGHT;
    const row = cats.get(category);
    return row ? row.weight : 0;
  };
  const decorated = items.map((it) => {
    const headline = it.headline != null ? it.headline : it.text;
    const fit = scorePosting({ title: headline, location: '', pay: '', rankStamp: '' }, targets);
    return { it, headline, weight: weightOf(it.category), fit, score: fit ? fit.score : null };
  });
  decorated.sort((a, b) => {
    // Pending before resolved.
    if (!!a.it.done !== !!b.it.done) return a.it.done ? 1 : -1;
    // Category weight (higher first) — precedes fit.
    if (a.weight !== b.weight) return b.weight - a.weight;
    // Fit within the tier (a null fit sorts after any ranked one).
    if (a.score !== b.score) {
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    }
    // Stable file position as the final tiebreak.
    return (a.it.line ?? a.it.num) - (b.it.line ?? b.it.num);
  });
  return decorated.map((d) => d.it);
}

// Grouped/filtered view of the queue, ordered by orderApprovals. Opt-in; the
// bare `list` / `list --all` output is untouched.
function listGrouped() {
  const all = process.argv.includes('--all');
  const wantCat = (opt('category') || '').toLowerCase();
  const cats = loadCats();
  let items = parseItems()
    .filter((it) => all || !it.done)
    .map((it) => ({ ...it, ...parseItemText(it.text) }));
  if (wantCat) items = items.filter((it) => it.category === wantCat);

  if (!items.length) {
    if (wantCat) return process.stdout.write(`No ${wantCat.toUpperCase()} items.\n`);
    return process.stdout.write(all ? 'Inbox is empty.\n' : 'No pending items.\n');
  }

  const ordered = orderApprovals(items, { profile: loadProfileMaybe(), categories: cats });
  let current = null;
  for (const it of ordered) {
    if (it.category !== current) {
      current = it.category;
      process.stdout.write(`\n${labelForCategory(it.category, cats)}\n`);
    }
    const head = it.headline || it.text;
    const meta = it.id ? ` {id=${it.id}}` : '';
    process.stdout.write(`${String(it.num).padStart(2)}. [${it.done ? 'x' : ' '}] ${head}${meta}\n`);
  }
}

function fail(msg) {
  process.stderr.write(`agent-inbox.mjs: ${msg}\n`);
  process.exit(1);
}

const USAGE =
  'Usage:\n' +
  '  node agent-inbox.mjs add "evaluate https://acme.com/jobs/42"\n' +
  '  node agent-inbox.mjs list [--all]\n' +
  '  node agent-inbox.mjs resolve <n> [--expect "substring"] [--result "..."]\n' +
  '\n' +
  'Approval queue (AGEN-203):\n' +
  '  node agent-inbox.mjs enqueue --category <submit|borderline|message|resume|profile|targeting> \\\n' +
  '        [--ref <report#|path>] [--sink <form-submit|email|linkedin|file|none>] [--producer <mode>] "<headline>"\n' +
  '        (or `add --category ...` — same thing)\n' +
  '  node agent-inbox.mjs list [--grouped | --category <cat>] [--all]\n' +
  '  node agent-inbox.mjs approve <n...> [--expect "substring"] [--note "..."]\n' +
  '  node agent-inbox.mjs edit <n...>    [--expect "substring"] [--note "..."]\n' +
  '  node agent-inbox.mjs reject <n...>  [--expect "substring"] [--note "..."]\n' +
  '  node agent-inbox.mjs snooze <n...>  [--expect "substring"] [--note "..."]   (stays pending, records deferred)\n' +
  '  node agent-inbox.mjs batch-approve <n...> [--expect "substring"]            (refuses if any item is SUBMIT)\n' +
  '\n' +
  'Numbers are stable file positions: `list` shows gaps once items are\n' +
  'resolved, and a batch of resolves read off one `list` stays correct.\n' +
  '--expect aborts unless the target item contains that substring.\n' +
  'Approving a SUBMIT item records your own "self-submitted" attestation —\n' +
  'the system never submits or sends anything on your behalf.\n';

// isMainModule (lib/is-main-module.mjs) guards the dispatch so tests can import
// orderApprovals without triggering a CLI run (which would read a test-runner
// argv and exit), and answers "was I run?" correctly through a symlink (#3170).
async function main() {
  const cmd = process.argv[2];
  if (cmd === 'add') await add();
  else if (cmd === 'list') list();
  else if (cmd === 'resolve') await resolve();
  else if (cmd === 'enqueue') await enqueue();
  else if (cmd === 'approve') await disposition('approve');
  else if (cmd === 'edit') await disposition('edit');
  else if (cmd === 'reject') await disposition('reject');
  else if (cmd === 'snooze') await disposition('snooze');
  else if (cmd === 'batch-approve') await disposition('batch-approve');
  else if (cmd === undefined || cmd === '--help' || cmd === '-h') process.stdout.write(USAGE);
  else {
    // A word that is not a subcommand (`ad` for `add`) queued nothing, so it must
    // not exit 0: the callers that check the status read 0 as "queued".
    process.stderr.write(`agent-inbox.mjs: unknown command "${cmd}"\n${USAGE}`);
    process.exit(1);
  }
}

if (isMainModule(import.meta.url)) await main();
