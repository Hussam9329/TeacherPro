export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  hasPermission,
  requirePermissionPrincipal,
} from "@/lib/server-auth";
import { db } from "@/lib/db";
import { settleDueScheduledExamActivations } from "@/lib/scheduled-exam-activation-server";
import {
  databaseMigrationRequiredResponse,
  isMissingDatabaseObjectError,
  routeErrorResponse,
} from "@/lib/route-helpers";
import { baghdadDateKey } from "@/lib/baghdad-time";
import { parseCourseIds } from "@/lib/grade-classification";
import {
  getExamEntryAvailability,
  isAllMainSitesSelection,
  normalizeExamSiteValue,
  splitSelection,
} from "@/lib/exam-utils";
import {
  extractAuditEntityIds,
  type AuditLogEntityLabels,
} from "@/lib/audit-log-display";
import {
  getActiveChapterHealth,
  sanitizeDashboardAuditLog,
} from "@/lib/dashboard-stats";

const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;

type DashboardAlertTone = "danger" | "warning" | "info" | "success";

type DashboardAlert = {
  id: string;
  title: string;
  description: string;
  count: number;
  tone: DashboardAlertTone;
  actionSection:
    | "grade-entry"
    | "student-registry"
    | "follow-up-leaves"
    | "opportunities";
  actionLabel: string;
  actionQuery?: Record<string, string>;
  sample?: string[];
};

type ExamAlertRow = {
  id: string;
  name: string;
  date: Date;
  courseIds: string;
  mainSite: string | null;
  fullMark: number;
  active: boolean;
  scheduledActivateAt: Date | null;
};

type StatsClient = Prisma.TransactionClient;

function dayAfter(value: Date): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function getTodayBaghdadRange(now = new Date()) {
  const baghdadNow = new Date(now.getTime() + BAGHDAD_OFFSET_MS);
  const key = `${baghdadNow.getUTCFullYear()}-${String(
    baghdadNow.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(baghdadNow.getUTCDate()).padStart(2, "0")}`;
  const start = new Date(`${key}T00:00:00.000Z`);
  return { key, start, end: dayAfter(start) };
}

async function countPendingCorrectionItems(tx: StatsClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ count: bigint | number | string }>>`
    SELECT COUNT(*)::bigint AS "count"
    FROM (
      SELECT "studentId", "examId"
      FROM "CorrectionSheet"
      WHERE "status" IS DISTINCT FROM 'مكتمل'
      UNION
      SELECT "studentId", "examId"
      FROM "TelegramExamSubmission"
      WHERE "status" IS DISTINCT FROM 'مكتمل'
    ) AS "pendingCorrectionItems"
  `;
  return Number(rows[0]?.count || 0);
}

