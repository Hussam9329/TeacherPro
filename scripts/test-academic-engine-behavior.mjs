#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;

// Load the actual TypeScript source, including the @/ alias, without copying
// its business logic into the test. This makes these checks behavioral rather
// than includes()-based source-text assertions.
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

const {
  classifyGradeImpact,
  examPenaltyValue,
  isAutomaticOpportunityLog,
  recalculateAcademicState,
} = require(path.join(root, "src/lib/academic-engine.ts"));
const {
  examSiteDatabaseValues,
  includesOutsideCountryExamSite,
  studentMatchesExamMainSites,
} = require(path.join(root, "src/lib/exam-utils.ts"));

const student = (overrides = {}) => ({
  id: "student-1",
  courseId: "course-1",
  status: "نشط",
  dismissalType: "",
  dismissalReason: "",
  dismissalNotes: "",
  opportunities: 3,
  baseOpportunities: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  accountingGraceDays: 0,
  gracePeriodStartDate: null,
  ...overrides,
});

const exam = (overrides = {}) => ({
  id: "exam-1",
  name: "اختبار سلوكي",
  type: "فاينل",
  date: "2026-02-01T00:00:00.000Z",
  fullMark: 100,
  passMark: 50,
  discountMark: 20,
  opportunitiesPenalty: 1,
  dismissalGrade: null,
  noDiscount: false,
  active: true,
  courseIds: ["course-1"],
  ...overrides,
});

const grade = (overrides = {}) => ({
  id: "grade-1",
  studentId: "student-1",
  examId: "exam-1",
  status: "درجة",
  score: 0,
  notes: null,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  ...overrides,
});

function state(overrides = {}) {
  return {
    students: [student()],
    exams: [exam()],
    grades: [grade()],
    courseChapters: [
      {
        id: "link-1",
        courseId: "course-1",
        chapterId: "chapter-1",
        active: true,
        archived: false,
      },
    ],
    chapters: [{ id: "chapter-1", name: "الفصل الأول", opportunities: 3 }],
    opportunityLogs: [],
    studentLeaves: [],
    studentNotes: [],
    ...overrides,
  };
}

function recalculatedStudent(input) {
  return recalculateAcademicState(input, new Set(["student-1"])).students.find(
    (item) => item.id === "student-1",
  );
}

{
  assert.equal(
    studentMatchesExamMainSites({ mainSite: "اربيل" }, ["أربيل"]),
    true,
  );
  assert.equal(
    studentMatchesExamMainSites({ locationScope: "خارج القطر - تركيا" }, ["خارج القطر"]),
    true,
  );
  assert.ok(examSiteDatabaseValues(["الديوانية"]).includes("القادسية"));
  assert.equal(includesOutsideCountryExamSite(["خارج القطر"]), true);
  console.log("✅ تطبيع المواقع القديمة متطابق بين قاعدة البيانات والمحرك الأكاديمي");
}

{
  const result = recalculatedStudent(state());
  assert.equal(result.status, "مفصول");
  assert.equal(result.opportunities, 0);
  assert.match(result.dismissalReason, /درجة صفر/);
  assert.equal(
    classifyGradeImpact(grade(), exam(), 3).type,
    "temporary_dismissal",
  );
  console.log("✅ فاينل صفر يفصل حتى عندما dismissalGrade فارغة");
}

{
  const noDiscountExam = exam({ noDiscount: true });
  const result = recalculatedStudent(
    state({ exams: [noDiscountExam] }),
  );
  assert.equal(result.status, "نشط");
  assert.equal(result.opportunities, 3);
  console.log("✅ خيار بدون خصم يبقى الاستثناء الصريح ولا يتغير");
}

{
  const dailyExam = exam({
    type: "يومي",
    opportunitiesPenalty: 1,
    dismissalGrade: null,
  });
  const oneChanceStudent = student({ opportunities: 1, baseOpportunities: 1 });
  const result = recalculatedStudent(
    state({
      students: [oneChanceStudent],
      exams: [dailyExam],
      grades: [grade({ score: 10 })],
      chapters: [
        { id: "chapter-1", name: "الفصل الأول", opportunities: 1 },
      ],
    }),
  );
  assert.equal(result.status, "مفصول");
  assert.equal(result.opportunities, 0);
  assert.match(result.dismissalReason, /انتهاء الفرص/);
  console.log("✅ وصول الفرص إلى صفر يفصل في إعادة الاحتساب الفعلية");
}

