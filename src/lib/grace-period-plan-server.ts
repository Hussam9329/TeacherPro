import type { Prisma } from "@prisma/client";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import {
  formatGraceDays,
  formatGracePeriod,
  gracePeriodDays,
  isStudentInGracePeriod,
  validateGracePeriodInput,
  type GracePeriodRange,
  type GracePeriodRecord,
} from "@/lib/grace-periods";
import {
  graceDateColumn,
  listStudentGracePeriods,
} from "@/lib/grace-periods-server";
import {
  classifyGradeAcademicImpact,
  isProtectedGradeKind,
  type GradeClassificationKind,
} from "@/lib/grade-classification";
import { parseCourseIds } from "@/lib/exam-course-links";
import { splitSelection, studentMatchesExamMainSites } from "@/lib/exam-utils";
import {
  previewStudentAcademicUpdate,
  recalculateStudentsAcademicState,
  type StudentAcademicUpdatePreview,
} from "@/lib/academic-recalculate-server";
import { buildStudentAcademicImpactToken } from "@/lib/student-academic-impact-token";

export type GraceChangeAction = "create" | "update" | "cancel";

export type GraceChangeRequest = {
  studentId: string;
  action: GraceChangeAction;
  periodId?: string;
  startDate?: string;
  endDate?: string;
  cancelReason?: string;
};

export type GraceChangeActor = { id: string | null; name: string };

export class GraceChangeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "GraceChangeError";
    this.status = status;
  }
}

export type GraceAffectedExam = {
  examId: string;
  examName: string;
  examDate: string;
  examType: string;
  change: "enters" | "leaves";
  result: string;
  before: GradeClassificationKind;
  after: GradeClassificationKind;
  accountingChanged: boolean;
};

export type GraceChangePlan = {
  student: { id: string; name: string; code: string; status: string };
  action: GraceChangeAction;
  target: GracePeriodRecord | null;
  proposed: GracePeriodRange | null;
  summary: string;
  currentPeriods: GracePeriodRange[];
  proposedPeriods: GracePeriodRange[];
  affectedExams: GraceAffectedExam[];
  projection: StudentAcademicUpdatePreview | null;
  previewToken: string;
};

const ARCHIVED_STATUS = "مؤرشف";

