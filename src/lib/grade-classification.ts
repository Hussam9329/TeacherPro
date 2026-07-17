import { getExamEntryAvailability } from "@/lib/exam-utils";
import { baghdadDateKey } from "@/lib/baghdad-time";
import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";

export type GradeStatusFilter =
  | "all"
  | "excused"
  | "grace-period"
  | "absent"
  | "cheating"
  | "discounted"
  | "failed"
  | "academic-accounting"
  | "passed"
  | "full-mark"
  | "has-grade";

export type GradeClassificationKind =
  | "missing"
  | "excused"
  | "grace-period"
  | "before-registration"
  | "unavailable-exam"
  | "cheating"
  | "absent-dismissal"
  | "absent-deducted"
  | "discounted"
  | "academic-accounting"
  | "dismissal"
  | "failed"
  | "passed"
  | "full-mark"
  | "no-discount-protected";

export type GradeLike = {
  status?: string | null;
  score?: number | null;
};

export type ExamLike = {
  id: string;
  type?: string | null;
  date?: Date | string | null;
  fullMark?: number | null;
  passMark?: number | null;
  discountMark?: number | null;
  dismissalGrade?: number | null;
  noDiscount?: boolean | null;
  active?: boolean | null;
  scheduledActivateAt?: Date | string | null;
  scheduledDeactivateAt?: Date | string | null;
};

export type StudentGraceLike = {
  createdAt?: Date | string | null;
  accountingGraceDays?: number | null;
  gracePeriodStartDate?: Date | string | null;
};

export type StudentLeaveLike = {
  examId?: string | null;
  leaveType?: string | null;
  date?: Date | string | null;
  dateFrom?: Date | string | null;
  dateTo?: Date | string | null;
};

export function parseCourseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // دعم النسخ القديمة التي تحفظها كقائمة مفصولة بفواصل.
  }
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function dayKey(value: unknown): string {
  if (!value) return "";
  return baghdadDateKey(value as Date | string | null | undefined);
}

