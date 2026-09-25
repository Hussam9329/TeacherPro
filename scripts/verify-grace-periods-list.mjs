#!/usr/bin/env node
// Checks a list of expected grace periods against a running TeacherPro site,
// through the same endpoints «إدارة فترة السماح» uses (search, then the
// student's periods). Read-only.
//
//   TEACHERPRO_URL=https://... TEACHERPRO_USER=admin TEACHERPRO_PASSWORD=... \
//     node scripts/verify-grace-periods-list.mjs expected.json
//
// expected.json (kept outside the repository; it names students):
//   [{ "username": "Si_717", "name": "...", "startDate": "2026-09-20", "days": 4 }, ...]
// Days are inclusive: 20/09 + 4 days = 20/09 → 23/09.

import fs from "node:fs";

const baseUrl = String(process.env.TEACHERPRO_URL || "").replace(/\/+$/, "");
const username = process.env.TEACHERPRO_USER || "admin";
const password = process.env.TEACHERPRO_PASSWORD || "";
const file = process.argv[2] || "";
if (!baseUrl || !password || !file) {
  console.error("TEACHERPRO_URL و TEACHERPRO_PASSWORD وملف القائمة المتوقعة مطلوبة.");
  process.exit(2);
}

const expected = JSON.parse(fs.readFileSync(file, "utf8"));
const cookies = new Map();

function cookieHeader() {
  return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function call(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
      "Content-Type": "application/json",
      ...(cookies.size ? { Cookie: cookieHeader() } : {}),
      ...(init.headers || {}),
    },
  });
  for (const raw of response.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} → ${response.status} ${data?.error || ""}`.trim());
  return data;
}

function addDays(key, days) {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const arabicNormalize = (value) =>
  String(value || "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[گك]/g, "ك").replace(/[چج]/g, "ج")
    .replace(/[ً-ْ]/g, "").replace(/\s+/g, " ").trim();

const handle = (value) => String(value || "").replace(/^@+/, "").trim().toLowerCase();

function fmt(key) {
  const [y, m, d] = String(key).split("-");
  return `${d}/${m}/${y}`;
}

async function findStudent(entry) {
  const wanted = handle(entry.username);
  if (wanted) {
    const byHandle = await call(`/api/grace-periods/search?q=${encodeURIComponent(wanted)}`);
    const exact = (byHandle.students || []).filter(
      (student) => handle(student.username) === wanted || handle(student.telegram) === wanted,
    );
    if (exact.length === 1) return { student: exact[0], via: "اليوزر" };
    if (exact.length > 1) return { student: null, via: `أكثر من طالب بنفس اليوزر (${exact.length})` };
  }
  const byName = await call(`/api/grace-periods/search?q=${encodeURIComponent(entry.name)}`);
  const wantedName = arabicNormalize(entry.name);
  const exactName = (byName.students || []).filter((student) => arabicNormalize(student.name) === wantedName);
  if (exactName.length === 1) return { student: exactName[0], via: "الاسم" };
  if (exactName.length > 1) return { student: null, via: `أكثر من طالب بنفس الاسم (${exactName.length})` };
  const partial = (byName.students || []).filter((student) => arabicNormalize(student.name).includes(wantedName.split(" ").slice(0, 2).join(" ")));
  if (partial.length === 1) return { student: partial[0], via: "بداية الاسم" };
  return { student: null, via: partial.length ? `تطابق جزئي مع ${partial.length} طالب` : "غير موجود" };
}

const rows = [];
await call("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });

for (const entry of expected) {
  const expectedStart = entry.startDate;
  const expectedEnd = entry.endDate || addDays(entry.startDate, Number(entry.days) - 1);
  const row = { name: entry.name, username: entry.username, expected: `${fmt(expectedStart)} → ${fmt(expectedEnd)}`, result: "", detail: "" };
  rows.push(row);
  try {
    const found = await findStudent(entry);
    if (!found.student) {
      row.result = "❓ الطالب غير موجود";
      row.detail = found.via;
      continue;
    }
    const data = await call(`/api/grace-periods?studentId=${encodeURIComponent(found.student.id)}`);
    const active = (data.periods || []).filter((period) => !period.cancelledAt);
    const match = active.find((period) => period.startDate === expectedStart && period.endDate === expectedEnd);
    const recorded = active.map((period) => `${fmt(period.startDate)} → ${fmt(period.endDate)}`).join(" | ");
    row.detail = `${found.student.name} (${found.student.code}) عبر ${found.via}`;
    if (match) {
      row.result = "✅ مطابقة";
    } else if (active.length) {
      row.result = "⚠️ مختلفة";
      row.detail += ` · المسجل: ${recorded}`;
    } else {
      row.result = "❌ لا توجد فترة سماح";
    }
  } catch (error) {
    row.result = "⛔ خطأ";
    row.detail = error instanceof Error ? error.message : String(error);
  }
}

const counts = rows.reduce((acc, row) => ((acc[row.result.slice(0, 2)] = (acc[row.result.slice(0, 2)] || 0) + 1), acc), {});
for (const [index, row] of rows.entries()) {
  console.log(`${String(index + 1).padStart(2)}. ${row.result}  @${row.username}  ${row.name}`);
  console.log(`    المطلوب: ${row.expected}${row.detail ? `  —  ${row.detail}` : ""}`);
}
console.log("\nالخلاصة:", Object.entries(counts).map(([key, value]) => `${key} ${value}`).join("  ·  "));
