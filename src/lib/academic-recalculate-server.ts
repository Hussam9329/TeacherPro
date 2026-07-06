import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  isAutomaticOpportunityLog,
  recalculateAcademicState,
} from "@/lib/academic-engine";
import type {
  AcademicChapter,
  AcademicCourseChapter,
  AcademicExam,
  AcademicGrade,
  AcademicOpportunityLog,
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

function normalizeOpportunityPenalty(value: unknown): number | "فصل مؤقت" {
  if (value === "فصل مؤقت") return "فصل مؤقت";
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function mapStudent(student: {
  id: string;
  courseId: string;
  status: string;
  dismissalType: string | null;
  dismissalReason: string | null;
  dismissalNotes: string | null;
  opportunities: number;
  baseOpportunities: number;
  createdAt: Date;
  accountingGraceDays: number;
}): AcademicStudent {
  return {
    id: student.id,
    courseId: student.courseId,
    status: student.status === "مفصول" || student.status === "مؤرشف" ? student.status : "نشط",
    dismissalType: nullableText(student.dismissalType),
    dismissalReason: nullableText(student.dismissalReason),
    dismissalNotes: nullableText(student.dismissalNotes),
    opportunities: Number(student.opportunities || 0),
    baseOpportunities: Number(student.baseOpportunities || 0),
    createdAt: dateString(student.createdAt),
    accountingGraceDays: Number(student.accountingGraceDays || 0),
  };
}

function mapExam(exam: {
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
  scheduledDeactivateAt: Date | null;
}): AcademicExam {
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
    scheduledDeactivateAt: exam.scheduledDeactivateAt ? dateString(exam.scheduledDeactivateAt) : null,
  };
}

function mapGrade(grade: {
  id: string;
  studentId: string;
  examId: string;
  status: string;
  score: number | null;
  createdAt: Date;
  updatedAt: Date;
}): AcademicGrade {
  return {
    id: grade.id,
    studentId: grade.studentId,
    examId: grade.examId,
    status: grade.status === "غائب" || grade.status === "غش" ? grade.status : "درجة",
    score: grade.score === null ? null : Number(grade.score),
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
  reason: string | null;
  date: Date;
  chapterId: string | null;
}): AcademicOpportunityLog {
  return {
    id: log.id,
    studentId: log.studentId,
    examId: nullableText(log.examId),
    action: log.action,
    amount: Number(log.amount || 0),
    reason: nullableText(log.reason),
    date: dateString(log.date),
    chapterId: nullableText(log.chapterId),
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

function automaticOpportunityLogWhere(studentIds: string[]): Prisma.OpportunityLogWhereInput {
  return {
    studentId: { in: studentIds },
    OR: [
      { action: { in: ["خصم تلقائي", "فصل تلقائي"] } },
      { reason: { startsWith: "تلقائي:" } },
    ],
  };
}

async function loadAcademicStateForStudents(
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
  ] = await Promise.all([
    client.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        courseId: true,
        status: true,
        dismissalType: true,
        dismissalReason: true,
        dismissalNotes: true,
        opportunities: true,
        baseOpportunities: true,
        createdAt: true,
        accountingGraceDays: true,
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
        scheduledDeactivateAt: true,
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
        reason: true,
        date: true,
        chapterId: true,
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
  ]);

  return {
    students: students.map(mapStudent),
    grades: grades.map(mapGrade),
    exams: exams.map(mapExam),
    courseChapters: courseChapters.map(mapCourseChapter),
    chapters: chapters.map(mapChapter),
    opportunityLogs: opportunityLogs.map(mapOpportunityLog),
    studentLeaves: studentLeaves.map(mapStudentLeave),
    studentNotes: studentNotes.map(mapStudentNote),
  };
}

async function persistAcademicRecalculation(
  client: PrismaClientLike,
  studentIds: string[],
  result: ReturnType<typeof recalculateAcademicState>,
): Promise<AcademicServerRecalculationResult> {
  const targetStudentIds = new Set(studentIds);
  const students = result.students.filter((student) =>
    targetStudentIds.has(student.id),
  );
  const automaticOpportunityLogs = result.opportunityLogs.filter(
    (log) => targetStudentIds.has(log.studentId) && isAutomaticOpportunityLog(log),
  );

  for (const student of students) {
    await client.student.update({
      where: { id: student.id },
      data: {
        status: student.status,
        opportunities: Math.max(
          0,
          Math.trunc(Number(student.opportunities || 0)),
        ),
        dismissalType: student.dismissalType || null,
        dismissalReason: student.dismissalReason || null,
      },
    });
  }

  if (studentIds.length > 0) {
    await client.opportunityLog.deleteMany({
      where: automaticOpportunityLogWhere(studentIds),
    });
  }

  if (automaticOpportunityLogs.length > 0) {
    await client.opportunityLog.createMany({
      data: automaticOpportunityLogs.map((log) => ({
        id: log.id,
        studentId: log.studentId,
        examId: log.examId || null,
        action: log.action,
        amount: Math.max(0, Math.trunc(Number(log.amount || 0))),
        reason: log.reason || null,
        date: log.date ? new Date(log.date) : new Date(),
        chapterId: log.chapterId || null,
      })),
      skipDuplicates: true,
    });
  }

  return {
    studentIds,
    students,
    opportunityLogs: result.opportunityLogs.filter((log) =>
      targetStudentIds.has(log.studentId),
    ),
    automaticOpportunityLogs,
  };
}

export async function recalculateStudentsAcademicState(
  rawStudentIds: Array<string | null | undefined>,
  options: { tx?: Prisma.TransactionClient } = {},
): Promise<AcademicServerRecalculationResult> {
  const studentIds = uniqueIds(rawStudentIds);
  if (studentIds.length === 0) {
    return {
      studentIds: [],
      students: [],
      opportunityLogs: [],
      automaticOpportunityLogs: [],
    };
  }

  const client = options.tx || db;
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
  const result = recalculateAcademicState(
    state,
    new Set(recalculableStudentIds),
  );
  return persistAcademicRecalculation(client, recalculableStudentIds, result);
}

export async function recalculateStudentsForExam(
  examId: string,
  options: { tx?: Prisma.TransactionClient } = {},
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
  const grades = await client.grade.findMany({
    where: { examId: trimmedExamId },
    select: { studentId: true },
  });
  return recalculateStudentsAcademicState(
    grades.map((grade) => grade.studentId),
    { tx: options.tx },
  );
}
