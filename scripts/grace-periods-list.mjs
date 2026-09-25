#!/usr/bin/env node
// Brings a list of granted grace periods into a running TeacherPro site
// through the same endpoints «إدارة فترة السماح» uses: search the student,
// read their periods, then (with --apply) preview and confirm a create or an
// edit. Without --apply it only reports what it would do.
//
//   TEACHERPRO_URL=https://... TEACHERPRO_USER=admin TEACHERPRO_PASSWORD=... \
//     node scripts/grace-periods-list.mjs expected.json [--apply]
//
// expected.json (kept outside the repository; it names students):
//   [{ "username": "Si_717", "name": "...", "startDate": "2026-09-20", "days": 4 }, ...]
// Days are inclusive: 20/09 + 4 days = 20/09 → 23/09.
//
// Rules: a matching active period is left alone; one active period that
// overlaps the wanted range is edited to it; no overlap means a new period;
// anything ambiguous (several overlaps, several students) is reported for a
// person to decide. Nothing is ever cancelled.

import fs from "node:fs";

const baseUrl = String(process.env.TEACHERPRO_URL || "").replace(/\/+$/, "");
const username = process.env.TEACHERPRO_USER || "admin";
const password = process.env.TEACHERPRO_PASSWORD || "";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find((arg) => !arg.startsWith("--")) || "";
if (!baseUrl || !password || !file) {
  console.error("TEACHERPRO_URL و TEACHERPRO_PASSWORD وملف القائمة المتوقعة مطلوبة.");
  process.exit(2);
}

const expected = JSON.parse(fs.readFileSync(file, "utf8"));
const cookies = new Map();

async function call(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
      "Content-Type": "application/json",
      ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
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

const post = (body) => call("/api/grace-periods", { method: "POST", body: JSON.stringify(body) });

function addDays(key, days) {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const normalizeName = (value) =>
  String(value || "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[گك]/g, "ك").replace(/[چج]/g, "ج")
    .replace(/[ً-ْ]/g, "").replace(/\s+/g, " ").trim();
const handle = (value) => String(value || "").replace(/^@+/, "").trim().toLowerCase();
const fmt = (key) => { const [y, m, d] = String(key).split("-"); return `${d}/${m}/${y}`; };
const range = (period) => `${fmt(period.startDate)} → ${fmt(period.endDate)}`;
const overlaps = (a, b) => a.startDate <= b.endDate && b.startDate <= a.endDate;

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
  const wantedName = normalizeName(entry.name);
  const exactName = (byName.students || []).filter((student) => normalizeName(student.name) === wantedName);
  if (exactName.length === 1) return { student: exactName[0], via: "الاسم" };
  if (exactName.length > 1) return { student: null, via: `أكثر من طالب بنفس الاسم (${exactName.length})` };
  const prefix = wantedName.split(" ").slice(0, 2).join(" ");
  const partial = (byName.students || []).filter((student) => normalizeName(student.name).startsWith(prefix));
  if (partial.length === 1) return { student: partial[0], via: "بداية الاسم" };
  return { student: null, via: partial.length ? `تطابق جزئي مع ${partial.length} طالب` : "غير موجود" };
}

/** Preview then confirm, exactly like the screen; one retry if the token went stale. */
async function change(request) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const preview = await post({ ...request, mode: "preview" });
    try {
      const result = await post({ ...request, mode: "apply", previewToken: preview.previewToken });
      return { preview, result };
    } catch (error) {
      if (attempt === 0 && /409/.test(String(error.message))) continue;
      throw error;
    }
  }
  throw new Error("تعذر تأكيد التعديل بعد إعادة المعاينة.");
}

const rows = [];
await call("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });

for (const entry of expected) {
  const wanted = { startDate: entry.startDate, endDate: entry.endDate || addDays(entry.startDate, Number(entry.days) - 1) };
  const row = { name: entry.name, username: entry.username, wanted: range(wanted), result: "", detail: "" };
  rows.push(row);
  try {
    const found = await findStudent(entry);
    if (!found.student) {
      row.result = "❓ الطالب غير موجود";
      row.detail = found.via;
      continue;
    }
    const student = found.student;
    row.detail = `${student.name} (${student.code}) عبر ${found.via}`;
    const data = await call(`/api/grace-periods?studentId=${encodeURIComponent(student.id)}`);
    const active = (data.periods || []).filter((period) => !period.cancelledAt);
    if (active.some((period) => period.startDate === wanted.startDate && period.endDate === wanted.endDate)) {
      row.result = "✅ مطابقة";
      continue;
    }
    const overlapping = active.filter((period) => overlaps(period, wanted));
    if (overlapping.length > 1) {
      row.result = "⚠️ تحتاج مراجعة يدوية";
      row.detail += ` · تتداخل مع ${overlapping.length} فترات: ${overlapping.map(range).join(" | ")}`;
      continue;
    }
    const target = overlapping[0] || null;
    const request = target
      ? { studentId: student.id, action: "update", periodId: target.id, ...wanted }
      : { studentId: student.id, action: "create", ...wanted };
    if (!apply) {
      row.result = target ? "✏️ ستُعدَّل" : "➕ ستُضاف";
      if (target) row.detail += ` · المسجل الآن: ${range(target)}`;
      continue;
    }
    const { preview, result } = await change(request);
    row.result = target ? "✏️ عُدِّلت" : "➕ أُضيفت";
    if (target) row.detail += ` · كانت ${range(target)}`;
    const affected = preview.affectedExams?.length || 0;
    const balance = result.student ? ` · الرصيد الآن ${result.student.opportunities} (${result.student.status})` : "";
    row.detail += ` · امتحانات متأثرة: ${affected}${balance}`;
  } catch (error) {
    row.result = "⛔ خطأ";
    row.detail += `${row.detail ? " · " : ""}${error instanceof Error ? error.message : String(error)}`;
  }
}

console.log(apply ? "وضع التطبيق: التعديلات حُفظت في النظام.\n" : "وضع الفحص فقط: لم يتغير أي شيء.\n");
for (const [index, row] of rows.entries()) {
  console.log(`${String(index + 1).padStart(2)}. ${row.result}  @${row.username}  ${row.name}`);
  console.log(`    المطلوب: ${row.wanted}${row.detail ? `  —  ${row.detail}` : ""}`);
}
const counts = new Map();
for (const row of rows) counts.set(row.result, (counts.get(row.result) || 0) + 1);
console.log("\nالخلاصة:", [...counts].map(([key, value]) => `${key}: ${value}`).join("  ·  "));
