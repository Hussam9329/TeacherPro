import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AUTH_COOKIE_NAME, findUserByUsername, hasPermission, toAuthPrincipal, type AuthPrincipal } from "@/lib/server-auth";
import { readServerEnv } from "@/lib/bot-integration-auth";
import { baghdadDateKey } from "@/lib/baghdad-time";
import { mintCorrectionSession } from "@/lib/correction-integration-server";
import { findStudentsByName } from "@/lib/mirmaz-name-match";
import { POST as manualGradeEntry } from "@/app/api/grades/route";

/**
 * Grades from «Mirmaz Pro» go into TeacherPro as this account, through the
 * grade entry screen's own handler (same checks, recalculation and log).
 * It needs «إدخال درجات» (grades.add) and must not be an administrator or
 * supervisor; stopping the account stops the integration.
 */
export const MIRMAZ_ACCOUNT_USERNAME = (readServerEnv("MIRMAZ_ACCOUNT_USERNAME") || "mirmaz").trim().toLowerCase();

/** Prefix of the idempotency keys (CorrectionReceipt) of Mirmaz grades: `mirmaz-grade:<answerId>:<score>`. */
export const MIRMAZ_KEY_PREFIX = "mirmaz-grade:";
export const mirmazKey = (answerId: string, score: number) => `${MIRMAZ_KEY_PREFIX}${answerId}:${score}`;

export async function mirmazServicePrincipal(): Promise<{ principal: AuthPrincipal; userId: string } | { error: string }> {
  const user = await findUserByUsername(MIRMAZ_ACCOUNT_USERNAME);
  if (!user || !user.active) return { error: `حساب «${MIRMAZ_ACCOUNT_USERNAME}» غير موجود أو موقوف في «الحسابات».` };
  const principal = toAuthPrincipal(user);
  if (principal.isAdmin || principal.permissions.includes("system.oversight")) {
    return { error: `حساب «${MIRMAZ_ACCOUNT_USERNAME}» لازم يكون بصلاحية «إدخال درجات» بس، مو مدير ولا مشرف.` };
  }
  if (!hasPermission(principal, "grades.add")) return { error: `حساب «${MIRMAZ_ACCOUNT_USERNAME}» يحتاج صلاحية «إدخال درجات».` };
  return { principal, userId: user.id };
}

// ---------- The exam ----------

export type MirmazExam = { id: string; name: string; datetime: string; fullMark: number | null };

/**
 * The exam's day. Mirmaz names exams with their day («أ.حسن فلاح 10/24»)
 * while its own date is often when the exam was opened (the evening
 * before), so the day in the name wins; the date is the fallback.
 */