async function countActiveExamsWithMissingGrades(
  tx: StatsClient,
  healthyCourseIds: Set<string>,
  now: Date,
) {
  if (healthyCourseIds.size === 0) {
    return {
      examsWithMissingGrades: 0,
      missingGradesTotal: 0,
      sample: [] as string[],
      firstExamId: "",
    };
  }

  const candidates = (await tx.exam.findMany({
    where: {
      OR: [
        { active: true },
        { scheduledActivateAt: { lte: now } },
      ],
    },
    select: {
      id: true,
      name: true,
      date: true,
      courseIds: true,
      mainSite: true,
      fullMark: true,
      active: true,
      scheduledActivateAt: true,
    },
    orderBy: [{ date: "desc" }, { id: "asc" }],
  })) as ExamAlertRow[];

  const exams = candidates.filter(
    (exam) =>
      getExamEntryAvailability(exam, now).available &&
      parseCourseIds(exam.courseIds).some((courseId) =>
        healthyCourseIds.has(courseId),
      ),
  );
  if (exams.length === 0) {
    return {
      examsWithMissingGrades: 0,
      missingGradesTotal: 0,
      sample: [] as string[],
      firstExamId: "",
    };
  }

  // The database receives only the compact exam policy. It performs all
  // student/grade/leave eligibility work and returns one aggregate row per
  // affected exam, so no large academic collections reach the Node process.
  const examPolicyJson = JSON.stringify(
    exams.map((exam) => {
      const selectedMainSites = splitSelection(exam.mainSite);
      return {
        id: exam.id,
        name: exam.name,
        exam_date: baghdadDateKey(exam.date),
        full_mark: exam.fullMark,
        course_ids: Array.from(
          new Set(
            parseCourseIds(exam.courseIds).filter((courseId) =>
              healthyCourseIds.has(courseId),
            ),
          ),
        ),
        main_sites: Array.from(
          new Set(
            selectedMainSites.map(normalizeExamSiteValue).filter(Boolean),
          ),
        ),
        all_sites: isAllMainSitesSelection(selectedMainSites),
      };
    }),
  );

  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      name: string;
      exam_date: Date | string;
      missing_count: bigint | number | string;
    }>
  >(Prisma.sql`
    WITH "examPolicy" AS (
      SELECT *
      FROM jsonb_to_recordset(${examPolicyJson}::jsonb) AS policy(
        id text,
        name text,
        exam_date date,
        full_mark integer,
        course_ids jsonb,
        main_sites jsonb,
        all_sites boolean
      )
    ),
    "eligibleStudents" AS (
      SELECT
        policy.id AS "examId",
        policy.name AS "examName",
        policy.exam_date AS "examDate",
        policy.full_mark AS "fullMark",
        student.id AS "studentId"
      FROM "examPolicy" policy
      CROSS JOIN LATERAL jsonb_array_elements_text(policy.course_ids) course_id(value)
      JOIN "Student" student
        ON student."courseId" = course_id.value
       AND student.status = 'نشط'
      CROSS JOIN LATERAL (
        SELECT
          ((student."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Baghdad')::date AS registration_date,
          CASE
            WHEN LEAST(30, GREATEST(0, student."accountingGraceDays")) > 0
              THEN COALESCE(
                ((student."gracePeriodStartDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Baghdad')::date,
                ((student."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Baghdad')::date
              )
            ELSE ((student."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Baghdad')::date
          END AS grace_start,
          CASE
            WHEN LEAST(30, GREATEST(0, student."accountingGraceDays")) > 0
              THEN LEAST(30, GREATEST(0, student."accountingGraceDays"))
            ELSE 3
          END AS grace_days
      ) grace
      WHERE policy.exam_date >= grace.registration_date
        AND (
          student."gracePeriodEndedAt" IS NOT NULL
          OR NOT (
            policy.exam_date >= grace.grace_start
            AND policy.exam_date < grace.grace_start + grace.grace_days
          )
        )
        AND (
          policy.all_sites
          OR EXISTS (
            SELECT 1
            FROM (
              SELECT CASE
                WHEN site.raw_value = '' THEN ''
                WHEN site.raw_value IN ('اونلاين', 'إونلاين', 'الكتروني', 'إلكتروني') THEN 'أونلاين'
                WHEN site.raw_value LIKE 'خارج القطر%' THEN 'خارج القطر'
                WHEN site.raw_value = 'اربيل' THEN 'أربيل'
                WHEN site.raw_value = 'الانبار' THEN 'الأنبار'
                WHEN site.raw_value = 'البصره' THEN 'البصرة'
                WHEN site.raw_value IN ('الديوانيه', 'القادسية') THEN 'الديوانية'
                WHEN site.raw_value = 'ذي قار' THEN 'الناصرية'
                ELSE site.raw_value
              END AS normalized_value
              FROM (
                SELECT regexp_replace(
                  trim(COALESCE(value.raw_value, '')),
                  '[[:space:]]+',
                  ' ',
                  'g'
                ) AS raw_value
                FROM (VALUES
                  (student."mainSite"),
                  (student."subSite"),
                  (student."locationScope")
                ) value(raw_value)
              ) site
            ) student_site
            JOIN jsonb_array_elements_text(policy.main_sites) selected_site(value)
              ON selected_site.value = student_site.normalized_value
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "StudentLeave" leave_record
          WHERE leave_record."studentId" = student.id
            AND (
              (
                COALESCE(leave_record."leaveType", 'exam') <> 'period'
                AND leave_record."examId" = policy.id
              )
              OR (
                leave_record."leaveType" = 'period'
                AND policy.exam_date BETWEEN
                  ((COALESCE(leave_record."dateFrom", leave_record.date) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Baghdad')::date
                  AND ((COALESCE(leave_record."dateTo", leave_record."dateFrom", leave_record.date) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Baghdad')::date
              )
            )
        )
    )
    SELECT
      eligible."examId" AS id,
      eligible."examName" AS name,
      eligible."examDate" AS exam_date,
      COUNT(*)::bigint AS missing_count
    FROM "eligibleStudents" eligible
    WHERE NOT EXISTS (
      SELECT 1
      FROM "Grade" grade
      WHERE grade."examId" = eligible."examId"
        AND grade."studentId" = eligible."studentId"
        AND (
          grade.status IN (
            'غائب',
            'غش',
            'مجاز',
            'ضمن فترة السماح',
            'قبل تسجيل الطالب'
          )
          OR (
            grade.status = 'درجة'
            AND grade.score IS NOT NULL
            AND grade.score >= 0
            AND grade.score <= eligible."fullMark"
          )
        )
      )
    GROUP BY eligible."examId", eligible."examName", eligible."examDate"
    ORDER BY eligible."examDate" DESC, eligible."examId" ASC
  `);

  const normalizedRows = rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      count: Number(row.missing_count || 0),
    }))
    .filter((row) => row.count > 0);
  return {
    examsWithMissingGrades: normalizedRows.length,
    missingGradesTotal: normalizedRows.reduce(
      (total, row) => total + row.count,
      0,
    ),
    sample: normalizedRows
      .slice(0, 3)
      .map((row) => `${row.name} (${row.count})`),
    firstExamId: normalizedRows[0]?.id || "",
  };
}

