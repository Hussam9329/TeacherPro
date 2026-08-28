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
    "dismissal",
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
  assert.equal(result.status, "نشط");
  assert.equal(result.opportunities, 0);
  assert.equal(result.dismissalReason, "");
  assert.equal(
    classifyGradeImpact(grade({ score: 10 }), dailyExam, 1).type,
    "discount",
  );
  console.log("✅ فقدان آخر فرصة يوصل الرصيد إلى صفر ويبقي الطالب نشطاً");
}

{
  const absentExam = exam({
    id: "exam-absent-zero",
    name: "امتحان غياب آخر فرصة",
    type: "يومي",
    date: "2026-02-01T00:00:00.000Z",
    opportunitiesPenalty: 1,
    dismissalGrade: null,
  });
  const result = recalculatedStudent(
    state({
      students: [student({ opportunities: 1, baseOpportunities: 1 })],
      exams: [absentExam],
      grades: [grade({ status: "غائب", score: null, examId: absentExam.id })],
      chapters: [{ id: "chapter-1", name: "الفصل الأول", opportunities: 1 }],
    }),
  );
  assert.equal(result.status, "نشط");
  assert.equal(result.opportunities, 0);
  console.log("✅ الغياب الذي يستهلك آخر فرصة يوصل الرصيد إلى صفر بدون فصل");
}

{
  const firstExam = exam({
    id: "exam-zero-1",
    name: "امتحان الوصول إلى صفر",
    type: "يومي",
    date: "2026-02-01T00:00:00.000Z",
    opportunitiesPenalty: 1,
    dismissalGrade: null,
  });
  const secondExam = exam({
    id: "exam-zero-2",
    name: "امتحان المخالفة بدون فرص",
    type: "يومي",
    date: "2026-02-02T00:00:00.000Z",
    opportunitiesPenalty: 1,
    dismissalGrade: null,
  });
  const result = recalculatedStudent(
    state({
      students: [student({ opportunities: 1, baseOpportunities: 1 })],
      exams: [firstExam, secondExam],
      grades: [
        grade({
          id: "grade-zero-1",
          examId: firstExam.id,
          score: 10,
          createdAt: firstExam.date,
          updatedAt: firstExam.date,
        }),
        grade({
          id: "grade-zero-2",
          examId: secondExam.id,
          score: 10,
          createdAt: secondExam.date,
          updatedAt: secondExam.date,
        }),
      ],
      chapters: [{ id: "chapter-1", name: "الفصل الأول", opportunities: 1 }],
    }),
  );
  assert.equal(result.status, "مفصول");
  assert.equal(result.opportunities, 0);
  assert.match(result.dismissalReason, /بعد انتهاء الفرص|بدون فرص/);
  assert.equal(
    classifyGradeImpact(grade({ score: 10 }), secondExam, 0).type,
    "dismissal",
  );
  console.log("✅ مخالفة خصم جديدة عند رصيد صفر تفصل بدون إنشاء رصيد سالب");
}

{
  const highPenaltyExam = exam({
    type: "يومي",
    opportunitiesPenalty: 3,
    dismissalGrade: null,
  });
  const result = recalculatedStudent(
    state({
      students: [student({ opportunities: 1, baseOpportunities: 1 })],
      exams: [highPenaltyExam],
      grades: [grade({ score: 10 })],
      chapters: [{ id: "chapter-1", name: "الفصل الأول", opportunities: 1 }],
    }),
  );
  assert.equal(result.status, "نشط");
  assert.equal(result.opportunities, 0);
  console.log("✅ حتى لو كانت عقوبة الحدث أكبر من الرصيد، الوصول من رصيد موجب إلى صفر لا يفصل");
}

{
  const oneManualDeduction = recalculatedStudent(
    state({
      students: [student({ opportunities: 1, baseOpportunities: 1 })],
      grades: [],
      chapters: [{ id: "chapter-1", name: "الفصل الأول", opportunities: 1 }],
      opportunityLogs: [
        {
          id: "manual-1",
          studentId: "student-1",
          examId: "",
          action: "خصم",
          amount: 1,
          reason: "خصم يدوي أول",
          date: "2026-02-01",
          chapterId: "chapter-1",
          chapterNameSnapshot: "الفصل الأول",
        },
      ],
    }),
  );
  assert.equal(oneManualDeduction.status, "نشط");
  assert.equal(oneManualDeduction.opportunities, 0);

  const secondManualDeduction = recalculatedStudent(
    state({
      students: [student({ opportunities: 1, baseOpportunities: 1 })],
      grades: [],
      chapters: [{ id: "chapter-1", name: "الفصل الأول", opportunities: 1 }],
      opportunityLogs: [
        {
          id: "manual-1",
          studentId: "student-1",
          examId: "",
          action: "خصم",
          amount: 1,
          reason: "خصم يدوي أول",
          date: "2026-02-01",
          chapterId: "chapter-1",
          chapterNameSnapshot: "الفصل الأول",
        },
        {
          id: "manual-2",
          studentId: "student-1",
          examId: "",
          action: "خصم",
          amount: 1,
          reason: "خصم يدوي جديد والطالب بدون فرص",
          date: "2026-02-02",
          chapterId: "chapter-1",
          chapterNameSnapshot: "الفصل الأول",
        },
      ],
    }),
  );
  assert.equal(secondManualDeduction.status, "مفصول");
  assert.equal(secondManualDeduction.opportunities, 0);
  assert.match(secondManualDeduction.dismissalReason, /خصم يدوي/);

  const undoneZeroBalanceDeduction = recalculatedStudent(
    state({
      students: [student({ opportunities: 1, baseOpportunities: 1 })],
      grades: [],
      chapters: [{ id: "chapter-1", name: "الفصل الأول", opportunities: 1 }],
      opportunityLogs: [
        {
          id: "manual-1",
          studentId: "student-1",
          examId: "",
          action: "خصم",
          amount: 1,
          reason: "خصم يدوي أول",
          date: "2026-02-01",
          chapterId: "chapter-1",
          chapterNameSnapshot: "الفصل الأول",
        },
        {
          id: "manual-2",
          studentId: "student-1",
          examId: "",
          action: "خصم",
          amount: 1,
          reason: "خصم تم التراجع عنه لاحقاً",
          date: "2026-02-02",
          chapterId: "chapter-1",
          chapterNameSnapshot: "الفصل الأول",
        },
        {
          id: "manual-undo-2",
          studentId: "student-1",
          examId: "",
          action: "إضافة",
          amount: 1,
          reason: "تراجع موثق عن خصم [undo-ref:manual-2]",
          date: "2026-02-03",
          chapterId: "chapter-1",
          chapterNameSnapshot: "الفصل الأول",
        },
      ],
    }),
  );
  assert.equal(undoneZeroBalanceDeduction.status, "نشط");
  assert.equal(undoneZeroBalanceDeduction.opportunities, 1);
  console.log("✅ التراجع الموثق عن خصم الصفر يلغي أثر الفصل أيضاً");
}

