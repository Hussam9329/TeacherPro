import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { hasPermission, type AuthPrincipal } from "@/lib/server-auth";

export const STUDENT_PROFILE_AUDIT_LIMIT = 100;

export const STUDENT_PROFILE_ACCESS_PERMISSIONS = [
  "students.view",
  "grades.view",
  "grades.add",
  "grades.edit",
  "opportunities.view",
  "follow-up.view",
  "follow-up.calls.view",
  "follow-up.leaves.view",
  "follow-up.pledges.view",
  "logs.view",
  "correction.view",
] as const;

export type StudentProfileSectionAccess = {
  students: boolean;
  grades: boolean;
  opportunities: boolean;
  followUp: boolean;
  logs: boolean;
  correction: boolean;
  archives: boolean;
};

export function studentProfileSectionAccess(
  principal: AuthPrincipal,
): StudentProfileSectionAccess {
  const students = hasPermission(principal, "students.view");
  const grades = ["grades.view", "grades.add", "grades.edit"].some(
    (permission) => hasPermission(principal, permission),
  );
  const opportunities = hasPermission(principal, "opportunities.view");
  const followUp = [
    "follow-up.view",
    "follow-up.calls.view",
    "follow-up.leaves.view",
    "follow-up.pledges.view",
  ].some((permission) => hasPermission(principal, permission));
  const logs = hasPermission(principal, "logs.view");
  const correction = hasPermission(principal, "correction.view");

  return {
    students,
    grades,
    opportunities,
    followUp,
    logs,
    correction,
    archives: students,
  };
}

export function studentProfileStudentForAccess<T extends Record<string, unknown>>(
  student: T,
  access: StudentProfileSectionAccess,
): Record<string, unknown> {
  if (access.students) return student;
  const allowed = new Set([
    "id",
    "courseId",
    "opportunities",
    "baseOpportunities",
    "opportunityLimit",
    "opportunitySource",
    "opportunityLimitSource",
    "opportunityHealth",
    "activeChapterConflictCount",
    "activeChapter",
    "isOpportunityFull",
    "isOpportunityOverLimit",
    "hasActiveChapter",
  ]);
  return Object.fromEntries(
    Object.entries(student).filter(([key]) => allowed.has(key)),
  );
}

export const STUDENT_PROFILE_STUDENT_SELECT = {
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
  gracePeriodStartDate: true,
  createdAt: true,
  courseId: true,
} satisfies Prisma.StudentSelect;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function auditDetailsMatchStudent(
  details: string | null | undefined,
  student: { id: string; code: string },
): boolean {
  const text = String(details || "");
  if (!text) return false;
  const matchesExactToken = (value: string) => {
    const token = String(value || "").trim();
    if (!token) return false;
    return new RegExp(
      `(^|[^\\p{L}\\p{N}_])${escapeRegExp(token)}($|[^\\p{L}\\p{N}_])`,
      "iu",
    ).test(text);
  };
  if (matchesExactToken(student.id)) return true;
  const code = String(student.code || "").trim();
  if (!code) return false;

  // Audit details are legacy free text. Match the unique student code only as
  // a complete token so code "123" cannot pull another student's "1234" log.
  return matchesExactToken(code);
}

export async function loadStudentProfileAuditLogs(
  client: Pick<Prisma.TransactionClient, "auditLog">,
  student: { id: string; code: string },
  options: { from?: Date | null; limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit || STUDENT_PROFILE_AUDIT_LIMIT)));
  const scanLimit = Math.min(2000, limit * 5 + 1);
  const candidates = await client.auditLog.findMany({
    where: {
      ...(options.from ? { time: { gte: options.from } } : {}),
      OR: [
        { details: { contains: student.id, mode: "insensitive" } },
        { details: { contains: student.code, mode: "insensitive" } },
      ],
    },
    orderBy: [{ time: "desc" }, { id: "desc" }],
    take: scanLimit,
  });
  const matched = candidates.filter((log) =>
    auditDetailsMatchStudent(log.details, student),
  );
  const logs = matched.slice(0, limit);

  return {
    logs,
    metadata: {
      limit,
      returned: logs.length,
      truncated: matched.length > limit || candidates.length === scanLimit,
      matchSource: "student-id-or-exact-code" as const,
    },
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

export function buildStudentProfileSnapshotVersion(facts: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(stableValue(facts)))
    .digest("hex")
    .slice(0, 24);
  return `student-profile-v2-${digest}`;
}

