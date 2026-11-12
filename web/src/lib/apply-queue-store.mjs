/**
 * apply-queue-store.mjs
 *
 * Pure-JS store for the human-in-the-loop apply-review queue.
 * Mirrors scheduled-jobs-store.mjs: JSON file, dir-lock, atomic write.
 *
 * The queue holds prefilled, ready-to-review applications.
 * The system NEVER auto-submits — the SUBMITTED state requires an
 * explicit user attestation flag that no automated path can supply.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  withResourceLock,
} from "./scheduled-jobs-store.mjs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const QUEUE_STATES = Object.freeze([
  "QUEUED",
  "PREFILLED",
  "NEEDS_REVIEW",
  "BLOCKED",
  "SUBMITTED",
  "APPLIED",
  "DISCARDED",
  "ARCHIVED",
]);

const QUEUE_STATES_SET = new Set(QUEUE_STATES);

const TERMINAL_STATES = new Set(["DISCARDED", "ARCHIVED"]);

/**
 * Allowed transitions.  Edges the state machine permits.
 * SUBMITTED is reachable only via explicit user attestation (enforced below).
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  QUEUED:       ["PREFILLED", "BLOCKED", "DISCARDED"],
  PREFILLED:    ["NEEDS_REVIEW", "SUBMITTED", "BLOCKED", "DISCARDED"],
  NEEDS_REVIEW: ["PREFILLED", "SUBMITTED", "BLOCKED", "DISCARDED"],
  BLOCKED:      ["QUEUED", "DISCARDED"],
  SUBMITTED:    ["APPLIED", "ARCHIVED"],
  APPLIED:      ["ARCHIVED"],
  DISCARDED:    [],
  ARCHIVED:     [],
});

/**
 * States that require the user to explicitly attest they performed the action.
 * The server must reject any automated or unattested transition to these states.
 */
const ATTESTED_STATES = new Set(["SUBMITTED"]);

// ---------------------------------------------------------------------------
// Path resolution (mirrors scheduled-runner-path.mjs)
// ---------------------------------------------------------------------------

export function applyQueueStorePath(root, configured = process.env.CAREER_OPS_APPLY_QUEUE_PATH) {
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(root, configured);
  return path.join(root, "data", "apply-queue", "queue.json");
}

// ---------------------------------------------------------------------------
// ID safety
// ---------------------------------------------------------------------------

// Accepts UUIDs or stable slug-style ids derived from pipeline/report numbers.
// Rejects path traversal (slashes, backslashes) and empty strings.
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function isSafeQueueId(value) {
  return typeof value === "string" && SAFE_ID_RE.test(value);
}

// ---------------------------------------------------------------------------
// Validation error
// ---------------------------------------------------------------------------

export class ApplyQueueValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApplyQueueValidationError";
  }
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export function emptyApplyQueue() {
  return { items: [] };
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function assertIso(v, label) {
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v))) {
    throw new ApplyQueueValidationError(`${label} must be an ISO timestamp`);
  }
}

function validateItem(item, idx) {
  if (!isObject(item)) throw new ApplyQueueValidationError(`item[${idx}] is not an object`);
  if (!isSafeQueueId(item.id)) throw new ApplyQueueValidationError(`item[${idx}].id is invalid`);
  if (!QUEUE_STATES_SET.has(item.state)) {
    throw new ApplyQueueValidationError(`item[${idx}].state "${item.state}" is unknown`);
  }
  if (typeof item.company !== "string" || !item.company) {
    throw new ApplyQueueValidationError(`item[${idx}].company is required`);
  }
  if (typeof item.role !== "string" || !item.role) {
    throw new ApplyQueueValidationError(`item[${idx}].role is required`);
  }
  assertIso(item.createdAt, `item[${idx}].createdAt`);
  assertIso(item.updatedAt, `item[${idx}].updatedAt`);
  if (!Array.isArray(item.history)) {
    throw new ApplyQueueValidationError(`item[${idx}].history must be an array`);
  }
}

