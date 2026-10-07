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
const phoneQr = loadTypeScriptModule("src/lib/call-phone-qr.ts");
const classification = loadTypeScriptModule("src/lib/grade-classification.ts");
const batch = loadTypeScriptModule("src/lib/call-batch.ts");
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
  gracePeriods: [],
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

test("phone QR handoff dials the local 07 number (no +964 for Android to show as extra digits)", () => {
  assert.equal(
    phoneQr.callPhoneQrValue("0770 123 4567"),
    "tel:07701234567",
  );
  assert.equal(
    phoneQr.callPhoneQrValue("٠٧٨١٢٣٤٥٦٧٨"),
    "tel:07812345678",
  );
  for (const stored of ["+964 750 123 4567", "00964 750 123 4567", "9647501234567", "7501234567"]) {
    assert.equal(phoneQr.callPhoneQrValue(stored), "tel:07501234567", stored);
  }
  assert.equal(phoneQr.callPhoneQrValue(""), "");
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
      student: {
        ...student,
        createdAt: "2026-08-09",
        gracePeriods: [{ startDate: "2026-08-09", endDate: "2026-08-11" }],
      },
      today,
    }),
    null,
  );
  // No hidden days: a new student without a grace period is accounted normally.
  assert.equal(
    absence.resolveCallAbsenceSource({
      exam,
      student: { ...student, createdAt: "2026-08-09" },
      today,
    }),
    "missing",
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

test("an active grade range keeps numeric grades inside it only", () => {
  const parsed = range.parseCallGradeRange("10", "30");
  assert.equal(range.callGradeMatchesRange(absentGrade, parsed), false);
  assert.equal(
    range.callGradeMatchesRange({ status: "غش", score: null }, parsed),
    false,
  );
  assert.equal(
    range.callGradeMatchesRange({ status: "درجة", score: 20 }, parsed),
    true,
  );
  assert.equal(
    range.callGradeMatchesRange({ status: "درجة", score: 31 }, parsed),
    false,
  );
  assert.equal(
    range.callGradeMatchesRange(absentGrade, range.parseCallGradeRange("", "")),
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
    assert.match(source, /attemptEvidenceStudentIds/);
  }
});

// The kinds «المخصومين» counts, as in the calls list and stats routes.
const DEDUCTED_KINDS = new Set(["absent-deducted", "absent-dismissal", "discounted", "dismissal", "cheating"]);
const deductionExam = { ...exam, type: "يومي", fullMark: 100, passMark: 50, discountMark: 20 };
function isDeducted({ grade, student: who = student, leaves = [], examOverride = deductionExam }) {
  const source = absence.resolveCallAbsenceSource({ grade, exam: examOverride, student: who, leaves, today });
  const effective = grade || (source === "missing"
    ? absence.buildImplicitCallAbsenceGrade({ studentId: who.id, examId: examOverride.id, examDate: examOverride.date })
    : undefined);
  if (!effective) return false;
  return DEDUCTED_KINDS.has(
    classification.classifyGradeAcademicImpact(effective, examOverride, { student: who, leaves }),
  );
}

test("«المخصومين» holds every student who missed the exam, cheated or failed into a deduction", () => {
  assert.equal(isDeducted({ grade: absentGrade }), true, "recorded absence");
  assert.equal(isDeducted({ grade: undefined }), true, "no grade ever entered");
  assert.equal(
    isDeducted({ grade: undefined, student: { ...student, status: "مفصول" } }),
    true,
    "dismissed student who did not sit the exam",
  );
  assert.equal(isDeducted({ grade: { status: "غش", score: null } }), true, "cheating");
  assert.equal(isDeducted({ grade: { status: "درجة", score: 20 } }), true, "at the deduction mark");
});

test("«المخصومين» leaves out leave, grace, passes and fails above the deduction mark", () => {
  assert.equal(
    isDeducted({
      grade: undefined,
      leaves: [{ studentId: student.id, examId: exam.id, leaveType: "exam", date: exam.date }],
    }),
    false,
    "leave for the exam",
  );
  assert.equal(
    isDeducted({
      grade: undefined,
      student: { ...student, gracePeriods: [{ startDate: "2026-08-01", endDate: "2026-08-20", active: true }] },
    }),
    false,
    "within a grace period",
  );
  assert.equal(isDeducted({ grade: { status: "درجة", score: 35 } }), false, "fail above the deduction mark");
  assert.equal(isDeducted({ grade: { status: "درجة", score: 80 } }), false, "pass");
  assert.equal(isDeducted({ grade: { status: "مجاز", score: null } }), false, "excused");
});

test("«دفعات»: who still needs a call, and the next batch in list order", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");
  const hoursAgo = (h) => new Date(now.getTime() - h * 3600_000).toISOString();
  assert.equal(batch.callCaseOpenForBatch(undefined, now), true, "nobody called yet");
  assert.equal(batch.callCaseOpenForBatch({ status: "" }, now), true, "an action taken back");
  assert.equal(batch.callCaseOpenForBatch({ status: "تم الاتصال" }, now), false);
  assert.equal(batch.callCaseOpenForBatch({ status: "الرقم خاطئ" }, now), false);
  assert.equal(batch.callCaseOpenForBatch({ status: "", completed: true }, now), false, "legacy completed row");
  assert.equal(batch.callCaseOpenForBatch({ status: "لم يرد", actedAt: hoursAgo(0.5) }, now), false, "«لم يرد» half an hour ago waits");
  assert.equal(batch.callCaseOpenForBatch({ status: "لم يرد", actedAt: hoursAgo(1) }, now), true, "«لم يرد» an hour ago comes back");
  assert.equal(batch.callCaseOpenForBatch({ status: "لم يرد", actedAt: null, createdAt: hoursAgo(30) }, now), true, "old rows use their creation time");
  assert.equal(batch.CALL_BATCH_SIZE, 10);
  assert.equal(batch.CALL_WINDOW_TTL_MS, 2 * 60 * 1000);
  assert.equal(batch.CALL_WINDOW_AWAY_MS, 15 * 60 * 1000);
  assert.equal(batch.CALL_NO_ANSWER_RETRY_MS, 60 * 60 * 1000);
  const ids = Array.from({ length: 15 }, (_, i) => `s${i}`);
  assert.deepEqual(batch.pickCallBatch(ids, new Set(["s0", "s2"]), 4), ["s1", "s3", "s4", "s5"]);
  assert.equal(batch.pickCallBatch(ids, new Set()).length, 10);
  assert.deepEqual(batch.pickCallBatch(ids, new Set(ids)), []);
  assert.equal(batch.parseCallWindowId("3b1f2c4e-1111-4a2b-9c3d-0123456789ab"), "3b1f2c4e-1111-4a2b-9c3d-0123456789ab");
  assert.equal(batch.parseCallWindowId("short"), null);
  assert.equal(batch.parseCallWindowId("bad id with spaces"), null);
  assert.equal(batch.callWindowAlive(hoursAgo(1 / 60), now), true, "a beat a minute ago");
  assert.equal(batch.callWindowAlive(hoursAgo(3 / 60), now), false, "silent for three minutes");
  assert.equal(batch.callWindowAlive(hoursAgo(10 / 60), now, new Date(now.getTime() + 5 * 60 * 1000)), true, "away on a call");
  assert.equal(batch.callWindowAlive(hoursAgo(20 / 60), now, hoursAgo(1 / 60)), false, "away past its grace");
});