{
  const result = recalculatedStudent(
    state({
      students: [student({ opportunities: 8, baseOpportunities: 8 })],
      grades: [],
      chapters: [
        { id: "chapter-1", name: "الفصل الأول", opportunities: 2 },
      ],
    }),
  );
  assert.equal(result.status, "نشط");
  assert.equal(result.opportunities, 2);
  console.log("✅ تغيير سقف الفصل يثبت الرصيد عند السقف الجديد");
}

{
  const result = recalculatedStudent(
    state({ grades: [grade({ status: "ضمن فترة السماح", score: null })] }),
  );
  assert.equal(result.status, "نشط");
  assert.equal(result.opportunities, 3);
  console.log("✅ حالة ضمن فترة السماح لا تخصم ولا تفصل");
}

{
  const result = recalculatedStudent(
    state({
      students: [
        student({
          createdAt: "2026-02-01T00:00:00.000Z",
          gracePeriodEndedAt: "2026-02-02T09:00:00.000Z",
        }),
      ],
      exams: [
        exam({
          type: "يومي",
          date: "2026-02-02T00:00:00.000Z",
          opportunitiesPenalty: 1,
        }),
      ],
      grades: [grade({ score: 10 })],
    }),
  );
  assert.equal(result.status, "نشط");
  assert.equal(result.opportunities, 2);
  console.log("✅ إنهاء السماح يجعل نفس الدرجة الرقمية مؤثرة أكاديمياً");
}

{
  const outOfSiteStudent = student({ mainSite: "المنصور" });
  const siteScopedExam = exam({
    type: "يومي",
    mainSite: "زيونة",
    opportunitiesPenalty: 1,
  });
  const result = recalculatedStudent(
    state({
      students: [outOfSiteStudent],
      exams: [siteScopedExam],
      grades: [grade({ score: 10 })],
    }),
  );
  assert.equal(result.status, "نشط");
  assert.equal(result.opportunities, 3);
  console.log("✅ الامتحان المقيد بموقع لا يؤثر أكاديمياً على طالب خارج الموقع");
}

{
  const earlyExam = exam({
    id: "exam-early",
    name: "الامتحان المبكر",
    type: "يومي",
    date: "2026-02-01T00:00:00.000Z",
    opportunitiesPenalty: 1,
  });
  const lateExam = exam({
    id: "exam-late",
    name: "الامتحان المتأخر",
    type: "يومي",
    date: "2026-02-10T00:00:00.000Z",
    opportunitiesPenalty: 1,
  });
  const input = state({
    students: [student({ opportunities: 2, baseOpportunities: 2 })],
    exams: [earlyExam, lateExam],
    grades: [
      grade({
        id: "grade-late",
        examId: "exam-late",
        score: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      grade({
        id: "grade-early",
        examId: "exam-early",
        score: 10,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
    ],
    chapters: [{ id: "chapter-1", name: "الفصل الأول", opportunities: 2 }],
  });
  const recalculated = recalculateAcademicState(input, new Set(["student-1"]));
  const automatic = recalculated.opportunityLogs.filter(isAutomaticOpportunityLog);
  assert.equal(automatic[0]?.examId, "exam-early");
  assert.equal(automatic[1]?.examId, "exam-late");
  console.log("✅ ترتيب الأثر الأكاديمي يعتمد تاريخ الامتحان لا وقت إدخال الدرجة");
}

assert.equal(examPenaltyValue({ noDiscount: false, opportunitiesPenalty: 0 }), 1);
assert.equal(
  isAutomaticOpportunityLog({ action: "خصم تلقائي", reason: "" }),
  true,
);
assert.equal(
  isAutomaticOpportunityLog({ action: "خصم", reason: "تعديل يدوي" }),
  false,
);
console.log("✅ الخصم الافتراضي وتمييز المصدر التلقائي/اليدوي صحيحان");

console.log("\nكل اختبارات المحرك الأكاديمي السلوكية نجحت.");
