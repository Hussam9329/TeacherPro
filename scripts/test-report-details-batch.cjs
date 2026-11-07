// The HTML report of «إدارة الفرص» reads its students in batches from
// /api/students/report-details. Each student there must carry exactly the
// report fields /api/students/profile-log gives for the same student, and the
// number of reads must not grow with the number of students.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const date = (value) => new Date(value);

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename,
);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, isMain, options);
};

// Made-up data only.
const students = [
  { id: "s1", name: "طالب أول", code: "T-1", courseId: "course", status: "نشط", opportunities: 3, baseOpportunities: 3,
    dismissalReason: "", dismissalNotes: "", phone: "07700000001", createdAt: date("2026-08-01T00:00:00Z") },
  { id: "s2", name: "طالب ثاني", code: "T-2", courseId: "course", status: "مفصول", opportunities: 0, baseOpportunities: 3,
    dismissalReason: "غياب", dismissalNotes: "", phone: "07700000002", createdAt: date("2026-08-02T00:00:00Z") },
  { id: "s3", name: "طالب ثالث", code: "T-3", courseId: "other", status: "نشط", opportunities: 3, baseOpportunities: 3,
    dismissalReason: "", dismissalNotes: "", phone: "07700000003", createdAt: date("2026-08-03T00:00:00Z") },
];
const chapter = { id: "chapter", name: "الفصل الحالي", opportunities: 3 };
const examBase = {
  type: "يومي", fullMark: 20, passMark: 15, discountMark: 0, opportunitiesPenalty: "1", dismissalGrade: null,
  noDiscount: false, active: true, scheduledActivateAt: null, telegramOpenAt: null, telegramCloseAt: null, mainSite: null,
};
const exams = [
  { ...examBase, id: "e1", name: "امتحان 1", date: date("2026-09-16T00:00:00Z"), courseIds: '["course"]', examCourses: [{ courseId: "course", chapterId: "chapter" }] },
  { ...examBase, id: "e2", name: "امتحان 2", date: date("2026-09-18T00:00:00Z"), courseIds: '["course"]', examCourses: [{ courseId: "course", chapterId: "chapter" }] },
  { ...examBase, id: "e3", name: "امتحان آخر", date: date("2026-09-17T00:00:00Z"), courseIds: '["other"]', examCourses: [{ courseId: "other", chapterId: "chapter" }] },
];
const gradeBase = { score: null, notes: "", academicAccountingChecked: true, academicEffectExcluded: false,
  academicEffectExclusionReason: null, academicEffectExclusionSource: null, smartNoteId: null };
const grades = [
  { ...gradeBase, id: "g1", studentId: "s1", examId: "e1", status: "غائب", createdAt: date("2026-09-19T05:00:00Z"), updatedAt: date("2026-09-19T05:00:00Z") },
  { ...gradeBase, id: "g2", studentId: "s2", examId: "e1", status: "غائب", createdAt: date("2026-09-19T06:00:00Z"), updatedAt: date("2026-09-19T06:00:00Z") },
  { ...gradeBase, id: "g3", studentId: "s3", examId: "e3", status: "حاضر", score: 18, createdAt: date("2026-09-19T07:00:00Z"), updatedAt: date("2026-09-19T07:00:00Z") },
];
const logBase = { requestedAmount: null, appliedAmount: null, balanceBefore: null, balanceAfter: null, reversalOfLogId: null,
  ledgerVersion: null, settledGradeIds: null, chapterId: "chapter", chapterNameSnapshot: "الفصل الحالي" };
const opportunityLogs = [
  { ...logBase, id: "l1", studentId: "s1", examId: "e1", action: "خصم تلقائي", amount: 1, reason: "تلقائي: غياب", date: date("2026-09-16T00:00:00Z") },
  { ...logBase, id: "l2", studentId: "s2", examId: null, action: "إضافة", amount: 1, reason: "سبب", date: date("2026-09-17T00:00:00Z") },
];
const leaves = [
  { id: "v1", studentId: "s1", examId: "e2", leaveType: "مرضية", reason: "سبب خاص", studyType: "", date: date("2026-09-18T00:00:00Z"),
    dateFrom: null, dateTo: null, notes: "", createdAt: date("2026-09-18T00:00:00Z") },
];
const notes = [
  { id: "n1", studentId: "s2", kind: "إجراء", text: "تم فصل الطالب", date: date("2026-09-20T00:00:00Z"), sourceType: null,
    sourceId: null, dismissalKey: "k", dismissalReason: "غياب", dismissalDate: date("2026-09-16T00:00:00Z") },
];
const calls = [
  { id: "c1", studentId: "s2", examId: "e2", category: "", target: "", phone: "", status: "", completed: false, completedAt: null,
    notes: "", noteResolved: false, createdAt: date("2026-09-19T00:00:00Z"), actedAt: null, actedByName: "" },
];
const links = [
  { id: "link", courseId: "course", chapterId: "chapter", active: true, archived: false, chapter },
  { id: "link2", courseId: "other", chapterId: "chapter", active: true, archived: false, chapter },
];

let permissions = ["grades.view", "opportunities.view", "follow-up.view"];
let inTransaction = false;
let reads = [];
const pick = (row, selection) => !selection ? row : Object.fromEntries(Object.entries(selection)
  .filter(([, enabled]) => enabled)
  .map(([key]) => [key, row[key]]));
