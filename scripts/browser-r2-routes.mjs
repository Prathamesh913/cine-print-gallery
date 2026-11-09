import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.ROUTES_BASE_URL || "http://127.0.0.1:4317";
const ARTIFACT_DIR = "/tmp/opencode/phase13";
const SHOT_DIR = path.join(ARTIFACT_DIR, "screenshots");
const RESULT_PATH = "/tmp/opencode/phase13-routes-browser.json";
const CHROMIUM = process.env.CHROMIUM_BIN || "chromium";
const R2_MAP = JSON.parse(
  fs.readFileSync(path.join(ROOT, "migration", "r2-image-map.json"), "utf8"),
);
const R2_IDS = new Set(Object.keys(R2_MAP.entries));
const UNAVAILABLE_IDS = new Set(["stranger-things-2", "the-substance-2"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(`${message.error.message}: ${JSON.stringify(message.error.data ?? "")}`),
          );
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      const handlers = this.handlers.get(message.method);
      if (handlers) for (const handler of handlers) handler(message.params);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }
  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await Promise.race([
    cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Runtime.evaluate timed out")), 45_000),
    ),
  ]);
  if (result.exceptionDetails) {
    throw new Error(
      `${result.exceptionDetails.text ?? "evaluation failed"}: ${
        result.exceptionDetails.exception?.description ?? ""
      }`,
    );
  }
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await evaluate(cdp, expression);
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ""}`);
}

const COLLECTOR = `
(() => {
  window.__PERF__ = { lcp: 0, cls: 0, shifts: [], errors: [], rejections: [] };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__PERF__.lcp = Math.max(window.__PERF__.lcp, entry.startTime);
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__PERF__.cls += entry.value;
          window.__PERF__.shifts.push({
            value: entry.value,
            sources: (entry.sources || []).slice(0, 3).map((source) => ({
              node: source.node ? source.node.nodeName : null,
              previousRect: source.previousRect,
              currentRect: source.currentRect,
            })),
          });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  window.addEventListener("error", (event) => {
    window.__PERF__.errors.push(String(event.message || event.error || "error"));
  });
  window.addEventListener("unhandledrejection", (event) => {
    window.__PERF__.rejections.push(String(event.reason));
  });
})();
`;

async function setViewport(cdp, width, height, dpr, mobile) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: dpr,
    mobile,
  });
}

async function capture(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const filePath = path.join(SHOT_DIR, name);
  fs.writeFileSync(filePath, Buffer.from(data, "base64"));
  return filePath;
}

async function scrollThrough(cdp) {
  await evaluate(
    cdp,
    `(async () => {
      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y <= document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return true;
    })()`,
    true,
  );
}

async function settleImages(cdp, timeoutMs = 12_000) {
  await evaluate(
    cdp,
    `Promise.race([
      Promise.all([...document.images].map((img) => {
        if (img.complete) return true;
        return new Promise((resolve) => {
          img.addEventListener('load', () => resolve(true), { once: true });
          img.addEventListener('error', () => resolve(true), { once: true });
        });
      })),
      new Promise((resolve) => setTimeout(() => resolve(false), ${timeoutMs}))
    ])`,
    true,
  );
  await sleep(400);
}

async function collectImages(cdp) {
  const total = await evaluate(cdp, "document.images.length");
  console.error("[collect] total", total);
  const stats = await evaluate(
    cdp,
    `(() => {
      const hostOf = (url) => { try { return new URL(url).hostname; } catch { return null; } };
      const imgs = [...document.images];
      const r2 = imgs.filter((img) => hostOf(img.currentSrc || img.src) === 'images.cineprint.click');
      const blob = imgs.filter((img) => hostOf(img.currentSrc || img.src)?.endsWith('public.blob.vercel-storage.com'));
      const srcOf = (img) => img.currentSrc || img.src;
      return {
        r2Count: r2.length,
        optimizedCount: r2.filter((img) => srcOf(img).includes('/versions/optimized/') || srcOf(img).includes('/cineprint/optimized/')).length,
        originalCount: r2.filter((img) => srcOf(img).includes('/versions/original/')).length,
        blobCount: blob.length,
        brokenCount: imgs.filter((img) => img.complete && img.naturalWidth === 0).length,
        r2BrokenCount: r2.filter((img) => img.complete && img.naturalWidth === 0).length,
        blobBrokenCount: blob.filter((img) => img.complete && img.naturalWidth === 0).length,
      };
    })()`,
  );
  console.error("[collect] stats", stats);
  const sampleExpression = (hostFilter) => `(() => {
    const hostOf = (url) => { try { return new URL(url).hostname; } catch { return null; } };
    return [...document.images]
      .filter((img) => ${hostFilter})
      .slice(0, 10)
      .map((img) => {
        const rect = img.getBoundingClientRect();
        const link = img.closest('a[href^="/poster/"]');
        return {
          src: img.currentSrc || img.src,
          posterId: link ? link.getAttribute('href').replace('/poster/', '') : null,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          cssWidth: Number(rect.width.toFixed(2)),
          cssHeight: Number(rect.height.toFixed(2)),
          status: img.getAttribute('data-image-status'),
          broken: img.complete && img.naturalWidth === 0,
        };
      });
  })()`;
  const r2Samples = await evaluate(
    cdp,
    sampleExpression("hostOf(img.currentSrc || img.src) === 'images.cineprint.click'"),
  );
  console.error("[collect] r2Samples", r2Samples.length);
  const blobSamples = await evaluate(
    cdp,
    sampleExpression(
      "hostOf(img.currentSrc || img.src)?.endsWith('public.blob.vercel-storage.com')",
    ),
  );
  console.error("[collect] blobSamples", blobSamples.length);
  const r2Broken = await evaluate(
    cdp,
    `(() => {
      const hostOf = (url) => { try { return new URL(url).hostname; } catch { return null; } };
      return [...document.images]
        .filter((img) => hostOf(img.currentSrc || img.src) === 'images.cineprint.click' && img.complete && img.naturalWidth === 0)
        .slice(0, 20)
        .map((img) => ({ src: img.currentSrc || img.src, alt: img.alt || '' }));
    })()`,
  );
  const blobBroken = await evaluate(
    cdp,
    `(() => {
      const hostOf = (url) => { try { return new URL(url).hostname; } catch { return null; } };
      return [...document.images]
        .filter((img) => hostOf(img.currentSrc || img.src)?.endsWith('public.blob.vercel-storage.com') && img.complete && img.naturalWidth === 0)
        .slice(0, 20)
        .map((img) => ({ src: img.currentSrc || img.src, alt: img.alt || '' }));
    })()`,
  );
  console.error("[collect] broken", r2Broken.length, blobBroken.length);
  const posterLinks = await evaluate(
    cdp,
    `[...new Set([...document.querySelectorAll('a[href^="/poster/"]')].map((a) => a.getAttribute('href')))]`,
  );
  const unavailable = await evaluate(
    cdp,
    `(() => {
      const nodes = [...document.querySelectorAll('[data-poster-unavailable-id]')];
      return {
        count: nodes.length,
        ids: [...new Set(nodes.map((node) => node.getAttribute('data-poster-unavailable-id')))],
        samples: nodes.slice(0, 10).map((node) => ({
          id: node.getAttribute('data-poster-unavailable-id'),
          alt: node.getAttribute('alt'),
          src: node.currentSrc || node.src,
          naturalWidth: node.naturalWidth,
          naturalHeight: node.naturalHeight,
          status: node.getAttribute('data-image-status'),
        })),
      };
    })()`,
  );
  console.error("[collect] posterLinks", posterLinks.length);
  const perf = JSON.parse(await evaluate(cdp, `JSON.stringify(window.__PERF__ ?? null)`));
  console.error("[collect] perf");
  const path = await evaluate(cdp, `location.pathname`);
  console.error("[collect] path", path);
  const title = await evaluate(cdp, `document.title`);
  const closeButton = await evaluate(
    cdp,
    `Boolean(document.querySelector('button[aria-label="Close"]'))`,
  );
  return {
    url: await evaluate(cdp, `location.href`),
    path,
    title,
    total,
    ...stats,
    r2Broken,
    blobBroken,
    r2Samples,
    blobSamples,
    perf,
    closeButton,
    posterLinks,
    unavailableCount: unavailable.count,
    unavailableIds: unavailable.ids,
    unavailableSamples: unavailable.samples,
  };
}
async function decodeR2(cdp) {
  const raw = await evaluate(
    cdp,
    `(async () => {
      const hostOf = (url) => { try { return new URL(url).hostname; } catch { return null; } };
      const imgs = [...document.images].filter((img) => hostOf(img.currentSrc || img.src) === 'images.cineprint.click');
      const complete = imgs.filter((img) => img.complete && img.naturalWidth > 0);
      const pending = imgs.length - complete.length;
      const results = await Promise.race([
        Promise.all(complete.map((img) => img.decode().then(() => true).catch(() => false))),
        new Promise((resolve) => setTimeout(() => resolve(null), 10_000)),
      ]);
      return JSON.stringify({ total: imgs.length, complete: complete.length, pending, results });
    })()`,
    true,
  );
  return JSON.parse(raw);
}
function summarizeNetwork(events) {
  const requests = events.filter((event) => event.kind === "request");
  const responses = new Map(
    events.filter((event) => event.kind === "response").map((event) => [event.requestId, event]),
  );
  const failures = new Map(
    events.filter((event) => event.kind === "failed").map((event) => [event.requestId, event]),
  );
  const rows = requests
    .filter(
      (request) =>
        request.type === "Image" || /\.(webp|png|jpe?g|gif|svg)(\?|$)/i.test(request.url),
    )
    .map((request) => {
      const response = responses.get(request.requestId);
      const failure = failures.get(request.requestId);
      return {
        url: request.url,
        status: response?.status ?? null,
        mimeType: response?.mimeType ?? null,
        failed: Boolean(failure),
        errorText: failure?.errorText ?? null,
      };
    });
  const hostOf = (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  };
  const allHosts = [
    ...new Set(requests.map((request) => hostOf(request.url)).filter(Boolean)),
  ].sort();
  const nonImageHosts = [
    ...new Set(
      requests
        .filter((request) => request.type !== "Image")
        .map((request) => hostOf(request.url))
        .filter(Boolean),
    ),
  ].sort();
  return {
    allHosts,
    nonImageHosts,
    imageRequests: rows.length,
    uniqueImageUrls: new Set(rows.map((row) => row.url)).size,
    r2Requests: rows.filter((row) => hostOf(row.url) === "images.cineprint.click").length,
    blobRequests: rows.filter((row) => hostOf(row.url)?.endsWith("public.blob.vercel-storage.com"))
      .length,
    otherHosts: [
      ...new Set(
        rows
          .map((row) => hostOf(row.url))
          .filter(
            (host) =>
              host &&
              host !== "images.cineprint.click" &&
              !host.endsWith("public.blob.vercel-storage.com"),
          ),
      ),
    ],
    failed: rows.filter((row) => row.failed || (row.status !== null && row.status >= 400)),
    rows,
  };
}

function consoleSummary(consoleEvents, exceptions) {
  return {
    consoleErrors: consoleEvents.filter((entry) => entry.type === "error"),
    consoleWarnings: consoleEvents.filter((entry) => entry.type === "warning"),
    exceptions,
  };
}

function addCheck(checks, name, ok, detail) {
  checks.push({ name, status: ok ? "PASS" : "FAIL", detail });
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  console.error("[routes] starting");
  const chromeVersion = execFileSync(CHROMIUM, ["--version"], { encoding: "utf8" }).trim();
  const debugPort = await getFreePort();
  const userDataDir = fs.mkdtempSync("/tmp/opencode/phase13-chrome-");
  const chrome = spawn(
    CHROMIUM,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let chromeStderr = "";
  chrome.stderr.on("data", (chunk) => {
    chromeStderr += String(chunk);
  });

  console.error("[routes] chrome launched", chromeVersion);
  const checks = [];
  const result = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    browser: { executable: CHROMIUM, version: chromeVersion, headless: true },
    routes: {},
    checks,
  };

  let cdp = null;
  let networkEvents = [];
  let consoleEvents = [];
  let exceptions = [];

  try {
    let version = null;
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        if (response.ok) {
          version = await response.json();
          break;
        }
      } catch {}
      await sleep(250);
    }
    if (!version) throw new Error("Chromium DevTools endpoint did not become ready");
    console.error("[routes] devtools ready");

    const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
      method: "PUT",
    });
    const target = await created.json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: COLLECTOR });
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });

    cdp.on("Network.requestWillBeSent", (event) => {
      networkEvents.push({
        kind: "request",
        requestId: event.requestId,
        url: event.request.url,
        type: event.type,
      });
    });
    cdp.on("Network.responseReceived", (event) => {
      networkEvents.push({
        kind: "response",
        requestId: event.requestId,
        status: event.response.status,
        mimeType: event.response.mimeType,
      });
    });
    cdp.on("Network.loadingFailed", (event) => {
      networkEvents.push({
        kind: "failed",
        requestId: event.requestId,
        errorText: event.errorText,
      });
    });
    cdp.on("Runtime.consoleAPICalled", (event) => {
      if (event.type === "error" || event.type === "warning") {
        consoleEvents.push({
          type: event.type,
          text: event.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") ?? "",
        });
      }
    });
    cdp.on("Runtime.exceptionThrown", (event) => {
      exceptions.push(event.exceptionDetails?.text ?? "exception");
    });

    const viewports = [
      { name: "desktop", width: 1440, height: 900, dpr: 1, mobile: false },
      { name: "mobile", width: 375, height: 812, dpr: 3, mobile: true },
    ];

    for (const viewport of viewports) {
      console.error("[routes] viewport", viewport.name);
      networkEvents = [];
      consoleEvents = [];
      exceptions = [];
      await setViewport(cdp, viewport.width, viewport.height, viewport.dpr, viewport.mobile);

      // Home / catalogue
      console.error("[routes] home navigate");
      await cdp.send("Page.navigate", { url: `${BASE_URL}/` });
      await waitFor(
        cdp,
        `document.readyState === "complete"`,
        30_000,
        `${viewport.name} home load`,
      );
      await waitFor(
        cdp,
        `document.querySelectorAll('a[href^="/poster/"]').length > 0`,
        30_000,
        `${viewport.name} home posters`,
      );
      console.error("[routes] home scroll");
      await scrollThrough(cdp);
      console.error("[routes] home settle");
      await settleImages(cdp);
      console.error("[routes] home collect");
      const home = await collectImages(cdp);
      const homeDecoded = await decodeR2(cdp);
      const homeShot = await capture(cdp, `routes-home-${viewport.name}.png`);
      let homeUnavailableShot = null;
      if (home.unavailableCount > 0) {
        await evaluate(
          cdp,
          `(() => {
            const node = document.querySelector('a[href^="/poster/"] [data-poster-unavailable-id]') || document.querySelector('[data-poster-unavailable-id]');
            if (node) node.scrollIntoView({ block: 'center' });
            return true;
          })()`,
        );
        await sleep(400);
        homeUnavailableShot = await capture(cdp, `routes-home-unavailable-${viewport.name}.png`);
        await evaluate(cdp, `window.scrollTo(0, 0); true`);
      }
      console.error("[routes] home done", home.total, home.r2Count, home.blobCount);
      const homeNetwork = summarizeNetwork(networkEvents);
      result.routes[`home-${viewport.name}`] = {
        viewport,
        page: home,
        decodedR2: homeDecoded.results?.filter(Boolean).length ?? 0,
        decodeFailures: homeDecoded.results?.filter((value) => !value).length ?? 0,
        decodePending: homeDecoded.pending,
        network: homeNetwork,
        console: { consoleEvents: [...consoleEvents], exceptions: [...exceptions] },
        screenshot: homeShot,
        unavailableScreenshot: homeUnavailableShot,
      };

      addCheck(
        checks,
        `${viewport.name} home: poster links rendered`,
        home.posterLinks.length > 0,
        {
          posterLinks: home.posterLinks.length,
        },
      );
      addCheck(checks, `${viewport.name} home: R2 images rendered`, home.r2Count > 0, {
        r2: home.r2Count,
        blob: home.blobCount,
        total: home.total,
      });
      addCheck(
        checks,
        `${viewport.name} home: R2 images decoded`,
        Boolean(homeDecoded.results) && homeDecoded.results.every(Boolean),
        {
          total: homeDecoded.total,
          complete: homeDecoded.complete,
          pending: homeDecoded.pending,
          decoded: homeDecoded.results?.filter(Boolean).length ?? 0,
          failed: homeDecoded.results?.filter((value) => !value).length ?? 0,
        },
      );
      addCheck(
        checks,
        `${viewport.name} home: no full-size originals for thumbnails`,
        home.originalCount === 0,
        { originalCount: home.originalCount, optimizedCount: home.optimizedCount },
      );
      addCheck(checks, `${viewport.name} home: no broken R2 images`, home.r2Broken.length === 0, {
        broken: home.r2Broken,
      });
      addCheck(
        checks,
        `${viewport.name} home: no console errors`,
        consoleEvents.filter((event) => event.type === "error").length === 0 &&
          exceptions.length === 0 &&
          home.perf?.errors?.length === 0 &&
          home.perf?.rejections?.length === 0,
        {
          consoleErrors: consoleEvents.filter((event) => event.type === "error"),
          exceptions,
          pageErrors: home.perf?.errors,
          rejections: home.perf?.rejections,
        },
      );

      console.error("[routes] detail target");
      // Detail / lightbox via a real poster link whose image is on R2.
      const targetHref = await evaluate(
        cdp,
        `(() => {
          const link = [...document.querySelectorAll('a[href^="/poster/"]')].find((a) => {
            const img = a.querySelector('img');
            return img && (img.currentSrc || img.src).startsWith('https://images.cineprint.click/');
          });
          if (!link) return null;
          const img = link.querySelector('img');
          return { href: link.getAttribute('href'), src: img.currentSrc || img.src };
        })()`,
      );
      if (!targetHref) throw new Error(`${viewport.name}: no R2 poster link found on home`);

      await evaluate(
        cdp,
        `(() => {
          const link = [...document.querySelectorAll('a[href^="/poster/"]')].find((a) => a.getAttribute('href') === ${JSON.stringify(targetHref.href)});
          link.click();
          return true;
        })()`,
      );
      await waitFor(
        cdp,
        `location.pathname.startsWith('/poster/')`,
        30_000,
        `${viewport.name} detail navigation`,
      );
      console.error("[routes] detail wait lightbox");
      await waitFor(
        cdp,
        `Boolean(document.querySelector('button[aria-label="Close"]'))`,
        30_000,
        `${viewport.name} lightbox`,
      );
      console.error("[routes] detail settle");
      await settleImages(cdp);
      const detail = await collectImages(cdp);
      const detailDecoded = await decodeR2(cdp);
      const detailShot = await capture(cdp, `routes-detail-${viewport.name}.png`);
      console.error("[routes] detail done", detail.total, detail.r2Count);

      // Zoom switches the lightbox to the original R2 asset.
      const beforeZoom = await evaluate(
        cdp,
        `(() => {
          const overlay = document.querySelector('button[aria-label="Close"]')?.parentElement;
          const img = overlay?.querySelector('img');
          return img ? img.currentSrc || img.src : null;
        })()`,
      );
      await evaluate(
        cdp,
        `(() => {
          const overlay = document.querySelector('button[aria-label="Close"]')?.parentElement;
          const img = overlay?.querySelector('img');
          if (img) img.click();
          return true;
        })()`,
      );
      await sleep(800);
      const afterZoom = await evaluate(
        cdp,
        `(() => {
          const overlay = document.querySelector('button[aria-label="Close"]')?.parentElement;
          const img = overlay?.querySelector('img');
          return img ? img.currentSrc || img.src : null;
        })()`,
      );
      const zoomShot = await capture(cdp, `routes-detail-zoom-${viewport.name}.png`);
      const detailNetwork = summarizeNetwork(networkEvents);

      result.routes[`detail-${viewport.name}`] = {
        viewport,
        target: targetHref,
        page: detail,
        decodedR2: detailDecoded.results?.filter(Boolean).length ?? 0,
        decodeFailures: detailDecoded.results?.filter((value) => !value).length ?? 0,
        decodePending: detailDecoded.pending,
        zoom: { before: beforeZoom, after: afterZoom },
        network: detailNetwork,
        console: { consoleEvents: [...consoleEvents], exceptions: [...exceptions] },
        screenshot: detailShot,
        zoomScreenshot: zoomShot,
      };

      addCheck(checks, `${viewport.name} detail: route rendered`, detail.path === targetHref.href, {
        path: detail.path,
        target: targetHref.href,
      });
      addCheck(checks, `${viewport.name} detail: lightbox present`, detail.closeButton, {
        closeButton: detail.closeButton,
      });
      addCheck(
        checks,
        `${viewport.name} detail: R2 images decoded`,
        detailDecoded.complete > 0 &&
          Boolean(detailDecoded.results) &&
          detailDecoded.results.every(Boolean),
        {
          total: detailDecoded.total,
          complete: detailDecoded.complete,
          pending: detailDecoded.pending,
          decoded: detailDecoded.results?.filter(Boolean).length ?? 0,
          failed: detailDecoded.results?.filter((value) => !value).length ?? 0,
        },
      );
      addCheck(
        checks,
        `${viewport.name} detail: no broken R2 images`,
        detail.r2Broken.length === 0,
        { broken: detail.r2Broken },
      );
      addCheck(
        checks,
        `${viewport.name} detail: zoom uses R2 original`,
        Boolean(afterZoom) &&
          afterZoom !== beforeZoom &&
          afterZoom.startsWith("https://images.cineprint.click/"),
        { before: beforeZoom, after: afterZoom },
      );
      addCheck(
        checks,
        `${viewport.name} detail: no console errors`,
        consoleEvents.filter((event) => event.type === "error").length === 0 &&
          exceptions.length === 0,
        {
          consoleErrors: consoleEvents.filter((event) => event.type === "error"),
          exceptions,
        },
      );

      console.error("[routes] back");
      // Browser back returns to the catalogue.
      await evaluate(cdp, `history.back(); true`);
      await waitFor(cdp, `location.pathname === "/"`, 30_000, `${viewport.name} back navigation`);
      const backShot = await capture(cdp, `routes-back-${viewport.name}.png`);
      result.routes[`back-${viewport.name}`] = {
        viewport,
        path: await evaluate(cdp, `location.pathname`),
        screenshot: backShot,
      };
      addCheck(checks, `${viewport.name} back navigation returns home`, true, {
        path: "/",
      });

      // Intentional unavailable detail routes for both unresolved identities.
      for (const unavailableId of ["the-substance-2", "stranger-things-2"]) {
        networkEvents = [];
        consoleEvents = [];
        exceptions = [];
        await cdp.send("Page.navigate", { url: `${BASE_URL}/poster/${unavailableId}` });
        await waitFor(
          cdp,
          `document.readyState === "complete"`,
          30_000,
          `${viewport.name} ${unavailableId} detail load`,
        );
        await waitFor(
          cdp,
          `Boolean(document.querySelector('[data-poster-unavailable-id="${unavailableId}"]'))`,
          30_000,
          `${viewport.name} ${unavailableId} placeholder`,
        );
        await settleImages(cdp);
        const unavailableDetail = await collectImages(cdp);
        const unavailableDetailNetwork = summarizeNetwork(networkEvents);
        const unavailableDetailConsole = consoleSummary(consoleEvents, exceptions);
        const unavailableDetailShot = await capture(
          cdp,
          `routes-unavailable-detail-${unavailableId}-${viewport.name}.png`,
        );
        result.routes[`unavailable-detail-${unavailableId}-${viewport.name}`] = {
          viewport,
          page: unavailableDetail,
          network: unavailableDetailNetwork,
          console: unavailableDetailConsole,
          screenshot: unavailableDetailShot,
        };
        addCheck(
          checks,
          `${viewport.name} unavailable detail (${unavailableId}): intentional placeholder`,
          unavailableDetail.path === `/poster/${unavailableId}` &&
            unavailableDetail.unavailableIds.includes(unavailableId) &&
            unavailableDetail.unavailableSamples.some(
              (sample) =>
                sample.alt?.includes("Image unavailable") &&
                sample.src.endsWith("/poster-unavailable.svg"),
            ),
          { path: unavailableDetail.path, unavailableIds: unavailableDetail.unavailableIds },
        );
        addCheck(
          checks,
          `${viewport.name} unavailable detail (${unavailableId}): zero Blob and broken images`,
          unavailableDetail.blobCount === 0 &&
            unavailableDetail.brokenCount === 0 &&
            unavailableDetailNetwork.blobRequests === 0,
          {
            blobImages: unavailableDetail.blobCount,
            blobRequests: unavailableDetailNetwork.blobRequests,
            brokenCount: unavailableDetail.brokenCount,
          },
        );
        addCheck(
          checks,
          `${viewport.name} unavailable detail (${unavailableId}): no console errors`,
          unavailableDetailConsole.consoleErrors.length === 0 &&
            unavailableDetailConsole.exceptions.length === 0,
          {
            consoleErrors: unavailableDetailConsole.consoleErrors,
            exceptions: unavailableDetailConsole.exceptions,
          },
        );
      }

      console.error("[routes] category");
      // Category view.
      await cdp.send("Page.navigate", { url: `${BASE_URL}/genres` });
      await waitFor(
        cdp,
        `document.readyState === "complete"`,
        30_000,
        `${viewport.name} genres load`,
      );
      await scrollThrough(cdp);
      await settleImages(cdp);
      const category = await collectImages(cdp);
      const categoryDecoded = await decodeR2(cdp);
      const categoryShot = await capture(cdp, `routes-category-${viewport.name}.png`);
      result.routes[`category-${viewport.name}`] = {
        viewport,
        page: category,
        decodedR2: categoryDecoded.results?.filter(Boolean).length ?? 0,
        decodeFailures: categoryDecoded.results?.filter((value) => !value).length ?? 0,
        decodePending: categoryDecoded.pending,
        screenshot: categoryShot,
      };
      addCheck(checks, `${viewport.name} category: route rendered`, category.path === "/genres", {
        path: category.path,
        title: category.title,
      });
      console.error("[routes] category done", category.total, category.r2Count);
      addCheck(
        checks,
        `${viewport.name} category: R2 images decoded`,
        categoryDecoded.complete > 0 &&
          Boolean(categoryDecoded.results) &&
          categoryDecoded.results.every(Boolean),
        {
          total: categoryDecoded.total,
          complete: categoryDecoded.complete,
          pending: categoryDecoded.pending,
          decoded: categoryDecoded.results?.filter(Boolean).length ?? 0,
          failed: categoryDecoded.results?.filter((value) => !value).length ?? 0,
        },
      );
    }
  } catch (error) {
    addCheck(checks, "route harness completed", false, {
      error: error instanceof Error ? error.message : String(error),
      chromeStderr: chromeStderr.slice(-2_000),
    });
  } finally {
    cdp?.close();
    try {
      chrome.kill("SIGTERM");
    } catch {}
    fs.writeFileSync(
      RESULT_PATH,
      `${JSON.stringify(
        {
          ...result,
          summary: {
            checks: checks.length,
            passed: checks.filter((check) => check.status === "PASS").length,
            failed: checks.filter((check) => check.status === "FAIL").length,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const failed = checks.filter((check) => check.status === "FAIL");
  console.log(
    JSON.stringify(
      {
        checks: checks.length,
        passed: checks.length - failed.length,
        failed: failed.length,
        failures: failed,
        result: RESULT_PATH,
        screenshots: SHOT_DIR,
      },
      null,
      2,
    ),
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
