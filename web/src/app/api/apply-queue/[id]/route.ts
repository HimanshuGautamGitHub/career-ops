import { NextResponse } from "next/server";
import {
  ApplyQueueValidationError,
  getApplyItem,
  isSafeQueueId,
  transitionApplyItem,
} from "@/lib/apply-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function apiError(error: unknown, fallback: string) {
  if (error instanceof ApplyQueueValidationError || error instanceof SyntaxError) {
    const msg = error.message || fallback;
    if (/not found/i.test(msg)) return { status: 404, body: { error: msg } };
    if (/illegal transition/i.test(msg)) return { status: 409, body: { error: msg } };
    return { status: 400, body: { error: msg } };
  }
  if (error instanceof Error && /lock timeout/i.test(error.message)) {
    return { status: 409, body: { error: "Apply queue is busy; try again." } };
  }
  return { status: 500, body: { error: fallback } };
}

async function readId(ctx: Ctx): Promise<string | null> {
  const { id } = await ctx.params;
  if (!isSafeQueueId(id)) return null;
  return id;
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const id = await readId(ctx);
    if (!id) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const item = getApplyItem(id);
    if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(item, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = apiError(error, "Could not read the apply-queue item.");
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const id = await readId(ctx);
    if (!id) return NextResponse.json({ error: "invalid id" }, { status: 400 });

    const body = (await req.json()) as unknown;
    if (!body || typeof body !== "object") {
      throw new ApplyQueueValidationError("body must be a JSON object");
    }
    const item = await transitionApplyItem(id, body as never);
    return NextResponse.json(item);
  } catch (error) {
    const failure = apiError(error, "Could not update the apply-queue item.");
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
