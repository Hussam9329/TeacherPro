#!/usr/bin/env node

const baseUrl = String(process.env.TEACHERPRO_BASE_URL || "").replace(/\/$/, "");
const secret = String(process.env.CRON_SECRET || "").trim();
const apply = process.argv.includes("--apply");

if (!baseUrl || !secret) {
  console.error("Set TEACHERPRO_BASE_URL and CRON_SECRET first.");
  process.exit(1);
}

const endpoint = `${baseUrl}/api/internal/academic-integrity/zero-balance`;
const headers = { authorization: `Bearer ${secret}` };
const previewResponse = await fetch(endpoint, { headers, cache: "no-store" });
const preview = await previewResponse.json();
console.log(JSON.stringify(preview, null, 2));
if (!previewResponse.ok) process.exit(1);
if (!apply || Number(preview.candidateCount || 0) === 0) {
  console.log(apply ? "No reconciliation is needed." : "Dry run only. Re-run with --apply after reviewing the preview.");
  process.exit(0);
}

const applyResponse = await fetch(endpoint, {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({ previewToken: preview.previewToken }),
});
const applied = await applyResponse.json();
console.log(JSON.stringify(applied, null, 2));
if (!applyResponse.ok) process.exit(1);
