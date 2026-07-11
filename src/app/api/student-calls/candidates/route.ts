export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { normalizeListFilter } from "@/lib/all-filter";
import { withFollowupTables } from "@/lib/followup-schema";
import {
  classifyGradeAcademicImpact,
  type GradeClassificationKind,
  gradeKindForCalls,
  parseCourseIds,
} from "@/lib/grade-classification";
import { studentCourseScopeWhere } from "@/lib/student-scope";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";

export type CallStatusFilter =
  | "all"
  | "absent"
  | "discounted"
  | "failed"
  | "cheating"
  | "passed"
  | "full";

type CallKind =
  | "absent"
  | "discounted"
  | "failed"
  | "academic-accounting"
  | "full"
  | "passed"
  | "cheating"
  | "protected"
  | "missing";

type DbStudentLite = {
  id: string;
  name: string;
  school: string;
  gender: string;
  phone: string | null;
  parentPhone: string | null;
  telegram: string | null;
  courseProgram: string | null;
  courseTerm: string | null;
  studyType: string | null;
  locationScope: string | null;
  baghdadMode: string | null;
  mainSite: string | null;
  subSite: string | null;
  code: string;
  status: string;
  dismissalType: string | null;
  dismissalReason: string | null;
  dismissalNotes: string | null;
  opportunities: number;
  baseOpportunities: number;
  accountingGraceDays: number;
  createdAt: Date;
  courseId: string;
};

