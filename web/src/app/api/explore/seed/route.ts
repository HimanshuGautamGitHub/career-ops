import { seedExploreFilters } from "@/lib/core/portals";
import { DEFAULT_FILTERS } from "@/lib/explore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// First-search seed for the scheduled-scan create form. The create modal is a
// client component, so it cannot call seedExploreFilters (fs-bound) directly;
// this GET hands it the same portals.yml / profile.yml defaults the Explorer
// page seeds from server-side. Read-only, FREE (no scanner, no LLM). A bare
// checkout with no config falls back to DEFAULT_FILTERS rather than erroring.
export function GET() {
  try {
    return Response.json(seedExploreFilters());
  } catch {
    return Response.json({ filters: DEFAULT_FILTERS, seededFrom: [] });
  }
}
