import type { LucideIcon } from "lucide-react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  count?: number | string;
}

interface TabToggleProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  tabs: TabItem<T>[];
  className?: string;
}

export function TabToggle<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: TabToggleProps<T>) {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-1 rounded-xl border border-white/12 bg-white/[0.06] p-1 ${className ?? ""}`}
    >
      {tabs.map((tab) => {
        const active = value === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-[background-color,color] duration-150 ease-[var(--ease-out)] focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]/70 ${
              active
                ? "bg-[#FF6B6B] text-[#121212]"
                : "text-white/55 hoverable:hover:bg-white/[0.08] hoverable:hover:text-white/85"
            }`}
          >
            {Icon && <Icon size={14} fill={active ? "currentColor" : "none"} />}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium leading-none ${
                  active ? "bg-[#121212] text-[#FF6B6B]" : "bg-white/15 text-white/75"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
