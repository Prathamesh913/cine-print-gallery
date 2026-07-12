import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Github, Twitter, Mail, Globe, Sparkles, MessageSquare, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About CinePrint — Curated Alternative Film & TV Art Gallery" },
      { name: "description", content: "Learn about CinePrint, a curated digital archive of custom alternative movie posters, minimalist film art, and television key designs created by independent designers." },
    ],
  }),
  component: About,
});

function About() {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
      <Header showSearch={false} />
      <main className="mx-auto w-full max-w-2xl px-6 py-16 flex-grow flex flex-col justify-center">
        {/* About CinePrint Section */}
        <div className="text-center">
          <span style={{ fontFamily: "Bebas Neue, sans-serif", color: "#FF6B6B" }} className="text-sm tracking-[0.3em] uppercase">
            ABOUT CINEPRINT
          </span>
          <h1 style={{ fontFamily: "Poppins, sans-serif" }} className="mt-2 text-3xl font-bold sm:text-4xl">
            Celebrating alternative movie posters & custom film art.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-white/70">
            CinePrint is a curated digital gallery celebrating custom alternative movie posters and television key art design. We archive minimalist film poster artwork, bold vector layouts, and retro cinematic designs created by independent designers and illustrators globally. Explore fan-made visual re-imaginations of cinematic masterpieces, download high-resolution ticket print designs, and discover talented poster artists.
          </p>
        </div>

        {/* Highlighted Project Notice */}
        <div className="mt-8 border-l-2 border-[#FF6B6B] bg-[#FF6B6B]/5 px-4 py-3 rounded-r-lg text-left">
          <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
            CinePrint is a non-commercial fan project. All poster art belongs to the respective artists/studios. If you are an artist and want your work removed, please contact me and it will be taken down immediately.
          </p>
        </div>

        {/* Creator Cinema Ticket Pass */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-[#161616] relative overflow-hidden flex flex-col sm:flex-row shadow-2xl">
          {/* Left Pane: Main Curator Pass (70% on desktop) */}
          <div className="w-full sm:w-[70%] p-6 sm:p-8 flex flex-col justify-between relative">
            {/* Red Curator Stamp */}
            <div className="absolute top-6 right-6 border border-[#FF6B6B]/30 text-[#FF6B6B]/40 font-mono text-[9px] uppercase py-0.5 px-2 tracking-[0.2em] rounded -rotate-6 select-none pointer-events-none">
              CURATOR PASS
            </div>

            <div>
              <span style={{ fontFamily: "Bebas Neue, sans-serif" }} className="text-xs uppercase tracking-[0.25em] text-[#FF6B6B]">
                CREATOR & CURATOR
              </span>
              <h2 style={{ fontFamily: "Bebas Neue, sans-serif" }} className="mt-1 text-5xl tracking-wide uppercase text-white font-bold leading-none">
                Prathamesh
              </h2>
              <p className="mt-4 text-sm text-white/70 leading-relaxed font-sans max-w-md">
                Design Engineer, movie enthusiast, and typography lover. Created CinePrint to archive and share custom visual re-imaginations of cinema masterpieces.
              </p>
            </div>

            {/* Social channels as retro ticket tags */}
            <div className="mt-8 flex flex-wrap gap-2.5">
              <a
                href="https://github.com/Prathamesh913"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2 rounded border border-white/10 bg-white/2 hover:bg-[#FF6B6B]/10 hover:border-[#FF6B6B]/40 px-3.5 py-1.5 text-xs text-white/60 hover:text-[#FF6B6B] transition-all duration-300 font-mono"
              >
                <Github size={13} />
                <span>GITHUB</span>
              </a>
              <a
                href="https://x.com/Prathamesh913"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2 rounded border border-white/10 bg-white/2 hover:bg-[#FF6B6B]/10 hover:border-[#FF6B6B]/40 px-3.5 py-1.5 text-xs text-white/60 hover:text-[#FF6B6B] transition-all duration-300 font-mono"
              >
                <Twitter size={13} />
                <span>TWITTER</span>
              </a>
              <a
                href="mailto:prathameshjadhav913@gmail.com"
                className="group inline-flex items-center gap-2 rounded border border-white/10 bg-white/2 hover:bg-[#FF6B6B]/10 hover:border-[#FF6B6B]/40 px-3.5 py-1.5 text-xs text-white/60 hover:text-[#FF6B6B] transition-all duration-300 font-mono"
              >
                <Mail size={13} />
                <span>EMAIL</span>
              </a>
              <a
                href="https://prathameshdesigns.framer.website/"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2 rounded border border-white/10 bg-white/2 hover:bg-[#FF6B6B]/10 hover:border-[#FF6B6B]/40 px-3.5 py-1.5 text-xs text-white/60 hover:text-[#FF6B6B] transition-all duration-300 font-mono"
              >
                <Globe size={13} />
                <span>PORTFOLIO</span>
              </a>
            </div>
          </div>

          {/* Separation line (Vertical on desktop, horizontal on mobile) */}
          <div className="border-t border-dotted border-white/20 w-full h-0 sm:w-0 sm:h-auto sm:border-t-0 sm:border-l sm:border-dotted sm:my-4 sm:mx-1 sm:opacity-100"></div>

          {/* Right Pane: Stub / Details (30% on desktop) */}
          <div className="w-full sm:w-[30%] bg-white/[0.02] p-6 sm:p-8 flex flex-row sm:flex-col justify-between items-center sm:items-stretch sm:text-left text-center">
            {/* Ticket Info Stack */}
            <div className="space-y-3 text-left">
              <div>
                <p className="text-[9px] font-mono tracking-widest text-white/30 uppercase">SECTION</p>
                <p style={{ fontFamily: "Bebas Neue, sans-serif" }} className="text-xl tracking-wider text-white">ARCHIVE</p>
              </div>
              <div>
                <p className="text-[9px] font-mono tracking-widest text-white/30 uppercase">TICKET NO.</p>
                <p style={{ fontFamily: "Bebas Neue, sans-serif" }} className="text-xl tracking-wider text-[#FF6B6B]">#0001</p>
              </div>
              <div className="sm:block hidden">
                <p className="text-[9px] font-mono tracking-widest text-white/30 uppercase">ADMIT</p>
                <p style={{ fontFamily: "Bebas Neue, sans-serif" }} className="text-xl tracking-wider text-white">ONE CURATOR</p>
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
              <span className="text-[8px] font-mono tracking-[0.25em] text-white/30">C1N3-PR1NT</span>
            </div>
          </div>
        </div>

        {/* Suggestion Callout */}
        <div className="mt-8 text-center bg-white/2 border border-white/5 rounded-2xl p-6">
          <div className="flex justify-center text-[#FF6B6B] mb-2">
            <MessageSquare size={20} />
          </div>
          <h3 className="text-sm font-semibold text-white">Got a Suggestion?</h3>
          <p className="mt-2 text-xs text-white/50 max-w-md mx-auto leading-relaxed">
            Have feature ideas, spotted bugs, or want to suggest posters? Feel free to reach out through social channels listed above.
          </p>
          <div className="mt-4">
            <Link
              to="/submit"
              className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-[#FF6B6B] hover:text-[#FF8585] transition"
            >
              Submit Poster
              <ExternalLink size={10} />
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
