import { NextResponse } from "next/server";
import { isActivityDate, readActivityDay, readActivityRange } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/activity
 *   ?date=YYYY-MM-DD           → one day's events (newest first)
 *   ?from=YYYY-MM-DD&to=...     → a range grouped per day (newest day first)
 *   (no params)                → all available days grouped per day
 *
 * Read-only. Returns a graceful empty result when nothing has been logged.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  try {
    if (date !== null) {
      if (!isActivityDate(date)) {
        return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
      }
      return NextResponse.json(
        { date, events: readActivityDay(date) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if ((from !== null && !isActivityDate(from)) || (to !== null && !isActivityDate(to))) {
      return NextResponse.json({ error: "from/to must be YYYY-MM-DD" }, { status: 400 });
    }

    return NextResponse.json(
      { days: readActivityRange(from, to) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Could not read the activity log." }, { status: 500 });
  }
}