async function readRecentDashboardLogs(
  tx: StatsClient,
  canViewLogs: boolean,
) {
  if (!canViewLogs) return [];
  const logs = await tx.auditLog.findMany({
    orderBy: [{ time: "desc" }, { id: "desc" }],
    take: 6,
    select: {
      id: true,
      module: true,
      action: true,
      details: true,
      userName: true,
      time: true,
    },
  });

  const studentIds = new Set<string>();
  const examIds = new Set<string>();
  for (const log of logs) {
    const ids = extractAuditEntityIds(log.details);
    ids.studentIds.forEach((id) => studentIds.add(id));
    ids.examIds.forEach((id) => examIds.add(id));
  }

  const [students, exams] = await Promise.all([
    studentIds.size
      ? tx.student.findMany({
          where: { id: { in: Array.from(studentIds) } },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve([]),
    examIds.size
      ? tx.exam.findMany({
          where: { id: { in: Array.from(examIds) } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const labels: AuditLogEntityLabels = {
    students: Object.fromEntries(
      students.map((student) => [
        student.id,
        student.code ? `${student.name} (${student.code})` : student.name,
      ]),
    ),
    exams: Object.fromEntries(exams.map((exam) => [exam.id, exam.name])),
  };
  return logs.map((log) => sanitizeDashboardAuditLog(log, labels));
}

/**
 * All dashboard numbers are read from one repeatable-read snapshot. This keeps
 * related cards and alerts mutually consistent without locking or mutating any
 * production rows.
 */
export async function GET(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, "system.dashboard");
  if (principalOrError instanceof NextResponse) return principalOrError;
  const canViewLogs = hasPermission(principalOrError, "logs.view");

  try {
    // Dashboard is a natural authenticated heartbeat. Settle due scheduled
    // activations first; the daily Vercel cron remains a no-traffic backstop.
    await settleDueScheduledExamActivations({ batchSize: 5 });
    const snapshot = await db.$transaction(
      async (tx) => {
        const now = new Date();
        const today = getTodayBaghdadRange(now);

        const activeChapterLinks = await tx.courseChapter.findMany({
          where: { active: true, archived: false },
          select: {
            courseId: true,
            chapter: { select: { opportunities: true } },
          },
        });
        const chapterHealth = getActiveChapterHealth(activeChapterLinks);
        const activeStudentGroups = await tx.student.groupBy({
          by: ["courseId"],
          where: { status: "نشط" },
          _count: { _all: true },
        });
        const activeCount = activeStudentGroups.reduce(
          (sum, group) => sum + group._count._all,
          0,
        );
        const studentsWithoutActiveChapterCount = activeStudentGroups.reduce(
          (sum, group) =>
            sum +
            (chapterHealth.activeLinkCountByCourse.has(group.courseId)
              ? 0
              : group._count._all),
          0,
        );
        const studentsWithChapterConflictCount = activeStudentGroups.reduce(
          (sum, group) =>
            sum +
            (chapterHealth.conflictCourseIds.has(group.courseId)
              ? group._count._all
              : 0),
          0,
        );

        const positiveOpportunityCourseIds = new Set(
          activeChapterLinks
            .filter(
              (link) =>
                chapterHealth.healthyCourseIds.has(link.courseId) &&
                link.chapter.opportunities > 0,
            )
            .map((link) => link.courseId),
        );

        const [
          dismissedCount,
          totalCount,
          pendingSheetsCount,
          zeroOpportunityActiveCount,
          todaysLeavesCount,
          recentLogs,
          missingGradesSummary,
        ] = await Promise.all([
          tx.student.count({ where: { status: "مفصول" } }),
          tx.student.count(),
          countPendingCorrectionItems(tx),
          positiveOpportunityCourseIds.size
            ? tx.student.count({
                where: {
                  status: "نشط",
                  opportunities: 0,
                  courseId: { in: Array.from(positiveOpportunityCourseIds) },
                },
              })
            : Promise.resolve(0),
          tx.studentLeave.count({
            where: {
              OR: [
                {
                  leaveType: "exam",
                  date: { gte: today.start, lt: today.end },
                },
                {
                  leaveType: "period",
                  dateFrom: { lte: today.start },
                  dateTo: { gte: today.start },
                },
              ],
            },
          }),
          readRecentDashboardLogs(tx, canViewLogs),
          countActiveExamsWithMissingGrades(
            tx,
            chapterHealth.healthyCourseIds,
            now,
          ),
        ]);

        const allAlerts: DashboardAlert[] = [
          {
            id: "exams-missing-grades",
            title: "امتحانات عليها طلاب بلا درجات",
            description: `يوجد ${missingGradesSummary.missingGradesTotal} طالباً نشطاً مستحقاً للإدخال ولم تُسجل له درجة أو حالة معتمدة. لا يشمل العدد المجازين أو طلاب السماح أو من يسبق الامتحان تسجيلهم.`,
            count: missingGradesSummary.examsWithMissingGrades,
            tone: "danger",
            actionSection: "grade-entry",
            actionLabel: "فتح تسجيل الدرجات",
            actionQuery: {
              ...(missingGradesSummary.firstExamId
                ? { examId: missingGradesSummary.firstExamId }
                : {}),
              filterStatus: "غير مسجل",
            },
            sample: missingGradesSummary.sample,
          },
          {
            id: "students-without-active-chapter",
            title: "طلاب بدون فصل نشط",
            description:
              "هؤلاء الطلاب في دورات لا تملك فصلاً نشطاً، لذلك لا يمكن تطبيق قواعد الامتحان والفرص عليهم بصورة صحيحة.",
            count: studentsWithoutActiveChapterCount,
            tone: "warning",
            actionSection: "student-registry",
            actionLabel: "مراجعة سجل الطلاب",
            actionQuery: { registryIssue: "no-active-chapter" },
          },
          {
            id: "students-with-active-chapter-conflict",
            title: "طلاب ضمن دورات لها أكثر من فصل نشط",
            description:
              "هذه الدورات مرتبطة بأكثر من فصل نشط في الوقت نفسه، لذلك يجب حسم الفصل المعتمد قبل أي محاسبة جديدة.",
            count: studentsWithChapterConflictCount,
            tone: "danger",
            actionSection: "student-registry",
            actionLabel: "مراجعة التعارض",
            actionQuery: { registryIssue: "active-chapter-conflict" },
          },
          {
            id: "today-leaves",
            title: "إجازات اليوم",
            description: `إجازات مطابقة لتاريخ اليوم ${today.key} بتوقيت بغداد، وتشمل إجازات اليوم والإجازات الممتدة.`,
            count: todaysLeavesCount,
            tone: "info",
            actionSection: "follow-up-leaves",
            actionLabel: "فتح الإجازات",
            actionQuery: { dashboardDate: today.key },
          },
          {
            id: "active-zero-opportunities",
            title: "طلاب نشطون بفرص صفر",
            description:
              "طلاب نشطون رصيدهم صفر ضمن فصول سقف فرصها أكبر من صفر، وهذا يحتاج مراجعة قبل أي خصم جديد.",
            count: zeroOpportunityActiveCount,
            tone: "danger",
            actionSection: "opportunities",
            actionLabel: "فتح إدارة الفرص",
            actionQuery: { status: "no-opportunities" },
          },
        ];

        return {
          activeStudents: activeCount,
          dismissedStudents: dismissedCount,
          totalStudents: totalCount,
          pendingCorrectionSheets: pendingSheetsCount,
          alerts: allAlerts.filter((alert) => alert.count > 0),
          recentLogs,
          canViewLogs,
          source: "database" as const,
          generatedAt: now.toISOString(),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 10_000,
        timeout: 55_000,
      },
    );

    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    if (isMissingDatabaseObjectError(error)) {
      return databaseMigrationRequiredResponse(
        "بيانات لوحة النظام غير جاهزة بعد وتحتاج تحديث مخطط البيانات بواسطة مسؤول النظام. لم تتغير أي بيانات.",
      );
    }
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات لوحة النظام حالياً. لم تتغير أي بيانات.",
    );
  }
}
