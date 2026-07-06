import { Link } from "@tanstack/react-router";
import { Search, Sparkles } from "lucide-react";

interface Props {
  query?: string;
  onQueryChange?: (v: string) => void;
  showSearch?: boolean;
  onFeelingLucky?: () => void;
}

export function Header({ query = "", onQueryChange, showSearch = true, onFeelingLucky }: Props) {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md" style={{ backgroundColor: "rgba(18,18,18,0.8)" }}>
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 sm:py-4">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <FrameIcon />
          <span style={{ fontFamily: "Bebas Neue, sans-serif" }} className="text-2xl tracking-[0.12em] sm:text-3xl">
            CINEPRINT
          </span>
        </Link>

        {showSearch && (
          <div className="relative mx-auto hidden max-w-md flex-1 md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
            <input
              value={query}
              onChange={(e) => onQueryChange?.(e.target.value)}
              placeholder="Search posters, artists, tags…"
              className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-[#F5F5F5] placeholder:text-white/40 focus:border-[#FF6B6B] focus:outline-none"
            />
          </div>
        )}

        <nav className="ml-auto flex items-center gap-1 text-sm sm:gap-2">
          {onFeelingLucky && (
            <button
              onClick={onFeelingLucky}
              title="Feeling Lucky? Show a random poster."
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-white/70 transition-all duration-150 hover:text-[#FF6B6B] active:scale-95"
            >
              <Sparkles size={16} />
              <span className="hidden sm:inline">Lucky</span>
            </button>
          )}
          <NavLink to="/about">About</NavLink>
          <NavLink to="/submit">Submit</NavLink>
          <NavLink to="/saved">Saved</NavLink>
          {/* <NavLink to="/constellation">Galaxy</NavLink> */}
        </nav>
      </div>

      {showSearch && (
        <div className="px-4 pb-3 md:hidden">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
            <input
              value={query}
              onChange={(e) => onQueryChange?.(e.target.value)}
              placeholder="Search posters, artists, tags…"
              className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-[#F5F5F5] placeholder:text-white/40 focus:border-[#FF6B6B] focus:outline-none"
            />
          </div>
        </div>
      )}
    </header>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-full px-3 py-1.5 text-white/70 transition-colors hover:text-[#F5F5F5]"
      activeProps={{ style: { color: "#FF6B6B" } }}
    >
      {children}
    </Link>
  );
}

function FrameIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2" strokeLinecap="square">
      <path d="M3 3 H9 M3 3 V9" />
      <path d="M21 21 H15 M21 21 V15" />
    </svg>
  );
}
