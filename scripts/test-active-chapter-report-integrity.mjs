// اختبار سلامة «تقرير امتحانات الفصل النشط الحالي» في تصدير HTML لإدارة الفرص:
// 1) الحدود الحتمية لقرار الفصل النشط (computeActiveChapterReportContext).
// 2) الفلترة داخل دالة التحويل المشتركة (تصدير HTML + رسالة تيليجرام).
// 3) توسيط خانة البحث ومرنيتها داخل ملف HTML المتولد.
import assert from "node:assert/strict";
import fs, { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;

// نفس آلية test-academic-engine-behavior.mjs: تحميل مصدر TypeScript الفعلي
// (مع اختصار @/) دون نسخ منطق العمل داخل الاختبار، فتبقى الفحوص سلوكية.
Module._resolveFilename = function resolveTeacherProModule(
  request,
  parent,
  isMain,
  options,
) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(root, "src", request.slice(2))
    : request;
  return originalResolveFilename.call(
    this,
    resolvedRequest,
    parent,
    isMain,
    options,
  );
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

const { computeActiveChapterReportContext, parseArchiveEntryDates, opportunityLogWithinActiveChapter } = require(
  path.join(root, "src/lib/active-chapter-report.ts"),
);

const read = (path) => readFileSync(path, "utf8");
const lib = read("src/lib/active-chapter-report.ts");
const route = read("src/app/api/students/profile-log/route.ts");
const exportDialog = read("src/components/teacher-pro/export-dialog.tsx");
const api = read("src/lib/api.ts");
const pkg = JSON.parse(read("package.json"));

const checks = [];
const must = (condition, label) => {
  checks.push({ label, ok: Boolean(condition) });
  if (!condition) {
    console.error(`❌ ${label}`);
    throw new Error(label);
  }
  console.log(`✅ ${label}`);
};

/* ============================ سلوك الحدود الحتمية ============================ */

// أرشيف مدخل واحد بصيغة مفتاح يوم (2026-08-30) — نفس صيغة activate الاعتيادية.
const dayKeyArchive = JSON.stringify([
  { studentId: "s1", opportunities: 3, date: "2026-08-30" },
  { studentId: "s2", opportunities: 0, date: "2026-08-30" },
]);

// أرشيف بصيغة ISO كامل — نفس صيغة انتقال الدورة الصيفية/الاعفاء 2026-08-14.
const isoArchive = JSON.stringify([
  { studentId: "s1", opportunities: 3, date: "2026-08-14T17:39:56.561Z" },
]);

const chapter = { id: "ch2", name: "الفصل الثاني - الانسجة" };
const newExam = (id, date) => ({ id, date });
const evidence = (map) => new Map(Object.entries(map));

// انتقال بصيغة ISO: الامتحان الذي انصنع بعده (أول درجة 08-15) يدخل،
// والامتحان القديم (أول درجة 08-10) يُستبعد، والمؤرخ قبل الانتقال بلا درجات
// يُستبعد، والمستقبلي بلا درجات يدخل بتاريخه.
const isoContext = computeActiveChapterReportContext(
  [
    { active: true, archived: false, archive: "[]", chapter },
    { active: false, archived: false, archive: isoArchive, chapter: { id: "ch1", name: "الفصل الاول - الخلية" } },
  ],
  [
    newExam("e-new", "2026-08-13T00:00:00.000Z"),
    newExam("e-old", "2026-08-08T00:00:00.000Z"),
    newExam("e-dated-old", "2026-08-13T00:00:00.000Z"),
    newExam("e-future", "2026-09-05T00:00:00.000Z"),
  ],
  evidence({
    "e-new": "2026-08-15T22:04:54.593Z",
    "e-old": "2026-08-10T14:17:58.569Z",
    "e-dated-old": null,
    "e-future": null,
  }),
);
assert.deepEqual(isoContext.examIds, ["e-new", "e-future"]);
assert.equal(isoContext.name, "الفصل الثاني - الانسجة");
assert.equal(isoContext.since, "2026-08-14T17:39:56.561Z");
must(
  isoContext.examIds.includes("e-new") && !isoContext.examIds.includes("e-old"),
  "حد الانتقال ISO: الامتحان المنشأ بعد الانتقال يدخل والقديم يُستبعد",
);

// انتقال بصيغة مفتاح يوم: نفس اليوم لا يكفي — يبدأ من اليوم التالي فصاعداً
// حتى لا يدخل «فاينل» الفصل السابق المؤرخ/المُنشأ بنفس يوم التحويل.
const dayKeyContext = computeActiveChapterReportContext(
  [
    { active: true, archived: false, archive: "[]", chapter },
    { active: false, archived: true, archive: dayKeyArchive, chapter: { id: "ch1", name: "الفصل الاول - الخلية" } },
  ],
  [
    newExam("e-same-day", "2026-08-30T05:00:00.000Z"),
    newExam("e-next-day", "2026-08-31T00:00:00.000Z"),
  ],
  evidence({
    "e-same-day": "2026-08-30T09:30:00.000Z",
    "e-next-day": "2026-09-01T10:00:00.000Z",
  }),
);
assert.deepEqual(dayKeyContext.examIds, ["e-next-day"]);
must(
  !dayKeyContext.examIds.includes("e-same-day") &&
    dayKeyContext.examIds.includes("e-next-day"),
  "حد الانتقال بمفتاح يوم: يبدأ من اليوم التالي فقط",
);

// بلا أي رابط غير مفعلة → الفصل النشط منذ بداية الدورة: كل الامتحانات.
const noTransition = computeActiveChapterReportContext(
  [{ active: true, archived: false, archive: "[]", chapter }],
  [newExam("e1", "2026-06-16T00:00:00.000Z"), newExam("e2", "2026-08-08T00:00:00.000Z")],
  evidence({ e1: "2026-06-18T12:00:00.000Z", e2: "2026-08-10T14:00:00.000Z" }),
);
assert.equal(noTransition.since, null);
assert.equal(noTransition.examIds.length, 2);
must(
  noTransition.since === null && noTransition.examIds.length === 2,
  "بلا انتقال (الفصل الأول منذ البداية): كل امتحانات الدورة من الفصل النشط",
);

// تعارض أكثر من فصل نشط أو غياب فصل نشط → بلا سياق (لا فلترة، السلوك القديم).
assert.equal(
  computeActiveChapterReportContext(
    [
      { active: true, archived: false, archive: "[]", chapter },
      { active: true, archived: false, archive: "[]", chapter: { id: "ch3", name: "فصل آخر" } },
    ],
    [newExam("e1", "2026-09-01T00:00:00.000Z")],
    evidence({}),
  ),
  null,
);
assert.equal(
  computeActiveChapterReportContext([], [newExam("e1", "2026-09-01T00:00:00.000Z")], evidence({})),
  null,
);
must(
  lib.includes("activeLinks.length !== 1") && lib.includes("return null"),
  "تعارض/غياب الفصل النشط: يعيد null فلا يخفي التقرير بيانات عن طريق الخطأ",
);

// آخر انتقال هو الحد عند وجود روابط قديمة متعددة (ch1→ch2 ثم ch2→ch3).
const latestTransition = computeActiveChapterReportContext(
  [
    { active: true, archived: false, archive: "[]", chapter: { id: "ch3", name: "الفصل الثالث" } },
    { active: false, archived: false, archive: JSON.stringify([{ date: "2026-08-14" }]), chapter: { id: "ch1", name: "الفصل الاول" } },
    { active: false, archived: false, archive: JSON.stringify([{ date: "2026-08-30" }]), chapter: { id: "ch2", name: "الفصل الثاني" } },
  ],
  [newExam("e-after", "2026-08-20T00:00:00.000Z"), newExam("e-latest", "2026-09-02T00:00:00.000Z")],
  evidence({ "e-after": "2026-08-21T00:00:00.000Z", "e-latest": "2026-09-03T00:00:00.000Z" }),
);
assert.deepEqual(latestTransition.examIds, ["e-latest"]);
must(
  latestTransition.examIds.length === 1,
  "روابط قديمة متعددة: الحد هو آخر انتقال لا أول انتقال",
);

// تحليل أرشيف غير صالح لا يفجّر الحساب.
assert.deepEqual(parseArchiveEntryDates("not-json"), []);
assert.deepEqual(parseArchiveEntryDates(null), []);
assert.deepEqual(
  parseArchiveEntryDates(JSON.stringify([{ studentId: "s1", opportunities: 3 }])),
  [],
);
must(
  Array.isArray(parseArchiveEntryDates("[]")) &&
    parseArchiveEntryDates("not-json").length === 0,
  "أرشيف تالف أو بلا تواريخ: يُتجاهل بأمان",
);

/* ================= سلوك تقييد سجل الفرص على الفصل النشط ================= */

const chapterLogScope = {
  examIds: ["e-new", "e-future"],
  since: "2026-08-14T17:39:56.561Z",
};

// حركة مرتبطة بامتحان: تُعرض فقط إذا كان الامتحان من امتحانات الفصل النشط،
// مهما كان تاريخ تسجيل الحركة (حتى لو أعاد المحرك توليدها لاحقاً).
assert.equal(
  opportunityLogWithinActiveChapter(
    { examId: "e-new", date: "2026-08-15T10:00:00.000Z" },
    chapterLogScope,
  ),
  true,
);
assert.equal(
  opportunityLogWithinActiveChapter(
    { examId: "e-old", date: "2026-07-19T10:00:00.000Z" },
    chapterLogScope,
  ),
  false,
);
assert.equal(
  opportunityLogWithinActiveChapter(
    { examId: "e-old", date: "2026-08-25T10:00:00.000Z" },
    chapterLogScope,
  ),
  false,
);
must(
  opportunityLogWithinActiveChapter({ examId: "e-new" }, chapterLogScope) &&
    !opportunityLogWithinActiveChapter({ examId: "e-old" }, chapterLogScope) &&
    !opportunityLogWithinActiveChapter(
      { examId: "e-old", date: "2026-08-25T10:00:00.000Z" },
      chapterLogScope,
    ),
  "حركة مرتبطة بامتحان: تدخل فقط إذا كان الامتحان من الفصل النشط مهما تأخر تاريخها",
);

// التسوية تُسك بيوم الانتقال نفسها فتظهر (>= متعمد)، وما قبل اليوم يُخفى.
assert.equal(
  opportunityLogWithinActiveChapter(
    { examId: null, date: "2026-08-14T17:39:56.561Z" },
    chapterLogScope,
  ),
  true,
);
assert.equal(
  opportunityLogWithinActiveChapter(
    { examId: null, date: "2026-08-20T09:00:00.000Z" },
    chapterLogScope,
  ),
  true,
);
assert.equal(
  opportunityLogWithinActiveChapter(
    { examId: null, date: "2026-08-13T10:00:00.000Z" },
    chapterLogScope,
  ),
  false,
);
assert.equal(
  opportunityLogWithinActiveChapter(
    { examId: null, date: "2026-07-01T09:00:00.000Z" },
    chapterLogScope,
  ),
  false,
);
must(
  opportunityLogWithinActiveChapter(
    { examId: null, date: "2026-08-14T17:39:56.561Z" },
    chapterLogScope,
  ) &&
    opportunityLogWithinActiveChapter(
      { examId: null, date: "2026-08-20T09:00:00.000Z" },
      chapterLogScope,
    ) &&
    !opportunityLogWithinActiveChapter(
      { examId: null, date: "2026-08-13T10:00:00.000Z" },
      chapterLogScope,
    ),
  "حركة بلا امتحان: تظهر من يوم الانتقال فصاعداً (التسوية بيومها تظهر) وما قبله يُخفى",
);

// بلا انتقال بعد (الفصل الأول منذ البداية): الحركات غير المرتبطة بامتحان كلها ظاهرة.
assert.equal(
  opportunityLogWithinActiveChapter(
    { examId: null, date: "2026-06-01T00:00:00.000Z" },
    { examIds: ["e1"], since: null },
  ),
  true,
);
must(
  opportunityLogWithinActiveChapter(
    { examId: null, date: "2026-06-01T00:00:00.000Z" },
    { examIds: ["e1"], since: null },
  ),
  "فصل نشط بلا انتقال: الحركات غير المرتبطة بامتحان كلها من الفصل النشط",
);

// غياب السياق كلياً أو تاريخ غير صالح: بلا فلترة (السلوك القديم) وتجاهل آمن.
assert.equal(opportunityLogWithinActiveChapter({ examId: "x" }, null), true);
assert.equal(opportunityLogWithinActiveChapter({ examId: "x" }, undefined), true);
assert.equal(
  opportunityLogWithinActiveChapter(
    { examId: null, date: "تاريخ غير صالح" },
    chapterLogScope,
  ),
  false,
);
must(
  opportunityLogWithinActiveChapter({ examId: "x" }, null) &&
    !opportunityLogWithinActiveChapter(
      { examId: null, date: "تاريخ غير صالح" },
      chapterLogScope,
    ),
  "غياب السياق = بلا فلترة، وتاريخ حركة غير صالح لا يظهر داخل نطاق الفصل",
);

/* ===================== الربط بالمصدر الموحد للتقرير ===================== */

must(
  route.includes('import { loadActiveChapterReportContext } from "@/lib/active-chapter-report"') &&
    route.includes("await loadActiveChapterReportContext(tx, student.courseId)") &&
    route.includes("currentChapter,") &&
    route.includes("currentChapter,"),
  "API ملف الطالب يحسب سياق الفصل النشط داخل نفس transaction اللقطة ويعيده بالاستجابة",
);

must(
  exportDialog.includes("currentChapter?: {") &&
    exportDialog.includes("resolveActiveChapterExamFilter(profile)") &&
    exportDialog.includes("chapterExamIds.has(") &&
    exportDialog.includes("activeChapterName }"),
  "دالة التحويل المشتركة تفلتر درجات امتحانات الفصل النشط وتربط اسم الفصل بالتفاصيل",
);

must(
  exportDialog.includes('import { opportunityLogWithinActiveChapter } from "@/lib/active-chapter-report"') &&
    exportDialog.includes("resolveActiveChapterLogScope(profile)") &&
    exportDialog.includes("opportunityLogWithinActiveChapter("),
  "دالة التحويل المشتركة تقيد سجل حركات الفرص بنفس حدود الفصل النشط (خصومات الفصل السابق مخفية والتسوية ظاهرة)",
);

must(
  !exportDialog.includes("isOpportunityResetLog") &&
    !exportDialog.includes("RESET_REASON_PATTERNS"),
  "صفوف تسوية انتقال الفصول تبقى ظاهرة بالتقرير (لم تعد تُخفى) لأن السجل مقيد بالفصل النشط",
);

must(
  exportDialog.includes('id="tpLogsSectionTitle"') &&
    exportDialog.includes("سجل حركات الفرص — الفصل النشط ("),
  "عنوان قسم السجل بملف HTML يوضح أن الحركات مقيدة بالفصل النشط",
);

must(
  exportDialog.includes("activeChapterName: studentDetails.activeChapterName ?? null") &&
    api.includes("StudentActiveChapterContext") &&
    api.includes("currentChapter?: StudentActiveChapterContext | null"),
  "التنظيف ونوع الواجهة الأمامية يمرران سياق الفصل النشط دون فقدانه",
);

must(
  exportDialog.includes("tpGradesSectionTitle") &&
    exportDialog.includes("امتحانات الفصل النشط الحالي (") &&
    exportDialog.includes("لا توجد امتحانات للفصل النشط الحالي لهذا الطالب"),
  "ملف HTML يعرض عنوان قسم الامتحانات باسم الفصل النشط وحالة الفراغ الخاصة به",
);

must(
  exportDialog.includes(".tp-search-wrap") &&
    exportDialog.includes("max-width: 760px") &&
    exportDialog.includes("margin: 6px auto 22px") &&
    exportDialog.includes("text-align: center") &&
    exportDialog.includes("clamp(16px, 2.2dvw, 18px)") &&
    !/(?:^|[^a-z])\d+(?:\.\d+)?vw\b/i.test(
      exportDialog.slice(
        exportDialog.indexOf("DETAILS_MODAL_CSS"),
        exportDialog.indexOf("const DETAILS_MODAL_HTML"),
      ),
    ) &&
    exportDialog.includes("@media screen and (max-width: 720px)") &&
    exportDialog.includes("@media screen and (max-width: 420px)") &&
    exportDialog.includes("env(safe-area-inset-top, 0px)"),
  "خانة البحث في ملف HTML وسطية ومرنة ومعزولة للشاشة وتراعي safe-area",
);

must(
  pkg.scripts["test:active-chapter-report-integrity"] ===
    "node scripts/test-active-chapter-report-integrity.mjs",
  "اختبار سلامة تقرير الفصل النشط مُسجل في package.json",
);

must(
  String(pkg.scripts["test:side-effects"] || "").includes(
    "npm run test:active-chapter-report-integrity",
  ),
  "اختبار الفصل النشط داخل حزمة الاختبارات الشاملة (side-effects)",
);

console.log(
  checks.length === checks.filter((c) => c.ok).length
    ? "\nكل اختبارات سلامة تقرير الفصل النشط الحالي نجحت."
    : "\nفشل بعض اختبارات تقرير الفصل النشط الحالي.",
);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
