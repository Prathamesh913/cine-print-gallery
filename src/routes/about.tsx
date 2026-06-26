import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

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
    <div className="min-h-screen" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
      <Header showSearch={false} />
      <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-6 text-center">
        <span style={{ fontFamily: "Bebas Neue, sans-serif", color: "#FF6B6B" }} className="text-sm tracking-[0.3em]">
          ABOUT
        </span>
        <h1 style={{ fontFamily: "Poppins, sans-serif" }} className="mt-3 text-3xl font-semibold sm:text-4xl">
          One print at a time.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-white/70">
          CinePrint is a curated collection of alternative film and TV posters created by artists around the world.
          We celebrate the craft of poster design — one print at a time.
        </p>
      </main>
      <Footer />
    </div>
  );
}
