import { pageFrameWidthClass } from "@/components/page-frame";
import { Skeleton } from "@/components/ui/skeleton";

// Mirrors apply-review-view.tsx: a back link, header, and the prefill/actions
// cards. Exists so navigating to a single application shows feedback instead of
// the previous page (route-loading-coverage test).
export default function ApplyReviewLoading() {
  return (
    <div className={`mx-auto px-5 py-8 md:px-8 ${pageFrameWidthClass.default}`} aria-label="Loading application">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-6 h-10 w-64" />
      <Skeleton className="mt-6 h-16 w-full" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    </div>
  );
}
