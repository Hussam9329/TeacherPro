export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/lib/server-auth';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, ['backup.view', 'accounts.manage', 'system.settings']);
  if (authError) return authError;

  const [
    courses,
    sites,
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
    demoCopies,
  ] = await Promise.all([
    db.course.findMany(),
    db.site.findMany(),
    db.chapter.findMany(),
    db.courseChapter.findMany(),
    db.student.findMany(),
    db.exam.findMany(),
    db.grade.findMany(),
    db.opportunityLog.findMany(),
    db.studentLeave.findMany(),
    db.studentCall.findMany(),
    db.studentNote.findMany(),
    db.correctionSheet.findMany(),
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
    db.demoCopy.findMany(),
  ]);

  return NextResponse.json({
    version: 4,
    exportedAt: new Date().toISOString(),
    courses,
    sites,
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
    demoCopies,
  });
}
