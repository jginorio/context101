import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading fallback that mirrors <AppShell>'s frame (sidebar + header + content)
 * so route-segment navigation shows an instant, on-shape skeleton instead of a
 * blank stall while the server auth gate (requireActiveOrg) and the page
 * resolve. Used by each authed route's loading.tsx.
 */
export function AppShellSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <main className="flex h-screen overflow-hidden" aria-busy="true" aria-label="Loading">
      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <div className="flex items-center gap-2">
          <Skeleton className="size-8 rounded-xl" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="h-9 w-full rounded-lg" />
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md" />
          ))}
        </div>
        <div className="mt-auto flex items-center gap-2">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-3 sm:px-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="hidden h-3 w-56 sm:block" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </main>
  );
}

/**
 * Lighter fallback for standalone authed pages that don't use <AppShell>
 * (brains, settings) — a centered header + stacked content shimmer.
 */
export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-4 sm:p-8" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </main>
  );
}