const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => {
  if (key === "courseIds") return String(row.courseIds || "").includes(condition.contains);
  if (condition && typeof condition === "object" && !(condition instanceof Date)) {
    if ("in" in condition) return condition.in.includes(row[key]);
    if ("not" in condition) return row[key] !== condition.not;
    return true;
  }
  return row[key] === condition;
});
const table = (name, rows) => ({
  findMany: async (args = {}) => {
    assert.equal(inTransaction, true, `${name} must be read in the snapshot`);
    reads.push(name);
    let found = rows.filter((row) => matches(row, args.where));
    if (args.distinct) {
      const seen = new Set();
      found = found.filter((row) => {
        const key = args.distinct.map((field) => row[field]).join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return found.map((row) => pick(row, args.select));
  },
  findUnique: async ({ where, select }) => {
    reads.push(name);
    const row = rows.find((candidate) => candidate.id === where.id);
    return row ? pick(row, select) : null;
  },
});
const tx = {
  student: table("student", students),
  grade: table("grade", grades),
  gradeSmartNote: table("gradeSmartNote", []),
  exam: table("exam", exams),
  opportunityLog: table("opportunityLog", opportunityLogs),
  courseChapter: table("courseChapter", links),
  chapter: table("chapter", [chapter]),
  gracePeriod: table("gracePeriod", []),
  studentLeave: table("studentLeave", leaves),
  studentNote: table("studentNote", notes),
  studentCall: table("studentCall", calls),
  studentEnrollmentArchive: table("studentEnrollmentArchive", []),
  auditLog: table("auditLog", []),
};
const fakeDb = {
  $transaction: async (callback, options) => {
    assert.equal(options.isolationLevel, "RepeatableRead");
    inTransaction = true;
    try { return await callback(tx); } finally { inTransaction = false; }
  },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/db") return { db: fakeDb };
  if (request === "@/lib/server-auth") return {
    requireAnyPermissionPrincipal: async () => ({ permissions }),
    hasPermission: (principal, permission) => principal.permissions.includes(permission),
  };
  if (request === "@/lib/active-chapter-report") return {
    loadActiveChapterReportContext: async (_client, courseId) => ({
      id: chapter.id, name: chapter.name, since: null,
      examIds: exams.filter((exam) => exam.courseIds.includes(`"${courseId}"`)).map((exam) => exam.id),
    }),
  };
  return originalLoad.call(this, request, parent, isMain);
};

const single = require("../src/app/api/students/profile-log/route.ts");
const batch = require("../src/app/api/students/report-details/route.ts");
const { NextRequest } = require("next/server");

const REPORT_FIELDS = ["student", "currentChapter", "grades", "exams", "allCourseExams", "opportunityLogs",
  "opportunityCommandEffects", "studentLeaves", "reportContext"];
const reportPart = (body) => JSON.parse(JSON.stringify(Object.fromEntries(REPORT_FIELDS.map((key) => [key, body[key]]))));

(async () => {
  for (const access of [["grades.view", "opportunities.view", "follow-up.view"], ["grades.view"], ["students.view"]]) {
    permissions = access;
    reads = [];
    const response = await batch.GET(new NextRequest("http://localhost/api/students/report-details?ids=s1,s2,s3,missing"));
    assert.equal(response.status, 200);
    const body = await response.json();
    const batchReads = reads.length;
    assert.deepEqual(body.missing, ["missing"]);
    assert.equal(reads.includes("auditLog"), false, "a report never reads the audit log");
    for (const student of students) {
      const one = await single.GET(new NextRequest(`http://localhost/api/students/profile-log?studentId=${student.id}`));
      assert.equal(one.status, 200);
      assert.deepEqual(
        reportPart(body.students[student.id]),
        reportPart(await one.json()),
        `${student.id} (${access.join(",")}): the batch gives the same report fields as «ملف الطالب»`,
      );
    }

    // More students, the same number of reads per course.
    reads = [];
    await batch.GET(new NextRequest("http://localhost/api/students/report-details?ids=s1,s2"));
    const twoStudentsReads = reads.length;
    reads = [];
    await batch.GET(new NextRequest("http://localhost/api/students/report-details?ids=s1"));
    assert.equal(twoStudentsReads, reads.length, "reads do not grow with the students of one course");
    assert.ok(batchReads <= twoStudentsReads + 4, "a second course adds only its own course reads");
  }

  const tooMany = Array.from({ length: 101 }, (_, index) => `id${index}`).join(",");
  assert.equal((await batch.GET(new NextRequest(`http://localhost/api/students/report-details?ids=${tooMany}`))).status, 400);
  assert.equal((await batch.GET(new NextRequest("http://localhost/api/students/report-details"))).status, 400);

  // The opportunities export reads in batches, not one student at a time.
  const opportunities = fs.readFileSync(path.join(root, "src/components/teacher-pro/opportunities.tsx"), "utf8");
  const exporter = opportunities.slice(opportunities.indexOf("const fetchOpportunityStudentDetails"), opportunities.indexOf("return (\n    <div className=\"tp-opportunities-page"));
  assert.ok(exporter.includes("studentReportDetailsApi.get(ids)"), "the export reads batches");
  assert.equal(exporter.includes("studentProfileLogApi"), false, "the export no longer asks per student");
  assert.ok(exporter.includes("buildStudentDetailsFromProfileLog(profile)"), "the same builder makes the file");

  console.log("Report details batch: same report fields as the profile, flat reads, limits and the export path passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
