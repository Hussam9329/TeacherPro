import { baghdadDateKey } from "@/lib/baghdad-time";
import { examChapterExclusion } from "@/lib/exam-chapter-scope";
import { isExamOnOrAfterStudentRegistration } from "@/lib/exam-utils";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loadActiveGracePeriodsByStudent } from "@/lib/grace-periods-server";
import type { GracePeriodRange } from "@/lib/grace-periods";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { persistAcademicStudentResults } from "@/lib/academic-student-writeback-server";
import { historicalLeaveLogIds, recalculateWithLeaveReview, type LeaveDismissalReview } from "@/lib/leave-dismissal-review";
import { recalculateWithExamEditReview } from "@/lib/exam-dismissal-review";
import { recalculateWithGraceReview, type GraceDismissalReview } from "@/lib/grace-dismissal-review";
import {
  getActiveChapterForStudent,
  gradeHasAcademicEffect,
  isExamInStudentGracePeriod,
  isStudentExcusedForExam,
  isAutomaticOpportunityLog,
  isReactivationBalanceOpportunityLog,
  recalculateAcademicState,
} from "@/lib/academic-engine";
import type {
  AcademicChapter,
  AcademicCourseChapter,
  AcademicExam,
  AcademicGrade,
  AcademicOpportunityLog,
  AcademicOpportunityCommandEffect,
  AcademicStateInput,
  AcademicStudent,
  AcademicStudentLeave,
  AcademicStudentNote,
} from "@/lib/academic-types";

type PrismaClientLike = typeof db | Prisma.TransactionClient;

export interface AcademicServerRecalculationResult {
  studentIds: string[];
  students: AcademicStudent[];
  opportunityLogs: AcademicOpportunityLog[];
  automaticOpportunityLogs: AcademicOpportunityLog[];
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function dateString(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  }
  return String(value || "");
}