{
  const firstExam = exam({
    id: "exam-final-chance-1",
    name: "امتحان الفرصة بعد إعادة التفعيل",
    type: "يومي",
    date: "2026-02-01T00:00:00.000Z",
    opportunitiesPenalty: 1,
    dismissalGrade: null,
  });
  const secondExam = exam({
    id: "exam-final-chance-2",
    name: "امتحان المخالفة التالية",
    type: "يومي",
    date: "2026-02-02T00:00:00.000Z",
    opportunitiesPenalty: 1,
    dismissalGrade: null,
  });
  const thirdExam = exam({
    id: "exam-final-chance-3",
    name: "امتحان المخالفة عند الصفر",
    type: "يومي",
    date: "2026-02-03T00:00:00.000Z",
    opportunitiesPenalty: 1,
    dismissalGrade: null,
  });
  const priorDismissalExam = exam({
    id: "exam-prior-dismissal",
    name: "امتحان الفصل السابق",
    type: "فاينل",
    date: "2026-01-30T00:00:00.000Z",
    dismissalGrade: 20,
  });
  const priorDismissalGrade = grade({
    id: "grade-prior-dismissal",
    examId: priorDismissalExam.id,
    score: 10,
    createdAt: priorDismissalExam.date,
    updatedAt: priorDismissalExam.date,
  });
  const reactivationGrantLog = {
    id: "final-chance",
    studentId: "student-1",
    examId: "",
    action: "إعادة تفعيل بفرصتين",
    amount: 2,
    reason: "إرجاع الطالب بعد إعادة التفعيل بفرصتين [academic-reactivation-link:sourceGradeId=grade-prior-dismissal&sourceExamId=exam-prior-dismissal]",
    date: "2026-01-31",
    chapterId: "chapter-1",
    chapterNameSnapshot: "الفصل الأول",
  };

  const afterUsingChance = recalculatedStudent(
    state({
      students: [student({ opportunities: 2, baseOpportunities: 3 })],
      exams: [priorDismissalExam, firstExam],
      grades: [
        priorDismissalGrade,
        grade({
          id: "grade-final-chance-1",
          examId: firstExam.id,
          score: 10,
          createdAt: firstExam.date,
          updatedAt: firstExam.date,
        }),
      ],
      opportunityLogs: [reactivationGrantLog],
    }),
  );
  assert.equal(afterUsingChance.status, "نشط");
  assert.equal(afterUsingChance.opportunities, 1);

  const afterNextViolation = recalculatedStudent(
    state({
      students: [student({ opportunities: 2, baseOpportunities: 3 })],
      exams: [priorDismissalExam, firstExam, secondExam],
      grades: [
        priorDismissalGrade,
        grade({
          id: "grade-final-chance-1",
          examId: firstExam.id,
          score: 10,
          createdAt: firstExam.date,
          updatedAt: firstExam.date,
        }),
        grade({
          id: "grade-final-chance-2",
          examId: secondExam.id,
          score: 10,
          createdAt: secondExam.date,
          updatedAt: secondExam.date,
        }),
      ],
      opportunityLogs: [reactivationGrantLog],
    }),
  );
  assert.equal(afterNextViolation.status, "نشط");
  assert.equal(afterNextViolation.opportunities, 0);

  const afterZeroViolation = recalculatedStudent(
    state({
      students: [student({ opportunities: 2, baseOpportunities: 3 })],
      exams: [priorDismissalExam, firstExam, secondExam, thirdExam],
      grades: [
        priorDismissalGrade,
        grade({ id: "grade-final-chance-1", examId: firstExam.id, score: 10, createdAt: firstExam.date, updatedAt: firstExam.date }),
        grade({ id: "grade-final-chance-2", examId: secondExam.id, score: 10, createdAt: secondExam.date, updatedAt: secondExam.date }),
        grade({ id: "grade-final-chance-3", examId: thirdExam.id, score: 10, createdAt: thirdExam.date, updatedAt: thirdExam.date }),
      ],
      opportunityLogs: [reactivationGrantLog],
    }),
  );
  assert.equal(afterZeroViolation.status, "مفصول");
  assert.equal(afterZeroViolation.opportunities, 0);
  assert.equal(afterZeroViolation.dismissalType, "فصل");
  console.log("✅ إعادة التفعيل تمنح فرصتين؛ الوصول إلى صفر يبقي الطالب نشطاً والمخالفة اللاحقة تفصله");
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
