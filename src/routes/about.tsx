import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Github, Twitter, Mail, Globe, Sparkles, MessageSquare, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — CinePrint" },
      { name: "description", content: "CinePrint is a curated collection of alternative film and TV posters." },
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
            Celebrating alternative poster art.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-white/70">
            CinePrint is a digital gallery celebrating alternative film and television poster design. We curate minimalist artwork, bold vector layouts, and retro aesthetics created by talented designers globally.
          </p>
        </div>

        {/* Creator Card */}
        <div className="mt-12 rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-8 backdrop-blur-md relative overflow-hidden">
          {/* Subtle neon glowing accent */}
          <div className="absolute top-0 right-0 -mt-8 -mr-8 h-24 w-24 rounded-full bg-[#FF6B6B]/10 blur-xl"></div>
          
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FF6B6B]/10 text-[#FF6B6B] shrink-0 border border-[#FF6B6B]/20">
              <Sparkles size={28} className="animate-pulse" />
            </div>
            
            <div className="text-center sm:text-left flex-grow">
              <span className="text-xs uppercase tracking-widest text-[#FF6B6B] font-semibold">
                Creator & Curator
              </span>
              <h2 style={{ fontFamily: "Poppins, sans-serif" }} className="mt-1 text-xl font-semibold text-white">
                Prathamesh
              </h2>
              <p className="mt-3 text-sm text-white/60 leading-relaxed">
                Design Engineer, movie enthusiast, and typography lover. Created CinePrint to archive and share custom visual re-imaginations of cinema masterpieces.
              </p>

              {/* Social Channels */}
              <div className="mt-6 flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <a
                  href="https://github.com/Prathamesh913"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-[#FF6B6B] hover:text-[#121212] hover:border-transparent transition-all duration-300"
                >
                  <Github size={14} />
                  GitHub
                </a>
                <a
                  href="https://x.com/Prathamesh913"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-[#FF6B6B] hover:text-[#121212] hover:border-transparent transition-all duration-300"
                >
                  <Twitter size={14} />
                  Twitter
                </a>
                <a
                  href="mailto:prathameshjadhav913@gmail.com"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-[#FF6B6B] hover:text-[#121212] hover:border-transparent transition-all duration-300"
                >
                  <Mail size={14} />
                  Email
                </a>
                <a
                  href="https://prathameshdesigns.framer.website/"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-[#FF6B6B] hover:text-[#121212] hover:border-transparent transition-all duration-300"
                >
                  <Globe size={14} />
                  Portfolio
                </a>
              </div>
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