function activeRanges(records: GracePeriodRecord[]): GracePeriodRange[] {
  return records
    .filter((record) => !record.cancelledAt)
    .map(({ id, startDate, endDate }) => ({ id, startDate, endDate }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function resultLabel(grade: { status: string; score: number | null } | undefined): string {
  if (!grade) return "لا توجد نتيجة مسجلة";
  if (grade.status === "درجة") return grade.score === null ? "لا توجد نتيجة مسجلة" : `درجة ${grade.score}`;
  if (grade.status === "ضمن فترة السماح") return "لا توجد نتيجة مسجلة";
  return grade.status;
}

/**
 * Plans one grace-period change for one student with the SAME computation the
 * save uses: the proposed active periods, every exam of the student whose
 * protection changes (with or without a recorded result), the engine's
 * projected balance/status, and a token fingerprinting all inputs.
 */
export async function planGraceChange(
  tx: Prisma.TransactionClient,
  request: GraceChangeRequest,
  now: Date = new Date(),
): Promise<GraceChangePlan> {
  const studentId = String(request.studentId || "").trim();
  if (!studentId) throw new GraceChangeError("اختر الطالب أولاً.");
  const student = await tx.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      courseId: true,
      createdAt: true,
      mainSite: true,
      subSite: true,
      locationScope: true,
    },
  });
  if (!student) throw new GraceChangeError("الطالب غير موجود.", 404);
  if (student.status === ARCHIVED_STATUS) {
    throw new GraceChangeError("الطالب مؤرشف؛ لا يمكن تعديل فترات سماحه.", 409);
  }

  const records = await listStudentGracePeriods(tx, studentId);
  const currentPeriods = activeRanges(records);
  const todayKey = baghdadTodayKey(now);
  let target: GracePeriodRecord | null = null;
  let proposed: GracePeriodRange | null = null;
  let proposedPeriods: GracePeriodRange[];

  if (request.action === "create") {
    const error = validateGracePeriodInput({
      startDate: request.startDate,
      endDate: request.endDate,
      todayKey,
      existing: currentPeriods,
    });
    if (error) throw new GraceChangeError(error);
    proposed = { startDate: request.startDate!, endDate: request.endDate! };
    proposedPeriods = [...currentPeriods, proposed];
  } else if (request.action === "update" || request.action === "cancel") {
    target = records.find((record) => record.id === request.periodId) || null;
    if (!target) throw new GraceChangeError("فترة السماح المطلوبة غير موجودة.", 404);
    if (target.cancelledAt) throw new GraceChangeError("هذه الفترة ملغاة مسبقاً.", 409);
    if (request.action === "update") {
      const error = validateGracePeriodInput({
        startDate: request.startDate,
        endDate: request.endDate,
        todayKey,
        existing: currentPeriods,
        ignoreId: target.id,
      });
      if (error) throw new GraceChangeError(error);
      if (request.startDate === target.startDate && request.endDate === target.endDate) {
        throw new GraceChangeError("لم يتغير شيء في الفترة.");
      }
      proposed = { id: target.id, startDate: request.startDate!, endDate: request.endDate! };
      proposedPeriods = currentPeriods.map((period) => (period.id === target!.id ? proposed! : period));
    } else {
      proposedPeriods = currentPeriods.filter((period) => period.id !== target!.id);
    }
  } else {
    throw new GraceChangeError("نوع العملية غير معروف.");
  }
  proposedPeriods.sort((a, b) => a.startDate.localeCompare(b.startDate));

  const [exams, grades, leaves] = await Promise.all([
    tx.exam.findMany({
      where: { examCourses: { some: { courseId: student.courseId } } },
      select: {
        id: true,
        name: true,
        type: true,
        date: true,
        courseIds: true,
        mainSite: true,
        fullMark: true,
        passMark: true,
        discountMark: true,
        dismissalGrade: true,
        noDiscount: true,
        active: true,
        scheduledActivateAt: true,
      },
      orderBy: { date: "asc" },
    }),
    tx.grade.findMany({
      where: { studentId },
      select: {
        id: true,
        examId: true,
        status: true,
        score: true,
        notes: true,
        academicEffectExcluded: true,
        academicEffectExclusionReason: true,
        academicEffectExclusionSource: true,
      },
    }),
    tx.studentLeave.findMany({
      where: { studentId },
      select: { examId: true, leaveType: true, date: true, dateFrom: true, dateTo: true },
    }),
  ]);
  const gradeByExam = new Map(grades.map((grade) => [grade.examId, grade]));
  const sites = (value: string | null) => splitSelection(String(value || ""));
  const before = { courseId: student.courseId, createdAt: student.createdAt, gracePeriods: currentPeriods };
  const after = { courseId: student.courseId, createdAt: student.createdAt, gracePeriods: proposedPeriods };

  const affectedExams: GraceAffectedExam[] = [];
  for (const exam of exams) {
    if (!parseCourseIds(exam.courseIds).includes(student.courseId) && !gradeByExam.has(exam.id)) continue;
    if (!gradeByExam.has(exam.id) && !studentMatchesExamMainSites(student, sites(exam.mainSite))) continue;
    const wasInGrace = isStudentInGracePeriod(currentPeriods, exam.date);
    const willBeInGrace = isStudentInGracePeriod(proposedPeriods, exam.date);
    if (wasInGrace === willBeInGrace) continue;
    const grade = gradeByExam.get(exam.id);
    const beforeKind = classifyGradeAcademicImpact(grade, exam, { student: before, leaves });
    const afterKind = classifyGradeAcademicImpact(grade, exam, { student: after, leaves });
    affectedExams.push({
      examId: exam.id,
      examName: exam.name,
      examDate: exam.date.toISOString(),
      examType: exam.type,
      change: willBeInGrace ? "enters" : "leaves",
      result: resultLabel(grade),
      before: beforeKind,
      after: afterKind,
      accountingChanged:
        beforeKind !== afterKind &&
        isProtectedGradeKind(beforeKind) !== isProtectedGradeKind(afterKind),
    });
  }

  const [projection, previewToken] = await Promise.all([
    previewStudentAcademicUpdate(studentId, { gracePeriods: proposedPeriods }, { tx, graceReview: true }),
    buildStudentAcademicImpactToken(tx, { studentId, proposedGracePeriods: proposedPeriods }),
  ]);

  const describe = (period: GracePeriodRange) =>
    `من ${formatGracePeriod(period).replace(" → ", " إلى ")} — ${formatGraceDays(gracePeriodDays(period))}`;
  const summary =
    request.action === "cancel"
      ? `سيتم إلغاء فترة السماح ${describe(target!)}.`
      : `الطالب سيكون ضمن فترة السماح ${describe(proposed!)}.`;

  return {
    student: { id: student.id, name: student.name, code: student.code, status: student.status },
    action: request.action,
    target,
    proposed,
    summary,
    currentPeriods,
    proposedPeriods,
    affectedExams,
    projection,
    previewToken,
  };
}

