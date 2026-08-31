// ============================================================================
// verify_grade_score_consistency.mjs
// ----------------------------------------------------------------------------
// Standalone integrity scanner. Connects directly to the production database
// and reports any Grade row that violates the status ↔ score invariant:
//
//   - status === 'درجة'      → score MAY be a non-null integer
//   - status !== 'درجة'      → score MUST be null
//
// Run locally before and after deploying the consistency fix:
//   DATABASE_URL='postgresql://...' node scripts/verify_grade_score_consistency.mjs
//
// Exit codes:
//   0  — no inconsistent rows found (the invariant holds)
//   1  — inconsistent rows found (run the cleanup migration or the auto-fix)
//   2  — connection / query error
// ============================================================================

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const ALLOWED_STATUSES = ['درجة', 'غائب', 'غش', 'مجاز', 'ضمن فترة السماح', 'قبل تسجيل الطالب'];

async function main() {
  console.log('=== فحص سلامة: تناقض الحالة × الدرجة ===\n');

  // 1. Any row with an unknown status?
  const unknownStatusRows = await db.grade.findMany({
    where: { NOT: { status: { in: ALLOWED_STATUSES } } },
    select: {
      id: true,
      studentId: true,
      examId: true,
      status: true,
      score: true,
      updatedAt: true,
    },
    take: 100,
  });
  if (unknownStatusRows.length > 0) {
    console.log(`❌ وُجدت ${unknownStatusRows.length} سجل بحالة غير معروفة:`);
    for (const row of unknownStatusRows) {
      console.log(`   - id=${row.id} status="${row.status}" score=${row.score}`);
    }
    console.log();
  }

  // 2. The core check: any row with status != 'درجة' AND score IS NOT NULL?
  const contradictoryRows = await db.grade.findMany({
    where: {
      AND: [
        { status: { not: 'درجة' } },
        { score: { not: null } },
      ],
    },
    select: {
      id: true,
      studentId: true,
      examId: true,
      status: true,
      score: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  console.log(`النتائج:`);
  console.log(`  صفوف بحالة غير معروفة:        ${unknownStatusRows.length}`);
  console.log(`  صفوف متناقضة (status!=درجة, score!=NULL): ${contradictoryRows.length}\n`);

  // 3. Stale absence notes check — graded rows whose notes still mention
  //    an automatic batch-absence phrase. This is the second root-cause
  //    bug we fixed on 2026-08-20.
  const staleNotesRows = await db.grade.findMany({
    where: {
      status: 'درجة',
      score: { not: null },
      OR: [
        { notes: { contains: 'تسجيل جماعي كغائب' } },
        { notes: { contains: 'تسجيل تلقائي: الامتحان يسبق' } },
        { notes: { contains: 'تسجيل تلقائي: الطالب ضمن فترة السماح' } },
      ],
    },
    select: {
      id: true,
      studentId: true,
      examId: true,
      status: true,
      score: true,
      notes: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  console.log(`  صفوف بملاحظة غياب قديمة على درجة فعلية: ${staleNotesRows.length}`);
  if (staleNotesRows.length > 0) {
    console.log(`\n--- عينة من الصفوف ذات الملاحظات المتناقضة ---`);
    for (const row of staleNotesRows.slice(0, 10)) {
      console.log(
        `  - id=${row.id}\n` +
        `    studentId=${row.studentId}  examId=${row.examId}\n` +
        `    status="${row.status}"  score=${row.score}\n` +
        `    notes="${(row.notes || '').slice(0, 100)}"\n` +
        `    updatedAt=${row.updatedAt.toISOString()}`,
      );
    }
    if (staleNotesRows.length > 10) {
      console.log(`  ... و ${staleNotesRows.length - 10} صف آخر.`);
    }
    console.log();
  }

  if (contradictoryRows.length === 0 && unknownStatusRows.length === 0 && staleNotesRows.length === 0) {
    console.log('✅ قاعدة البيانات نظيفة — لا يوجد أي تناقض بين الحالة والدرجة ولا ملاحظات غياب قديمة.');
    await db.$disconnect();
    process.exit(0);
  }

  if (contradictoryRows.length > 0) {
    console.log('--- عينة من الصفوف المتناقضة ---');
    for (const row of contradictoryRows.slice(0, 50)) {
      console.log(
        `  - id=${row.id}\n` +
        `    studentId=${row.studentId}  examId=${row.examId}\n` +
        `    status="${row.status}"  score=${row.score}\n` +
        `    updatedAt=${row.updatedAt.toISOString()}\n` +
        `    notes="${(row.notes || '').slice(0, 80)}"`,
      );
    }
    if (contradictoryRows.length > 50) {
      console.log(`  ... و ${contradictoryRows.length - 50} صف آخر.`);
    }
    console.log();
  }

  console.log('🔧 الإصلاح الموصى به:');
  console.log('   1. لتناقض الحالة × الدرجة:');
  console.log('      migration 20260820090000_grade_status_score_safety_trigger');
  console.log('      (يقوم بتنظيف الصفوف المتناقضة تلقائياً ويضيف Trigger لمنع تكرارها)');
  console.log('   2. لملاحظات الغياب القديمة على درجات فعلية:');
  console.log('      migration 20260820100000_clean_stale_absence_notes');
  console.log('      (يستبدل النص القديم بـ "تم تصحيح الدرجة يدوياً...")');
  console.log('   3. أو نفّذ يدوياً:');
  console.log('      UPDATE "Grade" SET "score" = NULL');
  console.log('      WHERE "status" IS DISTINCT FROM \'درجة\' AND "score" IS NOT NULL;');
  console.log('      UPDATE "Grade" SET "notes" = \'تم تصحيح الدرجة يدوياً...\'');
  console.log('      WHERE "status" = \'درجة\' AND "score" IS NOT NULL');
  console.log('        AND "notes" LIKE \'%تسجيل جماعي كغائب%\';');
  console.log('   4. أعِد تشغيل هذا السكربت للتأكد من نجاح التنظيف.');

  await db.$disconnect();
  process.exit(
    contradictoryRows.length > 0 || staleNotesRows.length > 0 || unknownStatusRows.length > 0
      ? 1
      : 0,
  );
}

main().catch(async (error) => {
  console.error('❌ خطأ أثناء الفحص:', error);
  await db.$disconnect();
  process.exit(2);
});
