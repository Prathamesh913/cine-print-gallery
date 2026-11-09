import { createRoot } from "react-dom/client";
import { FailureApp, R2PreviewApp, UnmountApp, type PreviewData } from "./preview-r2-app";

declare global {
  interface Window {
    __PREVIEW_PAGE__?: "preview" | "failures" | "unmount";
    __R2_PREVIEW_DATA__?: PreviewData;
    __R2_PREVIEW__?: unknown;
    __FAILURES__?: unknown;
    __UNMOUNT__?: unknown;
    __PERF__?: {
      lcp: number;
      cls: number;
      errors: string[];
      rejections: string[];
    };
  }
}

interface FrameResult {
  id: string;
  status: string | null;
  src: string | null;
  complete: boolean | null;
  naturalWidth: number;
  naturalHeight: number;
  fallback: boolean;
  fallbackLabel: string | null;
}

const page = window.__PREVIEW_PAGE__ ?? "preview";
const data = window.__R2_PREVIEW_DATA__ ?? { entries: [] };
const rootElement = document.getElementById("root");

if (rootElement) {
  const element =
    page === "failures" ? (
      <FailureApp />
    ) : page === "unmount" ? (
      <UnmountApp />
    ) : (
      <R2PreviewApp entries={data.entries} />
    );
  createRoot(rootElement).render(element);
}

function collectFrames(): FrameResult[] {
  const selector =
    page === "failures"
      ? "[data-failure-id] [data-image-frame-status]"
      : "[data-preview-id] [data-image-frame-status]";

  return [...document.querySelectorAll<HTMLElement>(selector)].map((frame) => {
    const container = frame.closest<HTMLElement>("[data-preview-id], [data-failure-id]");
    const img = frame.querySelector("img");
    const fallback = frame.querySelector<HTMLElement>('[role="img"]');
    return {
      id:
        container?.getAttribute("data-preview-id") ??
        container?.getAttribute("data-failure-id") ??
        "",
      status: frame.getAttribute("data-image-frame-status"),
      src: img ? img.currentSrc || img.src : null,
      complete: img ? img.complete : null,
      naturalWidth: img?.naturalWidth ?? 0,
      naturalHeight: img?.naturalHeight ?? 0,
      fallback: Boolean(fallback),
      fallbackLabel: fallback?.getAttribute("aria-label") ?? null,
    };
  });
}

function finishFrames() {
  const items = collectFrames();
  const report = {
    done: true,
    total: items.length,
    loaded: items.filter((item) => item.status === "loaded").length,
    error: items.filter((item) => item.status === "error").length,
    pending: items.filter((item) => item.status === "loading").length,
    items,
    perf: window.__PERF__ ?? null,
  };
  if (page === "failures") {
    window.__FAILURES__ = report;
  } else {
    window.__R2_PREVIEW__ = report;
  }
  document.body.setAttribute("data-preview-status", "done");
}

function watchFrames() {
  let finished = false;
  const maybeFinish = () => {
    if (finished) return;
    const items = collectFrames();
    if (items.length > 0 && items.every((item) => item.status !== "loading")) {
      finished = true;
      finishFrames();
    }
  };

  const observer = new MutationObserver(maybeFinish);
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-image-frame-status"],
  });

  const poll = setInterval(() => {
    if (finished) {
      clearInterval(poll);
      return;
    }
    maybeFinish();
  }, 250);

  setTimeout(() => {
    if (finished) return;
    finished = true;
    clearInterval(poll);
    finishFrames();
  }, 30_000);

  maybeFinish();
}

if (page === "unmount") {
  setTimeout(() => {
    const perf = window.__PERF__ ?? { lcp: 0, cls: 0, errors: [], rejections: [] };
    window.__UNMOUNT__ = {
      unmounted: Boolean(document.querySelector('[data-unmounted="true"]')),
      errors: perf.errors,
      rejections: perf.rejections,
      perf,
    };
  }, 2_500);
} else {
  watchFrames();
}
