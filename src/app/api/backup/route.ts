export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { ensureExamSchema } from "@/lib/exam-schema";
import { ensureTelegramSubmissionSchema } from "@/lib/telegram-submission-schema";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import {
  ensureLogClearBackupTable,
  type LogClearBackupRow,
} from "@/lib/log-clear-backups";

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, [
    "backup.view",
    "accounts.manage",
    "system.settings",
  ]);
  if (authError) return authError;
  const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.backup);
  if (rateLimitError) return rateLimitError;
  try {
    await ensureExamSchema();
    await ensureTelegramSubmissionSchema();
    await ensureLogClearBackupTable();
    const [
      courses,
      chapters,
      courseChapters,
      students,
      exams,
      examCourses,
      grades,
      opportunityLogs,
      studentLeaves,
      studentCalls,
      studentNotes,
      gradeEntryMissingNotes,
      correctionSheets,
      telegramExamSubmissions,
      telegramExamSubmissionVersions,
      studentLeaveGradeBackups,
      studentEnrollmentArchives,
      roles,
      appUsers,
      permissionCatalog,
      auditLogs,
      logClearBackups,
    ] = await Promise.all([
      db.course.findMany(),
      db.chapter.findMany(),
      db.courseChapter.findMany(),
      db.student.findMany(),
      db.exam.findMany(),
      db.examCourse.findMany(),
      db.grade.findMany(),
      db.opportunityLog.findMany(),
      db.studentLeave.findMany(),
      db.studentCall.findMany(),
      db.studentNote.findMany(),
      db.gradeEntryMissingNote.findMany(),
      db.correctionSheet.findMany(),
      db.telegramExamSubmission.findMany(),
      db.telegramExamSubmissionVersion.findMany(),
      db.studentLeaveGradeBackup.findMany(),
      db.studentEnrollmentArchive.findMany(),
      db.role.findMany(),
      db.appUser.findMany(),
      db.permissionCatalog.findMany(),
      db.auditLog.findMany({ orderBy: { time: "asc" } }),
      db.$queryRaw<
        LogClearBackupRow[]
      >`SELECT * FROM "LogClearBackup" ORDER BY "createdAt" ASC`,
    ]);
    const tables = {
      courses,
      chapters,
      courseChapters,
      students,
      exams,
      examCourses,
      grades,
      opportunityLogs,
      studentLeaves,
      studentCalls,
      studentNotes,
      gradeEntryMissingNotes,
      correctionSheets,
      telegramExamSubmissions,
      telegramExamSubmissionVersions,
      studentLeaveGradeBackups,
      studentEnrollmentArchives,
      roles,
      appUsers,
      permissionCatalog,
      auditLogs,
      logClearBackups,
    };
    const counts = Object.fromEntries(
      Object.entries(tables).map(([key, value]) => [key, value.length]),
    );
    const payload = {
      format: "teacherpro-full-backup",
      version: 7,
      exportedAt: new Date().toISOString(),
      counts,
      tables,
    };
    const checksum = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    await writeRequestAuditLog(
      req,
      "النسخ الاحتياطي",
      "تصدير نسخة نظام كاملة",
      { version: 7, counts, checksum },
    );
    return NextResponse.json({ ...payload, checksum });
  } catch (error) {
    return routeErrorResponse(error, "تعذر إنشاء النسخة الاحتياطية الكاملة.");
  }
}
