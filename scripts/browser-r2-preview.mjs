import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_DIR = "/tmp/opencode/phase12c";
const SHOT_DIR = path.join(ARTIFACT_DIR, "screenshots");
const RESULT_PATH = "/tmp/opencode/phase12c-browser.json";
const BIN = path.join(ROOT, "node_modules", ".bin");
const CHROMIUM = process.env.CHROMIUM_BIN || "chromium";

const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812, deviceScaleFactor: 3, mobile: true },
  { name: "mobile-430", width: 430, height: 900, deviceScaleFactor: 3, mobile: true },
  { name: "tablet-768", width: 768, height: 1024, deviceScaleFactor: 2, mobile: false },
  { name: "desktop-1440", width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertCheck(checks, name, ok, detail) {
  checks.push({ name, status: ok ? "PASS" : "FAIL", detail });
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function startServer() {
  const sockets = new Set();
  const stalled = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/fail/404") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    if (url.pathname === "/fail/403") {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden");
      return;
    }
    if (url.pathname === "/fail/500") {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("server error");
      return;
    }
    if (url.pathname === "/fail/invalid-bytes") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("this is not an image");
      return;
    }
    if (url.pathname === "/fail/decode") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]),
      );
      return;
    }
    if (url.pathname === "/fail/timeout") {
      stalled.add(res);
      req.on("close", () => stalled.delete(res));
      return;
    }

    const relative = url.pathname === "/" ? "/preview.html" : url.pathname;
    const filePath = path.join(ARTIFACT_DIR, path.normalize(relative).replace(/^(\.\.[/\\])+/, ""));
    if (
      !filePath.startsWith(ARTIFACT_DIR) ||
      !fs.existsSync(filePath) ||
      fs.statSync(filePath).isDirectory()
    ) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": contentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return {
    server,
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return server.address().port;
    },
    async close() {
      for (const res of stalled) {
        try {
          res.destroy();
        } catch {}
      }
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch {}
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
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
      if (handlers) {
        for (const handler of handlers) handler(message.params);
      }
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
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
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
  window.__PERF__ = { lcp: 0, cls: 0, errors: [], rejections: [] };
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
        if (!entry.hadRecentInput) window.__PERF__.cls += entry.value;
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

function scrollThroughPage(cdp) {
  return evaluate(
    cdp,
    `(async () => {
      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y <= document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 120));
      return true;
    })()`,
    true,
  );
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
  });
}

async function captureScreenshot(cdp, filePath) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(filePath, Buffer.from(data, "base64"));
}

