import { useState } from "react";
import { ChevronDown, Search, Palette, Film, CalendarRange } from "lucide-react";
import { type PosterStyle, type PosterGenre } from "@/lib/posters";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  style: PosterStyle | "All";
  genre: PosterGenre | "All";
  decade: string | "All";
  styles: PosterStyle[];
  genres: PosterGenre[];
  decades: string[];
  onStyle: (s: PosterStyle | "All") => void;
  onGenre: (g: PosterGenre | "All") => void;
  onDecade: (d: string | "All") => void;
}

export function FilterBar({
  query,
  onQueryChange,
  style,
  genre,
  decade,
  styles,
  genres,
  decades,
  onStyle,
  onGenre,
  onDecade,
}: Props) {
  const [openDropdown, setOpenDropdown] = useState<"style" | "genre" | "decade" | null>(null);

  const activeCount =
    (style !== "All" ? 1 : 0) +
    (genre !== "All" ? 1 : 0) +
    (decade !== "All" ? 1 : 0);

  const handleClearAll = () => {
    onStyle("All");
    onGenre("All");
    onDecade("All");
    setOpenDropdown(null);
  };

  return (
    <div
      className="sticky top-[60px] z-30 border-b border-white/5 px-4 py-3 backdrop-blur-md sm:px-6"
      style={{ backgroundColor: "rgba(18,18,18,0.8)" }}
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left Side: Search Bar */}
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" size={14} />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search posters, artists, tags…"
            className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-xs text-[#F5F5F5] placeholder:text-white/40 focus:border-[#FF6B6B] focus:outline-none transition-colors"
          />
        </div>

        {/* Right Side: Filters */}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Dropdown
            icon={<Palette size={13} />}
            label="Style"
            value={style}
            options={styles}
            onSelect={onStyle}
            isOpen={openDropdown === "style"}
            onToggle={() => setOpenDropdown(openDropdown === "style" ? null : "style")}
          />

          <Dropdown
            icon={<Film size={13} />}
            label="Genre"
            value={genre}
            options={genres}
            onSelect={onGenre}
            isOpen={openDropdown === "genre"}
            onToggle={() => setOpenDropdown(openDropdown === "genre" ? null : "genre")}
          />

          <Dropdown
            icon={<CalendarRange size={13} />}
            label="Decade"
            value={decade}
            options={decades}
            onSelect={onDecade}
            isOpen={openDropdown === "decade"}
            onToggle={() => setOpenDropdown(openDropdown === "decade" ? null : "decade")}
          />

          {activeCount > 0 && (
            <button
              onClick={handleClearAll}
              className="text-xs font-semibold text-white/40 hover:text-white transition pl-1"
            >
              Clear all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface DropdownProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  options: string[];
  onSelect: (val: any) => void;
  isOpen: boolean;
  onToggle: () => void;
}

function Dropdown({ icon, label, value, options, onSelect, isOpen, onToggle }: DropdownProps) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
        style={{
          borderColor: value !== "All" ? "#FF6B6B" : "rgba(255, 255, 255, 0.1)",
          backgroundColor: value !== "All" ? "rgba(255, 107, 107, 0.1)" : "rgba(255, 255, 255, 0.03)",
          color: value !== "All" ? "#FF6B6B" : "rgba(245, 245, 245, 0.75)",
        }}
      >
        <span className={value !== "All" ? "text-[#FF6B6B]" : "text-white/50"}>{icon}</span>
        <span>{value !== "All" ? `${label}: ${value}` : label}</span>
        <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <>
          {/* Backdrop to close when clicking outside */}
          <div className="fixed inset-0 z-40" onClick={onToggle} />
          
          <div className="absolute right-0 mt-2 max-h-60 w-48 overflow-y-auto rounded-xl border border-white/10 bg-[#1a1a1a] p-1.5 shadow-2xl z-50 backdrop-blur-md">
            <button
              onClick={() => {
                onSelect("All");
                onToggle();
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-xs transition"
              style={{
                backgroundColor: value === "All" ? "rgba(255, 107, 107, 0.1)" : "transparent",
                color: value === "All" ? "#FF6B6B" : "rgba(245, 245, 245, 0.8)",
              }}
            >
              All
            </button>
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  onSelect(opt);
                  onToggle();
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-xs transition"
                style={{
                  backgroundColor: value === opt ? "rgba(255, 107, 107, 0.1)" : "transparent",
                  color: value === opt ? "#FF6B6B" : "rgba(245, 245, 245, 0.8)",
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
