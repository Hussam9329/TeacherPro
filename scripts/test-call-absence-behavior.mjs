import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createTypeScriptModuleLoader() {
  const cache = new Map();

  function resolveSource(specifier, parentFile) {
    const unresolved = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(parentFile), specifier)
        : null;
    if (!unresolved) return null;
    return [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`].find((candidate) =>
      fs.existsSync(candidate),
    ) || null;
  }

  function load(file) {
    const absoluteFile = path.resolve(file);
    if (cache.has(absoluteFile)) return cache.get(absoluteFile).exports;
    const moduleRecord = { exports: {} };
    cache.set(absoluteFile, moduleRecord);
    const compiled = ts.transpileModule(fs.readFileSync(absoluteFile, "utf8"), {
      fileName: absoluteFile,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        esModuleInterop: true,
      },
    }).outputText;
    const localRequire = (specifier) => {
      const resolved = resolveSource(specifier, absoluteFile);
      return resolved ? load(resolved) : require(specifier);
    };
    new Function("exports", "require", "module", "__filename", "__dirname", compiled)(
      moduleRecord.exports,
      localRequire,
      moduleRecord,
      absoluteFile,
      path.dirname(absoluteFile),
    );
    return moduleRecord.exports;
  }

  return (relativeFile) => load(path.join(root, relativeFile));
}

const loadTypeScriptModule = createTypeScriptModuleLoader();
const absence = loadTypeScriptModule("src/lib/call-absence.ts");
const identity = loadTypeScriptModule("src/lib/call-identity.ts");
const range = loadTypeScriptModule("src/lib/call-grade-range.ts");
const contact = loadTypeScriptModule("src/lib/call-contact-status.ts");
const notes = loadTypeScriptModule("src/lib/call-notes-filter.ts");
const candidatesSource = fs.readFileSync(
  path.join(root, "src/app/api/student-calls/candidates/route.ts"),
  "utf8",
);
const statsSource = fs.readFileSync(
  path.join(root, "src/app/api/student-calls/stats/route.ts"),
  "utf8",
);

const today = "2026-08-14";
const exam = {
  id: "exam-1",
  date: "2026-08-10",
  mainSite: "الكل",
  noDiscount: false,
  active: true,
};
const student = {
  id: "student-1",
  status: "نشط",
  createdAt: "2026-07-01",
  accountingGraceDays: 0,
  gracePeriodStartDate: null,
  mainSite: "بغداد",
  subSite: "المنصور",
  locationScope: "بغداد",
};
const absentGrade = {
  status: "غائب",
  score: null,
  academicEffectExcluded: false,
};

test("contact status filters normalize known values and reject unknown values", () => {
  assert.equal(contact.normalizeContactStatusFilter("contacted"), "contacted");
  assert.equal(contact.normalizeContactStatusFilter("no-action"), "no-action");
  assert.equal(contact.normalizeContactStatusFilter("unexpected"), "all");
  assert.equal(contact.normalizeContactStatusFilter(null), "all");
});

test("legacy completed calls remain compatible with the contacted filter", () => {
  assert.equal(
    contact.normalizeContactStatus({ status: "", completed: true }),
    "تم الاتصال",
  );
  assert.equal(
    contact.normalizeContactStatus({ status: "حالة قديمة", completed: false }),
    "",
  );
});

test("every contact filter matches only its intended status", () => {
  assert.equal(contact.contactStatusMatchesFilter("all", "لم يرد"), true);
  assert.equal(contact.contactStatusMatchesFilter("no-action", ""), true);
  assert.equal(
    contact.contactStatusMatchesFilter("contacted", "تم الاتصال"),
    true,
  );
  assert.equal(contact.contactStatusMatchesFilter("unanswered", "لم يرد"), true);
  assert.equal(contact.contactStatusMatchesFilter("wrong", "الرقم خاطئ"), true);
  assert.equal(contact.contactStatusMatchesFilter("wrong", "لم يرد"), false);
});

test("notes filter accepts only the supported value", () => {
  assert.equal(notes.normalizeCallNotesFilter("with-notes"), "with-notes");
  assert.equal(notes.normalizeCallNotesFilter("all"), "all");
  assert.equal(notes.normalizeCallNotesFilter("unexpected"), "all");
  assert.equal(notes.normalizeCallNotesFilter(null), "all");
});

test("notes filter counts only non-empty manual student notes", () => {
  assert.equal(
    notes.hasManualCallNote({
      category: notes.CALL_STUDENT_NOTE_CATEGORY,
      notes: "ملاحظة متابعة",
    }),
    true,
  );
  assert.equal(
    notes.hasManualCallNote({
      category: notes.CALL_STUDENT_NOTE_CATEGORY,
      notes: "   ",
    }),
    false,
  );
  assert.equal(
    notes.hasManualCallNote({
      category: "grade:example",
      notes: "نص تلقائي لإجراء الاتصال",
    }),
    false,
  );
});

test("stored absent remains absent for inactive and no-discount exams", () => {
  assert.equal(
    absence.resolveCallAbsenceSource({
      grade: absentGrade,
      exam: { ...exam, active: false, noDiscount: true },
      student,
      today,
    }),
    "recorded",
  );
});

test("a student without a Grade is a read-only absence candidate", () => {
  assert.equal(
    absence.resolveCallAbsenceSource({ exam, student, today }),
    "missing",
  );
  const virtualGrade = absence.buildImplicitCallAbsenceGrade({
    studentId: student.id,
    examId: exam.id,
    examDate: exam.date,
  });
  assert.equal(virtualGrade.status, "غائب");
  assert.equal(virtualGrade.score, null);
  assert.equal(
    virtualGrade.id,
    absence.implicitCallAbsenceGradeId(student.id, exam.id),
  );
});

test("real numeric grades are not converted to absences", () => {
  assert.equal(
    absence.resolveCallAbsenceSource({
      grade: { status: "درجة", score: 20 },
      exam,
      student,
      today,
    }),
    null,
  );
});

test("dismissed students stay in follow-up while real attempt evidence is protected", () => {
  assert.equal(
    absence.resolveCallAbsenceSource({
      exam,
      student: { ...student, status: "مفصول" },
      today,
    }),
    "missing",
  );
  assert.equal(
    absence.resolveCallAbsenceSource({
      grade: absentGrade,
      exam,
      student: { ...student, status: "مفصول" },
      today,
    }),
    "recorded",
  );
  assert.equal(
    absence.resolveCallAbsenceSource({
      exam,
      student,
      hasAttemptEvidence: true,
      today,
    }),
    null,
  );
  for (const smartNoteStatus of ["PENDING", "CONFLICT", "PROCESSED", "REJECTED"]) {
    assert.equal(
      absence.resolveCallAbsenceSource({
        exam,
        student,
        // The route maps every scored note, regardless of resolution status,
        // to this evidence flag.
        hasAttemptEvidence: Boolean(smartNoteStatus),
        today,
      }),
      null,
    );
  }
});

test("today's explicit absence is visible but today's missing grade is not derived yet", () => {
  const todayExam = { ...exam, date: today };
  assert.equal(
    absence.resolveCallAbsenceSource({
      grade: absentGrade,
      exam: todayExam,
      student,
      today,
    }),
    "recorded",
  );
  assert.equal(
    absence.resolveCallAbsenceSource({ exam: todayExam, student, today }),
    null,
  );
});

test("future exams, leave, pre-registration, grace, archive and exclusion are protected", () => {
  assert.equal(
    absence.resolveCallAbsenceSource({
      exam: { ...exam, date: "2026-08-15" },
      student,
      today,
    }),
    null,
  );
  assert.equal(
    absence.resolveCallAbsenceSource({
      grade: absentGrade,
      exam,
      student,
      leaves: [{ examId: exam.id, leaveType: "exam", date: exam.date }],
      today,
    }),
    null,
  );
  assert.equal(
    absence.resolveCallAbsenceSource({
      exam,
      student: { ...student, createdAt: "2026-08-11" },
      today,
    }),
    null,
  );
  assert.equal(
    absence.resolveCallAbsenceSource({
      exam,
      student: { ...student, createdAt: "2026-08-09" },
      today,
    }),
    null,
  );
  assert.equal(
    absence.resolveCallAbsenceSource({
      exam,
      student: { ...student, status: "مؤرشف" },
      today,
    }),
    null,
  );
  assert.equal(
    absence.resolveCallAbsenceSource({
      grade: { ...absentGrade, academicEffectExcluded: true },
      exam,
      student,
      today,
    }),
    null,
  );
});

test("students outside the exam site are not implicit absences", () => {
  assert.equal(
    absence.resolveCallAbsenceSource({
      exam: { ...exam, mainSite: "البصرة" },
      student,
      today,
    }),
    null,
  );
});

test("absence filter ignores stale numeric range while numeric filters keep it", () => {
  const parsed = range.parseCallGradeRange("10", "30");
  assert.equal(
    range.callGradeMatchesRangeForStatus(absentGrade, parsed, "absent"),
    true,
  );
  assert.equal(
    range.callGradeMatchesRangeForStatus(
      { status: "غش", score: null },
      parsed,
      "cheating",
    ),
    true,
  );
  assert.equal(
    range.callGradeMatchesRangeForStatus(absentGrade, parsed, "all"),
    false,
  );
  assert.equal(
    range.callGradeMatchesRangeForStatus(
      { status: "درجة", score: 20 },
      parsed,
      "all",
    ),
    true,
  );
});

test("stable call identity survives derived absence becoming a numeric Grade", () => {
  const call = {
    studentId: student.id,
    examId: exam.id,
    category: "absent",
    status: "تم الاتصال",
  };
  assert.equal(
    identity.studentExamCallIdentityMatches(call, student.id, exam.id),
    true,
  );
  assert.equal(call.status, "تم الاتصال");
});

test("stable call identity survives leave restore with a new Grade id", () => {
  const call = {
    studentId: student.id,
    examId: exam.id,
    category: "grade:old-before-leave",
    status: "تم الاتصال",
  };
  const restoredGrade = { id: "new-after-leave", status: "غائب" };
  assert.notEqual(call.category, `grade:${restoredGrade.id}`);
  assert.equal(
    identity.studentExamCallIdentityMatches(call, student.id, exam.id),
    true,
  );
});

test("stable call identity survives Grade deletion and recreation", () => {
  const call = {
    studentId: student.id,
    examId: exam.id,
    category: "grade:deleted-grade",
    status: "لم يرد",
  };
  const recreatedGrade = { id: "recreated-grade", status: "درجة", score: 18 };
  assert.notEqual(call.category, `grade:${recreatedGrade.id}`);
  assert.equal(
    identity.studentExamCallIdentityMatches(call, student.id, exam.id),
    true,
  );
});

test("reload and second-tab category variants resolve to the same logical call key", () => {
  const oldTabCall = {
    studentId: student.id,
    examId: exam.id,
    category: "grade:old-tab",
  };
  const reloadedCall = {
    studentId: student.id,
    examId: exam.id,
    category: "absent",
  };
  assert.equal(
    identity.studentExamCallIdentityKey(oldTabCall.studentId, oldTabCall.examId),
    identity.studentExamCallIdentityKey(reloadedCall.studentId, reloadedCall.examId),
  );
  assert.equal(identity.isStudentExamCall(oldTabCall), true);
  assert.equal(
    identity.isStudentExamCall({
      studentId: student.id,
      examId: null,
      category: notes.CALL_STUDENT_NOTE_CATEGORY,
    }),
    false,
  );
});

test("site changes do not hide a stored absence, but site mismatch protects derived missing", () => {
  const mismatchedStudent = { ...student, mainSite: "البصرة", locationScope: "البصرة" };
  const siteExam = { ...exam, mainSite: "بغداد" };
  assert.equal(
    absence.resolveCallAbsenceSource({
      grade: absentGrade,
      exam: siteExam,
      student: mismatchedStudent,
      today,
    }),
    "recorded",
  );
  assert.equal(
    absence.resolveCallAbsenceSource({
      exam: siteExam,
      student: mismatchedStudent,
      today,
    }),
    null,
  );
});

test("candidate rows and stats protect all scored notes and submitted papers", () => {
  for (const source of [candidatesSource, statsSource]) {
    assert.match(source, /gradeSmartNote\.findMany/);
    assert.match(source, /score:\s*\{\s*not:\s*null\s*\}/);
    assert.doesNotMatch(source, /gradeSmartNote\.findMany\([\s\S]{0,180}status:\s*"PENDING"/);
    assert.match(source, /correctionSheet\.findMany/);
    assert.match(source, /telegramExamSubmission\.findMany/);
    assert.match(source, /pageCount:\s*\{\s*gt:\s*0\s*\}/);
    assert.match(source, /attemptEvidenceStudentIds/);
  }
});