function nullableText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function normalizeOpportunityPenalty(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function mapStudent(student: {
  id: string;
  courseId: string;
  mainSite?: string | null;
  subSite?: string | null;
  locationScope?: string | null;
  status: string;
  dismissalReason: string | null;
  dismissalNotes: string | null;
  opportunities: number;
  baseOpportunities: number;
  createdAt: Date;
}, gracePeriods: GracePeriodRange[] = []): AcademicStudent {
  return {
    id: student.id,
    courseId: student.courseId,
    mainSite: student.mainSite || null,
    subSite: student.subSite || null,
    locationScope: student.locationScope || null,
    status: student.status === "مفصول" || student.status === "مؤرشف" ? student.status : "نشط",
    dismissalReason: nullableText(student.dismissalReason),
    dismissalNotes: nullableText(student.dismissalNotes),
    opportunities: Number(student.opportunities || 0),
    baseOpportunities: Number(student.baseOpportunities || 0),
    createdAt: dateString(student.createdAt),
    gracePeriods,
  };
}

export function toAcademicExam(exam: {
  id: string;
  name: string;
  type: string;
  date: Date;
  fullMark: number;
  passMark: number;
  discountMark: number;
  opportunitiesPenalty: string;
  dismissalGrade: number | null;
  noDiscount: boolean;
  active: boolean;
  scheduledActivateAt: Date | null;
  telegramOpenAt?: Date | null;
  telegramCloseAt?: Date | null;
  courseIds?: string;
  examCourses?: Array<{ courseId: string; chapterId: string | null }>;
  mainSite?: string | null;
}): AcademicExam {
  let parsedCourseIds: string[] = [];
  try {
    const parsed = JSON.parse(exam.courseIds || "[]");
    if (Array.isArray(parsed)) parsedCourseIds = parsed.map(String).filter(Boolean);
  } catch {
    // دعم نسخ قديمة خزنتها كقائمة مفصولة بفواصل.
    parsedCourseIds = String(exam.courseIds || "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return {
    id: exam.id,
    name: exam.name,
    type: exam.type === "تراكمي" || exam.type === "فاينل" ? exam.type : "يومي",
    date: dateString(exam.date),
    fullMark: Number(exam.fullMark || 0),
    passMark: Number(exam.passMark || 0),
    discountMark: Number(exam.discountMark || 0),
    opportunitiesPenalty: normalizeOpportunityPenalty(exam.opportunitiesPenalty),
    dismissalGrade: exam.dismissalGrade === null ? null : Number(exam.dismissalGrade),
    noDiscount: Boolean(exam.noDiscount),
    active: Boolean(exam.active),
    scheduledActivateAt: exam.scheduledActivateAt ? dateString(exam.scheduledActivateAt) : null,
    telegramOpenAt: exam.telegramOpenAt ? dateString(exam.telegramOpenAt) : null,
    telegramCloseAt: exam.telegramCloseAt ? dateString(exam.telegramCloseAt) : null,
    courseIds: parsedCourseIds,
    examCourses: exam.examCourses,
    mainSite: exam.mainSite || null,
  };
}

function mapGrade(grade: {
  id: string;
  studentId: string;
  examId: string;
  status: string;
  score: number | null;
  notes: string | null;
  academicEffectExcluded?: boolean;
  academicEffectExclusionReason?: string | null;
  academicEffectExclusionSource?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AcademicGrade {
  return {
    id: grade.id,
    studentId: grade.studentId,
    examId: grade.examId,
    status:
      grade.status === "غائب" ||
      grade.status === "غش" ||
      grade.status === "مجاز" ||
      grade.status === "ضمن فترة السماح" ||
      grade.status === "قبل تسجيل الطالب"
        ? grade.status
        : "درجة",
    score: grade.score === null ? null : Number(grade.score),
    notes: grade.notes,
    academicEffectExcluded: Boolean(grade.academicEffectExcluded),
    academicEffectExclusionReason: grade.academicEffectExclusionReason ?? null,
    academicEffectExclusionSource: grade.academicEffectExclusionSource ?? null,
    createdAt: dateString(grade.createdAt),
    updatedAt: dateString(grade.updatedAt),
  };
}

function mapOpportunityLog(log: {
  id: string;
  studentId: string;
  examId: string | null;
  action: string;
  amount: number;
  requestedAmount?: number | null;
  appliedAmount?: number | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  reversalOfLogId?: string | null;
  ledgerVersion?: number | null;
  settledGradeIds?: string | null;
  reason: string | null;
  date: Date;
  chapterId: string | null;
  chapterNameSnapshot?: string | null;
}): AcademicOpportunityLog {
  return {
    ...log,
    id: log.id,
    studentId: log.studentId,
    examId: nullableText(log.examId),
    action: log.action,
    amount: Number(log.amount || 0),
    reason: nullableText(log.reason),
    date: dateString(log.date),
    chapterId: nullableText(log.chapterId),
    chapterNameSnapshot: nullableText(log.chapterNameSnapshot),
  };
}

function mapStudentLeave(leave: {
  id: string;
  studentId: string;
  examId: string | null;
  leaveType: string;
  reason: string;
  studyType: string;
  date: Date;
  dateFrom: Date | null;
  dateTo: Date | null;
  notes: string;
}): AcademicStudentLeave {
  return {
    id: leave.id,
    studentId: leave.studentId,
    examId: nullableText(leave.examId),
    leaveType: leave.leaveType === "period" ? "period" : "exam",
    reason: leave.reason,
    studyType: leave.studyType,
    date: dateString(leave.date),
    dateFrom: dateString(leave.dateFrom || leave.date),
    dateTo: dateString(leave.dateTo || leave.dateFrom || leave.date),
    notes: leave.notes,
  };
}

function mapStudentNote(note: {
  id: string;
  studentId: string;
  kind: string;
  text: string;
  date: Date;
}): AcademicStudentNote {
  return {
    id: note.id,
    studentId: note.studentId,
    kind: note.kind,
    text: note.text,
    date: dateString(note.date),
  };
}

function mapCourseChapter(link: {
  id: string;
  courseId: string;
  chapterId: string;
  active: boolean;
  archived: boolean;
}): AcademicCourseChapter {
  return {
    id: link.id,
    courseId: link.courseId,
    chapterId: link.chapterId,
    active: Boolean(link.active),
    archived: Boolean(link.archived),
  };
}

function mapChapter(chapter: { id: string; name: string; opportunities: number }): AcademicChapter {
  return {
    id: chapter.id,
    name: chapter.name,
    opportunities: Number(chapter.opportunities || 0),
  };
}

/** Shared normalization for accounting and read-only profile snapshots. */
export interface AcademicStateRows {
  students: Array<Parameters<typeof mapStudent>[0] & { gracePeriods?: GracePeriodRange[] }>;
  grades: Array<Parameters<typeof mapGrade>[0]>;
  exams: Array<Parameters<typeof toAcademicExam>[0]>;
  courseChapters: Array<Parameters<typeof mapCourseChapter>[0]>;
  chapters: Array<Parameters<typeof mapChapter>[0]>;
  opportunityLogs: Array<Parameters<typeof mapOpportunityLog>[0]>;
  studentLeaves: Array<Parameters<typeof mapStudentLeave>[0]>;
  studentNotes: Array<Parameters<typeof mapStudentNote>[0]>;
  gracePeriodsByStudent?: ReadonlyMap<string, GracePeriodRange[]>;
}

export function buildAcademicStateFromRows(rows: AcademicStateRows): AcademicStateInput {
  return {
    students: rows.students.map((student) => mapStudent(
      student,
      rows.gracePeriodsByStudent?.get(student.id) || student.gracePeriods || [],
    )),
    grades: rows.grades.map(mapGrade),
    exams: rows.exams.map(toAcademicExam),
    courseChapters: rows.courseChapters.map(mapCourseChapter),
    chapters: rows.chapters.map(mapChapter),
    opportunityLogs: rows.opportunityLogs.map(mapOpportunityLog),
    studentLeaves: rows.studentLeaves.map(mapStudentLeave),
    studentNotes: rows.studentNotes.map(mapStudentNote),
  };
}

/** Explain only commands replayed by the authoritative engine. An unresolved
 * stored/replayed state disagreement must not become a guessed report balance. */
export function buildAcademicOpportunityCommandEffects(
  state: AcademicStateInput,
  studentId: string,
): AcademicOpportunityCommandEffect[] {
  const stored = state.students.find((student) => student.id === studentId);
  if (!stored || stored.status === "مؤرشف") return [];
  const activeChapter = getActiveChapterForStudent(stored, state.courseChapters, state.chapters);
  if (!activeChapter) return [];
  const manualLogs = state.opportunityLogs.filter((log) =>
    log.studentId === studentId && !isAutomaticOpportunityLog(log));
  const boundary = manualLogs.filter((log) => log.ledgerVersion === 2 &&
    log.chapterId === activeChapter.id &&
    (log.action === "إعادة تعيين" || isReactivationBalanceOpportunityLog(log)))
    .sort((a, b) => a.date.localeCompare(b.date) ||
      Number(a.action === "إعادة تعيين") - Number(b.action === "إعادة تعيين") ||
      a.id.localeCompare(b.id)).at(-1);
  const isBalanceCommand = (log: AcademicOpportunityLog) =>
    ["إضافة", "خصم", "إعادة تعيين"].includes(log.action) || isReactivationBalanceOpportunityLog(log);
  const currentGradeExamIds = new Set(state.grades.filter((grade) => grade.studentId === studentId).map((grade) => grade.examId));
  const segmentStart = boundary?.date || [
    ...manualLogs.filter((log) => log.ledgerVersion === 2 && log.chapterId === activeChapter.id && isBalanceCommand(log)).map((log) => log.date),
    ...state.exams.filter((exam) => currentGradeExamIds.has(exam.id) && !examChapterExclusion(exam, stored.courseId, activeChapter.id)).map((exam) => exam.date),
  ].filter(Boolean).sort()[0];
  // Legacy balance movements are applied before dated commands by the
  // engine. Explaining that mixed replay as calendar-ordered rows would be
  // misleading even when the final balance happens to match. Earlier
  // history covered by a structured settlement does not cause this fallback.
  if (manualLogs.some((log) => log.ledgerVersion !== 2 &&
      (!segmentStart || log.date >= segmentStart) && isBalanceCommand(log))) return [];
  if (boundary && manualLogs.some((log) => log.id !== boundary.id &&
      log.ledgerVersion === 2 && log.chapterId === activeChapter.id &&
      log.date === boundary.date && isBalanceCommand(log))) return [];
  const effects: AcademicOpportunityCommandEffect[] = [];
  try {
    const parsedIds: unknown = boundary?.settledGradeIds ? JSON.parse(boundary.settledGradeIds) : [];
    if (!Array.isArray(parsedIds) || !parsedIds.every((id) => typeof id === "string")) return [];
    const settledIds = new Set<string>(parsedIds);
    const exams = new Map(state.exams.map((exam) => [exam.id, exam]));
    // A replay initializes its latest fixed balance before processing any
    // unsettled earlier result. That order cannot explain calendar rows with
    // the result before the fixed-balance row, so do not project its commands.
    if (boundary && state.grades.some((grade) => {
      const exam = exams.get(grade.examId);
      return grade.studentId === studentId && !settledIds.has(grade.id) && exam &&
        baghdadDateKey(exam.date) < baghdadDateKey(boundary.date) &&
        !examChapterExclusion(exam, stored.courseId, activeChapter.id) &&
        gradeHasAcademicEffect(grade, exam) &&
        isExamOnOrAfterStudentRegistration(stored, exam) &&
        !isStudentExcusedForExam(state, stored.id, exam.id) &&
        !isExamInStudentGracePeriod(stored, exam);
    })) return [];
    const result = recalculateAcademicState(state, new Set([studentId]), {
      onOpportunityCommand: (effect) => effects.push(effect),
    });
    const calculated = result.students.find((student) => student.id === studentId);
    if (calculated?.opportunities !== stored.opportunities || calculated.status !== stored.status) return [];
    const settledExamIds = new Set(state.grades.filter((grade) =>
      grade.studentId === studentId && settledIds.has(grade.id)).map((grade) => grade.examId));
    const automaticEffects = (logs: AcademicOpportunityLog[]) => {
      const totals = new Map<string, number>();
      for (const log of logs) {
        if (log.studentId !== studentId || log.chapterId !== activeChapter.id ||
            !isAutomaticOpportunityLog(log) || settledExamIds.has(log.examId)) continue;
        const key = JSON.stringify([log.examId, log.action]);
        totals.set(key, (totals.get(key) || 0) + Number(log.appliedAmount ?? log.amount));
      }
      return JSON.stringify([...totals].sort(([a], [b]) => a.localeCompare(b)));
    };
    // The HTML uses saved deductions. Equal final balances alone cannot
    // justify a trace that silently changes those deductions between exams.
    return automaticEffects(state.opportunityLogs) === automaticEffects(result.opportunityLogs) ? effects : [];
  } catch {
    // An explanation must not turn an existing readable profile into a 500.
    // Do not log student data, ledger content, or the rejected input.
    console.warn("[profile-opportunity-effects] Academic replay explanation unavailable");
    return [];
  }
}

function automaticOpportunityLogWhere(studentIds: string[]): Prisma.OpportunityLogWhereInput {
  return {
    studentId: { in: studentIds },
    OR: [
      { action: { in: ["خصم تلقائي", "فصل تلقائي"] } },
      { reason: { startsWith: "تلقائي:" } },
    ],
  };
}

function chunks<T>(items: T[], size = 200): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function repairAcademicBaselinesForStudents(
  client: PrismaClientLike,
  studentIds: string[],
): Promise<number> {
  if (studentIds.length === 0) return 0;

  const students = await client.student.findMany({
    where: { id: { in: studentIds }, status: { not: "مؤرشف" } },
    select: { id: true, courseId: true, baseOpportunities: true },
  });
  if (students.length === 0) return 0;

  const courseIds = uniqueIds(students.map((student) => student.courseId));
  const activeLinks = await client.courseChapter.findMany({
    where: { courseId: { in: courseIds }, active: true, archived: false },
    select: { courseId: true, chapterId: true },
  });
  if (activeLinks.length === 0) return 0;

  const chapterIds = uniqueIds(activeLinks.map((link) => link.chapterId));
  const chapters = await client.chapter.findMany({
    where: { id: { in: chapterIds } },
    select: { id: true, opportunities: true },
  });
  const chapterOppById = new Map<string, number>(
    chapters.map((chapter) => [
      String(chapter.id),
      Number(chapter.opportunities || 0),
    ]),
  );
  const activeLinksByCourseId = new Map<string, typeof activeLinks>();
  for (const link of activeLinks) {
    const links = activeLinksByCourseId.get(link.courseId) || [];
    links.push(link);
    activeLinksByCourseId.set(link.courseId, links);
  }
  const baselineByCourseId = new Map<string, number>();
  for (const [courseId, links] of activeLinksByCourseId.entries()) {
    if (links.length !== 1) continue;
    const chapterOpportunities = Number(
      chapterOppById.get(String(links[0].chapterId)) ?? 0,
    );
    baselineByCourseId.set(
      String(courseId),
      Math.max(0, Math.trunc(chapterOpportunities)),
    );
  }

  let fixed = 0;
  const updateIdsByBaseline = new Map<number, string[]>();
  for (const student of students) {
    const courseId = String(student.courseId || "");
    const studentId = String(student.id || "");
    if (!studentId || !baselineByCourseId.has(courseId)) continue;
    const expectedBase = baselineByCourseId.get(courseId) ?? 0;
    if (Number(student.baseOpportunities || 0) === expectedBase) continue;
    const ids = updateIdsByBaseline.get(expectedBase) || [];
    ids.push(studentId);
    updateIdsByBaseline.set(expectedBase, ids);
  }

  for (const [baseOpportunities, ids] of updateIdsByBaseline.entries()) {
    for (const group of chunks(ids, 500)) {
      const update = await client.student.updateMany({
        where: { id: { in: group } },
        data: { baseOpportunities },
      });
      fixed += update.count;
    }
  }

  return fixed;
}

export async function loadAcademicStateForStudents(
  client: PrismaClientLike,
  studentIds: string[],
): Promise<AcademicStateInput> {
  const [
    students,
    grades,
    exams,
    courseChapters,
    chapters,
    opportunityLogs,
    studentLeaves,
    studentNotes,
    gracePeriodsByStudent,
  ] = await Promise.all([
    client.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        courseId: true,
        mainSite: true,
        subSite: true,
        locationScope: true,
        status: true,
        dismissalReason: true,
        dismissalNotes: true,
        opportunities: true,
        baseOpportunities: true,
        createdAt: true,
      },
    }),
    client.grade.findMany({
      where: { studentId: { in: studentIds } },
      select: {
        id: true,
        studentId: true,
        examId: true,
        status: true,
        score: true,
        notes: true,
        academicEffectExcluded: true,
        academicEffectExclusionReason: true,
        academicEffectExclusionSource: true,
        smartNoteId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    client.exam.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        date: true,
        fullMark: true,
        passMark: true,
        discountMark: true,
        opportunitiesPenalty: true,
        dismissalGrade: true,
        noDiscount: true,
        active: true,
        scheduledActivateAt: true,
        telegramOpenAt: true,
        telegramCloseAt: true,
        courseIds: true,
        examCourses: { select: { courseId: true, chapterId: true } },
        mainSite: true,
      },
    }),
    client.courseChapter.findMany({
      select: {
        id: true,
        courseId: true,
        chapterId: true,
        active: true,
        archived: true,
      },
    }),
    client.chapter.findMany({
      select: { id: true, name: true, opportunities: true },
    }),
    client.opportunityLog.findMany({
      where: { studentId: { in: studentIds } },
      select: {
        id: true,
        studentId: true,
        examId: true,
        action: true,
        amount: true,
        requestedAmount: true,
        appliedAmount: true,
        balanceBefore: true,
        balanceAfter: true,
        reversalOfLogId: true,
        ledgerVersion: true,
        settledGradeIds: true,
        reason: true,
        date: true,
        chapterId: true,
        chapterNameSnapshot: true,
      },
      orderBy: { date: "asc" },
    }),
    client.studentLeave.findMany({
      where: { studentId: { in: studentIds } },
      select: {
        id: true,
        studentId: true,
        examId: true,
        leaveType: true,
        reason: true,
        studyType: true,
        date: true,
        dateFrom: true,
        dateTo: true,
        notes: true,
      },
    }),
    client.studentNote.findMany({
      where: { studentId: { in: studentIds } },
      select: {
        id: true,
        studentId: true,
        kind: true,
        text: true,
        date: true,
      },
      orderBy: { date: "asc" },
    }),
    loadActiveGracePeriodsByStudent(client, studentIds),
  ]);

  return buildAcademicStateFromRows({
    students, grades, exams, courseChapters, chapters, opportunityLogs,
    studentLeaves, studentNotes, gracePeriodsByStudent,
  });
}

/** A settlement stops old grades from spending the new balance, but does not
 * erase the deductions that actually happened before it. Retain this evidence
 * only at persistence, after all academic/dismissal reviews have finished: a
 * saved historical dismissal must never become proof of a current dismissal.
 * The latest structured boundary and its exact grade IDs are authoritative;
 * dates alone, a legacy pledge, or an older boundary cannot settle a grade. */
function settledAutomaticHistory(
  state: AcademicStateInput,
  result: ReturnType<typeof recalculateAcademicState>,
  targetIds: Set<string>,
): AcademicOpportunityLog[] {
  const savedRows = new Set(state.opportunityLogs);
  const resultIds = new Set(result.opportunityLogs.map(log => log.id));
  const eventKey = (log: AcademicOpportunityLog) => JSON.stringify([
    log.studentId, log.examId,
  ]);
  // A live event's newly generated result wins over any older ID for it.
  const currentEvents = new Set(result.opportunityLogs
    .filter(log => isAutomaticOpportunityLog(log) && !savedRows.has(log))
    .map(eventKey));
  const logsByStudent = new Map<string, AcademicOpportunityLog[]>();
  const gradesByStudent = new Map<string, AcademicGrade[]>();
  for (const log of state.opportunityLogs) {
    const logs = logsByStudent.get(log.studentId) || [];
    logs.push(log);
    logsByStudent.set(log.studentId, logs);
  }
  for (const grade of state.grades) {
    const grades = gradesByStudent.get(grade.studentId) || [];
    grades.push(grade);
    gradesByStudent.set(grade.studentId, grades);
  }
  const retained: AcademicOpportunityLog[] = [];
  for (const student of state.students) {
    if (!targetIds.has(student.id)) continue;
    const chapter = getActiveChapterForStudent(student, state.courseChapters, state.chapters);
    if (!chapter) continue;
    const logs = logsByStudent.get(student.id) || [];
    const boundaries = logs.filter(log => !isAutomaticOpportunityLog(log) &&
      log.ledgerVersion === 2 && log.chapterId === chapter.id &&
      (log.action === "إعادة تعيين" || isReactivationBalanceOpportunityLog(log)))
      .sort((a, b) => a.date.localeCompare(b.date));
    const reset = boundaries.filter(log => log.action === "إعادة تعيين").at(-1);
    const grant = boundaries.filter(isReactivationBalanceOpportunityLog).at(-1);
    // Match the engine's tie rule: a reset wins over an equal-time grant.
    const boundary = reset && (!grant || reset.date >= grant.date) ? reset : grant;
    if (!boundary || !Number.isFinite(Date.parse(boundary.date))) continue;
    const balance = boundary.balanceAfter ?? boundary.amount;
    if (!Number.isSafeInteger(balance) || balance < 0) continue;
    let ids: unknown;
    try { ids = JSON.parse(boundary.settledGradeIds || "null"); }
    catch { continue; }
    if (!Array.isArray(ids) || !ids.every(id => typeof id === "string" && id.trim())) continue;
    const settledIds = new Set<string>(ids);
    const settledExams = new Set((gradesByStudent.get(student.id) || [])
      .filter(grade => settledIds.has(grade.id)).map(grade => grade.examId));
    for (const log of logs) {
      if (isAutomaticOpportunityLog(log) && log.chapterId === chapter.id &&
          settledExams.has(log.examId) && !resultIds.has(log.id) &&
          !currentEvents.has(eventKey(log)) && Number.isFinite(Date.parse(log.date)) &&
          Date.parse(log.date) <= Date.parse(boundary.date)) {
        retained.push(log);
      }
    }
  }
  return retained;
}

async function persistAcademicRecalculation(
  client: PrismaClientLike,
  studentIds: string[],
  result: ReturnType<typeof recalculateAcademicState>,
  preservedAutomaticIds: Set<string> = new Set(),
  previousLogs: AcademicOpportunityLog[] = [],
): Promise<AcademicServerRecalculationResult> {
  const targetStudentIds = new Set(studentIds);
  const students = result.students.filter((student) =>
    targetStudentIds.has(student.id),
  );
  const automaticOpportunityLogs = result.opportunityLogs.filter(
    (log) => targetStudentIds.has(log.studentId) && isAutomaticOpportunityLog(log),
  );

  await persistAcademicStudentResults(client, students);

  // Keep identical persisted rows, including their ledger metadata. Replaying
  // an exam must not delete and reinsert unrelated historical/pledge evidence.
  const previousById = new Map(previousLogs.map(log => [log.id, log]));
  const logSignature = (log: AcademicOpportunityLog) => JSON.stringify([
    log.studentId, log.examId || "", log.action,
    Math.max(0, Math.trunc(Number(log.amount || 0))), log.reason || "",
    log.date ? new Date(log.date).toISOString() : "",
    log.chapterId || "", log.chapterNameSnapshot || "",
  ]);
  for (const log of automaticOpportunityLogs) {
    const previous = previousById.get(log.id);
    if (previous && logSignature(previous) === logSignature(log)) {
      preservedAutomaticIds.add(log.id);
    }
  }

  if (studentIds.length > 0) {
    await client.opportunityLog.deleteMany({
      where: { ...automaticOpportunityLogWhere(studentIds), ...(preservedAutomaticIds.size ? { id: { notIn: [...preservedAutomaticIds] } } : {}) },
    });
  }

  const replacementLogs = automaticOpportunityLogs.filter(log => !preservedAutomaticIds.has(log.id));
  for (const group of chunks(replacementLogs, 500)) {
    await client.opportunityLog.createMany({
      data: group.map((log) => ({
        id: log.id,
        studentId: log.studentId,
        examId: log.examId || null,
        action: log.action,
        amount: Math.max(0, Math.trunc(Number(log.amount || 0))),
        reason: log.reason || null,
        date: log.date ? new Date(log.date) : new Date(),
        chapterId: log.chapterId || null,
        chapterNameSnapshot: log.chapterNameSnapshot || null,
      })),
      skipDuplicates: true,
    });
  }

  const persistedLogs = result.opportunityLogs
    .filter(log => targetStudentIds.has(log.studentId))
    .map(log => preservedAutomaticIds.has(log.id) ? previousById.get(log.id) || log : log);
  return {
    studentIds,
    students,
    opportunityLogs: persistedLogs,
    automaticOpportunityLogs: persistedLogs.filter(isAutomaticOpportunityLog),
  };
}

function examPeriodLeaveWhere(
  dates: Array<Date | string | null | undefined>,
): Prisma.StudentLeaveWhereInput[] {
  const periodLeaveWhere: Prisma.StudentLeaveWhereInput[] = [];
  const periodDayKeys = Array.from(
    new Set(
      dates
        .map((value) =>
          baghdadDateKey(value),
        )
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
    ),
  );
  for (const key of periodDayKeys) {
    const dayStart = new Date(`${key}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    periodLeaveWhere.push({
      leaveType: "period",
      dateFrom: { lt: dayEnd },
      dateTo: { gte: dayStart },
    });
  }

  return periodLeaveWhere;
}

/** Scope/availability edits can rewrite grade and leave markers. Capture the
 * actual old state for existing dependents and the courses that can gain new
 * markers; reconstructing old policy over already-mutated grades is unsafe. */
export async function loadExamEditHistoryState(
  client: PrismaClientLike,
  examId: string,
  courseIds: string[],
  periodLeaveDates: Array<Date | string | null | undefined> = [],
): Promise<AcademicStateInput> {
  const rows = await Promise.all([
    client.student.findMany({ where: { courseId: { in: uniqueIds(courseIds) } }, select: { id: true } })
      .then(students => students.map(student => ({ studentId: student.id }))),
    client.grade.findMany({ where: { examId }, select: { studentId: true } }),
    client.opportunityLog.findMany({ where: { examId }, select: { studentId: true } }),
    client.studentLeave.findMany({
      where: { OR: [{ examId }, ...examPeriodLeaveWhere(periodLeaveDates)] },
      select: { studentId: true },
    }),
    client.studentCall.findMany({ where: { examId }, select: { studentId: true } }),
    client.studentLeaveGradeBackup.findMany({ where: { examId }, select: { studentId: true } }),
  ]);
  return loadAcademicStateForStudents(client, uniqueIds(rows.flat().map(row => row.studentId)));
}

/** Capture real pre-edit evidence before an exam can move grade/leave scope.
 * Only dismissed students with an automatic contribution from this exam can
 * qualify for recovery; ordinary recalculation remains unchanged. */
export async function loadExamEditDismissalReviewState(
  client: PrismaClientLike,
  examId: string,
): Promise<AcademicStateInput | undefined> {
  const logs = await client.opportunityLog.findMany({
    where: { examId, action: { in: ["خصم تلقائي", "فصل تلقائي"] } },
    select: { studentId: true },
  });
  const ids = uniqueIds(logs.map(log => log.studentId));
  if (!ids.length) return undefined;
  const students = await client.student.findMany({
    where: { id: { in: ids }, status: "مفصول" },
    select: { id: true },
  });
  return students.length
    ? loadAcademicStateForStudents(client, students.map(student => student.id))
    : undefined;
}

function applyPreviewAcademicBaseline(
  state: AcademicStateInput,
  studentId: string,
): AcademicStateInput {
  const student = state.students.find((item) => item.id === studentId);
  if (!student) return state;
  const activeLinks = state.courseChapters.filter(
    (link) =>
      link.courseId === student.courseId && link.active && !link.archived,
  );
  if (activeLinks.length !== 1) return state;
  const chapter = state.chapters.find(
    (item) => item.id === activeLinks[0].chapterId,
  );
  if (!chapter) return state;
  const expectedBase = Math.max(
    0,
    Math.trunc(Number(chapter.opportunities || 0)),
  );
  if (student.baseOpportunities === expectedBase) return state;
  return {
    ...state,
    students: state.students.map((item) =>
      item.id === studentId
        ? { ...item, baseOpportunities: expectedBase }
        : item,
    ),
  };
}

export interface StudentAcademicUpdatePreview {
  studentId: string;
  current: {
    createdAt: string;
    opportunities: number;
    status: string;
    dismissalReason: string;
    automaticOpportunityLogs: number;
  };
  projected: {
    createdAt: string;
    opportunities: number;
    status: string;
    dismissalReason: string;
    automaticOpportunityLogs: number;
  };
}

/** Pure database-backed preview. It runs the same academic engine used by save,
 * but never persists students or logs. A grace change is previewed with the
 * same explicit dismissal review that its save applies. */
export async function previewStudentAcademicUpdate(
  studentId: string,
  changes: {
    createdAt?: Date;
    gracePeriods?: GracePeriodRange[];
  },
  options: { tx?: Prisma.TransactionClient; graceReview?: boolean } = {},
): Promise<StudentAcademicUpdatePreview | null> {
  const trimmedId = String(studentId || "").trim();
  if (!trimmedId) return null;
  const client = options.tx || db;
  const loadedState = await loadAcademicStateForStudents(client, [trimmedId]);
  const state = applyPreviewAcademicBaseline(loadedState, trimmedId);
  const storedStudent = state.students.find((student) => student.id === trimmedId);
  if (!storedStudent) return null;

  const currentResult = recalculateAcademicState(state, new Set([trimmedId]));
  const calculatedCurrent =
    currentResult.students.find((student) => student.id === trimmedId) ||
    storedStudent;

  const projectedStudent: AcademicStudent = {
    ...storedStudent,
    ...(changes.createdAt
      ? { createdAt: dateString(changes.createdAt) }
      : {}),
    ...(changes.gracePeriods !== undefined
      ? { gracePeriods: changes.gracePeriods }
      : {}),
  };
  const projectedState: AcademicStateInput = {
    ...state,
    students: state.students.map((student) =>
      student.id === trimmedId ? projectedStudent : student,
    ),
  };
  const projectedResult = options.graceReview
    ? recalculateWithGraceReview(projectedState, new Set([trimmedId]), { studentId: trimmedId })
    : recalculateAcademicState(projectedState, new Set([trimmedId]));
  const calculatedProjected =
    projectedResult.students.find((student) => student.id === trimmedId) ||
    projectedStudent;

  return {
    studentId: trimmedId,
    current: {
      createdAt: storedStudent.createdAt,
      opportunities: calculatedCurrent.opportunities,
      status: calculatedCurrent.status,
      dismissalReason: calculatedCurrent.dismissalReason || "",
      automaticOpportunityLogs: currentResult.opportunityLogs.filter(
        (log) => log.studentId === trimmedId && isAutomaticOpportunityLog(log),
      ).length,
    },
    projected: {
      createdAt: projectedStudent.createdAt,
      opportunities: calculatedProjected.opportunities,
      status: calculatedProjected.status,
      dismissalReason: calculatedProjected.dismissalReason || "",
      automaticOpportunityLogs: projectedResult.opportunityLogs.filter(
        (log) => log.studentId === trimmedId && isAutomaticOpportunityLog(log),
      ).length,
    },
  };
}

export async function recalculateStudentsAcademicState(
  rawStudentIds: Array<string | null | undefined>,
  options: {
    tx?: Prisma.TransactionClient;
    leaveReview?: LeaveDismissalReview;
    graceReview?: GraceDismissalReview;
    preserveHistoricalLogs?: boolean;
    previousPolicyExam?: AcademicExam;
    previousExamState?: AcademicStateInput;
    examEditReview?: { beforeState: AcademicStateInput; examId: string };
  } = {},
): Promise<AcademicServerRecalculationResult> {
  const transaction = options.tx;
  if (!transaction) {
    return withSerializableTransaction((tx) =>
      recalculateStudentsAcademicState(rawStudentIds, { ...options, tx }),
    );
  }
  const studentIds = uniqueIds(rawStudentIds);
  if (studentIds.length === 0) {
    return {
      studentIds: [],
      students: [],
      opportunityLogs: [],
      automaticOpportunityLogs: [],
    };
  }

  const client = transaction;
  await repairAcademicBaselinesForStudents(client, studentIds);
  const state = await loadAcademicStateForStudents(client, studentIds);
  const recalculableStudentIds = state.students
    .filter((student) => student.status !== "مؤرشف")
    .map((student) => student.id);
  if (recalculableStudentIds.length === 0) {
    return {
      studentIds: [],
      students: [],
      opportunityLogs: [],
      automaticOpportunityLogs: [],
    };
  }
  let result = options.graceReview
    ? recalculateWithGraceReview(state, new Set(recalculableStudentIds), options.graceReview)
    : recalculateWithLeaveReview(
        state,
        new Set(recalculableStudentIds),
        options.leaveReview,
      );
  if (options.examEditReview) {
    result = recalculateWithExamEditReview(
      state, new Set(recalculableStudentIds), result,
      options.examEditReview.beforeState, options.examEditReview.examId,
    );
    const previouslyDismissed = new Set(state.students.filter(student => student.status === "مفصول").map(student => student.id));
    const restored = result.students.filter(student => previouslyDismissed.has(student.id) && student.status === "نشط");
    const examName = state.exams.find(exam => exam.id === options.examEditReview?.examId)?.name || "الامتحان";
    for (const group of chunks(restored, 500)) {
      await client.studentNote.createMany({ data: group.map(student => ({
        studentId: student.id,
        kind: "إجراء",
        text: `استعادة الطالب بعد تعديل الامتحان «${examName}» وزوال سبب الفصل المرتبط به. الرصيد المحسوب: ${student.opportunities}؛ دون منح فرص إضافية.`,
        date: new Date(),
      })) });
    }
  }
  const preservedHistory = options.leaveReview || options.graceReview || options.preserveHistoricalLogs
    ? historicalLeaveLogIds(state, new Set(recalculableStudentIds))
    : new Set<string>();
  if (options.preserveHistoricalLogs && (options.previousPolicyExam || options.previousExamState)) {
    // Keep already-settled evidence omitted by BOTH genuine before/after
    // replays, while reconciling every event whose computed effect changed.
    const previousExam = options.previousPolicyExam;
    const beforeState = options.previousExamState || {
      ...state,
      exams: state.exams.map(exam => exam.id === previousExam?.id
        ? { ...previousExam, examCourses: exam.examCourses }
        : exam),
    };
    const beforeStudentIds = new Set(beforeState.students.map(student => student.id));
    const editedExamId = previousExam?.id || options.examEditReview?.examId;
    const beforeResult = recalculateAcademicState(beforeState, new Set(recalculableStudentIds));
    const beforeIds = new Set(beforeResult.opportunityLogs.map(log => log.id));
    const afterIds = new Set(result.opportunityLogs.map(log => log.id));
    // Legacy IDs can differ from replay IDs for the same live event.
    const eventKey = (log: AcademicOpportunityLog) => JSON.stringify([
      log.studentId, log.examId || "", log.action,
    ]);
    const replayedEvents = new Set([
      ...beforeResult.opportunityLogs, ...result.opportunityLogs,
    ].filter(isAutomaticOpportunityLog).map(eventKey));
    for (const log of state.opportunityLogs) {
      if (isAutomaticOpportunityLog(log) && beforeStudentIds.has(log.studentId) && log.examId !== editedExamId &&
          !beforeIds.has(log.id) && !afterIds.has(log.id) &&
          !replayedEvents.has(eventKey(log))) {
        preservedHistory.add(log.id);
      }
    }
  }
  if (options.preserveHistoricalLogs) {
    result.opportunityLogs = [
      ...result.opportunityLogs.filter(log => !preservedHistory.has(log.id)),
      ...state.opportunityLogs.filter(log => preservedHistory.has(log.id)),
    ];
  }
  const settledHistory = settledAutomaticHistory(state, result, new Set(recalculableStudentIds));
  for (const log of settledHistory) preservedHistory.add(log.id);
  result.opportunityLogs.push(...settledHistory);
  // Explicit leave/exam edits may remove only a proved obsolete exam dismissal.
  // Neither creates a grant nor promotes dismissed pending grades.
  return persistAcademicRecalculation(
    client,
    recalculableStudentIds,
    result,
    preservedHistory,
    state.opportunityLogs,
  );
}

/** Pure multi-student preview used by guarded maintenance routes. It reads the
 * same snapshot and runs the same engine as persistence, without repairing,
 * settling, updating, or deleting anything. */
export async function previewStudentsAcademicState(
  rawStudentIds: Array<string | null | undefined>,
  options: { tx?: Prisma.TransactionClient } = {},
): Promise<AcademicServerRecalculationResult> {
  const studentIds = uniqueIds(rawStudentIds);
  if (!studentIds.length) {
    return {
      studentIds: [],
      students: [],
      opportunityLogs: [],
      automaticOpportunityLogs: [],
    };
  }
  const state = await loadAcademicStateForStudents(options.tx || db, studentIds);
  const recalculableStudentIds = state.students
    .filter((student) => student.status !== "مؤرشف")
    .map((student) => student.id);
  const recalculableStudentIdSet = new Set(recalculableStudentIds);
  const result = recalculateAcademicState(state, recalculableStudentIdSet);
  return {
    studentIds: recalculableStudentIds,
    students: result.students.filter((student) =>
      recalculableStudentIdSet.has(student.id),
    ),
    opportunityLogs: result.opportunityLogs.filter((log) =>
      recalculableStudentIdSet.has(log.studentId),
    ),
    automaticOpportunityLogs: result.opportunityLogs.filter(
      (log) =>
        recalculableStudentIdSet.has(log.studentId) &&
        isAutomaticOpportunityLog(log),
    ),
  };
}

export async function recalculateStudentsForExam(
  examId: string,
  options: {
    tx?: Prisma.TransactionClient;
    periodLeaveDates?: Array<Date | string | null | undefined>;
    preserveHistoricalLogs?: boolean;
    previousPolicyExam?: AcademicExam;
    previousExamState?: AcademicStateInput;
    examEditReview?: { beforeState: AcademicStateInput; examId: string };
  } = {},
): Promise<AcademicServerRecalculationResult> {
  const trimmedExamId = String(examId || "").trim();
  if (!trimmedExamId) {
    return {
      studentIds: [],
      students: [],
      opportunityLogs: [],
      automaticOpportunityLogs: [],
    };
  }
  const client = options.tx || db;

  const periodLeaveWhere = examPeriodLeaveWhere(options.periodLeaveDates || []);

  const [
    grades,
    leaves,
    calls,
    opportunityLogs,
    leaveGradeBackups,
  ] = await Promise.all([
    client.grade.findMany({
      where: { examId: trimmedExamId },
      select: { studentId: true },
    }),
    client.studentLeave.findMany({
      where: {
        OR: [{ examId: trimmedExamId }, ...periodLeaveWhere],
      },
      select: { studentId: true },
    }),
    client.studentCall.findMany({
      where: { examId: trimmedExamId },
      select: { studentId: true },
    }),
    client.opportunityLog.findMany({
      where: { examId: trimmedExamId },
      select: { studentId: true },
    }),
    client.studentLeaveGradeBackup.findMany({
      where: { examId: trimmedExamId },
      select: { studentId: true },
    }),
  ]);
  return recalculateStudentsAcademicState(
    [
      ...grades.map((grade) => grade.studentId),
      ...leaves.map((leave) => leave.studentId),
      ...calls.map((call) => call.studentId),
      ...opportunityLogs.map((log) => log.studentId),
      ...leaveGradeBackups.map((backup) => backup.studentId),
    ],
    {
      tx: options.tx,
      preserveHistoricalLogs: options.preserveHistoricalLogs,
      previousPolicyExam: options.previousPolicyExam,
      previousExamState: options.previousExamState,
      examEditReview: options.examEditReview,
    },
  );
}


export async function recalculateAllStudentsAcademicState(
  options: { batchSize?: number } = {},
): Promise<{
  ok: true;
  totalStudents: number;
  recalculatedStudents: number;
  automaticOpportunityLogs: number;
  batches: number;
}> {
  const batchSize = Math.min(500, Math.max(25, Math.trunc(Number(options.batchSize || 200))));
  const students = await db.student.findMany({
    where: { status: { not: "مؤرشف" } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const studentIds: string[] = students
    .map((student) => String(student.id || ""))
    .filter((id): id is string => Boolean(id));
  let recalculatedStudents = 0;
  let automaticOpportunityLogs = 0;
  let batches = 0;

  for (const group of chunks(studentIds, batchSize)) {
    batches += 1;
    const result = await recalculateStudentsAcademicState(group);
    recalculatedStudents += result.students.length;
    automaticOpportunityLogs += result.automaticOpportunityLogs.length;
  }

  return {
    ok: true,
    totalStudents: studentIds.length,
    recalculatedStudents,
    automaticOpportunityLogs,
    batches,
  };
}
