import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

console.log('=== DIAGNOSING SECOND-CHAPTER TRANSITION STATE ===\n');

try {
  const [courses, chapters, links, students, transitionMarker, transitionNotes, settlementLogs] = await Promise.all([
    db.course.findMany({
      select: { id: true, name: true, active: true },
      orderBy: { id: 'asc' },
    }),
    db.chapter.findMany({
      select: { id: true, name: true, opportunities: true },
      orderBy: { id: 'asc' },
    }),
    db.courseChapter.findMany({
      select: {
        id: true,
        courseId: true,
        chapterId: true,
        active: true,
        archived: true,
        course: { select: { name: true } },
        chapter: { select: { name: true, opportunities: true } },
      },
      orderBy: { id: 'asc' },
    }),
    db.student.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        courseId: true,
        status: true,
        opportunities: true,
        baseOpportunities: true,
        dismissalReason: true,
        course: { select: { name: true } },
      },
      orderBy: { id: 'asc' },
    }),
    db.auditLog.findUnique({
      where: { id: 'second_chapter_transition_summer_exemption_v1_20260814' },
      select: { id: true, time: true, action: true },
    }),
    db.studentNote.findFirst({
      where: {
        sourceType: 'second-chapter-transition-snapshot',
        sourceId: 'second_chapter_transition_summer_exemption_v1_20260814',
      },
      select: { id: true, date: true, text: true },
    }),
    db.opportunityLog.findMany({
      where: {
        reason: { startsWith: 'تسوية تاريخية' },
      },
      select: { id: true, studentId: true, date: true, reason: true, action: true, amount: true, chapterId: true },
      orderBy: { date: 'desc' },
      take: 30,
    }),
  ]);

  console.log('--- COURSES ---');
  for (const c of courses) {
    console.log(`[${c.id}] name="${c.name}" active=${c.active}`);
  }

  console.log('\n--- CHAPTERS ---');
  for (const c of chapters) {
    console.log(`[${c.id}] name="${c.name}" opportunities=${c.opportunities}`);
  }

  console.log('\n--- COURSE-CHAPTER LINKS ---');
  for (const l of links) {
    console.log(`[${l.id}] course="${l.course.name}" chapter="${l.chapter.name}" (opps=${l.chapter.opportunities}) active=${l.active} archived=${l.archived}`);
  }

  console.log('\n--- STUDENTS PER COURSE ---');
  const byCourse = new Map();
  for (const s of students) {
    if (!byCourse.has(s.courseId)) byCourse.set(s.courseId, []);
    byCourse.get(s.courseId).push(s);
  }
  for (const [courseId, list] of byCourse) {
    const courseName = list[0].course.name;
    const counts = { نشط: 0, مفصول: 0, مؤرشف: 0, other: 0 };
    for (const s of list) {
      counts[s.status] = (counts[s.status] || 0) + 1;
    }
    console.log(`Course "${courseName}" (id=${courseId}): total=${list.length}, active=${counts['نشط']}, dismissed=${counts['مفصول']}, archived=${counts['مؤرشف']}, other=${counts.other}`);
    // Print dismissed ones with reason
    const dismissed = list.filter(s => s.status === 'مفصول');
    if (dismissed.length > 0) {
      console.log(`  Dismissed in "${courseName}":`);
      for (const s of dismissed) {
        console.log(`    [${s.id}] code=${s.code} name="${s.name}" opps=${s.opportunities}/${s.baseOpportunities} reason="${s.dismissalReason}"`);
      }
    }
  }

  console.log('\n--- TRANSITION MARKER ---');
  if (transitionMarker) {
    console.log(`EXISTS: id=${transitionMarker.id} time=${transitionMarker.time} action="${transitionMarker.action}"`);
  } else {
    console.log('NOT FOUND: second_chapter_transition_summer_exemption_v1_20260814');
  }

  console.log('\n--- TRANSITION NOTES ---');
  if (transitionNotes) {
    console.log(`EXISTS: id=${transitionNotes.id} date=${transitionNotes.date}`);
    console.log(`  text: ${transitionNotes.text?.slice(0, 200)}`);
  } else {
    console.log('No transition student notes found');
  }

  console.log(`\n--- SETTLEMENT LOGS (تسوية تاريخية) count=${settlementLogs.length} ---`);
  for (const l of settlementLogs) {
    console.log(`  [${l.id}] student=${l.studentId} date=${l.date} action="${l.action}" amount=${l.amount} chapterId=${l.chapterId}`);
    console.log(`    reason: ${l.reason?.slice(0, 150)}`);
  }

  // Count per course
  console.log('\n=== SUMMARY: students grouped by status per course ===');
  for (const c of courses) {
    const courseStudents = students.filter(s => s.courseId === c.id);
    if (courseStudents.length === 0) continue;
    const dismissed = courseStudents.filter(s => s.status === 'مفصول');
    const active = courseStudents.filter(s => s.status === 'نشط');
    const archived = courseStudents.filter(s => s.status === 'مؤرشف');
    console.log(`Course "${c.name}" (id=${c.id}, active=${c.active}):`);
    console.log(`  Total: ${courseStudents.length}, Active=${active.length}, Dismissed=${dismissed.length}, Archived=${archived.length}`);
  }

} catch (err) {
  console.error('ERROR:', err);
  process.exit(1);
} finally {
  await db.$disconnect();
}
