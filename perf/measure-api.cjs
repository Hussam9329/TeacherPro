// Endpoint timing against the local server (and its throwaway local database).
//
//   PERF_ADMIN_PASSWORD=... node perf/measure-api.cjs --base http://localhost:3187 --db-control http://127.0.0.1:54873 --out <file.json> [--samples 30] [--latency 0]
//
// Signs in once as the seeded admin, warms every endpoint with 3 requests, then
// sends the requests one after another and reports p50 / p95 / response size
// and the database round trips of one request (counted by the proxy of
// perf/db-server.cjs, session lookup included). --latency sets the delay that
// proxy adds to every round trip for the run.
const fs = require("node:fs");

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}
const base = flag("base", "http://localhost:3187");
const samples = Number(flag("samples", "30"));
const out = flag("out", "");
const dbControl = flag("db-control", "http://127.0.0.1:54873");
const latency = Number(flag("latency", "0"));
const control = async (path) => (await fetch(`${dbControl}${path}`)).json();

// The read requests the main pages send on open (captured from the browser).
const ENDPOINTS = [
  "/api/auth/session",
  "/api/bootstrap",
  "/api/sync/version",
  "/api/stats",
  "/api/stats/alerts",
  "/api/stats/trend?range=month",
  "/api/course-chapters?page=1&pageSize=500",
  "/api/students?opportunityMode=1&page=1&pageSize=10",
  "/api/students/stats",
  "/api/students/filter-options",
  "/api/grades?groupBy=student&statusFilter=all&page=1&pageSize=10",
  "/api/grades/stats",
  "/api/exams?page=1&pageSize=10",
  // The exams page asks for the numbers of the exams on screen only.
  `/api/exams/stats?examIds=${Array.from({ length: 10 }, (_, index) => `exam_1_${30 - index}`).join(",")}`,
  "/api/opportunity-logs?page=1&pageSize=20",
  "/api/opportunities/stats",
  "/api/opportunities/bulk-targets?actionType=add&excludeDismissed=true&excludeFullOpportunities=true",
  "/api/logs?page=1&pageSize=20",
];

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

(async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: process.env.PERF_ADMIN_PASSWORD }),
  });
  if (!login.ok) throw new Error(`login failed: ${login.status}`);
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");

  await control(`/latency?ms=${latency}`);
  const results = { base, samples, latencyMs: latency, measuredAt: new Date().toISOString(), endpoints: {} };
  for (const endpoint of ENDPOINTS) {
    const times = [];
    let status = 0;
    let bytes = 0;
    for (let index = 0; index < samples + 3; index += 1) {
      const started = performance.now();
      const response = await fetch(`${base}${endpoint}`, { headers: { cookie } });
      const body = await response.arrayBuffer();
      const elapsed = performance.now() - started;
      status = response.status;
      bytes = body.byteLength;
      if (index >= 3) times.push(elapsed);
    }
    times.sort((a, b) => a - b);
    await control("/reset");
    await (await fetch(`${base}${endpoint}`, { headers: { cookie } })).arrayBuffer();
    const { roundTrips } = await control("/count");
    const row = {
      status,
      bytes,
      roundTrips,
      p50: Number(percentile(times, 0.5).toFixed(1)),
      p95: Number(percentile(times, 0.95).toFixed(1)),
    };
    results.endpoints[endpoint] = row;
    console.log(String(row.status).padEnd(4), `${row.p50}`.padStart(8), `${row.p95}`.padStart(8), String(row.bytes).padStart(8), String(row.roundTrips).padStart(4), endpoint);
  }
  await control("/latency?ms=0");
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
