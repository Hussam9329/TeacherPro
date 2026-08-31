import { PrismaClient } from '@prisma/client';
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function main() {
  console.log('=== فحص الغيابات الخاطئة (قبل التسجيل أو ضمن فترة السماح) ===\n');

  const students = await db.student.findMany({
    select: {
      id: true, name: true, code: true,
      createdAt: true, accountingGraceDays: true,
      grades: {
        where: { status: 'غائب' },
        select: { id: true, examId: true, exam: { select: { name: true, date: true } } },
      },
    },
  });

  let affectedStudents = 0;
  let totalInvalidGrades = 0;
  const cleanupPlan = [];

  for (const s of students) {
    if (s.grades.length === 0) continue;
    const regDate = new Date(s.createdAt);
    const graceDays = Number(s.accountingGraceDays || 0);
    const graceEnd = new Date(regDate);
    graceEnd.setUTCDate(graceEnd.getUTCDate() + graceDays);

    const invalidGrades = [];
    for (const g of s.grades) {
      if (!g.exam?.date) continue;
      const examDate = new Date(g.exam.date);

      // Case 1: exam before registration
      if (examDate < regDate) {
        invalidGrades.push({ gradeId: g.id, examName: g.exam.name, examDate: examDate.toISOString().slice(0,10), reason: 'قبل التسجيل' });
      }
      // Case 2: exam within grace period
      else if (graceDays > 0 && examDate >= regDate && examDate < graceEnd) {
        invalidGrades.push({ gradeId: g.id, examName: g.exam.name, examDate: examDate.toISOString().slice(0,10), reason: 'ضمن فترة السماح' });
      }
    }

    if (invalidGrades.length > 0) {
      affectedStudents++;
      totalInvalidGrades += invalidGrades.length;
      cleanupPlan.push({ studentId: s.id, studentName: s.name, studentCode: s.code, regDate: regDate.toISOString().slice(0,10), graceDays, invalidGrades });
    }
  }

  console.log(`النتائج:`);
  console.log(`  الطلاب المتأثرون: ${affectedStudents}`);
  console.log(`  الغيابات الخاطئة: ${totalInvalidGrades}`);

  if (cleanupPlan.length > 0) {
    console.log(`\n--- قائمة الطلاب المتأثرين ---`);
    for (const c of cleanupPlan) {
      console.log(`\n${c.studentCode} | ${c.studentName} | تسجيل: ${c.regDate} | سماح: ${c.graceDays}يوم`);
      for (const g of c.invalidGrades) {
        console.log(`  ❌ ${g.examDate} | ${g.examName} | ${g.reason} | gradeId: ${g.gradeId}`);
      }
    }
  }

  // Save the plan for the cleanup script
  const fs = await import('fs');
  fs.writeFileSync('/tmp/cleanup_plan.json', JSON.stringify(cleanupPlan, null, 2));
  console.log(`\nتم حفظ خطة التنظيف في /tmp/cleanup_plan.json`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
