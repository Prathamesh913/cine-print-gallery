import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Film, WifiOff, RotateCw, Home } from "lucide-react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#121212] text-[#F5F5F5] px-4">
      <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-md">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#FF6B6B]/15 text-[#FF6B6B] mb-6 animate-bounce">
          <Film size={32} strokeWidth={1.5} />
        </div>
        <h1 
          style={{ fontFamily: "Bebas Neue, sans-serif" }} 
          className="text-6xl tracking-widest text-[#FF6B6B]"
        >
          404 ERROR
        </h1>
        <h2 
          style={{ fontFamily: "Poppins, sans-serif" }} 
          className="mt-3 text-xl font-bold text-[#F5F5F5]"
        >
          Scene Cut: Page Not Found!
        </h2>
        <p className="mt-4 text-sm text-white/50 leading-relaxed">
          We searched the projection room but couldn't find the reel you wanted. 
          It might have been deleted, or left on the cutting room floor.
        </p>
        <div className="mt-8 flex justify-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full bg-[#FF6B6B] px-6 py-2.5 text-xs font-semibold text-[#121212] transition hover:bg-[#FF8585] shadow-lg shadow-[#FF6B6B]/25"
          >
            <Home size={14} />
            BACK TO LOBBY
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#121212] text-[#F5F5F5] px-4">
      <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-md">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#FF6B6B]/15 text-[#FF6B6B] mb-6 animate-pulse">
          <WifiOff size={32} strokeWidth={1.5} />
        </div>
        <h1 
          style={{ fontFamily: "Bebas Neue, sans-serif" }} 
          className="text-5xl tracking-widest text-[#FF6B6B]"
        >
          LOST SIGNAL
        </h1>
        <h2 
          style={{ fontFamily: "Poppins, sans-serif" }} 
          className="mt-3 text-xl font-bold text-[#F5F5F5]"
        >
          Projector Error: Off The Grid
        </h2>
        <p className="mt-4 text-sm text-white/50 leading-relaxed">
          Connection to the Notion database failed or the network went offline. 
          Please check your internet connection, or retry the stream.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center gap-2 rounded-full bg-[#FF6B6B] px-6 py-2.5 text-xs font-semibold text-[#121212] transition hover:bg-[#FF8585] shadow-lg shadow-[#FF6B6B]/25"
          >
            <RotateCw size={14} />
            RELOAD STREAM
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-6 py-2.5 text-xs font-semibold text-[#F5F5F5] transition hover:bg-white/10"
          >
            <Home size={14} />
            BACK TO LOBBY
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CinePrint — Curated Alternative Movie & TV Posters Gallery" },
      { name: "description", content: "Explore CinePrint, a curated digital archive of custom alternative movie posters, minimalist film art, and television key designs created by talented designers globally." },
      { property: "og:title", content: "CinePrint — Alternative Movie & TV Posters Gallery" },
      { property: "og:description", content: "Explore a curated digital archive of custom alternative movie posters and minimalist film art designs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23FF6B6B' stroke-width='2' stroke-linecap='square'%3E%3Cpath d='M3 3h6M3 3v6M21 21h-6M21 21v-6'/%3E%3C/svg%3E",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Poppins:wght@500;600;700&family=Inter:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster />
      <Analytics
        scriptSrc="/api/insights/script.js"
        viewEndpoint="/api/insights/view"
        eventEndpoint="/api/insights/event"
      />
    </QueryClientProvider>
  );
}
