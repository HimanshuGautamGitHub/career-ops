/**
 * apply-queue.ts
 *
 * Thin TS orchestration over apply-queue-store.mjs:
 *   - binds careerOpsRoot() to the store path
 *   - re-exports the validation error and the closed state set
 *   - gives the API routes a typed surface
 *
 * The pure logic (state machine, validation, locking) lives in the .mjs
 * so `node --test` can exercise it directly.
 */

import { careerOpsRoot } from "@/lib/career-ops";
import {
  ApplyQueueValidationError,
  QUEUE_STATES,
  applyQueueStorePath,
  enqueueApplyItem as enqueueApplyItemCore,
  getApplyItem as getApplyItemCore,
  isSafeQueueId,
  listApplyItems as listApplyItemsCore,
  transitionApplyItem as transitionApplyItemCore,
} from "./apply-queue-store.mjs";

export { ApplyQueueValidationError, QUEUE_STATES, isSafeQueueId };

export type QueueState =
  | "QUEUED"
  | "PREFILLED"
  | "NEEDS_REVIEW"
  | "BLOCKED"
  | "SUBMITTED"
  | "APPLIED"
  | "DISCARDED"
  | "ARCHIVED";

export type QueueArtifacts = {
  /** Local path to the resume/CV copy used for this application (never a link). */
  cvPath: string | null;
  /** Local path to the cover letter copy used for this application. */
  coverPath: string | null;
};

export type QueuePrefill = {
  fieldsReady: number;
  fieldsTotal: number;
  knockoutFlags: string[];
};

export type QueueHistoryEntry = {
  at: string;
  from: QueueState;
  to: QueueState;
};

export type QueueItem = {
  id: string;
  reportNum: string | null;
  company: string;
  role: string;
  url: string;
  atsVendor: string | null;
  state: QueueState;
  prefill: QueuePrefill;
  artifacts: QueueArtifacts;
  createdAt: string;
  updatedAt: string;
  history: QueueHistoryEntry[];
  blockReason?: string;
  attestation?: { submittedByUser: true; at: string };
};

export type EnqueueFields = {
  id?: string;
  reportNum?: string | null;
  company: string;
  role: string;
  url?: string;
  atsVendor?: string | null;
  artifacts?: Partial<QueueArtifacts>;
};

export type TransitionPatch = {
  to: QueueState;
  reason?: string;
  attestation?: { submittedByUser: boolean };
  prefill?: Partial<QueuePrefill>;
  artifacts?: Partial<QueueArtifacts>;
};

const storeFile = (): string => applyQueueStorePath(careerOpsRoot());

export function listApplyItems(): QueueItem[] {
  return listApplyItemsCore(storeFile()) as QueueItem[];
}

export function getApplyItem(id: string): QueueItem | null {
  if (!isSafeQueueId(id)) return null;
  return getApplyItemCore(storeFile(), id) as QueueItem | null;
}

export async function enqueueApplyItem(fields: EnqueueFields): Promise<QueueItem> {
  return (await enqueueApplyItemCore(storeFile(), fields)) as QueueItem;
}

export async function transitionApplyItem(id: string, patch: TransitionPatch): Promise<QueueItem> {
  if (!isSafeQueueId(id)) {
    throw new ApplyQueueValidationError(`item "${id}" not found in the apply queue`);
  }
  return (await transitionApplyItemCore(storeFile(), id, patch)) as QueueItem;
}