type DbGradeLite = {
  id: string;
  studentId: string;
  examId: string;
  status: string;
  score: number | null;
  notes: string | null;
  academicAccountingChecked: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type DbExamLite = {
  id: string;
  name: string;
  type: string;
  date: Date;
  courseIds: string;
  mainSite: string | null;
  fullMark: number;
  passMark: number;
  discountMark: number;
  opportunitiesPenalty: string;
  dismissalGrade: number | null;
  noDiscount: boolean;
  active: boolean;
  scheduledActivateAt: Date | null;
  scheduledDeactivateAt: Date | null;
};

type DbLeaveLite = {
  studentId: string;
  examId: string | null;
  leaveType: string;
  date: Date;
  dateFrom: Date | null;
  dateTo: Date | null;
};

const CALL_STUDENT_NOTE_CATEGORY = "call-student-note";
const NON_DISPLAY_CALL_KINDS = new Set<CallKind>(["missing", "protected"]);

function normalizeCallStatusFilter(value: string | null): CallStatusFilter {
  const normalized = normalizeListFilter(value);
  // لم يعد "طلاب المحاسبة" فلتر مستقل في تبويبة المكالمات.
  // أي رابط/كاش قديم يطلبه يُعامل كـ "راسب غير مخصوم" حتى لا تظهر نتائج فارغة.
  if (normalized === "academic-accounting") return "failed";
  if (
    normalized === "absent" ||
    normalized === "discounted" ||
    normalized === "failed" ||
    normalized === "cheating" ||
    normalized === "passed" ||
    normalized === "full"
  ) {
    return normalized;
  }
  return "all";
}

function emptyResponse(page: number, pageSize: number) {
  return NextResponse.json({
    rows: [],
    students: [],
    grades: [],
    studentCalls: [],
    totalCount: 0,
    page,
    pageSize,
    totalPages: 1,
    hasMore: false,
    source: "database",
  });
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function dayAfter(value: Date): Date {
  const next = startOfUtcDay(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function dayKey(value: Date | string | null | undefined): string {
  if (!value) return "";
  return String(value instanceof Date ? value.toISOString() : value).slice(0, 10);
}

function examIncludesCourse(exam: Pick<DbExamLite, "courseIds">, courseId: string) {
  const ids = parseCourseIds(exam.courseIds);
  return ids.length === 0 || ids.includes(courseId);
}

function toClientExam(exam: DbExamLite) {
  return {
    ...exam,
    courseIds: parseCourseIds(exam.courseIds),
  };
}

function hasAbsentStatus(grade: Pick<DbGradeLite, "status"> | undefined): boolean {
  return grade?.status === "غائب";
}

function isDeductedImpact(kind: GradeClassificationKind): boolean {
  return (
    kind === "absent-deducted" ||
    kind === "absent-dismissal" ||
    kind === "discounted" ||
    kind === "dismissal" ||
    kind === "cheating"
  );
}

function classifyCallImpact(
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
  student?: DbStudentLite,
  leaves: DbLeaveLite[] = [],
): GradeClassificationKind {
  return classifyGradeAcademicImpact(grade, exam, { student, leaves });
}

function callKindForGrade(
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
  student?: DbStudentLite,
  leaves: DbLeaveLite[] = [],
): CallKind {
  const impactKind = classifyCallImpact(grade, exam, student, leaves);
  // الغياب يبقى غياباً في فلاتر المكالمات حتى لو كان محمياً من الخصم؛ الـ Badges تشرح سبب الخصم/الحماية.
  if (hasAbsentStatus(grade)) return "absent";
  return gradeKindForCalls(impactKind);
}

function callLabel(kind: CallKind): string {
  if (kind === "absent") return "غائب";
  if (kind === "cheating") return "غش";
  if (kind === "discounted") return "مخصوم";
  if (kind === "academic-accounting" || kind === "failed") return "راسب غير مخصوم";
  if (kind === "full") return "درجة كاملة";
  if (kind === "passed") return "ناجح";
  if (kind === "missing") return "غير مدخل";
  return "محمي من المحاسبة";
}

function callReason(kind: CallKind, grade: DbGradeLite, exam: DbExamLite): string {
  const scoreText =
    grade.status === "درجة" && grade.score !== null
      ? `${grade.score}/${exam.fullMark}`
      : grade.status;
  if (kind === "absent") return "غائب عن الامتحان";
  if (kind === "cheating") return "مسجل بحالة غش";
  if (kind === "discounted") return `ضمن درجة الخصم: ${scoreText}`;
  if (kind === "academic-accounting" || kind === "failed") return `راسب غير مخصوم: ${scoreText}`;
  if (kind === "full") return `درجة كاملة: ${scoreText}`;
  if (kind === "passed") return `ناجح: ${scoreText}`;
  if (kind === "protected") return `لا يدخل في متابعة المكالمات: ${scoreText}`;
  return scoreText;
}

type CallBadgeTone = "deducted" | "warning" | "safe" | "success" | "neutral";
type CallBadgeInfo = { label: string; tone: CallBadgeTone; detail?: string };

function callBadgesForGrade(args: {
  grade: DbGradeLite;
  exam: DbExamLite;
  impactKind: GradeClassificationKind;
}): CallBadgeInfo[] {
  const { grade, exam, impactKind } = args;
  if (hasAbsentStatus(grade)) {
    if (impactKind === "absent-dismissal") {
      return [
        {
          label: "غائب وتم الخصم/الفصل",
          tone: "deducted",
          detail: "غياب عن امتحان فاينل أو امتحان يؤدي إلى فصل حسب قواعد الامتحان.",
        },
      ];
    }
    if (impactKind === "absent-deducted") {
      return [
        {
          label: "غائب وتم الخصم",
          tone: "deducted",
          detail: "الطالب غائب وهذا الامتحان يدخل في الخصم الأكاديمي.",
        },
      ];
    }
    if (impactKind === "grace-period" || impactKind === "before-registration") {
      return [
        {
          label: "غائب بدون خصم: فترة سماح",
          tone: "safe",
          detail: "الطالب داخل فترة السماح أو الامتحان قبل تاريخ تسجيله.",
        },
      ];
    }
    if (impactKind === "excused") {
      return [
        {
          label: "غائب بدون خصم: إجازة",
          tone: "safe",
          detail: "توجد إجازة أو عذر معتمد يغطي تاريخ هذا الامتحان.",
        },
      ];
    }
    if (impactKind === "no-discount-protected" || exam.noDiscount) {
      return [
        {
          label: "غائب بدون خصم: الامتحان بدون خصم",
          tone: "safe",
          detail: "إعدادات الامتحان تمنع خصم الفرص لهذا الامتحان.",
        },
      ];
    }
    return [
      {
        label: "غائب يحتاج مراجعة أثر الخصم",
        tone: "warning",
        detail: "حالة الغياب واضحة، لكن أثر الخصم غير محسوم من قواعد التصنيف.",
      },
    ];
  }

  if (isDeductedImpact(impactKind)) {
    return [
      {
        label: impactKind === "cheating" ? "مخصوم بسبب الغش" : "مخصوم بسبب الدرجة",
        tone: "deducted",
        detail: "هذه الدرجة تدخل ضمن حالات الخصم أو الفصل الأكاديمي.",
      },
    ];
  }
  if (impactKind === "academic-accounting" || impactKind === "failed") {
    return [
      {
        label: "راسب غير مخصوم",
        tone: "warning",
        detail: "الطالب راسب أو ضمن المحاسبة لكنه لم يفقد فرصة بسبب هذه الدرجة.",
      },
    ];
  }
  if (impactKind === "passed" || impactKind === "full-mark") {
    return [
      {
        label: impactKind === "full-mark" ? "درجة كاملة" : "ناجح",
        tone: "success",
      },
    ];
  }
  if (impactKind === "excused" || impactKind === "grace-period" || impactKind === "before-registration" || impactKind === "no-discount-protected") {
    return [
      {
        label: "محمي من الخصم",
        tone: "safe",
      },
    ];
  }
  return [];
}

function gradeMatchesStatusFilter(
  filter: CallStatusFilter,
  kind: CallKind,
  impactKind: GradeClassificationKind,
  grade?: DbGradeLite,
): boolean {
  if (filter === "all") return hasAbsentStatus(grade) || !NON_DISPLAY_CALL_KINDS.has(kind);
  if (filter === "absent") return hasAbsentStatus(grade);
  if (filter === "discounted") return isDeductedImpact(impactKind);
  if (filter === "passed") return kind === "passed" || kind === "full";
  if (filter === "failed") {
    return !hasAbsentStatus(grade) && !isDeductedImpact(impactKind) && (kind === "failed" || kind === "academic-accounting");
  }
  return kind === filter;
}

function includesSearch(query: string, values: Array<unknown>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(needle),
  );
}

function searchableValues(args: {
  student: DbStudentLite;
  grade: DbGradeLite;
  exam: DbExamLite;
  kind: CallKind;
}) {
  const { student, grade, exam, kind } = args;
  return [
    student.name,
    student.code,
    student.phone,
    student.parentPhone,
    student.telegram,
    student.school,
    student.status,
    student.studyType,
    exam.name,
    dayKey(exam.date),
    grade.status,
    grade.notes,
    grade.score,
    callLabel(kind),
    callReason(kind, grade, exam),
  ];
}

function leavesForExam(
  leavesByStudentId: Map<string, DbLeaveLite[]>,
  studentId: string,
  exam: DbExamLite,
): DbLeaveLite[] {
  const examDay = dayKey(exam.date);
  return (leavesByStudentId.get(studentId) || []).filter((leave) => {
    if ((leave.leaveType || "exam") === "period") {
      const from = dayKey(leave.dateFrom || leave.date);
      const to = dayKey(leave.dateTo || leave.dateFrom || leave.date);
      return Boolean(examDay && from && to && examDay >= from && examDay <= to);
    }
    return leave.examId === exam.id;
  });
}

function buildGradeItem(args: {
  grade: DbGradeLite;
  exam: DbExamLite;
  student: DbStudentLite;
  leaves: DbLeaveLite[];
}) {
  const { grade, exam, student, leaves } = args;
  const impactKind = classifyCallImpact(grade, exam, student, leaves);
  const kind = hasAbsentStatus(grade) ? "absent" : gradeKindForCalls(impactKind);
  return {
    id: `grade:${grade.id}`,
    callKey: `grade:${grade.id}`,
    exam: toClientExam(exam),
    grade,
    category: kind,
    impactKind,
    label: callLabel(kind),
    reason: callReason(kind, grade, exam),
    badges: callBadgesForGrade({ grade, exam, impactKind }),
    // آخر امتحانين يجب أن يكونا حسب تاريخ الامتحان نفسه، لا حسب وقت تعديل الدرجة.
    sortTime: new Date(exam.date).getTime() || 0,
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const courseId = normalizeListFilter(searchParams.get("courseId"));
    const examId = normalizeListFilter(searchParams.get("examId"));
    const statusFilter = normalizeCallStatusFilter(searchParams.get("statusFilter"));
    const generalSearch = String(searchParams.get("q") || "").trim();
    const filterSearch = String(searchParams.get("filterQ") || "").trim();
    const page = parsePositiveInt(searchParams.get("page"), 1, 1_000_000);
    const pageSize = parsePositiveInt(searchParams.get("pageSize"), 120, 200);

    if (!courseId || !examId) return emptyResponse(page, pageSize);

    const exam = await db.exam.findUnique({
      where: { id: examId },
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
        opportunitiesPenalty: true,
        dismissalGrade: true,
        noDiscount: true,
        active: true,
        scheduledActivateAt: true,
        scheduledDeactivateAt: true,
      },
    });
    if (!exam || !examIncludesCourse(exam, courseId)) return emptyResponse(page, pageSize);

    const courseExams = ((await db.exam.findMany({
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
        opportunitiesPenalty: true,
        dismissalGrade: true,
        noDiscount: true,
        active: true,
        scheduledActivateAt: true,
        scheduledDeactivateAt: true,
      },
      orderBy: [{ date: "desc" }, { name: "asc" }],
    })) as DbExamLite[]).filter((item) => examIncludesCourse(item, courseId));
    const courseExamById = new Map(courseExams.map((item) => [item.id, item]));
    const courseExamIds = courseExams.map((item) => item.id);

    const selectedGrades = (await db.grade.findMany({
      where: {
        examId,
        student: { is: studentCourseScopeWhere(courseId, "followup") },
      },
      orderBy: [{ student: { name: "asc" } }, { updatedAt: "desc" }],
      select: {
        id: true,
        studentId: true,
        examId: true,
        status: true,
        score: true,
        notes: true,
        academicAccountingChecked: true,
        createdAt: true,
        updatedAt: true,
        student: {
          select: {
            id: true,
            name: true,
            school: true,
            gender: true,
            phone: true,
            parentPhone: true,
            telegram: true,
            courseProgram: true,
            courseTerm: true,
            studyType: true,
            locationScope: true,
            baghdadMode: true,
            mainSite: true,
            subSite: true,
            code: true,
            status: true,
            dismissalType: true,
            dismissalReason: true,
            dismissalNotes: true,
            opportunities: true,
            baseOpportunities: true,
            accountingGraceDays: true,
            createdAt: true,
            courseId: true,
          },
        },
      },
    })) as Array<DbGradeLite & { student: DbStudentLite }>;

    if (selectedGrades.length === 0) {
      return NextResponse.json({
        rows: [],
        students: [],
        grades: [],
        studentCalls: [],
        exams: courseExams.map(toClientExam),
        totalCount: 0,
        page,
        pageSize,
        totalPages: 1,
        hasMore: false,
        source: "database",
      });
    }

    const candidateStudentIds = selectedGrades.map((grade) => grade.studentId);
    const examDayStart = startOfUtcDay(exam.date);
    const examDayEnd = dayAfter(exam.date);
    const selectedLeaves = await db.studentLeave.findMany({
      where: {
        studentId: { in: candidateStudentIds },
        OR: [
          { examId },
          {
            leaveType: "period",
            dateFrom: { lt: examDayEnd },
            dateTo: { gte: examDayStart },
          },
        ],
      },
      select: {
        studentId: true,
        examId: true,
        leaveType: true,
        date: true,
        dateFrom: true,
        dateTo: true,
      },
    });
    const selectedLeavesByStudentId = new Map<string, DbLeaveLite[]>();
    selectedLeaves.forEach((leave) => {
      const list = selectedLeavesByStudentId.get(leave.studentId) || [];
      list.push(leave);
      selectedLeavesByStudentId.set(leave.studentId, list);
    });

    const matching = selectedGrades.flatMap((grade) => {
      const student = grade.student as DbStudentLite;
      if (!student || student.status === "مؤرشف") return [];
      const leaves = leavesForExam(selectedLeavesByStudentId, student.id, exam);
      const impactKind = classifyCallImpact(grade, exam, student, leaves);
      const kind = hasAbsentStatus(grade) ? "absent" : gradeKindForCalls(impactKind);
      if (!gradeMatchesStatusFilter(statusFilter, kind, impactKind, grade)) return [];
      const values = searchableValues({ student, grade, exam, kind });
      if (generalSearch && !includesSearch(generalSearch, values)) return [];
      if (filterSearch && !includesSearch(filterSearch, values)) return [];
      return [{ student, grade, kind }];
    });

    const sortedMatching = matching.sort((a, b) => {
      const aTime = new Date(exam.date).getTime() || 0;
      const bTime = new Date(exam.date).getTime() || 0;
      return bTime - aTime || a.student.name.localeCompare(b.student.name, "ar");
    });

    const totalCount = sortedMatching.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const paged = sortedMatching.slice((page - 1) * pageSize, page * pageSize);
    const pagedStudentIds = paged.map((item) => item.student.id);
    const pagedStudentsWithOpportunity = await attachStudentOpportunitySnapshots(
      paged.map((item) => item.student),
    );
    const pagedStudentById = new Map(
      pagedStudentsWithOpportunity.map((student) => [student.id, student]),
    );

    const [recentGrades, relevantLeaves, studentCalls] = (pagedStudentIds.length
      ? await withFollowupTables(
          () =>
            Promise.all([
              db.grade.findMany({
                where: {
                  studentId: { in: pagedStudentIds },
                  examId: { in: courseExamIds },
                },
                select: {
                  id: true,
                  studentId: true,
                  examId: true,
                  status: true,
                  score: true,
                  notes: true,
                  academicAccountingChecked: true,
                  createdAt: true,
                  updatedAt: true,
                },
              }),
              db.studentLeave.findMany({
                where: {
                  studentId: { in: pagedStudentIds },
                  OR: [
                    { examId: { in: courseExamIds } },
                    { leaveType: "period" },
                  ],
                },
                select: {
                  studentId: true,
                  examId: true,
                  leaveType: true,
                  date: true,
                  dateFrom: true,
                  dateTo: true,
                },
              }),
              db.studentCall.findMany({
                where: {
                  studentId: { in: pagedStudentIds },
                  OR: [
                    { examId: { in: courseExamIds } },
                    { category: CALL_STUDENT_NOTE_CATEGORY },
                  ],
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              }),
            ]),
          "StudentCallCandidates",
        )
      : [[], [], []]) as [DbGradeLite[], DbLeaveLite[], unknown[]];

    const leavesByStudentId = new Map<string, DbLeaveLite[]>();
    relevantLeaves.forEach((leave) => {
      const list = leavesByStudentId.get(leave.studentId) || [];
      list.push(leave);
      leavesByStudentId.set(leave.studentId, list);
    });

    const gradesByStudentId = new Map<string, DbGradeLite[]>();
    recentGrades.forEach((grade) => {
      const list = gradesByStudentId.get(grade.studentId) || [];
      list.push(grade);
      gradesByStudentId.set(grade.studentId, list);
    });

    const rows = paged.map(({ student, grade }) => {
      const authoritativeStudent = pagedStudentById.get(student.id) || student;
      const items = (gradesByStudentId.get(student.id) || [])
        .flatMap((itemGrade) => {
          const itemExam = courseExamById.get(itemGrade.examId);
          if (!itemExam) return [];
          const leaves = leavesForExam(leavesByStudentId, student.id, itemExam);
          return [
            buildGradeItem({
              grade: itemGrade,
              exam: itemExam,
              student: authoritativeStudent,
              leaves,
            }),
          ];
        })
        .sort((a, b) => b.sortTime - a.sortTime || a.exam.name.localeCompare(b.exam.name, "ar"));

      const focusItem =
        items.find((item) => item.grade.id === grade.id || item.exam.id === examId) ||
        buildGradeItem({
          grade,
          exam,
          student: authoritativeStudent,
          leaves: leavesForExam(selectedLeavesByStudentId, student.id, exam),
        });

      return {
        id: `student:${student.id}`,
        student: authoritativeStudent,
        items,
        focusItem,
      };
    });

    return NextResponse.json({
      rows,
      students: rows.map((row) => row.student),
      grades: rows.flatMap((row) => row.items.map((item) => item.grade)),
      exams: courseExams.map(toClientExam),
      studentCalls,
      totalCount,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
      source: "database",
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل طلاب المكالمات من بيانات النظام حالياً.",
    );
  }
}