export function mirmazExamDay(exam: Pick<MirmazExam, "name" | "datetime">): string {
  const dated = String(exam.datetime || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const inName = String(exam.name || "").match(/(?:^|\D)(\d{1,2})\/(\d{1,2})(?:\D|$)/);
  if (inName) {
    const month = Number(inName[1]);
    const day = Number(inName[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = dated ? Number(dated[1]) : Number(baghdadDateKey(new Date()).slice(0, 4));
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return dated ? `${dated[1]}-${dated[2]}-${dated[3]}` : "";
}

const DAY_MS = 86_400_000;
const dayNumber = (key: string) => Date.parse(`${key}T00:00:00Z`) / DAY_MS;

type ExamRow = { id: string; name: string; dayKey: string; fullMark: number; courseIds: string[] };
export type ExamCandidate = { id: string; name: string; date: string; fullMark: number };

/** TeacherPro exams with the same full mark within a day of `day`, with their courses. */
export async function examsAround(day: string, fullMark: number | null, spreadDays = 1): Promise<ExamRow[]> {
  if (!day) return [];
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - (spreadDays + 1) * DAY_MS);
  const to = new Date(Date.parse(`${day}T00:00:00Z`) + (spreadDays + 2) * DAY_MS);
  const exams = await db.exam.findMany({
    where: { date: { gte: from, lt: to }, ...(fullMark ? { fullMark } : {}) },
    select: { id: true, name: true, date: true, fullMark: true, examCourses: { select: { courseId: true } } },
    orderBy: { date: "asc" },
  });
  return exams
    .map((exam) => ({
      id: exam.id,
      name: exam.name,
      dayKey: baghdadDateKey(exam.date),
      fullMark: exam.fullMark,
      courseIds: exam.examCourses.map((link) => link.courseId),
    }))
    .filter((exam) => Math.abs(dayNumber(exam.dayKey) - dayNumber(day)) <= spreadDays);
}

/** The one exam of this course on that day (or, if none that day, the one a day off); else every possibility. */
function examFor(courseId: string | null, day: string, exams: ExamRow[]): { exam: ExamRow | null; options: ExamRow[] } {
  const ofCourse = exams.filter((exam) => courseId && exam.courseIds.includes(courseId));
  const sameDay = ofCourse.filter((exam) => exam.dayKey === day);
  if (sameDay.length === 1) return { exam: sameDay[0], options: sameDay };
  if (sameDay.length > 1) return { exam: null, options: sameDay };
  return { exam: ofCourse.length === 1 ? ofCourse[0] : null, options: ofCourse };
}

const asCandidate = (exam: ExamRow): ExamCandidate => ({ id: exam.id, name: exam.name, date: exam.dayKey, fullMark: exam.fullMark });

// ---------- The student, then the place ----------

export type StudentCandidate = { id: string; name: string; code: string; course: string; matched: number; of: number; full: boolean };

export type Placement =
  | { kind: "sure"; studentId: string; examId: string; studentName: string; examName: string }
  | { kind: "hold"; reason: string; reasonText: string; candidates: StudentCandidate[]; examCandidates: ExamCandidate[] };

const MAX_CANDIDATES = 8;

/**
 * Where a Mirmaz grade goes: the student found by name exactly as «أداة
 * مرماز» finds one, and the one exam of that student's course on the exam's
 * day with the same full mark. Anything less than one certain student with
 * one certain exam is held for a person.
 */
export async function placeMirmazGrade(studentName: string, exam: MirmazExam): Promise<Placement> {
  const students = await db.student.findMany({
    where: { status: { not: "مؤرشف" } },
    select: { id: true, name: true, code: true, courseId: true, course: { select: { name: true } } },
  });
  const found = findStudentsByName(studentName, students);
  const candidates: StudentCandidate[] = found.slice(0, MAX_CANDIDATES).map((student) => ({
    id: student.id,
    name: student.name,
    code: student.code,
    course: student.course?.name || "",
    matched: student.nameMatch.matched,
    of: student.nameMatch.of,
    full: student.nameMatch.full,
  }));
  const day = mirmazExamDay(exam);
  const exams = await examsAround(day, exam.fullMark);
  const hold = (reason: string, reasonText: string, examOptions: ExamRow[] = exams): Placement => ({
    kind: "hold", reason, reasonText, candidates, examCandidates: examOptions.slice(0, MAX_CANDIDATES).map(asCandidate),
  });

  if (!found.length) return hold("STUDENT_NOT_FOUND", "ما لگيت طالب بهذا الاسم.");
  const full = found.filter((student) => student.nameMatch.full);
  if (!full.length) return hold("STUDENT_LIKELY", "ماكو اسم مطابق تماماً؛ الطلاب المحتملين بالقائمة.");

  // Several students with the very same name: the exam can still tell them
  // apart, when only one of them has this exam in their course.
  const placed = full.map((student) => ({ student, ...examFor(student.courseId, day, exams) }));
  const withExam = placed.filter((item) => item.exam);
  if (withExam.length === 1) {
    const { student, exam: target } = withExam[0];
    return { kind: "sure", studentId: student.id, examId: target!.id, studentName: student.name, examName: target!.name };
  }
  if (full.length > 1) {
    return hold("STUDENT_AMBIGUOUS", `أكثر من طالب بنفس الاسم (${full.length})؛ اختر الصحيح.`);
  }
  const only = placed[0];
  if (!day) return hold("EXAM_NO_DATE", "امتحان مرماز ما بيه تاريخ؛ اختر الامتحان.", only.options);
  if (only.options.length > 1) return hold("EXAM_AMBIGUOUS", "أكثر من امتحان يطابق بنفس اليوم؛ اختر الامتحان.", only.options);
  return hold("EXAM_NOT_FOUND", `ما لگيت امتحان بدورة الطالب بيوم ${day}${exam.fullMark ? ` من ${exam.fullMark}` : ""}.`);
}

/** The student and exam a grade was placed on, as the choices of a hold (preselected in «مرماز برو»). */
export async function placedChoices(studentId: string, examId: string): Promise<{ candidates: StudentCandidate[]; examCandidates: ExamCandidate[] }> {
  const [student, exam] = await Promise.all([
    db.student.findUnique({ where: { id: studentId }, select: { id: true, name: true, code: true, course: { select: { name: true } } } }),
    db.exam.findUnique({ where: { id: examId }, select: { id: true, name: true, date: true, fullMark: true } }),
  ]);
  return {
    candidates: student ? [{ id: student.id, name: student.name, code: student.code, course: student.course?.name || "", matched: 1, of: 1, full: true }] : [],
    examCandidates: exam ? [{ id: exam.id, name: exam.name, date: baghdadDateKey(exam.date), fullMark: exam.fullMark }] : [],
  };
}

// ---------- Saving through the grade entry screen ----------

export type SaveOutcome =
  | { ok: true; status: number; result: Record<string, unknown> }
  | { ok: false; status: number; error: string; code?: string };

/**
 * Saves the grade with the grade entry screen's own handler, as the user
 * whose session `cookie` carries (the Mirmaz account, or the person placing
 * a held grade).
 */
export async function saveThroughGradeEntry(requestUrl: string, cookie: string, studentId: string, examId: string, score: number): Promise<SaveOutcome> {
  const response = await manualGradeEntry(new NextRequest(new URL("/api/grades", requestUrl), {
    method: "POST",
    headers: new Headers({ "content-type": "application/json", cookie }),
    body: JSON.stringify({ studentId, examId, status: "درجة", score }),
  }));
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 201 || response.status === 202) return { ok: true, status: response.status, result };
  return {
    ok: false,
    status: response.status,
    error: String(result.error || result.message || "تعذر حفظ الدرجة."),
    code: typeof result.code === "string" ? result.code : undefined,
  };
}

export async function mirmazSessionCookie(userId: string): Promise<string> {
  return `${AUTH_COOKIE_NAME}=${await mintCorrectionSession(userId)}`;
}

/** The student and exam an earlier Mirmaz grade of this paper went to, if any (a re-correction). */
export async function earlierPlacement(answerId: string): Promise<{ studentId: string; examId: string } | null> {
  const resolved = await db.mirmazHold.findUnique({
    where: { answerId },
    select: { status: true, resolvedStudentId: true, resolvedExamId: true },
  });
  if ((resolved?.status === "RESOLVED" || resolved?.status === "SAVED") && resolved.resolvedStudentId && resolved.resolvedExamId) {
    return { studentId: resolved.resolvedStudentId, examId: resolved.resolvedExamId };
  }
  const receipt = await db.correctionReceipt.findFirst({
    where: { key: { startsWith: `${MIRMAZ_KEY_PREFIX}${answerId}:` }, response: { not: { contains: "\"pending\":true" } } },
    orderBy: { createdAt: "desc" },
    select: { studentId: true, examId: true, response: true },
  });
  if (!receipt) return null;
  try {
    const stored = JSON.parse(receipt.response) as { status?: number };
    return stored.status === 200 ? { studentId: receipt.studentId, examId: receipt.examId } : null;
  } catch {
    return null;
  }
}

export type HoldInput = {
  answerId: string;
  reason: string;
  reasonText: string;
  score: number;
  studentName: string;
  exam: MirmazExam;
  correctedBy: string;
  candidates: StudentCandidate[];
  examCandidates: ExamCandidate[];
};

export type SavedInput = {
  answerId: string;
  score: number;
  studentName: string;
  exam: MirmazExam;
  correctedBy: string;
  studentId: string;
  examId: string;
  /** Shown with it in «كل الدرجات»: "" for a plain grade, else what happened (a pending note, already there). */
  note: string;
};

/**
 * A grade that placed itself is kept on the paper's row too (status SAVED),
 * so «مرماز برو» lists every grade that came from Mirmaz, not only the held
 * ones. Never fails the delivery: the grade is already saved by now.
 */
export async function recordSavedMirmazGrade(input: SavedInput): Promise<void> {
  const data = {
    status: "SAVED",
    reason: "",
    reasonText: input.note.slice(0, 400),
    score: input.score,
    studentName: input.studentName.slice(0, 200),
    examName: input.exam.name.slice(0, 200),
    examDate: mirmazExamDay(input.exam),
    examFullMark: input.exam.fullMark,
    mzExamId: input.exam.id.slice(0, 40),
    correctedBy: input.correctedBy.slice(0, 120),
    candidates: "[]",
    examCandidates: "[]",
    resolvedStudentId: input.studentId,
    resolvedExamId: input.examId,
    resolvedByName: "تلقائي",
    resolvedAt: new Date(),
  };
  try {
    await db.mirmazHold.upsert({ where: { answerId: input.answerId }, create: { answerId: input.answerId, ...data }, update: data });
  } catch (error) {
    console.error("[mirmaz] could not record a saved grade:", error);
  }
}

/** Holds the paper's grade for «مرماز برو» (one hold per paper; a newer grade replaces the held one). */
export async function holdMirmazGrade(input: HoldInput): Promise<void> {
  const data = {
    status: "PENDING",
    reason: input.reason,
    reasonText: input.reasonText.slice(0, 400),
    score: input.score,
    studentName: input.studentName.slice(0, 200),
    examName: input.exam.name.slice(0, 200),
    examDate: mirmazExamDay(input.exam),
    examFullMark: input.exam.fullMark,
    mzExamId: input.exam.id.slice(0, 40),
    correctedBy: input.correctedBy.slice(0, 120),
    candidates: JSON.stringify(input.candidates),
    examCandidates: JSON.stringify(input.examCandidates),
    resolvedStudentId: null,
    resolvedExamId: null,
    resolvedByName: null,
    resolvedAt: null,
  };
  await db.mirmazHold.upsert({ where: { answerId: input.answerId }, create: { answerId: input.answerId, ...data }, update: data });
}
