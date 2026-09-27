import { splitSelection, studentMatchesExamMainSites } from "./exam-utils";

export type StudentLeavePreviewStudent = {
  id: string;
  courseId: string;
  mainSite?: string | null;
  subSite?: string | null;
  locationScope?: string | null;
};

export type StudentLeavePreviewExam = {
  id: string;
  name: string;
  date: string;
  courseIds: string[];
  mainSite?: string | null;
  active?: boolean;
  type?: string;
};

export type StudentLeavePreviewLeave = {
  id: string;
  studentId: string;
  leaveType?: string | null;
  examId?: string | null;
  date?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type StudentLeavePreviewConflict = {
  leaveId: string;
  kind: "duplicate-exam" | "period-overlap" | "covered-exam";
  blocking: boolean;
};

export type StudentLeavePreview = {
  selectedExam: StudentLeavePreviewExam | null;
  periodExams: StudentLeavePreviewExam[];
  from: string;
  to: string;
  hasPeriodDates: boolean;
  conflicts: StudentLeavePreviewConflict[];
};

export type StudentLeavePreviewInput = {
  mode: "exam" | "period";
  student?: StudentLeavePreviewStudent | null;
  exams: StudentLeavePreviewExam[];
  leaves: StudentLeavePreviewLeave[];
  examId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  editingLeaveId?: string | null;
};

function utcDay(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function normalizedRange(from?: string | null, to?: string | null) {
  const first = utcDay(from);
  const last = utcDay(to);
  if (!first || !last) return null;
  return first <= last ? { from: first, to: last } : { from: last, to: first };
}

function existingPeriodRange(leave: StudentLeavePreviewLeave) {
  return normalizedRange(
    leave.dateFrom || leave.date,
    leave.dateTo || leave.dateFrom || leave.date,
  );
}

function examIsInRange(
  exam: StudentLeavePreviewExam,
  range: { from: string; to: string },
) {
  const timestamp = new Date(exam.date).getTime();
  const start = new Date(range.from).getTime();
  const exclusiveEnd = new Date(range.to);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
  return timestamp >= start && timestamp < exclusiveEnd.getTime();
}

/**
 * Mirrors the leave API's affected-exam scope for date-only form inputs:
 * inclusive UTC dates, the student's course, and the existing site matcher.
 * Disabled exams are still affected by a period leave; registration date and
 * study type do not restrict the server's coverage and must not hide them here.
 * This is a preview only. The API remains responsible for applying the leave.
 */
export function buildStudentLeavePreview({
  mode,
  student,
  exams,
  leaves,
  examId,
  dateFrom,
  dateTo,
  editingLeaveId,
}: StudentLeavePreviewInput): StudentLeavePreview {
  const range = normalizedRange(dateFrom, dateTo);
  const courseExams = student
    ? exams.filter((exam) => exam.courseIds.includes(student.courseId))
    : [];
  // A specific-exam leave is course-scoped by the API, without a site filter.
  const selectedExam = courseExams.find((exam) => exam.id === examId) || null;
  const periodEligibleExams = student
    ? courseExams.filter((exam) =>
        studentMatchesExamMainSites(student, splitSelection(exam.mainSite)),
      )
    : [];
  const periodExams = range
    ? periodEligibleExams
        .filter((exam) => examIsInRange(exam, range))
        .sort(
          (a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime() ||
            a.id.localeCompare(b.id),
        )
    : [];
  const conflicts: StudentLeavePreviewConflict[] = [];
  const coveredExamIds = new Set(periodExams.map((exam) => exam.id));
  const selectedExamPeriodEligible =
    selectedExam &&
    periodEligibleExams.some((exam) => exam.id === selectedExam.id);

  for (const leave of leaves) {
    if (
      !student ||
      leave.studentId !== student.id ||
      leave.id === editingLeaveId
    ) continue;
    const existingIsPeriod = leave.leaveType === "period";
    if (mode === "exam" && selectedExam) {
      if (!existingIsPeriod && leave.examId === selectedExam.id) {
        conflicts.push({
          leaveId: leave.id,
          kind: "duplicate-exam",
          blocking: true,
        });
      } else if (existingIsPeriod && selectedExamPeriodEligible) {
        const existingRange = existingPeriodRange(leave);
        if (existingRange && examIsInRange(selectedExam, existingRange)) {
          conflicts.push({
            leaveId: leave.id,
            kind: "covered-exam",
            blocking: false,
          });
        }
      }
    } else if (mode === "period" && range) {
      if (existingIsPeriod) {
        const existingRange = existingPeriodRange(leave);
        if (
          existingRange &&
          existingRange.from <= range.to &&
          existingRange.to >= range.from
        ) {
          conflicts.push({
            leaveId: leave.id,
            kind: "period-overlap",
            blocking: true,
          });
        }
      } else if (leave.examId && coveredExamIds.has(leave.examId)) {
        // The linked exam's date determines scope, never the documentation date.
        conflicts.push({
          leaveId: leave.id,
          kind: "covered-exam",
          blocking: false,
        });
      }
    }
  }

  return {
    selectedExam,
    periodExams,
    from: range?.from || "",
    to: range?.to || "",
    hasPeriodDates: Boolean(range),
    conflicts,
  };
}
