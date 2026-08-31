import { PrismaClient } from '@prisma/client';
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function main() {
  console.log('=== تنظيف الغيابات الخاطئة (قبل التسجيل + ضمن فترة السماح) ===\n');

  // Load the cleanup plan
  const fs = await import('fs');
  const plan = JSON.parse(fs.readFileSync('/tmp/cleanup_plan.json', 'utf-8'));

  console.log(`الطلاب المتأثرون: ${plan.length}`);
  console.log(`الغيابات الخاطئة: ${plan.reduce((sum, s) => sum + s.invalidGrades.length, 0)}\n`);

  // Collect all grade IDs to delete
  const gradeIdsToDelete = [];
  const affectedStudentIds = [];
  for (const s of plan) {
    affectedStudentIds.push(s.studentId);
    for (const g of s.invalidGrades) {
      gradeIdsToDelete.push(g.gradeId);
    }
  }

  console.log(`سيتم حذف ${gradeIdsToDelete.length} درجة غياب خاطئة`);
  console.log(`سيتم إعادة احتساب ${affectedStudentIds.length} طالب\n`);

  // Delete invalid grades in batches
  const batchSize = 100;
  let deleted = 0;
  for (let i = 0; i < gradeIdsToDelete.length; i += batchSize) {
    const batch = gradeIdsToDelete.slice(i, i + batchSize);
    const result = await db.grade.deleteMany({
      where: { id: { in: batch } },
    });
    deleted += result.count;
    console.log(`  حذف دفعة ${Math.floor(i / batchSize) + 1}: ${result.count} درجة (المجموع: ${deleted})`);
  }

  console.log(`\n✅ تم حذف ${deleted} درجة غياب خاطئة`);
  console.log(`\n=== إعادة احتساب الطلاب المتأثرين ===`);
  console.log(`سيتم استدعاء /api/students/academic-repair لإعادة احتساب الطلاب المتأثرين`);
  console.log(`(هذا سيتم عبر النظام بعد النشر — أو يمكن تشغيله يدوياً من الأدوات)`);
  
  console.log(`\n=== ملخص التنظيف ===`);
  console.log(`  الطلاب المتأثرون: ${affectedStudentIds.length}`);
  console.log(`  الدرجات المحذوفة: ${deleted}`);
  console.log(`  متوسط الغيابات الخاطئة لكل طالب: ${(deleted / affectedStudentIds.length).toFixed(1)}`);
  
  // Save affected student IDs for recalculation
  fs.writeFileSync('/tmp/affected_student_ids.json', JSON.stringify(affectedStudentIds));
  console.log(`\nتم حفظ قائمة الطلاب المتأثرين في /tmp/affected_student_ids.json`);
  console.log(`يمكن استخدامها لإعادة الاحتساب عبر academic-repair endpoint`);
}

main().catch(e => { console.error('خطأ:', e); process.exit(1); }).finally(() => db.$disconnect());