const ACTION_LABELS: Record<GraceChangeAction, string> = {
  create: "إضافة فترة سماح",
  update: "تعديل فترة سماح",
  cancel: "إلغاء فترة سماح",
};

/**
 * Applies a previewed change. The plan is recomputed inside the same
 * serializable transaction and must match the preview token, so the saved
 * result is exactly what the operator confirmed.
 */
export async function applyGraceChange(
  tx: Prisma.TransactionClient,
  request: GraceChangeRequest & { previewToken: string },
  actor: GraceChangeActor,
  now: Date = new Date(),
) {
  const plan = await planGraceChange(tx, request, now);
  if (!request.previewToken || plan.previewToken !== request.previewToken) {
    throw new GraceChangeError(
      "تغيرت بيانات الطالب بعد المعاينة. راجع المعاينة الجديدة ثم أكد مرة أخرى.",
      409,
    );
  }

  let periodId: string;
  if (request.action === "create") {
    const created = await tx.gracePeriod.create({
      data: {
        studentId: plan.student.id,
        startDate: graceDateColumn(plan.proposed!.startDate),
        endDate: graceDateColumn(plan.proposed!.endDate),
        source: "manual",
        createdById: actor.id,
        createdByName: actor.name,
        updatedById: actor.id,
        updatedByName: actor.name,
      },
    });
    periodId = created.id;
  } else if (request.action === "update") {
    await tx.gracePeriod.update({
      where: { id: plan.target!.id },
      data: {
        startDate: graceDateColumn(plan.proposed!.startDate),
        endDate: graceDateColumn(plan.proposed!.endDate),
        updatedById: actor.id,
        updatedByName: actor.name,
      },
    });
    periodId = plan.target!.id;
  } else {
    await tx.gracePeriod.update({
      where: { id: plan.target!.id },
      data: {
        cancelledAt: now,
        cancelledById: actor.id,
        cancelledByName: actor.name,
        cancelReason: String(request.cancelReason || "").trim().slice(0, 500),
      },
    });
    periodId = plan.target!.id;
  }

  const recalculation = await recalculateStudentsAcademicState([plan.student.id], {
    tx,
    graceReview: { studentId: plan.student.id },
  });
  const recalculated = recalculation.students.find((student) => student.id === plan.student.id);

  const range = (period: GracePeriodRange) =>
    `${formatGracePeriod(period)} (${formatGraceDays(gracePeriodDays(period))})`;
  const details = [
    `${plan.student.name} - ${plan.student.code}`,
    request.action === "update"
      ? `من ${range(plan.target!)} إلى ${range(plan.proposed!)}`
      : request.action === "cancel"
        ? `${range(plan.target!)}${request.cancelReason ? ` - السبب: ${String(request.cancelReason).trim().slice(0, 200)}` : ""}`
        : range(plan.proposed!),
    `امتحانات تغيّر وضعها: ${plan.affectedExams.length}`,
    recalculated ? `الفرص: ${recalculated.opportunities} - الحالة: ${recalculated.status}` : "",
  ].filter(Boolean).join(" - ");
  await tx.auditLog.create({
    data: {
      module: "فترات السماح",
      action: ACTION_LABELS[request.action],
      details,
      userId: actor.id,
      userName: actor.name,
    },
  });

  return {
    periodId,
    plan,
    student: recalculated
      ? { opportunities: recalculated.opportunities, status: recalculated.status }
      : null,
  };
}