function orderedFacts(
  values: Array<Record<string, unknown>> | undefined,
  keys: string[],
): unknown[] {
  return [...(values || [])]
    .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")))
    .map((value) =>
      keys.map((key) => {
        const nested = key.split(".").reduce<unknown>((current, part) => {
          if (!current || typeof current !== "object") return null;
          return (current as Record<string, unknown>)[part];
        }, value);
        return nested instanceof Date ? nested.toISOString() : nested ?? null;
      }),
    );
}

export function buildStudentProfileDataVersion(input: {
  student: Record<string, unknown>;
  opportunitySnapshot?: Record<string, unknown> | null;
  grades?: Array<Record<string, unknown>>;
  opportunityLogs?: Array<Record<string, unknown>>;
  studentLeaves?: Array<Record<string, unknown>>;
  studentCalls?: Array<Record<string, unknown>>;
  studentNotes?: Array<Record<string, unknown>>;
  enrollmentArchives?: Array<Record<string, unknown>>;
  auditLogs?: Array<Record<string, unknown>>;
}): string {
  const studentKeys = [
    "id", "courseId", "name", "school", "gender", "phone", "parentPhone",
    "telegram", "courseProgram", "courseTerm", "studyType", "locationScope",
    "baghdadMode", "mainSite", "subSite", "code", "status", "dismissalType",
    "dismissalReason", "dismissalNotes", "opportunities", "baseOpportunities",
    "accountingGraceDays", "gracePeriodStartDate", "createdAt",
  ];
  const student = Object.fromEntries(
    studentKeys.map((key) => [key, input.student[key] ?? null]),
  );
  const opportunitySnapshot = input.opportunitySnapshot
    ? Object.fromEntries(
        [
          "opportunityLimit", "opportunityLimitSource", "opportunityHealth",
          "activeChapterConflictCount", "activeChapter.id", "activeChapter.name",
          "activeChapter.opportunities",
        ].map((key) => {
          const value = key.split(".").reduce<unknown>((current, part) => {
            if (!current || typeof current !== "object") return null;
            return (current as Record<string, unknown>)[part];
          }, input.opportunitySnapshot);
          return [key, value ?? null];
        }),
      )
    : null;

  return buildStudentProfileSnapshotVersion({
    student,
    opportunitySnapshot,
    grades: orderedFacts(input.grades, [
      "id", "examId", "status", "score", "notes", "academicAccountingChecked",
      "createdAt", "updatedAt", "exam.id", "exam.name", "exam.type", "exam.date",
      "exam.fullMark", "exam.passMark", "exam.discountMark", "exam.opportunitiesPenalty",
      "exam.dismissalGrade", "exam.noDiscount", "exam.active",
      "exam.scheduledActivateAt", "exam.scheduledDeactivateAt",
    ]),
    opportunityLogs: orderedFacts(input.opportunityLogs, [
      "id", "examId", "action", "amount", "reason", "date", "chapterId",
      "chapterNameSnapshot",
    ]),
    studentLeaves: orderedFacts(input.studentLeaves, [
      "id", "examId", "leaveType", "reason", "studyType", "date", "dateFrom",
      "dateTo", "notes", "createdAt",
    ]),
    studentCalls: orderedFacts(input.studentCalls, [
      "id", "examId", "category", "target", "phone", "status", "completed",
      "completedAt", "notes", "createdAt",
    ]),
    studentNotes: orderedFacts(input.studentNotes, [
      "id", "kind", "text", "date", "sourceType", "sourceId", "dismissalKey",
      "dismissalType", "dismissalReason", "dismissalDate",
    ]),
    enrollmentArchives: orderedFacts(input.enrollmentArchives, [
      "id", "fromCourseId", "toCourseId", "resetKind", "reason", "createdAt",
    ]),
    auditLogs: orderedFacts(input.auditLogs, [
      "id", "module", "action", "details", "time", "userId", "userName",
    ]),
  });
}

