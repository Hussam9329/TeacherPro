import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const [courses, groups, sites, chapters, courseChapters, students, exams, grades, opportunityLogs, correctionSheets, users, logs, whatsappReports, whatsappQueue] = await Promise.all([
    db.course.findMany(),
    db.group.findMany(),
    db.site.findMany(),
    db.chapter.findMany(),
    db.courseChapter.findMany(),
    db.student.findMany(),
    db.exam.findMany(),
    db.grade.findMany(),
    db.opportunityLog.findMany(),
    db.correctionSheet.findMany(),
    db.appUser.findMany(),
    db.auditLog.findMany(),
    db.whatsAppReport.findMany(),
    db.whatsAppMessage.findMany(),
  ]);

  return NextResponse.json({ version: 2, exportedAt: new Date().toISOString(), courses, groups, sites, chapters, courseChapters, students, exams, grades, opportunityLogs, correctionSheets, users, logs, whatsappReports, whatsappQueue });
}
