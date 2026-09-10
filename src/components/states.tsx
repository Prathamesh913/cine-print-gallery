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
      {children && (
        <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>
      )}
    </div>
  );
}

/** Skeleton matching the CollectionCard shell for loading grids. */
export function CollectionCardSkeleton() {
  return (
    <div className="flex w-56 shrink-0 animate-pulse flex-col overflow-hidden rounded-xl border border-white/12 bg-white/[0.06] sm:w-64">
      <div className="flex h-[168px] items-end justify-center px-3 pt-4 sm:h-[184px]">
        <div className="flex items-end justify-center gap-1">
          <div className="h-[120px] w-[80px] -rotate-[6deg] rounded-lg bg-white/10 sm:h-[132px] sm:w-[88px]" />
          <div className="h-[132px] w-[88px] rounded-lg bg-white/10 sm:h-[144px] sm:w-[96px]" />
          <div className="h-[120px] w-[80px] rotate-[6deg] rounded-lg bg-white/10 sm:h-[132px] sm:w-[88px]" />
        </div>
      </div>
      <div className="flex flex-1 flex-col rounded-t-xl border-t border-white/10 bg-[#0F0F0F] px-4 pb-4 pt-4">
        <div className="h-4 w-3/4 rounded-md bg-white/10" />
        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
          <div className="h-3 w-16 rounded-md bg-white/10" />
          <div className="h-3 w-12 rounded-md bg-white/5" />
        </div>
      </div>
    </div>
  );
}
