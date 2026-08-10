import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useEffect, useState, useRef } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Save, MonitorSmartphone, Heart, Loader2 } from "lucide-react";
import { fetchNotionPosters } from "@/lib/notion";
import type { Poster } from "@/lib/posters";
import { PosterImage } from "@/components/PosterImage";

interface LoginSearch {
  redirect?: string;
}

function isSafeInternalPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

export const Route = createFileRoute("/login")({
  validateSearch: (input: Record<string, unknown>): LoginSearch => ({
    redirect: typeof input.redirect === "string" ? input.redirect : undefined,
  }),
  loader: () => fetchNotionPosters(),
  head: () => ({
    meta: [
      { title: "Sign In — CinePrint" },
      { name: "description", content: "Sign in to CinePrint to save your favorite posters." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, loading, signingIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const posters = Route.useLoaderData();
  const [error, setError] = useState<string | null>(null);

  const safeRedirect = redirect && isSafeInternalPath(redirect) ? redirect : "/";

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: safeRedirect });
    }
  }, [user, loading, navigate, safeRedirect]);

  const handleSignIn = async () => {
    setError(null);
    const result = await signInWithGoogle();
    if (!result.ok && !result.redirecting) {
      setError(result.message);
    }
  };

  const displayPosters = posters.slice(0, 32);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || displayPosters.length === 0) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const anim = el.animate([{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }], {
      duration: 40000,
      iterations: Infinity,
      easing: "linear",
    });

    const section = el.closest(".scroll-section") as HTMLElement | null;
    if (!section) return () => anim.cancel();

    let rafId: number | null = null;
    let current = 1;
    let target = 1;

    function tick() {
      const diff = target - current;
      if (Math.abs(diff) < 0.003) {
        anim.playbackRate = target;
        current = target;
        rafId = null;
        return;
      }
      current += diff * 0.07;
      anim.playbackRate = current;
      rafId = requestAnimationFrame(tick);
    }

    const onEnter = () => {
      target = 0.25;
      if (!rafId) rafId = requestAnimationFrame(tick);
    };
    const onLeave = () => {
      target = 1;
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    section.addEventListener("mouseenter", onEnter);
    section.addEventListener("mouseleave", onLeave);

    return () => {
      anim.cancel();
      if (rafId) cancelAnimationFrame(rafId);
      section.removeEventListener("mouseenter", onEnter);
      section.removeEventListener("mouseleave", onLeave);
    };
  }, [displayPosters.length]);

  return (
    <div
      className="relative flex min-h-screen flex-col"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} variant="auth" />

      <main className="flex flex-1 flex-col md:flex-row">
        {/* Login panel */}
        <section className="flex w-full items-center justify-center px-6 py-12 md:w-[36%] md:py-0 md:pl-8 lg:pl-12">
          <div className="w-full max-w-sm">
            <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-8 backdrop-blur-md sm:p-10">
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-[#FF6B6B]/10">
                <FrameIcon />
              </div>

              <h1
                style={{ fontFamily: "Bebas Neue, sans-serif" }}
                className="text-4xl tracking-widest text-[#FF6B6B]"
              >
                SIGN IN
              </h1>
              <p className="mt-2 text-sm text-white/60">Keep the posters you love.</p>

              <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FF6B6B]/10">
                    <Save size={11} className="text-[#FF6B6B]" />
                  </span>
                  <span className="text-xs text-white/60">Save</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FF6B6B]/10">
                    <MonitorSmartphone size={11} className="text-[#FF6B6B]" />
                  </span>
                  <span className="text-xs text-white/60">Sync</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FF6B6B]/10">
                    <Heart size={11} className="text-[#FF6B6B]" />
                  </span>
                  <span className="text-xs text-white/60">Curate</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSignIn}
                disabled={signingIn}
                aria-busy={signingIn}
                aria-describedby={error ? "login-error" : undefined}
                className="mt-10 inline-flex w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#121212] shadow-lg shadow-white/10 transition-[transform,background-color,box-shadow] duration-200 ease-[var(--ease-out)] hoverable:hover:bg-white/90 hoverable:hover:shadow-white/20 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121212] disabled:pointer-events-none disabled:opacity-60"
              >
                {signingIn ? (
                  <Loader2 size={20} className="animate-spin text-[#121212]" aria-hidden />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                )}
                {signingIn ? "Signing in…" : "Sign in with Google"}
              </button>

              {error && (
                <p
                  id="login-error"
                  role="alert"
                  className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2.5 text-sm text-red-200"
                >
                  {error}
                </p>
              )}

              <p className="mt-4 text-xs text-white/55">
                Only Google sign-in — no password to manage.
              </p>

              <p className="mt-3 text-xs text-white/65">
                By signing in, you agree to our{" "}
                <Link
                  to="/privacy"
                  className="underline underline-offset-2 transition-colors duration-150 hoverable:hover:text-white/70"
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>
        </section>

        {/* Auto-scrolling poster showcase */}
        <section
          className="scroll-section relative flex-1 overflow-hidden max-h-[40vh] md:max-h-none md:border-l border-white/5"
          style={{
            maskImage:
              "linear-gradient(to bottom, transparent 0%, #000 12%, #000 88%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, #000 12%, #000 88%, transparent 100%)",
          }}
        >
          {displayPosters.length > 0 ? (
            <div className="absolute inset-0">
              <div ref={scrollRef} className="will-change-transform">
                <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-6 lg:grid-cols-3 xl:grid-cols-4">
                  {displayPosters.map((poster) => (
                    <VisualPosterCard key={poster.id} poster={poster} />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-6 lg:grid-cols-3 xl:grid-cols-4">
                  {displayPosters.map((poster) => (
                    <VisualPosterCard key={`dup-${poster.id}`} poster={poster} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="rounded-xl bg-white/[0.06] p-6 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-[#FF6B6B]/5">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#FF6B6B"
                    strokeWidth="2"
                    strokeLinecap="square"
                  >
                    <path d="M3 3 H9 M3 3 V9" />
                    <path d="M21 21 H15 M21 21 V15" />
                  </svg>
                </div>
                <p className="mt-3 text-xs text-white/30">Loading gallery…</p>
              </div>
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}

function VisualPosterCard({ poster }: { poster: Poster }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg"
      style={{ aspectRatio: "2 / 3", backgroundColor: "#1E1E1E" }}
    >
      {!loaded && <div className="absolute inset-0 animate-pulse bg-white/5" />}
      <PosterImage
        poster={poster}
        purpose="gallery"
        alt=""
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={`h-full w-full object-cover transition-opacity duration-200 ease-[var(--ease-out)] ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

function FrameIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FF6B6B"
      strokeWidth="2"
      strokeLinecap="square"
    >
      <path d="M3 3 H9 M3 3 V9" />
      <path d="M21 21 H15 M21 21 V15" />
    </svg>
  );
}
