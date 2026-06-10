import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const [
    courses,
    sites,
    chapters,
    courseChapters,
    students,
    exams,
    grades,
    opportunityLogs,
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
    db.correctionSheet.findMany(),
    db.appUser.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        roleId: true,
        passwordHash: true,
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
    version: 3,
    exportedAt: new Date().toISOString(),
    courses,
    sites,
    chapters,
    courseChapters,
    students,
    exams,
    grades,
    opportunityLogs,
    correctionSheets,
    users,
    roles,
    logs,
    demoCopies,
  });
}
