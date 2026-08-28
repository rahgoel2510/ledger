import { Skeleton } from "@/components/ui/skeleton";

/**
 * Next.js route-level loading UI — shown automatically during client-side
 * navigation while a route segment's code/data is still being fetched
 * (e.g. slow network). See docs/modules for real per-page skeletons as
 * those modules get built; this generic shape is the fallback.
 */
export default function Loading() {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:px-6 sm:py-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
