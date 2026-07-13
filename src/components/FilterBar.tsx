import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, Film, CalendarRange, Paintbrush, Sparkles } from "lucide-react";
import { type PosterStyle, type PosterGenre } from "@/lib/posters";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  style: PosterStyle | "All";
  genre: PosterGenre | "All";
  decade: string | "All";
  artist: string | "All";
  styles: PosterStyle[];
  genres: PosterGenre[];
  decades: string[];
  artists: string[];
  onStyle: (s: PosterStyle | "All") => void;
  onGenre: (g: PosterGenre | "All") => void;
  onDecade: (d: string | "All") => void;
  onArtist: (a: string | "All") => void;
}

export function FilterBar({
  query,
  onQueryChange,
  style,
  genre,
  decade,
  artist,
  styles,
  genres,
  decades,
  artists,
  onStyle,
  onGenre,
  onDecade,
  onArtist,
}: Props) {
  const [openDropdown, setOpenDropdown] = useState<"style" | "genre" | "decade" | "artist" | null>(null);

  const activeCount =
    (style !== "All" ? 1 : 0) +
    (genre !== "All" ? 1 : 0) +
    (decade !== "All" ? 1 : 0) +
    (artist !== "All" ? 1 : 0);

  const handleClearAll = () => {
    onStyle("All");
    onGenre("All");
    onDecade("All");
    onArtist("All");
    setOpenDropdown(null);
  };

  const isAnyOpen = openDropdown !== null;

  return (
    <div
      className={`sticky top-[48px] sm:top-[68px] border-b border-white/5 px-4 py-3 sm:px-6 ${isAnyOpen ? "z-50" : "z-30"}`}
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
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap scrollbar-hide w-full sm:w-auto sm:ml-auto sm:overflow-x-visible sm:flex-wrap pb-1 sm:pb-0">
          <Dropdown
            icon={<Paintbrush size={13} />}
            label="Artist"
            value={artist}
            options={artists}
            onSelect={onArtist}
            isOpen={openDropdown === "artist"}
            onToggle={() => setOpenDropdown(openDropdown === "artist" ? null : "artist")}
            align="left"
          />

          <Dropdown
            icon={<Sparkles size={13} />}
            label="Style"
            value={style}
            options={styles}
            onSelect={onStyle}
            isOpen={openDropdown === "style"}
            onToggle={() => setOpenDropdown(openDropdown === "style" ? null : "style")}
            align="left"
          />

          <Dropdown
            icon={<Film size={13} />}
            label="Genre"
            value={genre}
            options={genres}
            onSelect={onGenre}
            isOpen={openDropdown === "genre"}
            onToggle={() => setOpenDropdown(openDropdown === "genre" ? null : "genre")}
            align="right"
          />

          <Dropdown
            icon={<CalendarRange size={13} />}
            label="Decade"
            value={decade}
            options={decades}
            onSelect={onDecade}
            isOpen={openDropdown === "decade"}
            onToggle={() => setOpenDropdown(openDropdown === "decade" ? null : "decade")}
            align="right"
          />

          {activeCount > 0 && (
            <button
              onClick={handleClearAll}
              className="text-xs font-semibold text-white/40 hover:text-white active:scale-95 transition-all duration-150 pl-1 shrink-0"
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
  align?: "left" | "right";
  optionRenderer?: (opt: string) => React.ReactNode;
  triggerSwatch?: React.ReactNode;
}

function Dropdown({
  icon,
  label,
  value,
  options,
  onSelect,
  isOpen,
  onToggle,
  align = "right",
  optionRenderer,
  triggerSwatch,
}: DropdownProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const optionsList = (
    <>
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
          className="w-full rounded-lg px-3 py-2 text-left text-xs transition flex items-center gap-2"
          style={{
            backgroundColor: value === opt ? "rgba(255, 107, 107, 0.1)" : "transparent",
            color: value === opt ? "#FF6B6B" : "rgba(245, 245, 245, 0.8)",
          }}
        >
          {optionRenderer ? optionRenderer(opt) : opt}
        </button>
      ))}
    </>
  );

  return (
    <div className="relative shrink-0">
      <button
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95"
        style={{
          borderColor: value !== "All" ? "#FF6B6B" : "rgba(255, 255, 255, 0.1)",
          backgroundColor: value !== "All" ? "rgba(255, 107, 107, 0.1)" : "rgba(255, 255, 255, 0.03)",
          color: value !== "All" ? "#FF6B6B" : "rgba(245, 245, 245, 0.75)",
        }}
      >
        <span className={value !== "All" ? "text-[#FF6B6B]" : "text-white/50"}>{icon}</span>
        {triggerSwatch}
        <span>{value !== "All" ? `${label}: ${value}` : label}</span>
        <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <>
          {/* Desktop Overlay & Dropdown (rendered inline, hidden on mobile) */}
          <div className="fixed inset-0 z-40 hidden sm:block" onClick={onToggle} />
          <div className={`absolute ${align === "left" ? "left-0" : "right-0"} mt-2 max-h-60 w-48 overflow-y-auto rounded-xl border border-white/10 bg-[#1a1a1a] p-1.5 shadow-2xl z-50 backdrop-blur-md hidden sm:block`}>
            {optionsList}
          </div>

          {/* Mobile Overlay & Dropdown (portaled to body to escape stacking context constraints, hidden on desktop) */}
          {mounted && typeof document !== "undefined" && createPortal(
            <>
              <div className="fixed top-[152px] inset-x-0 bottom-0 z-40 bg-black/60 backdrop-blur-sm sm:hidden" onClick={onToggle} />
              <div className="fixed top-[152px] inset-x-4 max-h-[60vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#1a1a1a] p-2.5 shadow-2xl z-50 backdrop-blur-md sm:hidden">
                {optionsList}
              </div>
            </>,
            document.body
          )}
        </>
      )}
    </div>
  );
}
