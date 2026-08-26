import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  children?: ReactNode;
}

/** Shared empty-state block — centered L1 card with icon, title, optional body + actions. */
export function EmptyState({ icon: Icon, title, body, children }: EmptyStateProps) {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-white/15 bg-white/5 p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FF6B6B]/10 text-[#FF6B6B]">
        <Icon size={24} />
      </div>
      <h2 className="mb-2 font-heading text-xl font-semibold">{title}</h2>
      {body && <p className="mb-6 text-sm text-white/60">{body}</p>}
      {children && <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>}
    </div>
  );
}

/** Skeleton matching the CollectionCard shell for loading grids. */
export function CollectionCardSkeleton() {
  return (
    <div className="h-fit animate-pulse gap-2.5 self-start overflow-hidden rounded-2xl border border-white/12 bg-white/[0.06] p-2.5">
      <div className="flex gap-2.5">
        <div className="h-20 w-14 shrink-0 rounded-lg bg-white/10" />
        <div className="min-w-0 flex-1 self-center space-y-2.5">
          <div className="h-4 w-3/4 rounded-md bg-white/10" />
          <div className="h-3 w-1/2 rounded-md bg-white/5" />
        </div>
      </div>
    </div>
  );
}
