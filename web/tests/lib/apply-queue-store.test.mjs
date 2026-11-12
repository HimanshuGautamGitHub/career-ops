import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ApplyQueueValidationError,
  QUEUE_STATES,
  applyQueueStorePath,
  emptyApplyQueue,
  enqueueApplyItem,
  getApplyItem,
  isSafeQueueId,
  listApplyItems,
  readApplyQueue,
  transitionApplyItem,
  writeApplyQueueAtomic,
} from "../../src/lib/apply-queue-store.mjs";

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-queue-"));
  return path.join(dir, "data", "apply-queue", "queue.json");
}

const baseFields = () => ({
  company: "Acme Corp",
  role: "Senior Backend Engineer",
  url: "https://jobs.lever.co/acme/abc-123",
  atsVendor: "lever",
  reportNum: "064",
});

test("readApplyQueue returns an empty store when the file is absent", () => {
  const storePath = tmpStore();
  assert.deepEqual(readApplyQueue(storePath), emptyApplyQueue());
  assert.deepEqual(emptyApplyQueue(), { items: [] });
});

test("readApplyQueue rejects a corrupt store instead of silently resetting it", () => {
  const storePath = tmpStore();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, "{ not json", "utf8");
  assert.throws(() => readApplyQueue(storePath), /Invalid apply-queue store/);
});

test("enqueueApplyItem creates a QUEUED item with timestamps, empty history, and persists it", async () => {
  const storePath = tmpStore();
  const item = await enqueueApplyItem(storePath, baseFields());

  assert.equal(item.state, "QUEUED");
  assert.equal(item.company, "Acme Corp");
  assert.equal(item.role, "Senior Backend Engineer");
  assert.ok(isSafeQueueId(item.id));
  assert.equal(item.reportNum, "064");
  assert.ok(Number.isFinite(Date.parse(item.createdAt)));
  assert.ok(Number.isFinite(Date.parse(item.updatedAt)));
  assert.deepEqual(item.history, []);
  assert.deepEqual(item.prefill, { fieldsReady: 0, fieldsTotal: 0, knockoutFlags: [] });

  // persisted to disk and readable back
  const reread = readApplyQueue(storePath);
  assert.equal(reread.items.length, 1);
  assert.equal(reread.items[0].id, item.id);
});

test("enqueueApplyItem rejects a missing company or role", async () => {
  const storePath = tmpStore();
  await assert.rejects(
    () => enqueueApplyItem(storePath, { role: "Engineer" }),
    ApplyQueueValidationError,
  );
  await assert.rejects(
    () => enqueueApplyItem(storePath, { company: "Acme" }),
    ApplyQueueValidationError,
  );
});

test("enqueueApplyItem rejects a duplicate non-terminal employer URL", async () => {
  const storePath = tmpStore();
  await enqueueApplyItem(storePath, baseFields());
  await assert.rejects(
    () => enqueueApplyItem(storePath, baseFields()),
    /already in the apply queue/,
  );
});

test("enqueueApplyItem persists which resume/CV copy was used (artifacts retained)", async () => {
  const storePath = tmpStore();
  const item = await enqueueApplyItem(storePath, {
    ...baseFields(),
    artifacts: { cvPath: "output/cv-jane-064-acme.pdf", coverPath: "output/cover-064-acme.pdf" },
  });
  assert.equal(item.artifacts.cvPath, "output/cv-jane-064-acme.pdf");
  assert.equal(item.artifacts.coverPath, "output/cover-064-acme.pdf");
  // survives a round-trip
  assert.equal(readApplyQueue(storePath).items[0].artifacts.cvPath, "output/cv-jane-064-acme.pdf");
});

test("transitionApplyItem advances QUEUED -> PREFILLED and appends history", async () => {
  const storePath = tmpStore();
  const created = await enqueueApplyItem(storePath, baseFields());
  const updated = await transitionApplyItem(storePath, created.id, {
    to: "PREFILLED",
    prefill: { fieldsReady: 7, fieldsTotal: 9, knockoutFlags: [] },
  });

  assert.equal(updated.state, "PREFILLED");
  assert.equal(updated.prefill.fieldsReady, 7);
  assert.equal(updated.history.length, 1);
  assert.equal(updated.history[0].from, "QUEUED");
  assert.equal(updated.history[0].to, "PREFILLED");
  assert.ok(Number.isFinite(Date.parse(updated.history[0].at)));
});

