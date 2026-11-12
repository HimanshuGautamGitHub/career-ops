import { pageFrameWidthClass } from "@/components/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

// Mirrors activity-view.tsx: serif title + intro, a four-up stat row, then the
// per-day timeline groups. Exists so navigating to /activity shows feedback
// instead of leaving the previous page on screen (route-loading-coverage test).
export default function ActivityLoading() {
  return (
    <div className={`mx-auto px-5 py-8 md:px-8 ${pageFrameWidthClass.default}`} aria-label="Loading activity">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <div className="mt-8 space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    </div>
  );
}
