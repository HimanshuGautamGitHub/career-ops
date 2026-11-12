import { NextResponse } from "next/server";
import {
  ApplyQueueValidationError,
  enqueueApplyItem,
  listApplyItems,
} from "@/lib/apply-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiError(error: unknown, fallback: string) {
  if (error instanceof ApplyQueueValidationError || error instanceof SyntaxError) {
    const msg = error.message || fallback;
    // dedup collisions go to 409; every other validation error is 400
    if (/already in the apply queue/i.test(msg)) {
      return { status: 409, body: { error: msg } };
    }
    return { status: 400, body: { error: msg } };
  }
  if (error instanceof Error && /lock timeout/i.test(error.message)) {
    return { status: 409, body: { error: "Apply queue is busy; try again." } };
  }
  return { status: 500, body: { error: fallback } };
}

export async function GET() {
  try {
    return NextResponse.json(
      { items: listApplyItems() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const failure = apiError(error, "Could not read the apply queue.");
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== "object") {
      throw new ApplyQueueValidationError("body must be a JSON object");
    }
    const item = await enqueueApplyItem(body as never);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    const failure = apiError(error, "Could not enqueue the apply-queue item.");
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