test("transitionApplyItem rejects an illegal transition (QUEUED -> SUBMITTED)", async () => {
  const storePath = tmpStore();
  const created = await enqueueApplyItem(storePath, baseFields());
  await assert.rejects(
    () => transitionApplyItem(storePath, created.id, { to: "SUBMITTED", attestation: { submittedByUser: true } }),
    /illegal transition/i,
  );
});

test("the never-auto-submit invariant: SUBMITTED requires explicit user attestation", async () => {
  const storePath = tmpStore();
  const created = await enqueueApplyItem(storePath, baseFields());
  await transitionApplyItem(storePath, created.id, { to: "PREFILLED" });

  // Without attestation the agent/server cannot move an item to SUBMITTED.
  await assert.rejects(
    () => transitionApplyItem(storePath, created.id, { to: "SUBMITTED" }),
    /attestation/i,
  );
  await assert.rejects(
    () => transitionApplyItem(storePath, created.id, { to: "SUBMITTED", attestation: { submittedByUser: false } }),
    /attestation/i,
  );

  // Only an explicit candidate confirmation records the submission.
  const submitted = await transitionApplyItem(storePath, created.id, {
    to: "SUBMITTED",
    attestation: { submittedByUser: true },
  });
  assert.equal(submitted.state, "SUBMITTED");
  assert.equal(submitted.attestation.submittedByUser, true);
  assert.ok(Number.isFinite(Date.parse(submitted.attestation.at)));
});

test("transitionApplyItem requires a reason to BLOCK and rejects an unknown target state", async () => {
  const storePath = tmpStore();
  const created = await enqueueApplyItem(storePath, baseFields());
  await assert.rejects(
    () => transitionApplyItem(storePath, created.id, { to: "BLOCKED" }),
    /reason/i,
  );
  await assert.rejects(
    () => transitionApplyItem(storePath, created.id, { to: "NONSENSE" }),
    /unknown state/i,
  );
  const blocked = await transitionApplyItem(storePath, created.id, { to: "BLOCKED", reason: "knockout: visa" });
  assert.equal(blocked.state, "BLOCKED");
  assert.equal(blocked.blockReason, "knockout: visa");
});

test("transitionApplyItem throws for an unknown id", async () => {
  const storePath = tmpStore();
  await assert.rejects(
    () => transitionApplyItem(storePath, "11111111-1111-4111-8111-111111111111", { to: "PREFILLED" }),
    /not found/i,
  );
});

test("getApplyItem returns the item or null; listApplyItems lists all", async () => {
  const storePath = tmpStore();
  const a = await enqueueApplyItem(storePath, baseFields());
  assert.equal(getApplyItem(storePath, a.id).id, a.id);
  assert.equal(getApplyItem(storePath, "nope"), null);
  assert.equal(listApplyItems(storePath).length, 1);
});

test("isSafeQueueId accepts stable derived ids and rejects path-traversal", () => {
  assert.equal(isSafeQueueId("report-064"), true);
  assert.equal(isSafeQueueId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isSafeQueueId("../etc/passwd"), false);
  assert.equal(isSafeQueueId("a/b"), false);
  assert.equal(isSafeQueueId(""), false);
  assert.equal(isSafeQueueId(42), false);
});

test("applyQueueStorePath resolves under the data root and honors an env override", () => {
  const root = "/tmp/career";
  assert.equal(applyQueueStorePath(root, undefined), path.join(root, "data", "apply-queue", "queue.json"));
  assert.equal(applyQueueStorePath(root, "/abs/queue.json"), "/abs/queue.json");
  assert.equal(applyQueueStorePath(root, "rel/q.json"), path.resolve(root, "rel/q.json"));
});

test("QUEUE_STATES is the closed set the UI and API share", () => {
  assert.deepEqual(
    [...QUEUE_STATES].sort(),
    ["APPLIED", "ARCHIVED", "BLOCKED", "DISCARDED", "NEEDS_REVIEW", "PREFILLED", "QUEUED", "SUBMITTED"].sort(),
  );
});

test("writeApplyQueueAtomic round-trips a validated store", () => {
  const storePath = tmpStore();
  const store = emptyApplyQueue();
  writeApplyQueueAtomic(storePath, store);
  assert.deepEqual(readApplyQueue(storePath), store);
});
