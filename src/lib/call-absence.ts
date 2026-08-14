import { baghdadDateKey, baghdadTodayKey } from "@/lib/baghdad-time";
import {
  hasStudentLeaveForExam,
  isExamBeforeStudentRegistration,
  isExamWithinStudentGracePeriodUnified,
  type ExamLike,
  type GradeLike,
  type StudentGraceLike,
  type StudentLeaveLike,
} from "@/lib/grade-classification";
import {
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";

export type CallAbsenceSource = "recorded" | "missing";

type CallAbsenceStudent = StudentGraceLike & {
  id?: string | null;
  status?: string | null;
  mainSite?: string | null;
  subSite?: string | null;
  locationScope?: string | null;
};

type CallAbsenceExam = ExamLike & {
  mainSite?: string | null;
};

/**
 * Resolves the read-only absence shown in follow-up calls.
 *
 * A stored absent grade and a student with no Grade at all are both absence
 * candidates after the exam date. This intentionally does not inspect
 * `noDiscount` or exam activation: those fields control academic accounting,
 * not whether the student attended. No Grade row is created here.
 */
export function resolveCallAbsenceSource(args: {
  grade?: GradeLike | null;
  exam: CallAbsenceExam;
  student: CallAbsenceStudent;
  leaves?: StudentLeaveLike[];
  hasAttemptEvidence?: boolean;
  today?: Date | string;
}): CallAbsenceSource | null {
  const { grade, exam, student, leaves = [] } = args;
  if (String(student.status || "") === "مؤرشف") return null;
  if (grade?.academicEffectExcluded) return null;

  const examDay = baghdadDateKey(exam.date);
  const today = args.today
    ? baghdadDateKey(args.today)
    : baghdadTodayKey();
  if (!examDay || !today || examDay > today) return null;

  if (
    !grade &&
    !studentMatchesExamMainSites(
      student,
      splitSelection(String(exam.mainSite || "")),
    )
  ) {
    return null;
  }
  if (hasStudentLeaveForExam(leaves, exam)) return null;
  if (isExamBeforeStudentRegistration(student, exam)) return null;
  if (isExamWithinStudentGracePeriodUnified(student, exam)) return null;

  if (grade?.status === "غائب") return "recorded";
  // A scored smart note, correction sheet, or received answer submission is
  // evidence that the student attempted the exam even without a Grade row.
  if (!grade && args.hasAttemptEvidence) return null;
  // Exam records contain a calendar day, not an end time. Derive missing
  // absence only from a previous Baghdad day so a class is never marked absent
  // while today's exam or grade entry is still in progress.
  if (!grade && examDay >= today) return null;
  if (!grade) return "missing";
  return null;
}

export function implicitCallAbsenceGradeId(
  studentId: string,
  examId: string,
): string {
  return `implicit-absence:${examId}:${studentId}`;
}

export function callCategoryAliasesForCurrentGrade(args: {
  requestedCategory: string;
  currentGrade?: { id: string; status: string } | null;
}): string[] {
  const requestedCategory = String(args.requestedCategory || "");
  const grade = args.currentGrade;
  if (!grade || grade.status !== "غائب") return [requestedCategory];

  const gradeCategory = `grade:${grade.id}`;
  if (requestedCategory === "absent") return ["absent", gradeCategory];
  if (requestedCategory === gradeCategory) return [gradeCategory, "absent"];
  return [requestedCategory];
}

export function retainedCallCategory(
  requestedCategory: string,
  existingCategory?: string | null,
  categoryAliases: string[] = [],
): string {
  if (existingCategory) return String(existingCategory);
  // New recorded-absence calls use the same canonical key as an implicit
  // absence. This closes the small race where one request still sees no Grade
  // while another already sees the newly-created absent Grade.
  if (categoryAliases.length > 1 && categoryAliases.includes("absent")) {
    return "absent";
  }
  return String(requestedCategory || "");
}

/**
 * Virtual display data only. It gives the existing calls UI a stable item for
 * contact logging without inserting a Grade or triggering recalculation.
 */
export function buildImplicitCallAbsenceGrade(args: {
  studentId: string;
  examId: string;
  examDate: Date | string;
}) {
  const timestamp =
    args.examDate instanceof Date
      ? args.examDate
      : new Date(String(args.examDate));
  const safeTimestamp = Number.isFinite(timestamp.getTime())
    ? timestamp
    : new Date(0);
  return {
    id: implicitCallAbsenceGradeId(args.studentId, args.examId),
    studentId: args.studentId,
    examId: args.examId,
    status: "غائب" as const,
    score: null,
    notes: "لا توجد درجة مسجلة لهذا الامتحان؛ غياب مشتق للمتابعة فقط.",
    academicAccountingChecked: false,
    academicEffectExcluded: false,
    academicEffectExclusionReason: null,
    academicEffectExclusionSource: null,
    createdAt: safeTimestamp,
    updatedAt: safeTimestamp,
  };
}
