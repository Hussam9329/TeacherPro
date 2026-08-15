import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getExamEntryAvailability,
  isExamOnOrAfterStudentRegistration,
  isExamWithinStudentGracePeriod,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";
import { baghdadDateKey } from "@/lib/baghdad-time";

export type StudentExamEligibilityCode =
  | "eligible"
  | "student-dismissed"
  | "student-archived"
  | "wrong-course"
  | "wrong-site"
  | "before-registration"
  | "student-leave"
  | "exam-unavailable"
  | "missing-active-chapter"
  | "active-chapter-conflict";

export type StudentExamEligibility = {
  eligible: boolean;
  code: StudentExamEligibilityCode;
  reason: string;
  withinGrace: boolean;
  availability: ReturnType<typeof getExamEntryAvailability>;
  hasLeave: boolean;
};

type Client = typeof db | Prisma.TransactionClient;

type StudentEligibilityRow = {
  id: string;
  courseId: string;
  status: string;
  createdAt: Date;
  accountingGraceDays: number;
  mainSite: string | null;
  subSite: string | null;
  locationScope: string | null;
};

type ExamEligibilityRow = {
  id: string;
  date: Date;
  courseIds: string;
  mainSite: string | null;
  active: boolean;
  scheduledActivateAt: Date | null;
  scheduledDeactivateAt: Date | null;
  examCourses?: Array<{ courseId: string }>;
};

export function parseExamCourseIds(
  value: string | null | undefined,
): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

export function examCourseIds(exam: ExamEligibilityRow): string[] {
  return Array.from(
    new Set([
      ...parseExamCourseIds(exam.courseIds),
      ...(exam.examCourses || []).map((item) => item.courseId),
    ]),
  );
}

export function isExamAssignedToStudentCourse(
  student: Pick<StudentEligibilityRow, "courseId">,
  exam: ExamEligibilityRow,
): boolean {
  const courseIds = examCourseIds(exam);
  return courseIds.length === 0 || courseIds.includes(student.courseId);
}

function dayBounds(value: Date): { start: Date; end: Date } {
  const key = baghdadDateKey(value);
  const start = new Date(`${key}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function studentHasLeaveForExam(
  client: Client,
  studentId: string,
  exam: Pick<ExamEligibilityRow, "id" | "date">,
  excludeLeaveId?: string,
): Promise<boolean> {
  const { start, end } = dayBounds(exam.date);
  const leave = await client.studentLeave.findFirst({
    where: {
      studentId,
      ...(excludeLeaveId ? { id: { not: excludeLeaveId } } : {}),
      OR: [
        { leaveType: "exam", examId: exam.id },
        {
          leaveType: "period",
          dateFrom: { lt: end },
          dateTo: { gte: start },
        },
      ],
    },
    select: { id: true },
  });
  return Boolean(leave);
}

export async function evaluateStudentExamEligibility(
  client: Client,
  student: StudentEligibilityRow,
  exam: ExamEligibilityRow,
  options: {
    requireActiveChapter?: boolean;
    checkAvailability?: boolean;
    checkRegistration?: boolean;
    checkLeave?: boolean;
    allowDismissed?: boolean;
    excludeLeaveId?: string;
  } = {},
): Promise<StudentExamEligibility> {
  const availability = getExamEntryAvailability(exam);
  const withinGrace = isExamWithinStudentGracePeriod(student, exam);
  const result = (
    code: StudentExamEligibilityCode,
    reason: string,
    hasLeave = false,
  ): StudentExamEligibility => ({
    eligible: code === "eligible",
    code,
    reason,
    withinGrace,
    availability,
    hasLeave,
  });

  if (student.status === "مؤرشف") {
    return result("student-archived", "ملف الطالب مؤرشف ومتاح للقراءة فقط.");
  }
  if (student.status === "مفصول" && !options.allowDismissed) {
    return result(
      "student-dismissed",
      "الطالب مفصول ولا يمكن اعتماد امتحان أو درجة له قبل إعادة التفعيل.",
    );
  }
  if (!isExamAssignedToStudentCourse(student, exam)) {
    return result("wrong-course", "الامتحان لا يتبع دورة الطالب الحالية.");
  }
  if (!studentMatchesExamMainSites(student, splitSelection(exam.mainSite))) {
    return result("wrong-site", "موقع الطالب غير مشمول بمواقع هذا الامتحان.");
  }
  if (
    options.checkRegistration !== false &&
    !isExamOnOrAfterStudentRegistration(student, exam)
  ) {
    return result(
      "before-registration",
      "الامتحان يسبق تاريخ تسجيل الطالب.",
    );
  }
  if (options.checkAvailability !== false && !availability.available) {
    return result("exam-unavailable", availability.reason);
  }

  const hasLeave =
    options.checkLeave === false
      ? false
      : await studentHasLeaveForExam(
          client,
          student.id,
          exam,
          options.excludeLeaveId,
        );
  if (hasLeave) {
    return result(
      "student-leave",
      "الطالب لديه إجازة تغطي هذا الامتحان.",
      true,
    );
  }

  if (options.requireActiveChapter !== false) {
    const activeLinks = await client.courseChapter.findMany({
      where: {
        courseId: student.courseId,
        active: true,
        archived: false,
      },
      select: { id: true },
      take: 2,
    });
    if (activeLinks.length === 0) {
      return result(
        "missing-active-chapter",
        "دورة الطالب لا تحتوي فصلاً نشطاً.",
      );
    }
    if (activeLinks.length > 1) {
      return result(
        "active-chapter-conflict",
        "دورة الطالب تحتوي أكثر من فصل نشط.",
      );
    }
  }

  return result("eligible", "الطالب مؤهل لهذا الامتحان.", false);
}

export async function loadStudentExamEligibility(
  client: Client,
  studentId: string,
  examId: string,
  options: Parameters<typeof evaluateStudentExamEligibility>[3] = {},
) {
  const [student, exam] = await Promise.all([
    client.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        courseId: true,
        status: true,
        createdAt: true,
        accountingGraceDays: true,
        mainSite: true,
        subSite: true,
        locationScope: true,
      },
    }),
    client.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        date: true,
        courseIds: true,
        mainSite: true,
        active: true,
        scheduledActivateAt: true,
        scheduledDeactivateAt: true,
        examCourses: { select: { courseId: true } },
      },
    }),
  ]);
  if (!student || !exam) return { student, exam, eligibility: null };
  const eligibility = await evaluateStudentExamEligibility(
    client,
    student,
    exam,
    options,
  );
  return { student, exam, eligibility };
}