function summarizeNetwork(events) {
  const requests = events.filter((event) => event.kind === "request");
  const responses = new Map(
    events.filter((event) => event.kind === "response").map((event) => [event.requestId, event]),
  );
  const failures = new Map(
    events.filter((event) => event.kind === "failed").map((event) => [event.requestId, event]),
  );
  const finished = new Map(
    events.filter((event) => event.kind === "finished").map((event) => [event.requestId, event]),
  );

  const rows = requests
    .filter(
      (request) =>
        request.type === "Image" || /\.(webp|png|jpe?g|gif|svg)(\?|$)/i.test(request.url),
    )
    .map((request) => {
      const response = responses.get(request.requestId);
      const failure = failures.get(request.requestId);
      const done = finished.get(request.requestId);
      return {
        url: request.url,
        status: response?.status ?? null,
        mimeType: response?.mimeType ?? null,
        failed: Boolean(failure),
        errorText: failure?.errorText ?? null,
        encodedDataLength: done?.encodedDataLength ?? response?.encodedDataLength ?? null,
      };
    });

  const byUrl = new Map();
  for (const row of rows) {
    byUrl.set(row.url, (byUrl.get(row.url) ?? 0) + 1);
  }

  const hostOf = (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  };

  return {
    imageRequests: rows.length,
    uniqueImageUrls: byUrl.size,
    duplicateImageUrls: [...byUrl.entries()]
      .filter(([, count]) => count > 1)
      .map(([url, count]) => ({ url, count })),
    blobRequests: rows.filter((row) => hostOf(row.url)?.endsWith("public.blob.vercel-storage.com"))
      .length,
    r2Requests: rows.filter((row) => hostOf(row.url) === "images.cineprint.click").length,
    localRequests: rows.filter((row) => hostOf(row.url) === "127.0.0.1").length,
    otherHosts: [
      ...new Set(
        rows
          .map((row) => hostOf(row.url))
          .filter(
            (host) =>
              host &&
              host !== "images.cineprint.click" &&
              host !== "127.0.0.1" &&
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

async function loadPreview(cdp, baseUrl, viewport, waitExpression, label) {
  await setViewport(cdp, viewport);
  await cdp.send("Page.navigate", { url: `${baseUrl}/preview.html` });
  await waitFor(cdp, `document.readyState === "complete"`, 20_000, `${label} load`);
  await waitFor(
    cdp,
    `document.querySelectorAll('[data-preview-id]').length === 61`,
    20_000,
    `${label} 61 frames`,
  );
  await scrollThroughPage(cdp);
  await waitFor(cdp, waitExpression, 90_000, `${label} settle`);
  return evaluate(cdp, `window.__R2_PREVIEW__`);
}

async function measureViewport(cdp, viewport, screenshotPath) {
  const measurement = await evaluate(
    cdp,
    `(() => {
      const frames = [...document.querySelectorAll('[data-preview-id] [data-image-frame-status]')];
      const items = frames.map((frame) => {
        const container = frame.closest('[data-preview-id]');
        const img = frame.querySelector('img');
        const rect = frame.getBoundingClientRect();
        return {
          id: container?.getAttribute('data-preview-id') ?? '',
          status: frame.getAttribute('data-image-frame-status'),
          cssWidth: Number(rect.width.toFixed(2)),
          cssHeight: Number(rect.height.toFixed(2)),
          naturalWidth: img?.naturalWidth ?? 0,
          naturalHeight: img?.naturalHeight ?? 0,
          requiredPx: Math.ceil(rect.width * window.devicePixelRatio),
          src: img ? img.currentSrc || img.src : null,
        };
      });
      const widths = items.map((item) => item.cssWidth);
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio,
        count: items.length,
        minCssWidth: Math.min(...widths),
        maxCssWidth: Math.max(...widths),
        maxRequiredPx: Math.max(...items.map((item) => item.requiredPx)),
        loaded: items.filter((item) => item.status === 'loaded').length,
        error: items.filter((item) => item.status === 'error').length,
        first: items[0],
        items,
      };
    })()`,
  );
  await captureScreenshot(cdp, screenshotPath);
  return measurement;
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  execFileSync(path.join(BIN, "tsx"), ["scripts/preview-r2-runtime.tsx"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  execFileSync(
    path.join(BIN, "esbuild"),
    [
      "scripts/preview-r2-client.tsx",
      "--bundle",
      "--format=esm",
      "--platform=browser",
      `--outfile=${path.join(ARTIFACT_DIR, "preview-client.js")}`,
      "--alias:@=./src",
      "--jsx=automatic",
      '--define:process.env.NODE_ENV="production"',
      "--log-level=warning",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  const staticServer = startServer();
  const port = await staticServer.listen();
  const baseUrl = `http://127.0.0.1:${port}`;
  const chromeVersion = execFileSync(CHROMIUM, ["--version"], { encoding: "utf8" }).trim();
  const debugPort = await getFreePort();
  const userDataDir = fs.mkdtempSync("/tmp/opencode/phase12c-chrome-");
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

  const checks = [];
  const result = {
    generatedAt: new Date().toISOString(),
    browser: { executable: CHROMIUM, version: chromeVersion, headless: true },
    baseUrl,
    viewports: [],
    main: null,
    failures: null,
    unmount: null,
    checks,
  };

  let cdp = null;
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
    result.browser.webSocketDebuggerUrl = version.webSocketDebuggerUrl;

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

    let networkEvents = [];
    let consoleEvents = [];
    let exceptions = [];
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
        encodedDataLength: event.response.encodedDataLength,
      });
    });
    cdp.on("Network.loadingFinished", (event) => {
      networkEvents.push({
        kind: "finished",
        requestId: event.requestId,
        encodedDataLength: event.encodedDataLength,
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

    // Full 61-entry run at desktop, then responsive runs.
    for (const viewport of VIEWPORTS) {
      networkEvents = [];
      consoleEvents = [];
      exceptions = [];
      const report = await loadPreview(
        cdp,
        baseUrl,
        viewport,
        `Boolean(window.__R2_PREVIEW__?.done)`,
        viewport.name,
      );
      const measurement = await measureViewport(
        cdp,
        viewport,
        path.join(SHOT_DIR, `${viewport.name}.png`),
      );
      const decoded = await evaluate(
        cdp,
        `Promise.all(
          [...document.querySelectorAll('[data-preview-id] img')].map((img) =>
            img.decode().then(() => true).catch(() => false)
          )
        )`,
        true,
      );
      const perf = await evaluate(
        cdp,
        `(() => {
          const resources = performance.getEntriesByType('resource').filter((entry) =>
            entry.initiatorType === 'img' || /\\.(webp|png|jpe?g|gif|svg)(\\?|$)/i.test(entry.name)
          );
          return {
            lcp: window.__PERF__?.lcp ?? 0,
            cls: window.__PERF__?.cls ?? 0,
            errors: window.__PERF__?.errors ?? [],
            rejections: window.__PERF__?.rejections ?? [],
            resourceCount: resources.length,
            transferSize: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
            encodedBodySize: resources.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
            maxDuration: resources.reduce((max, entry) => Math.max(max, entry.duration || 0), 0),
          };
        })()`,
      );
      const network = summarizeNetwork(networkEvents);
      const consoleInfo = consoleSummary(consoleEvents, exceptions);
      const viewportResult = {
        viewport,
        report,
        measurement,
        decoded: decoded.filter(Boolean).length,
        decodeFailures: decoded.filter((value) => !value).length,
        perf,
        network,
        console: consoleInfo,
      };
      result.viewports.push(viewportResult);

      assertCheck(checks, `${viewport.name}: 61 frames`, measurement.count === 61, {
        count: measurement.count,
      });
      assertCheck(
        checks,
        `${viewport.name}: all loaded`,
        report.loaded === 61 && report.error === 0 && report.pending === 0,
        { loaded: report.loaded, error: report.error, pending: report.pending },
      );
      assertCheck(checks, `${viewport.name}: all decoded`, decoded.every(Boolean), {
        decoded: decoded.filter(Boolean).length,
        failed: decoded.filter((value) => !value).length,
      });
      assertCheck(
        checks,
        `${viewport.name}: natural dimensions`,
        measurement.items.every((item) => item.naturalWidth > 0 && item.naturalHeight > 0),
        { sample: measurement.first },
      );
      assertCheck(
        checks,
        `${viewport.name}: R2 sources only`,
        measurement.items.every((item) => item.src?.startsWith("https://images.cineprint.click/")),
        { first: measurement.first?.src },
      );
      assertCheck(checks, `${viewport.name}: no Blob requests`, network.blobRequests === 0, {
        blobRequests: network.blobRequests,
      });
      assertCheck(
        checks,
        `${viewport.name}: no duplicate image URLs`,
        network.duplicateImageUrls.length === 0,
        { duplicates: network.duplicateImageUrls },
      );
      assertCheck(
        checks,
        `${viewport.name}: no failed image requests`,
        network.failed.length === 0,
        { failed: network.failed },
      );
      assertCheck(
        checks,
        `${viewport.name}: no console errors or exceptions`,
        consoleInfo.consoleErrors.length === 0 &&
          exceptions.length === 0 &&
          perf.errors.length === 0 &&
          perf.rejections.length === 0,
        {
          consoleErrors: consoleInfo.consoleErrors,
          exceptions,
          pageErrors: perf.errors,
          rejections: perf.rejections,
        },
      );
      assertCheck(
        checks,
        `${viewport.name}: 800px assets sufficient for grid`,
        measurement.maxRequiredPx <= 800,
        { maxRequiredPx: measurement.maxRequiredPx, maxCssWidth: measurement.maxCssWidth },
      );
    }

    result.main = result.viewports.find((entry) => entry.viewport.name === "desktop-1440");

    // Failure fixtures.
    networkEvents = [];
    consoleEvents = [];
    exceptions = [];
    await setViewport(cdp, VIEWPORTS[3]);
    await cdp.send("Page.navigate", { url: `${baseUrl}/failures.html` });
    await waitFor(cdp, `document.readyState === "complete"`, 20_000, "failures load");
    await waitFor(cdp, `Boolean(window.__FAILURES__?.done)`, 30_000, "failure fixtures settle");
    const failureReport = await evaluate(cdp, `window.__FAILURES__`);
    const failurePerf = await evaluate(cdp, `window.__PERF__`);
    const failureNetwork = summarizeNetwork(networkEvents);
    const failureConsole = consoleSummary(consoleEvents, exceptions);
    await captureScreenshot(cdp, path.join(SHOT_DIR, "failures-dark.png"));
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    await sleep(150);
    await captureScreenshot(cdp, path.join(SHOT_DIR, "failures-light.png"));
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    result.failures = {
      report: failureReport,
      perf: failurePerf,
      network: failureNetwork,
      console: failureConsole,
      screenshots: {
        dark: path.join(SHOT_DIR, "failures-dark.png"),
        light: path.join(SHOT_DIR, "failures-light.png"),
      },
    };
    assertCheck(checks, "failure fixtures: 8 frames", failureReport.total === 8, {
      total: failureReport.total,
    });
    assertCheck(
      checks,
      "failure fixtures: every frame shows placeholder",
      failureReport.error === 8 &&
        failureReport.items.every((item) => item.status === "error" && item.fallback),
      { report: failureReport },
    );
    assertCheck(
      checks,
      "failure fixtures: accessible fallback labels",
      failureReport.items.every(
        (item) => typeof item.fallbackLabel === "string" && item.fallbackLabel.length > 0,
      ),
      { labels: failureReport.items.map((item) => item.fallbackLabel) },
    );
    assertCheck(checks, "failure fixtures: no Blob requests", failureNetwork.blobRequests === 0, {
      blobRequests: failureNetwork.blobRequests,
    });
    assertCheck(
      checks,
      "failure fixtures: bounded requests per fixture URL",
      failureNetwork.rows
        .filter((row) => row.url.includes("/fail/"))
        .every((row) => {
          const count = failureNetwork.rows.filter((candidate) => candidate.url === row.url).length;
          return count <= 1;
        }),
      { rows: failureNetwork.rows },
    );

    // Unmount while a request is pending.
    networkEvents = [];
    consoleEvents = [];
    exceptions = [];
    await cdp.send("Page.navigate", { url: `${baseUrl}/unmount.html` });
    await waitFor(cdp, `document.readyState === "complete"`, 20_000, "unmount load");
    await waitFor(cdp, `Boolean(window.__UNMOUNT__)`, 20_000, "unmount report");
    const unmountReport = await evaluate(cdp, `window.__UNMOUNT__`);
    const unmountConsole = consoleSummary(consoleEvents, exceptions);
    await captureScreenshot(cdp, path.join(SHOT_DIR, "unmount-desktop.png"));
    result.unmount = { report: unmountReport, console: unmountConsole };
    assertCheck(checks, "unmount fixture: component unmounted", unmountReport.unmounted === true, {
      unmounted: unmountReport.unmounted,
    });
    assertCheck(
      checks,
      "unmount fixture: no page errors or rejections",
      unmountReport.errors.length === 0 &&
        unmountReport.rejections.length === 0 &&
        unmountConsole.exceptions.length === 0,
      {
        errors: unmountReport.errors,
        rejections: unmountReport.rejections,
        exceptions: unmountConsole.exceptions,
      },
    );
  } catch (error) {
    assertCheck(checks, "harness completed", false, {
      error: error instanceof Error ? error.message : String(error),
      chromeStderr: chromeStderr.slice(-2_000),
    });
  } finally {
    cdp?.close();
    try {
      chrome.kill("SIGTERM");
    } catch {}
    await staticServer.close();
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
