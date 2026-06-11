export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/lib/server-auth';
import { db } from '@/lib/db';
import { findManyOrEmpty, routeErrorResponse } from '@/lib/route-helpers';
import { withFollowupTables } from '@/lib/followup-schema';

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['backup.view', 'accounts.manage', 'system.settings']);
  if (authError) return authError;

  try {
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
      db.auditLog.findMany(),
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
