import { pageFrameWidthClass } from "@/components/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

// Mirrors apply-queue-view.tsx: serif title + intro, the never-auto-submit
// banner, then the review rows. Exists so navigating to /apply-queue shows
// feedback instead of the previous page (route-loading-coverage test).
export default function ApplyQueueLoading() {
  return (
    <div className={`mx-auto px-5 py-8 md:px-8 ${pageFrameWidthClass.default}`} aria-label="Loading apply review">
      <Skeleton className="h-9 w-52" />
      <Skeleton className="mt-3 h-4 w-full max-w-lg" />
      <Skeleton className="mt-6 h-16 w-full" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
    </div>
  );
}