export function summarizeStudentProfileActivity(input: {
  gradeCount: number;
  opportunityLogs: Array<{ action: string; amount: number }>;
  studentNotes: Array<{ kind: string; text: string; dismissalType: string }>;
  callsCount: number;
  leavesCount: number;
  auditCount: number;
}) {
  const deductedMovements = input.opportunityLogs.filter(
    (log) => log.action === "خصم" || log.action === "خصم تلقائي",
  ).length;
  const addedMovements = input.opportunityLogs.filter((log) => {
    const action = String(log.action || "").trim();
    if (action === "إضافة" || action === "إعادة تعيين") return true;
    return action.includes("فرصة أخيرة") && Number(log.amount || 0) > 0;
  }).length;
  const automaticDismissals = input.opportunityLogs.filter((log) =>
    String(log.action || "").includes("فصل"),
  ).length;
  const actionNotes = input.studentNotes.filter(
    (note) => note.kind === "إجراء",
  );
  const manualDismissals = actionNotes.filter((note) =>
    Boolean(
      String(note.dismissalType || "").trim() ||
        /(^|\s)(فصل الطالب|تم فصل الطالب)(\s|$|\()/u.test(
          String(note.text || ""),
        ),
    ),
  ).length;
  // A final-chance marker belongs to the same reactivation and must not turn
  // one reactivation into two events.
  const reactivations = input.opportunityLogs.filter(
    (log) => String(log.action || "").trim() === "إعادة تفعيل",
  ).length;
  const timeline =
    1 +
    Math.max(0, Math.trunc(input.gradeCount || 0)) +
    input.opportunityLogs.length +
    Math.max(0, Math.trunc(input.callsCount || 0)) +
    Math.max(0, Math.trunc(input.leavesCount || 0)) +
    input.studentNotes.length +
    Math.max(0, Math.trunc(input.auditCount || 0));

  return {
    deductedMovements,
    addedMovements,
    dismissals: manualDismissals + automaticDismissals,
    reactivations,
    actions: actionNotes.length + input.opportunityLogs.length,
    timeline,
  };
}

export function sanitizeEnrollmentArchiveSnapshot(
  snapshot: Record<string, unknown>,
  access: StudentProfileSectionAccess,
): Record<string, unknown> {
  const allowed = new Set([
    "version",
    "archivedAt",
    "resetKind",
    "reason",
    "student",
    "fromCourse",
    "toCourse",
    "activeCourseChapters",
  ]);
  if (access.grades) allowed.add("grades");
  if (access.opportunities) allowed.add("opportunityLogs");
  if (access.followUp) {
    allowed.add("studentLeaves");
    allowed.add("studentCalls");
    allowed.add("studentNotes");
  }
  if (access.correction) {
    allowed.add("correctionSheets");
    allowed.add("telegramExamSubmissions");
  }
  if (access.grades && access.followUp) {
    allowed.add("studentLeaveGradeBackups");
  }
  if (access.logs) allowed.add("auditLogs");

  const sanitized = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => allowed.has(key)),
  );
  const counts = snapshot.counts;
  if (counts && typeof counts === "object" && !Array.isArray(counts)) {
    const countKeys = new Set<string>();
    if (access.grades) countKeys.add("grades");
    if (access.opportunities) countKeys.add("opportunityLogs");
    if (access.followUp) {
      countKeys.add("studentLeaves");
      countKeys.add("studentCalls");
      countKeys.add("studentNotes");
    }
    if (access.correction) {
      countKeys.add("correctionSheets");
      countKeys.add("telegramExamSubmissions");
    }
    if (access.grades && access.followUp)
      countKeys.add("studentLeaveGradeBackups");
    if (access.logs) countKeys.add("auditLogs");
    sanitized.counts = Object.fromEntries(
      Object.entries(counts as Record<string, unknown>).filter(([key]) =>
        countKeys.has(key),
      ),
    );
  }
  return sanitized;
}