function parseDateOnly(value: unknown): Date | null {
  const key = dayKey(value);
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isGradeEnteredUnified(
  grade: GradeLike | null | undefined,
  exam: Pick<ExamLike, "fullMark"> | null | undefined,
): boolean {
  if (!grade || !exam) return false;
  if (grade.status === "درجة") {
    const score = Number(grade.score);
    return Number.isFinite(score) && score >= 0 && score <= Number(exam.fullMark || 0);
  }
  return grade.status === "غائب" || grade.status === "غش";
}

export function isExamBeforeStudentRegistration(
  student: StudentGraceLike,
  exam: Pick<ExamLike, "date">,
): boolean {
  const registeredAt = parseDateOnly(student.createdAt);
  const examDate = parseDateOnly(exam.date);
  if (!registeredAt || !examDate) return false;
  return examDate < registeredAt;
}

export function isExamWithinStudentGracePeriodUnified(
  student: StudentGraceLike,
  exam: Pick<ExamLike, "date">,
): boolean {
  return isExamWithinStudentGraceWindow(student, exam);
}

export function studentLeaveAppliesToExam(
  leave: StudentLeaveLike,
  exam: Pick<ExamLike, "id" | "date">,
): boolean {
  if ((leave.leaveType || "exam") === "period") {
    const examDate = dayKey(exam.date);
    const from = dayKey(leave.dateFrom || leave.date);
    const to = dayKey(leave.dateTo || leave.dateFrom || leave.date);
    return Boolean(examDate && from && to && examDate >= from && examDate <= to);
  }
  return Boolean(leave.examId && leave.examId === exam.id);
}

export function hasStudentLeaveForExam(
  leaves: StudentLeaveLike[] | undefined,
  exam: Pick<ExamLike, "id" | "date">,
): boolean {
  return Boolean(leaves?.some((leave) => studentLeaveAppliesToExam(leave, exam)));
}

export function classifyGradeAcademicImpact(
  grade: GradeLike | null | undefined,
  exam: ExamLike,
  options: { student?: StudentGraceLike | null; leaves?: StudentLeaveLike[] } = {},
): GradeClassificationKind {
  const { student, leaves = [] } = options;
  if (hasStudentLeaveForExam(leaves, exam)) return "excused";
  if (!isGradeEnteredUnified(grade, exam)) return "missing";
  if (student && isExamBeforeStudentRegistration(student, exam)) return "before-registration";
  if (exam.active !== undefined && !getExamEntryAvailability({
    active: Boolean(exam.active),
    date: exam.date,
    scheduledActivateAt: exam.scheduledActivateAt,
    scheduledDeactivateAt: exam.scheduledDeactivateAt,
  }).available) return "unavailable-exam";
  if (student && isExamWithinStudentGracePeriodUnified(student, exam)) return "grace-period";
  if (grade?.status === "غش") return "cheating";
  if (exam.noDiscount) {
    if (grade?.status === "درجة" && Number(grade.score || 0) >= Number(exam.passMark || 0)) {
      return Number(grade.score || 0) === Number(exam.fullMark || 0) ? "full-mark" : "passed";
    }
    return "no-discount-protected";
  }
  if (grade?.status === "غائب") return exam.type === "فاينل" ? "absent-dismissal" : "absent-deducted";

  const score = grade?.status === "درجة" ? Number(grade.score) : NaN;
  if (!Number.isFinite(score)) return "missing";

  if (exam.type === "فاينل") {
    if (score === 0 || (exam.dismissalGrade !== null && exam.dismissalGrade !== undefined && score <= Number(exam.dismissalGrade))) {
      return "dismissal";
    }
    if (score >= Number(exam.passMark || 0)) return score === Number(exam.fullMark || 0) ? "full-mark" : "passed";
    return "failed";
  }

  if (score >= Number(exam.passMark || 0)) return score === Number(exam.fullMark || 0) ? "full-mark" : "passed";
  if (score > Number(exam.discountMark || 0) && score < Number(exam.passMark || 0)) return "academic-accounting";
  return "discounted";
}

export function isProtectedGradeKind(kind: GradeClassificationKind): boolean {
  return kind === "excused" || kind === "grace-period" || kind === "before-registration" || kind === "unavailable-exam" || kind === "missing" || kind === "no-discount-protected";
}

export function gradeMatchesStatusFilterUnified(
  filter: GradeStatusFilter,
  grade: GradeLike | null | undefined,
  exam: ExamLike,
  options: { student?: StudentGraceLike | null; leaves?: StudentLeaveLike[] } = {},
): boolean {
  if (!filter || filter === "all") return true;
  const kind = classifyGradeAcademicImpact(grade, exam, options);
  const score = grade?.status === "درجة" && grade.score !== null && grade.score !== undefined ? Number(grade.score) : null;

  switch (filter) {
    case "excused":
      return kind === "excused";
    case "grace-period":
      return kind === "grace-period" || kind === "before-registration";
    case "absent":
      return kind === "absent-deducted" || kind === "absent-dismissal";
    case "cheating":
      return kind === "cheating";
    case "discounted":
      return kind === "discounted";
    case "failed":
      return kind === "failed";
    case "academic-accounting":
      return kind === "academic-accounting";
    case "passed":
      return kind === "passed" || kind === "full-mark";
    case "full-mark":
      return kind === "full-mark";
    case "has-grade":
      return score !== null || grade?.status === "غائب" || grade?.status === "غش";
    default:
      return true;
  }
}

export function gradeKindForCalls(kind: GradeClassificationKind): "absent" | "discounted" | "failed" | "academic-accounting" | "full" | "passed" | "cheating" | "protected" | "missing" {
  if (kind === "cheating") return "cheating";
  if (kind === "absent-deducted" || kind === "absent-dismissal") return "absent";
  if (kind === "discounted" || kind === "dismissal") return "discounted";
  if (kind === "academic-accounting") return "academic-accounting";
  if (kind === "failed" || kind === "no-discount-protected") return "failed";
  if (kind === "full-mark") return "full";
  if (kind === "passed") return "passed";
  if (kind === "missing") return "missing";
  return "protected";
}
