// Page-load measurement with Playwright + Chrome DevTools Protocol.
//
//   NODE_PATH=<tools>/node_modules CHROME_PATH=<chrome.exe> PERF_ADMIN_PASSWORD=... \
//     node perf/measure-pages.cjs --base http://localhost:3187 --profile mobile --out <file.json> [--runs 3]
//
// Profiles (keep them identical between the before and the after run):
//   mobile  : 412x823 viewport, DPR 2.625, mobile UA, CPU slowdown 4x, Slow 4G
//             (latency 562.5 ms, download 180,000 B/s, upload 84,375 B/s; the
//             DevTools/Lighthouse "Slow 4G" applied-throttling values)
//   desktop : 1366x768 viewport, no CPU or network throttling
// Every run uses a fresh browser context (empty cache). "settled" is the time
// from navigation start until no request has been in flight for 1.5 s.
const fs = require("node:fs");
const { chromium } = require("playwright-core");

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}
const base = flag("base", "http://localhost:3187");
const profile = flag("profile", "mobile");
const runs = Number(flag("runs", "3"));
const out = flag("out", "");
const only = flag("only", "");

const PROFILES = {
  mobile: {
    viewport: { width: 412, height: 823 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    cpu: 4,
    network: { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 },
  },
  desktop: {
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent: undefined,
    cpu: 1,
    network: null,
  },
};

const PAGES = [
  { id: "login", path: "/", auth: false },
  { id: "dashboard", path: "/?section=dashboard", auth: true },
  { id: "student-registry", path: "/?section=student-registry", auth: true },
  { id: "grade-entry", path: "/?section=grade-entry", auth: true },
  { id: "exam-records", path: "/?section=exam-records", auth: true },
  { id: "grade-records", path: "/?section=grade-records", auth: true },
  { id: "opportunities", path: "/?section=opportunities", auth: true },
  { id: "follow-up-calls", path: "/?section=follow-up-calls", auth: true },
  { id: "logs", path: "/?section=logs", auth: true },
].filter((page) => !only || only.split(",").includes(page.id));

const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.floor(sorted.length / 2)];
};

async function measureOnce(browser, page, settings) {
  const context = await browser.newContext({
    viewport: settings.viewport,
    deviceScaleFactor: settings.deviceScaleFactor,
    isMobile: settings.isMobile,
    hasTouch: settings.hasTouch,
    ...(settings.userAgent ? { userAgent: settings.userAgent } : {}),
    locale: "ar-IQ",
  });
  try {
    if (page.auth) {
      const login = await context.request.post(`${base}/api/auth/login`, {
        headers: { origin: base, "content-type": "application/json" },
        data: { username: "admin", password: process.env.PERF_ADMIN_PASSWORD },
      });
      if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
    }
    const tab = await context.newPage();
    const cdp = await context.newCDPSession(tab);
    await cdp.send("Network.enable");
    if (settings.network) await cdp.send("Network.emulateNetworkConditions", settings.network);
    if (settings.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: settings.cpu });

    const requests = new Map();
    let inFlight = 0;
    let lastActivity = Date.now();
    cdp.on("Network.requestWillBeSent", (event) => {
      if (event.request.url.startsWith("data:")) return;
      if (!requests.has(event.requestId)) inFlight += 1;
      requests.set(event.requestId, { url: event.request.url, method: event.request.method, type: event.type, start: event.timestamp, bytes: 0, end: null });
      lastActivity = Date.now();
    });
    const finish = (event, bytes) => {
      const request = requests.get(event.requestId);
      if (!request || request.end !== null) return;
      request.end = event.timestamp;
      request.bytes = bytes;
      inFlight -= 1;
      lastActivity = Date.now();
    };
    cdp.on("Network.loadingFinished", (event) => finish(event, event.encodedDataLength));
    cdp.on("Network.loadingFailed", (event) => finish(event, 0));

    await tab.addInitScript(() => {
      window.__perf = { lcp: 0, cls: 0, longTasks: [] };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__perf.lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__perf.cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__perf.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: true });
    });

    const started = Date.now();
    await tab.goto(`${base}${page.path}`, { waitUntil: "load", timeout: 180000 });
    // Settled: nothing in flight for 1.5 s (the 12 s sync poll leaves room).
    let settledAt = null;
    while (Date.now() - started < 180000) {
      if (inFlight <= 0 && Date.now() - lastActivity >= 1500) {
        settledAt = lastActivity - started;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const metrics = await tab.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const fcpTime = fcp ? fcp.startTime : 0;
      const tbt = window.__perf.longTasks
        .filter((task) => task.start >= fcpTime)
        .reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
      return {
        ttfb: navigation ? navigation.responseStart : null,
        fcp: fcp ? fcp.startTime : null,
        lcp: window.__perf.lcp || null,
        cls: window.__perf.cls,
        tbt,
        load: navigation ? navigation.loadEventEnd : null,
      };
    });

    const finished = [...requests.values()].filter((request) => request.end !== null);
    const byType = (test) => finished.filter(test).reduce((sum, request) => sum + request.bytes, 0);
    const api = finished
      .filter((request) => request.url.includes("/api/"))
      .map((request) => ({
        method: request.method,
        url: request.url.replace(base, ""),
        ms: Math.round((request.end - request.start) * 1000),
        bytes: request.bytes,
      }));
    return {
      ...metrics,
      settled: settledAt,
      requests: finished.length,
      transferBytes: byType(() => true),
      jsBytes: byType((request) => request.type === "Script"),
      cssBytes: byType((request) => request.type === "Stylesheet"),
      fontBytes: byType((request) => request.type === "Font"),
      apiRequests: api.length,
      api,
    };
  } finally {
    await context.close();
  }
}

(async () => {
  const settings = PROFILES[profile];
  if (!settings) throw new Error(`unknown profile ${profile}`);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const results = { base, profile, runs, settings, measuredAt: new Date().toISOString(), pages: {} };
  try {
    for (const page of PAGES) {
      const samples = [];
      for (let run = 0; run < runs; run += 1) samples.push(await measureOnce(browser, page, settings));
      const summary = {};
      for (const key of ["ttfb", "fcp", "lcp", "cls", "tbt", "load", "settled", "requests", "transferBytes", "jsBytes", "cssBytes", "fontBytes", "apiRequests"]) {
        summary[key] = median(samples.map((sample) => sample[key]));
      }
      results.pages[page.id] = { median: summary, api: samples[samples.length - 1].api };
      console.log(page.id.padEnd(18), JSON.stringify(summary));
    }
  } finally {
    await browser.close();
  }
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
