import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import {
  Github,
  Twitter,
  Mail,
  Globe,
  MessageSquare,
  ExternalLink,
  LayoutGrid,
  Orbit,
  Heart,
  Send,
} from "lucide-react";
import { fetchNotionPosters } from "@/lib/notion";
import { PosterImage } from "@/components/PosterImage";

export const Route = createFileRoute("/about")({
  // Same 2-min-cached server fn every discovery route uses — powers the stat
  // row and archive filmstrip with real catalog data.
  loader: () => fetchNotionPosters(),
  head: () => ({
    meta: [
      { title: "About CinePrint — Curated Alternative Film & TV Art Gallery" },
      {
        name: "description",
        content:
          "Learn about CinePrint, a curated digital archive of custom alternative movie posters, minimalist film art, and television key designs created by independent designers.",
      },
    ],
  }),
  component: About,
});

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]";

/** Cross-pathway tiles — every destination already exists in the route tree. */
const exploreTiles = [
  {
    to: "/",
    icon: LayoutGrid,
    label: "Gallery",
    description: "Browse the full poster wall.",
  },
  {
    to: "/constellation",
    icon: Orbit,
    label: "Constellation",
    description: "Explore the catalog by color.",
  },
  {
    to: "/saved",
    icon: Heart,
    label: "Saved",
    description: "Your pinned posters and collections.",
  },
  {
    to: "/submit",
    icon: Send,
    label: "Submit",
    description: "Add a poster to the archive.",
  },
] as const;

