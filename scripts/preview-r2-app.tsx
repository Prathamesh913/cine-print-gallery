/* eslint-disable react-refresh/only-export-components -- local preview harness, not a Vite HMR module */
import { useEffect, useState } from "react";
import { R2_IMAGE_MAP } from "../src/lib/r2-image-map.generated";
import { createPosterImageResolver } from "../src/lib/poster-images";
import { PosterImageFrame } from "../src/components/PosterImageFrame";
import type { Poster } from "../src/lib/posters";

export interface PreviewEntry {
  id: string;
  canary: boolean;
}

export interface PreviewData {
  entries: PreviewEntry[];
}

export const PREVIEW_RESOLVER_OPTIONS = {
  browserEnabled: true,
  seoEnabled: false,
  downloadsEnabled: false,
} as const;

export function createPreviewResolver() {
  return createPosterImageResolver(R2_IMAGE_MAP, PREVIEW_RESOLVER_OPTIONS);
}

export function posterFor(id: string, image?: string): Poster {
  const entry = R2_IMAGE_MAP[id];
  return {
    id,
    title: id,
    year: 0,
    artist: "",
    source: "",
    sourceUrl: "",
    image: image ?? entry?.blobImageUrl ?? "",
    style: "Minimalist",
    genre: [],
    tags: [],
  };
}

export function R2PreviewApp({ entries }: { entries: PreviewEntry[] }) {
  const resolver = createPreviewResolver();
  return (
    <main className="grid" data-preview-root>
      {entries.map((entry) => (
        <figure
          key={entry.id}
          className="card"
          data-preview-id={entry.id}
          data-canary={entry.canary ? "true" : "false"}
        >
          <PosterImageFrame
            poster={posterFor(entry.id)}
            resolver={resolver}
            alt={`${entry.id} poster`}
            className="poster-frame"
            loadTimeoutMs={20_000}
          />
          <figcaption>
            {entry.id}
            {entry.canary ? " · canary" : ""}
          </figcaption>
        </figure>
      ))}
    </main>
  );
}

interface FailureScenario {
  id: string;
  label: string;
  image: string;
  loadTimeoutMs: number;
}

const FAILURE_SCENARIOS: FailureScenario[] = [
  {
    id: "missing-mapping",
    label: "missing mapping",
    image: "/fail/404",
    loadTimeoutMs: 5_000,
  },
  {
    id: "invalid-url",
    label: "invalid URL",
    image: "data:image/png;base64,%%%%",
    loadTimeoutMs: 5_000,
  },
  { id: "http-404", label: "HTTP 404", image: "/fail/404", loadTimeoutMs: 5_000 },
  { id: "http-403", label: "HTTP 403", image: "/fail/403", loadTimeoutMs: 5_000 },
  { id: "http-500", label: "HTTP 500", image: "/fail/500", loadTimeoutMs: 5_000 },
  { id: "timeout", label: "network timeout", image: "/fail/timeout", loadTimeoutMs: 1_200 },
  {
    id: "invalid-bytes",
    label: "invalid image bytes",
    image: "/fail/invalid-bytes",
    loadTimeoutMs: 5_000,
  },
  {
    id: "decode-failure",
    label: "decode failure",
    image: "/fail/decode",
    loadTimeoutMs: 5_000,
  },
];

export function FailureApp() {
  const resolver = createPreviewResolver();
  return (
    <main className="grid" data-failure-root>
      {FAILURE_SCENARIOS.map((scenario) => (
        <figure
          key={scenario.id}
          className="card"
          data-failure-id={scenario.id}
          data-expected="error"
        >
          <PosterImageFrame
            poster={posterFor(`phase12c-${scenario.id}`, scenario.image)}
            resolver={resolver}
            alt={`${scenario.label} fixture`}
            fallbackLabel={`Image unavailable: ${scenario.label}`}
            className="poster-frame"
            loadTimeoutMs={scenario.loadTimeoutMs}
          />
          <figcaption>{scenario.label}</figcaption>
        </figure>
      ))}
    </main>
  );
}

export function UnmountApp() {
  const [mounted, setMounted] = useState(true);
  const resolver = createPreviewResolver();

  useEffect(() => {
    const timer = setTimeout(() => setMounted(false), 150);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) {
    return <p data-unmounted="true">unmounted while image was loading</p>;
  }

  return (
    <main data-unmount-root>
      <PosterImageFrame
        poster={posterFor("phase12c-unmount", "/fail/timeout")}
        resolver={resolver}
        alt="unmount fixture"
        className="poster-frame"
        loadTimeoutMs={5_000}
      />
    </main>
  );
}
