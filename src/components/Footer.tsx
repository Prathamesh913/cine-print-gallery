import { Link } from "@tanstack/react-router";

const NAV_LINKS = [
  { label: "Artists", to: "/artists" },
  { label: "Genres", to: "/genres" },
  { label: "Styles", to: "/styles" },
  { label: "About", to: "/about" },
] as const;

export function Footer() {
  return (
    <footer className="py-10 text-center text-xs text-white/45">
      <nav aria-label="Footer">
        <ul className="mb-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {NAV_LINKS.map((link) => (
            <li key={link.to}>
              <Link
                to={link.to}
                className="transition-colors hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      CinePrint © 2026
    </footer>
  );
}