function About() {
  const loaderData = Route.useLoaderData();
  // Defensive: a failed/empty server response degrades to no data rather than a crash.
  const posters = Array.isArray(loaderData) ? loaderData : [];

  /** Unique credited artists — `artists[]` preferred, legacy flat `artist` fallback. */
  let uniqueArtistCount = 0;
  {
    const seen = new Set<string>();
    for (const poster of posters) {
      const names =
        poster.artists && poster.artists.length > 0
          ? poster.artists.map((a) => a.name)
          : [poster.artist];
      for (const rawName of names) {
        const name = (rawName ?? "").trim();
        if (!name || name.toLowerCase() === "unknown") continue;
        seen.add(name.toLowerCase());
      }
    }
    uniqueArtistCount = seen.size;
  }

  let distinctStyleCount = 0;
  {
    const seen = new Set<string>();
    for (const poster of posters) {
      const style = (poster.style ?? "").trim();
      if (!style || style.toLowerCase() === "unknown") continue;
      seen.add(style.toLowerCase());
    }
    distinctStyleCount = seen.size;
  }

  // Stat cells: skip any metric that would render as 0/dead against live data;
  // the lone exception is Posters, which always shows the actual number.
  const statCells: { value: string; label: string }[] = [];
  statCells.push({ value: String(posters.length), label: "Posters" });
  if (uniqueArtistCount > 0) {
    statCells.push({ value: String(uniqueArtistCount), label: "Artists" });
  }
  if (distinctStyleCount > 1) {
    statCells.push({ value: String(distinctStyleCount), label: "Styles" });
  }

  // Deterministic decoration: first five of catalog order, lazily loaded so the
  // strip never competes with the hero or shifts layout (fixed 2:3 boxes).
  const stripPosters = posters.slice(0, 5);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} />
      <main className="page-shell flex-grow pt-10 pb-12">
        {/* Hero */}
        <section>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-[#FF6B6B]">
            About CinePrint
          </p>
          <h1 className="mt-3 max-w-3xl font-heading text-3xl leading-tight sm:text-4xl lg:text-5xl">
            Celebrating alternative movie posters & custom film art.
          </h1>
          <div className="mt-6 max-w-[65ch] space-y-4 text-sm leading-relaxed text-white/70 sm:text-base">
            <p>
              CinePrint is a curated digital gallery celebrating custom alternative movie posters
              and television key art design. We archive minimalist film poster artwork, bold vector
              layouts, and retro cinematic designs created by independent designers and illustrators
              globally.
            </p>
            <p>
              Explore fan-made visual re-imaginations of cinematic masterpieces, download
              high-resolution ticket print designs, and discover talented poster artists.
            </p>
          </div>
        </section>

        {/* Stat row */}
        {statCells.length > 0 && (
          <section aria-label="Archive statistics" className="mt-8">
            <div className="flex divide-x divide-white/10">
              {statCells.map((cell) => (
                <div key={cell.label} className="flex flex-col justify-center px-5 first:pl-0">
                  <p className="text-lg leading-none font-semibold tabular-nums text-[#F5F5F5]">
                    {cell.value}
                  </p>
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-white/55">
                    {cell.label}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Archive filmstrip — lazy discovery anchor */}
        {posters.length >= 5 && (
          <section aria-label="From the archive" className="mt-10">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="font-mono text-[10px] tracking-widest text-white/55 uppercase sm:text-xs">
                From the Archive
              </p>
              <Link
                to="/"
                preload="intent"
                className={`inline-flex min-h-11 shrink-0 items-center font-mono text-[10px] tracking-widest text-white/55 uppercase transition-colors duration-150 ease-[var(--ease-out)] hoverable:hover:text-[#FF6B6B] sm:text-xs ${focusRing}`}
              >
                Browse all →
              </Link>
            </div>
            <div className="-mx-1 scrollbar-hide overflow-x-auto px-1">
              <ul className="flex w-max gap-3">
                {stripPosters.map((poster) => (
                  <li key={poster.id}>
                    <Link
                      to="/poster/$id"
                      params={{ id: poster.id }}
                      preload="intent"
                      aria-label={`${poster.title} (${poster.year})`}
                      className={`block aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-lg border border-white/15 transition-colors duration-150 ease-[var(--ease-out)] hoverable:hover:border-white/30 sm:w-28 ${focusRing}`}
                    >
                      <PosterImage
                        poster={poster}
                        purpose="gallery"
                        loading="lazy"
                        decoding="async"
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Explore rail */}
        <nav aria-label="Explore CinePrint" className="mt-10">
          <p className="mb-3 font-mono text-[10px] tracking-widest text-white/55 uppercase sm:text-xs">
            Explore
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {exploreTiles.map(({ to, icon: Icon, label, description }) => (
              <Link
                key={label}
                to={to}
                preload="intent"
                className={`flex min-h-11 flex-col rounded-xl border border-white/15 bg-white/5 p-4 transition duration-150 ease-[var(--ease-out)] hoverable:hover:border-white/25 hoverable:hover:bg-white/10 ${focusRing}`}
              >
                <Icon size={16} className="text-[#FF6B6B]" aria-hidden />
                <span className="mt-3 text-sm font-medium">{label}</span>
                <span className="mt-1 text-xs leading-relaxed text-white/55">{description}</span>
              </Link>
            ))}
          </div>
        </nav>

        {/* Curator pass zone */}
        <div className="mt-10 max-w-4xl">
          {/* Creator Cinema Ticket Pass */}
          <div className="relative flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-white/[0.06] shadow-2xl sm:flex-row">
            {/* Left Pane: Main Curator Pass (70% on desktop) */}
            <div className="w-full p-6 sm:w-[70%] sm:p-8 flex flex-col justify-between relative">
              {/* Red Curator Stamp */}
              <div className="absolute top-6 right-6 border border-[#FF6B6B]/30 text-[#FF6B6B]/40 font-mono text-[9px] uppercase py-0.5 px-2 tracking-[0.2em] rounded -rotate-6 select-none pointer-events-none">
                CURATOR PASS
              </div>

              <div>
                <span className="text-xs uppercase tracking-[0.25em] text-[#FF6B6B] font-display">
                  CREATOR & CURATOR
                </span>
                <h2 className="mt-1 text-5xl tracking-wide uppercase text-white font-bold leading-none font-display">
                  Prathamesh
                </h2>
                <p className="mt-4 text-sm text-white/70 leading-relaxed font-sans max-w-md">
                  Design Engineer, movie enthusiast, and typography lover. Created CinePrint to
                  archive and share custom visual re-imaginations of cinema masterpieces.
                </p>
              </div>

              {/* Social channels as retro ticket tags */}
              <div className="mt-8 flex flex-wrap gap-2.5">
                <a
                  href="https://github.com/Prathamesh913"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 rounded border border-white/15 bg-white/5 hover:bg-[#FF6B6B]/10 hover:border-[#FF6B6B]/40 px-3.5 py-1.5 text-xs text-white/60 hover:text-[#FF6B6B] transition-all duration-300 font-mono"
                >
                  <Github size={13} />
                  <span>GITHUB</span>
                </a>
                <a
                  href="https://x.com/Prathamesh913"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 rounded border border-white/15 bg-white/5 hover:bg-[#FF6B6B]/10 hover:border-[#FF6B6B]/40 px-3.5 py-1.5 text-xs text-white/60 hover:text-[#FF6B6B] transition-all duration-300 font-mono"
                >
                  <Twitter size={13} />
                  <span>TWITTER</span>
                </a>
                <a
                  href="mailto:prathameshjadhav913@gmail.com"
                  className="group inline-flex items-center gap-2 rounded border border-white/15 bg-white/5 hover:bg-[#FF6B6B]/10 hover:border-[#FF6B6B]/40 px-3.5 py-1.5 text-xs text-white/60 hover:text-[#FF6B6B] transition-all duration-300 font-mono"
                >
                  <Mail size={13} />
                  <span>EMAIL</span>
                </a>
                <a
                  href="https://prathameshdesigns.framer.website/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 rounded border border-white/15 bg-white/5 hover:bg-[#FF6B6B]/10 hover:border-[#FF6B6B]/40 px-3.5 py-1.5 text-xs text-white/60 hover:text-[#FF6B6B] transition-all duration-300 font-mono"
                >
                  <Globe size={13} />
                  <span>PORTFOLIO</span>
                </a>
              </div>
            </div>

            {/* Separation line (Vertical on desktop, horizontal on mobile) */}
            <div className="border-t border-dotted border-white/20 w-full h-0 sm:w-0 sm:h-auto sm:border-t-0 sm:border-l sm:border-dotted sm:my-4 sm:mx-1 sm:opacity-100"></div>

            {/* Right Pane: Stub / Details (30% on desktop) */}
            <div className="w-full bg-black/25 p-6 sm:w-[30%] sm:p-8 flex flex-row sm:flex-col justify-between items-center sm:items-stretch sm:text-left text-center">
              {/* Ticket Info Stack */}
              <div className="space-y-3 text-left">
                <div>
                  <p className="text-[9px] font-mono tracking-widest text-white/45 uppercase">
                    SECTION
                  </p>
                  <p className="text-xl tracking-wider text-white font-display">ARCHIVE</p>
                </div>
                <div>
                  <p className="text-[9px] font-mono tracking-widest text-white/45 uppercase">
                    TICKET NO.
                  </p>
                  <p className="text-xl tracking-wider text-[#FF6B6B] font-display">#0001</p>
                </div>
                <div className="sm:block hidden">
                  <p className="text-[9px] font-mono tracking-widest text-white/45 uppercase">
                    ADMIT
                  </p>
                  <p className="text-xl tracking-wider text-white font-display">ONE CURATOR</p>
                </div>
              </div>

              {/* Retro Barcode Container */}
              <div className="flex flex-col items-center sm:items-start gap-1 sm:mt-6">
                <div className="flex items-end h-10 gap-[1.5px] opacity-75">
                  <div className="h-full w-[2px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[3px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[4px] bg-white"></div>
                  <div className="h-full w-[2px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[3px] bg-white"></div>
                  <div className="h-full w-[2px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[5px] bg-white"></div>
                  <div className="h-full w-[2px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[3px] bg-white"></div>
                  <div className="h-full w-[2px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[5px] bg-white"></div>
                  <div className="h-full w-[2px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[3px] bg-white"></div>
                  <div className="h-full w-[2px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[5px] bg-white"></div>
                  <div className="h-full w-[2px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[3px] bg-white"></div>
                  <div className="h-full w-[2px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[5px] bg-white"></div>
                  <div className="h-full w-[2px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[3px] bg-white"></div>
                  <div className="h-full w-[2px] bg-white"></div>
                  <div className="h-full w-[1px] bg-white"></div>
                  <div className="h-full w-[5px] bg-white"></div>
                </div>
                <span className="text-[8px] font-mono tracking-[0.25em] text-white/45">
                  C1N3-PR1NT
                </span>
              </div>
            </div>
          </div>

          {/* Suggestion callout — merged into the curator-pass zone */}
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="flex items-start gap-3">
              <MessageSquare size={16} className="mt-0.5 shrink-0 text-[#FF6B6B]" aria-hidden />
              <div>
                <h3 className="text-sm font-semibold text-white">Got a Suggestion?</h3>
                <p className="mt-1 text-xs leading-relaxed text-white/65">
                  Have feature ideas, spotted bugs, or want to suggest posters? Feel free to reach
                  out through social channels listed above.
                </p>
              </div>
            </div>
            <Link
              to="/submit"
              preload="intent"
              className={`inline-flex min-h-11 shrink-0 items-center gap-1 self-start text-xs font-bold tracking-widest text-[#FF6B6B] uppercase transition-colors duration-150 ease-[var(--ease-out)] hoverable:hover:text-[#FF8585] sm:self-center ${focusRing}`}
            >
              Submit Poster
              <ExternalLink size={10} />
            </Link>
          </div>
        </div>

        {/* Fine print — wording preserved verbatim */}
        <div className="mt-12 border-t border-white/10 pt-4">
          <p className="max-w-2xl text-[11px] leading-relaxed text-white/40 sm:text-xs">
            CinePrint is a non-commercial fan project. All poster art belongs to the respective
            artists/studios. If you are an artist and want your work removed, please contact me and
            it will be taken down immediately.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