export function validateApplyQueue(store) {
  if (!isObject(store)) throw new ApplyQueueValidationError("store root must be an object");
  if (!Array.isArray(store.items)) throw new ApplyQueueValidationError("store.items must be an array");
  store.items.forEach(validateItem);
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export function readApplyQueue(storePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const store = {
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
    validateApplyQueue(store);
    return store;
  } catch (err) {
    if (err?.code === "ENOENT") return emptyApplyQueue();
    if (err instanceof ApplyQueueValidationError) throw err;
    throw new ApplyQueueValidationError(`Invalid apply-queue store at ${storePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function writeApplyQueueAtomic(storePath, store) {
  validateApplyQueue(store);
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${storePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, storePath);
}

// ---------------------------------------------------------------------------
// Locked mutation (reuses scheduled-jobs-store's withResourceLock)
// ---------------------------------------------------------------------------

async function withApplyQueue(storePath, mutate, options = {}) {
  const resourcePath = `${storePath}.lock`;
  return withResourceLock(
    resourcePath,
    async () => {
      const store = readApplyQueue(storePath);
      const result = mutate(store);
      writeApplyQueueAtomic(storePath, store);
      return result;
    },
    options,
  );
}

// ---------------------------------------------------------------------------
// Sync reads (lock-free, safe because they don't write)
// ---------------------------------------------------------------------------

export function getApplyItem(storePath, id) {
  const store = readApplyQueue(storePath);
  return store.items.find((it) => it.id === id) ?? null;
}

export function listApplyItems(storePath) {
  return readApplyQueue(storePath).items;
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

function normalizeUrl(u) {
  if (!u) return "";
  try {
    const p = new URL(u);
    p.hash = "";
    return p.href.replace(/\/+$/, "").toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

export async function enqueueApplyItem(storePath, fields) {
  if (!fields || typeof fields !== "object") {
    throw new ApplyQueueValidationError("fields must be an object");
  }
  if (!fields.company || typeof fields.company !== "string") {
    throw new ApplyQueueValidationError("company is required");
  }
  if (!fields.role || typeof fields.role !== "string") {
    throw new ApplyQueueValidationError("role is required");
  }

  const id = fields.id && isSafeQueueId(fields.id) ? fields.id : randomUUID();
  const now = new Date().toISOString();
  const item = {
    id,
    reportNum: fields.reportNum ?? null,
    company: fields.company,
    role: fields.role,
    url: fields.url ?? "",
    atsVendor: fields.atsVendor ?? null,
    state: "QUEUED",
    prefill: { fieldsReady: 0, fieldsTotal: 0, knockoutFlags: [] },
    artifacts: {
      cvPath: fields.artifacts?.cvPath ?? null,
      coverPath: fields.artifacts?.coverPath ?? null,
    },
    createdAt: now,
    updatedAt: now,
    history: [],
  };

  return withApplyQueue(storePath, (store) => {
    // dedup: reject if a non-terminal item with the same id exists
    if (store.items.some((it) => it.id === id && !TERMINAL_STATES.has(it.state))) {
      throw new ApplyQueueValidationError(`item "${id}" already in the apply queue`);
    }
    // dedup: reject if a non-terminal item with the same employer URL exists (when URL is non-empty)
    if (item.url) {
      const norm = normalizeUrl(item.url);
      const dupe = store.items.find(
        (it) => !TERMINAL_STATES.has(it.state) && normalizeUrl(it.url) === norm,
      );
      if (dupe) {
        throw new ApplyQueueValidationError(
          `url "${item.url}" already in the apply queue (item "${dupe.id}")`,
        );
      }
    }
    store.items.push(item);
    return item;
  });
}

// ---------------------------------------------------------------------------
// State transition
// ---------------------------------------------------------------------------

export async function transitionApplyItem(storePath, id, patch) {
  if (!patch || typeof patch !== "object") {
    throw new ApplyQueueValidationError("patch must be an object");
  }
  const { to } = patch;
  if (!QUEUE_STATES_SET.has(to)) {
    throw new ApplyQueueValidationError(`unknown state "${to}"`);
  }
  // BLOCKED requires a reason
  if (to === "BLOCKED" && (!patch.reason || typeof patch.reason !== "string")) {
    throw new ApplyQueueValidationError("transition to BLOCKED requires a reason");
  }
  // SUBMITTED (and any future attested state) requires explicit user attestation
  if (ATTESTED_STATES.has(to)) {
    if (
      !patch.attestation ||
      typeof patch.attestation !== "object" ||
      patch.attestation.submittedByUser !== true
    ) {
      throw new ApplyQueueValidationError(
        `transition to ${to} requires attestation { submittedByUser: true } — the system must never auto-submit`,
      );
    }
  }

  return withApplyQueue(storePath, (store) => {
    const item = store.items.find((it) => it.id === id);
    if (!item) {
      throw new ApplyQueueValidationError(`item "${id}" not found in the apply queue`);
    }

    const allowed = ALLOWED_TRANSITIONS[item.state];
    if (!allowed || !allowed.includes(to)) {
      throw new ApplyQueueValidationError(
        `illegal transition: ${item.state} -> ${to} (allowed from ${item.state}: ${(allowed || []).join(", ") || "none"})`,
      );
    }

    const now = new Date().toISOString();
    item.history.push({ at: now, from: item.state, to });
    item.state = to;
    item.updatedAt = now;

    // optional: merge prefill stats
    if (patch.prefill && typeof patch.prefill === "object") {
      item.prefill = {
        fieldsReady: patch.prefill.fieldsReady ?? item.prefill.fieldsReady,
        fieldsTotal: patch.prefill.fieldsTotal ?? item.prefill.fieldsTotal,
        knockoutFlags: Array.isArray(patch.prefill.knockoutFlags)
          ? patch.prefill.knockoutFlags
          : item.prefill.knockoutFlags,
      };
    }

    // optional: merge artifacts (which resume/CV copy was used)
    if (patch.artifacts && typeof patch.artifacts === "object") {
      item.artifacts = {
        cvPath: patch.artifacts.cvPath ?? item.artifacts?.cvPath ?? null,
        coverPath: patch.artifacts.coverPath ?? item.artifacts?.coverPath ?? null,
      };
    }

    // BLOCKED reason
    if (to === "BLOCKED") {
      item.blockReason = patch.reason;
    }

    // user attestation for SUBMITTED
    if (ATTESTED_STATES.has(to)) {
      item.attestation = {
        submittedByUser: true,
        at: now,
      };
    }

    return { ...item };
  });
}
