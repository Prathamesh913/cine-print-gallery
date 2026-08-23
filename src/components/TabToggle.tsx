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
      className={`inline-flex rounded-full border border-white/15 bg-white/[0.06] p-1 ${className ?? ""}`}
    >
      {tabs.map((tab) => {
        const active = value === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm transition-colors sm:min-h-0"
            style={{
              backgroundColor: active ? "#FF6B6B" : "transparent",
              color: active ? "#121212" : "rgba(255,255,255,0.55)",
            }}
          >
            {Icon && <Icon size={13} fill={active ? "currentColor" : "none"} />}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none ${
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
