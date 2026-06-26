import { STYLES, GENRES, type PosterStyle, type PosterGenre } from "@/lib/posters";

interface Props {
  style: PosterStyle | "All";
  genre: PosterGenre | "All";
  onStyle: (s: PosterStyle | "All") => void;
  onGenre: (g: PosterGenre | "All") => void;
}

export function FilterBar({ style, genre, onStyle, onGenre }: Props) {
  return (
    <div className="scrollbar-hide sticky top-[60px] z-30 overflow-x-auto px-4 py-3 backdrop-blur-md sm:px-6" style={{ backgroundColor: "rgba(18,18,18,0.8)" }}>
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 whitespace-nowrap">
        <span className="pr-1 text-[11px] uppercase tracking-widest text-white/40">Style</span>
        <Chip active={style === "All"} onClick={() => onStyle("All")}>All</Chip>
        {STYLES.map((s) => (
          <Chip key={s} active={style === s} onClick={() => onStyle(s)}>{s}</Chip>
        ))}
        <span className="mx-2 h-4 w-px bg-white/10" />
        <span className="pr-1 text-[11px] uppercase tracking-widest text-white/40">Genre</span>
        <Chip active={genre === "All"} onClick={() => onGenre("All")}>All</Chip>
        {GENRES.map((g) => (
          <Chip key={g} active={genre === g} onClick={() => onGenre(g)}>{g}</Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-xs transition-all"
      style={{
        borderColor: active ? "#FF6B6B" : "rgba(255,255,255,0.12)",
        backgroundColor: active ? "rgba(255,107,107,0.12)" : "transparent",
        color: active ? "#FF6B6B" : "rgba(245,245,245,0.75)",
      }}
    >
      {children}
    </button>
  );
}
