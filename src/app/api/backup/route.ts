export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { findManyOrEmpty, routeErrorResponse } from '@/lib/route-helpers';
import { withFollowupTables } from '@/lib/followup-schema';
import { ensureExamSchema } from '@/lib/exam-schema';
import { API_RATE_LIMITS, checkApiRateLimit } from '@/lib/api-rate-limit';

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['backup.view', 'accounts.manage', 'system.settings']);
  if (authError) return authError;

  const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.backup);
  if (rateLimitError) return rateLimitError;

  try {
    await ensureExamSchema();

    const [
      courses,
      chapters,
      courseChapters,
      students,
      exams,
      grades,
      opportunityLogs,
      studentLeaves,
      studentCalls,
      studentNotes,
      correctionSheets,
      users,
      roles,
      logs,
    ] = await Promise.all([
      db.course.findMany(),
      db.chapter.findMany(),
      db.courseChapter.findMany(),
      db.student.findMany(),
      db.exam.findMany(),
      db.grade.findMany(),
      db.opportunityLog.findMany(),
      withFollowupTables(() => db.studentLeave.findMany(), 'StudentLeave'),
      withFollowupTables(() => db.studentCall.findMany(), 'StudentCall'),
      withFollowupTables(() => db.studentNote.findMany(), 'StudentNote'),
      findManyOrEmpty(db.correctionSheet.findMany(), 'CorrectionSheet'),
      db.appUser.findMany({
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          roleId: true,
          permissions: true,
          active: true,
          createdAt: true,
        },
      }),
      db.role.findMany(),
      // Audit logs grow unbounded over time — limit the payload sent to
      // the client on initial load to the most recent 500 entries.
      // The dedicated /api/logs endpoint supports search + pagination
      // for users who need older entries.
      db.auditLog.findMany({ orderBy: { time: 'desc' }, take: 500 }),
    ]);

    return NextResponse.json({
      version: 4,
      exportedAt: new Date().toISOString(),
      courses,
      chapters,
      courseChapters,
      students,
      exams,
      grades,
      opportunityLogs,
      studentLeaves,
      studentCalls,
      studentNotes,
      correctionSheets,
      users,
      roles,
      logs,
    });
  } catch (error) {
    return routeErrorResponse(error, 'تعذر تحميل البيانات');
  }
}
