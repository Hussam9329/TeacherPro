#!/usr/bin/env node
// تحقق حي: سياق تقرير الفصل النشط بعد الإصلاح — حالة «فاينل الدورة الصيفية الثانية».
// يحمّل الكود الفعلي (src/lib/active-chapter-report.ts) ويغذّيه ببيانات قاعدة
// البيانات الحقيقية نفسها التي يقرؤها loadActiveChapterReportContext.
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { Client } from "pg";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveTeacherProModule(
  request,
  parent,
  isMain,
  options,
) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(root, "src", request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022,
    },
  });
  module._compile(output.outputText, filename);
};

const { computeActiveChapterReportContext } = require(
  path.join(root, "src/lib/active-chapter-report.ts"),
);

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const TARGET_COURSE_NAME = /ثاني/;

function baghdadDateKey(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : "";
  }
  const baghdad = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return baghdad.toISOString().slice(0, 10);
}

function parseArchiveEntryDates(archive) {
  const source = typeof archive === "string" ? archive.trim() : "";
  if (!source) return [];
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => String(entry?.date ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});
await client.connect();

const courses = await client.query(
  `SELECT id, name FROM "Course" WHERE name ILIKE '%صيفي%' AND name ILIKE '%ثاني%'`,
);
let failed = false;

for (const course of courses.rows) {
  const courseId = course.id;
  const linksRows = await client.query(
    `SELECT cc.active, cc.archived, cc.archive, ch.id AS chapter_id, ch.name AS chapter_name
     FROM "CourseChapter" cc JOIN "Chapter" ch ON ch.id = cc."chapterId"
     WHERE cc."courseId" = $1`,
    [courseId],
  );
  const links = linksRows.rows.map((row) => ({
    active: row.active,
    archived: row.archived,
    archive: row.archive,
    chapter: { id: row.chapter_id, name: row.chapter_name },
  }));
  const activeLinks = links.filter((link) => link.active && !link.archived);
  if (activeLinks.length !== 1) {
    console.log(`⏭️  ${course.name}: لا فصل نشط وحيد — لا سياق`);
    continue;
  }
  const activeLink = activeLinks[0];

  const examRows = await client.query(
    `SELECT id, date FROM "Exam" WHERE "courseIds"::text LIKE $1`,
    [`%"${courseId}"%`],
  );
  const courseExams = examRows.rows.map((row) => ({ id: row.id, date: row.date }));

  const gradeMinRows = courseExams.length
    ? await client.query(
        `SELECT "examId", MIN("createdAt") AS min_created FROM "Grade"
         WHERE "examId" = ANY($1) GROUP BY "examId"`,
        [courseExams.map((exam) => exam.id)],
      )
    : { rows: [] };
  const firstEvidence = new Map(
    gradeMinRows.rows.map((row) => [row.examId, row.min_created]),
  );

  const settlementRow = await client.query(
    `SELECT ol.date FROM "OpportunityLog" ol
     JOIN "Student" s ON s.id = ol."studentId"
     WHERE s."courseId" = $1 AND ol."chapterId" = $2 AND ol.reason LIKE 'تسوية تاريخية:%'
     ORDER BY ol.date ASC LIMIT 1`,
    [courseId, activeLink.chapter.id],
  );
  const preciseBoundary = settlementRow.rows[0]?.date ?? null;

  // الحساب بالمنطق الجديد والقديم معاً للمقارنة
  const newContext = computeActiveChapterReportContext(
    links,
    courseExams,
    firstEvidence,
    preciseBoundary,
  );
  const oldContext = computeActiveChapterReportContext(links, courseExams, firstEvidence);

  console.log(`\n########## ${course.name} ##########`);
  console.log(`حد الأرشيف (يوم): ${baghdadDateKey(newContext?.since) || "—"}`);
  console.log(`لحظة الانتقال الدقيقة: ${preciseBoundary ? new Date(preciseBoundary).toISOString() : "—"}`);

  const oldSet = new Set(oldContext?.examIds || []);
  const newSet = new Set(newContext?.examIds || []);
  for (const exam of courseExams) {
    const was = oldSet.has(exam.id);
    const now = newSet.has(exam.id);
    const evidence = firstEvidence.get(exam.id);
    const state = was === now ? (now ? "✅ يدخل" : "❌ مستبعد") : now ? "🆕 أصبح يدخل" : "⚠️ أصبح مستبعد";
    console.log(
      `${state} | evidenceDay=${baghdadDateKey(evidence ?? exam.date) || "—"} | id=${exam.id.slice(0, 18)} | evidence=${evidence ? new Date(evidence).toISOString() : exam.date ? new Date(exam.date).toISOString() : "—"}`,
    );
    if (was && !now) failed = true;
  }

  // الفاينل يجب أن يدخل لهذه الدورة (حالة صاحبة البلاغ)
  const finalExams = examRows.rows.filter((row) => /فاينل/.test(row.id) || true);
  const finalNames = await client.query(
    `SELECT id, name FROM "Exam" WHERE "courseIds"::text LIKE $1 AND type = 'فاينل'`,
    [`%"${courseId}"%`],
  );
  for (const finalExam of finalNames.rows) {
    const included = newSet.has(finalExam.id);
    console.log(
      `${included ? "✅ الفاينل يدخل الآن في تقرير الفصل النشط" : "❌ الفاينل ما زال مستبعداً"} — "${finalExam.name}"`,
    );
    if (!included) failed = true;
  }
}

await client.end();
console.log(
  failed
    ? "\n❌ فشل التحقق الحي"
    : "\n✅ التحقق الحي نجح: الفاينل يدخل ولا امتحان قديم تسرب",
);
process.exit(failed ? 1 : 0);
