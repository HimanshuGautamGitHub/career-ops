/**
 * activity.ts
 *
 * Thin TS orchestration over activity-log.mjs:
 *   - binds careerOpsRoot() to the activity directory
 *   - gives the API route and the dashboard a typed surface
 *
 * The pure reader logic lives in the .mjs so `node --test` can exercise it.
 */

import { careerOpsRoot } from "@/lib/career-ops";
import {
  ACTIVITY_SOURCES,
  activityDirPath,
  isActivityDate,
  readDay as readDayCore,
  readRange as readRangeCore,
} from "./activity-log.mjs";

export { ACTIVITY_SOURCES, isActivityDate };

export type ActivitySource =
  | "scheduled-scan"
  | "email-import"
  | "apply-queue"
  | "gap-plan"
  | "evaluation";

export interface ActivityRef {
  reportNum?: string;
  queueId?: string;
  url?: string;
}

export interface ActivityEvent {
  ts: string;
  /** A known ActivitySource, or an unrecognized string tolerated as "other". */
  source: ActivitySource | string;
  knownSource: boolean;
  kind: string;
  summary: string;
  ref: ActivityRef;
  date: string;
}

export interface ActivityDay {
  date: string;
  count: number;
  bySource: Record<string, number>;
  events: ActivityEvent[];
}

const dir = (): string => activityDirPath(careerOpsRoot());

/** Read a single day's events, newest first. [] when nothing was logged. */
export function readActivityDay(date: string): ActivityEvent[] {
  return readDayCore(dir(), date) as ActivityEvent[];
}

/** Read a range grouped per day, newest day first. Open-ended when bounds omitted. */
export function readActivityRange(from?: string | null, to?: string | null): ActivityDay[] {
  return readRangeCore(dir(), from ?? null, to ?? null) as ActivityDay[];
}
