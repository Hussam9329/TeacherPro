import { db } from "@/lib/db";
import {
  classifyGradeAcademicImpact,
  hasStudentLeaveForExam,
  type ExamLike,
  type GradeLike,
  type StudentGraceLike,
} from "./grade-classification";
import {
  buildReportOpportunityContext,
  buildReportTimelineEvents,
  reportGradePresentation,
  type ReportOpportunityContext,
} from "./student-report-presentation";

type GradeWithImpactContext = GradeLike & {
  id: string;
  studentId: string;
  examId: string;
  student: StudentGraceLike & { id: string; status: string; courseId: string };
  exam: ExamLike;
};

/** Read-only evidence for the requested grade page. Never infer a debit from
 * a score or the browser's partial store, and never replay academic state. */
export async function annotateGradeRecordedImpacts<T extends GradeWithImpactContext>(
  grades: T[],
): Promise<void> {
  if (!grades.length) return;
  const studentIds = [...new Set(grades.map(grade => grade.studentId))];
  const courseIds = [...new Set(grades.map(grade => grade.student.courseId))];
  const [logs, leaves, links] = await Promise.all([
    // Complete student history is needed for exact settlements and completed
    // returns, including returns with no exam ID. Only each grade's own exam
    // movements are passed to its presentation, and no raw logs leave here.
    db.opportunityLog.findMany({
      where: { studentId: { in: studentIds } },
      select: {
        id: true, studentId: true, examId: true, chapterId: true,
        action: true, amount: true, appliedAmount: true, balanceAfter: true,
        reason: true, date: true, ledgerVersion: true, settledGradeIds: true,
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    db.studentLeave.findMany({
      where: { studentId: { in: studentIds } },
      select: {
        studentId: true, examId: true, leaveType: true,
        date: true, dateFrom: true, dateTo: true,
      },
    }),
    db.courseChapter.findMany({
      where: { courseId: { in: courseIds }, active: true, archived: false },
      select: { courseId: true, chapterId: true },
    }),
  ]);
  const logsByStudent = new Map<string, typeof logs>();
  const leavesByStudent = new Map<string, typeof leaves>();
  for (const log of logs) {
    const group = logsByStudent.get(log.studentId) || [];
    group.push(log);
    logsByStudent.set(log.studentId, group);
  }
  for (const leave of leaves) {
    const group = leavesByStudent.get(leave.studentId) || [];
    group.push(leave);
    leavesByStudent.set(leave.studentId, group);
  }
  const chapterByCourse = new Map<string, string | null>();
  for (const link of links) {
    const previous = chapterByCourse.get(link.courseId);
    chapterByCourse.set(link.courseId,
      previous === undefined || previous === link.chapterId ? link.chapterId : null);
  }
  const contexts = new Map<string, ReportOpportunityContext>();

  for (const grade of grades) {
    const studentLogs = logsByStudent.get(grade.studentId) || [];
    const studentLeaves = leavesByStudent.get(grade.studentId) || [];
    let context = contexts.get(grade.studentId);
    if (!context) {
      context = {
        // Ambiguous active chapters cannot establish a settlement context.
        ...buildReportOpportunityContext(studentLogs, chapterByCourse.get(grade.student.courseId)),
        historical: true,
        studentStatus: grade.student.status,
        registeredAt: grade.student.createdAt,
        gracePeriods: grade.student.gracePeriods || [],
        reactivationDates: buildReportTimelineEvents(studentLogs)
          .filter(event => event.kind === "return").map(event => event.date),
      };
      contexts.set(grade.studentId, context);
    }
    const reportGrade = {
      ...grade,
      status: hasStudentLeaveForExam(studentLeaves, grade.exam) ? "مجاز" : grade.status,
    };
    const presentation = reportGradePresentation(
      reportGrade,
      { ...grade.exam },
      studentLogs.filter(log => log.examId === grade.examId),
      context,
    );
    const hasRecordedPenalty = presentation.tone === "deducted" || presentation.tone === "dismissed";
    const kind = classifyGradeAcademicImpact(grade, grade.exam, {
      student: grade.student,
      leaves: studentLeaves,
    });
    const excluded = grade.academicEffectExcluded || grade.effectiveImpactExcluded;
    if (excluded) {
      // A past debit remains evidence, but must not imply a second debit from
      // today's restored balance. Settlement annotations are computed first.
      presentation.text = hasRecordedPenalty
        ? `${presentation.text} — لا أثر على الرصيد الحالي`
        : "لا أثر على الرصيد الحالي";
    } else if (kind === "missing") {
      presentation.text = hasRecordedPenalty
        ? `${presentation.text} — النتيجة معلّقة ولا تؤثر حالياً`
        : "لا أثر على الفرص — بانتظار تثبيت النتيجة";
    } else if (!hasRecordedPenalty && kind === "unavailable-exam") {
      presentation.text = "لا أثر حالياً — الامتحان غير متاح";
    } else if (!hasRecordedPenalty && presentation.text === "لا خصم" && kind !== "excused") {
      presentation.text = "لا يوجد خصم مسجّل";
    }
    Object.assign(grade, { recordedOpportunityImpact: presentation });
  }
}
