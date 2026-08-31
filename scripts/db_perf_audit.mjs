// فحص شامل لأداء قاعدة البيانات
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

async function raw(query, label) {
  try {
    const start = Date.now();
    const result = await db.$queryRawUnsafe(query);
    const elapsed = Date.now() - start;
    // Convert BigInt to Number for JSON serialization
    const serialized = JSON.parse(JSON.stringify(result, (_, v) =>
      typeof v === 'bigint' ? Number(v) : v
    ));
    console.log(`\n=== ${label} (${elapsed}ms) ===`);
    console.log(JSON.stringify(serialized, null, 2));
    return serialized;
  } catch (err) {
    console.log(`\n=== ${label} (ERROR) ===`);
    console.log(err.message);
    return null;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   فحص أداء قاعدة بيانات TeacherPro — تقرير شامل         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // 1. حجم الجداول
  await raw(`
    SELECT
      relname AS table_name,
      n_live_tup AS row_count,
      pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
      pg_size_pretty(pg_relation_size(relid)) AS table_size,
      pg_size_pretty(pg_indexes_size(relid)) AS indexes_size
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 25
  `, '1. حجم الجداول (الأكبر أولاً)');

  // 2. الفهارس غير المستخدمة (لم تُستخدم منذ آخر reset للإحصائيات)
  await raw(`
    SELECT
      schemaname AS schema,
      relname AS table,
      indexrelname AS index,
      idx_scan AS scans,
      idx_tup_read AS tuples_read,
      idx_tup_fetch AS tuples_fetched,
      pg_size_pretty(pg_relation_size(indexrelid)) AS size
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
      AND schemaname = 'public'
      AND indexrelname NOT LIKE '%_pkey'
    ORDER BY pg_relation_size(indexrelid) DESC
    LIMIT 20
  `, '2. الفهارس غير المستخدمة (مرشحة للحذف)');

  // 3. الفهارس الأكثر استخداماً
  await raw(`
    SELECT
      relname AS table,
      indexrelname AS index,
      idx_scan AS scans,
      idx_tup_read AS tuples_read,
      pg_size_pretty(pg_relation_size(indexrelid)) AS size
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
    ORDER BY idx_scan DESC
    LIMIT 15
  `, '3. الفهارس الأكثر استخداماً');

  // 4. الإحصائيات الإجمالية
  await raw(`
    SELECT
      (SELECT count(*) FROM "Student") AS students,
      (SELECT count(*) FROM "Grade") AS grades,
      (SELECT count(*) FROM "OpportunityLog") AS opportunity_logs,
      (SELECT count(*) FROM "Exam") AS exams,
      (SELECT count(*) FROM "Course") AS courses,
      (SELECT count(*) FROM "AuditLog") AS audit_logs,
      (SELECT count(*) FROM "StudentLeave") AS leaves,
      (SELECT count(*) FROM "TelegramExamSubmission") AS telegram_submissions,
      (SELECT count(*) FROM "CorrectionSheet") AS correction_sheets
  `, '4. الإحصائيات الإجمالية');

  // 5. أبطأ الاستعلامات (من pg_stat_statements لو متاح)
  await raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
    ) AS has_pg_stat_statements
  `, '5. pg_stat_statements متاح؟');

  // 6. قياس زمن استعلامات حقيقية من الـ application
  const start1 = Date.now();
  await db.student.count();
  console.log(`\n=== 6a. student.count() (${Date.now() - start1}ms) ===`);

  const start2 = Date.now();
  await db.student.findMany({ take: 50, select: { id: true, name: true, code: true, status: true, opportunities: true, courseId: true } });
  console.log(`=== 6b. student.findMany(50) (${Date.now() - start2}ms) ===`);

  const start3 = Date.now();
  await db.grade.count();
  console.log(`=== 6c. grade.count() (${Date.now() - start3}ms) ===`);

  const start4 = Date.now();
  await db.grade.findMany({
    take: 50,
    include: { student: { select: { name: true, code: true } }, exam: { select: { name: true } } },
  });
  console.log(`=== 6d. grade.findMany(50) with includes (${Date.now() - start4}ms) ===`);

  const start5 = Date.now();
  await db.opportunityLog.count();
  console.log(`=== 6e. opportunityLog.count() (${Date.now() - start5}ms) ===`);

  const start6 = Date.now();
  await db.opportunityLog.findMany({
    take: 100,
    orderBy: { date: 'desc' },
    include: { student: { select: { name: true, code: true } } },
  });
  console.log(`=== 6f. opportunityLog.findMany(100) recent with student (${Date.now() - start6}ms) ===`);

  const start7 = Date.now();
  await db.auditLog.count();
  console.log(`=== 6g. auditLog.count() (${Date.now() - start7}ms) ===`);

  const start8 = Date.now();
  await db.auditLog.findMany({ take: 100, orderBy: { time: 'desc' } });
  console.log(`=== 6h. auditLog.findMany(100) recent (${Date.now() - start8}ms) ===`);

  // 7. Students with most grades (تحليل N+1 محتمل)
  await raw(`
    SELECT
      s."name",
      s."code",
      COUNT(g."id") AS grade_count
    FROM "Student" s
    LEFT JOIN "Grade" g ON g."studentId" = s."id"
    GROUP BY s."id", s."name", s."code"
    ORDER BY grade_count DESC
    LIMIT 10
  `, '7. الطلاب الأكثر درجات (تحليل N+1)');

  // 8. Exams with most grades
  await raw(`
    SELECT
      e."name",
      e."date",
      COUNT(g."id") AS grade_count
    FROM "Exam" e
    LEFT JOIN "Grade" g ON g."examId" = e."id"
    GROUP BY e."id", e."name", e."date"
    ORDER BY grade_count DESC
    LIMIT 10
  `, '8. الامتحانات الأكثر درجات');

  // 9. Active vs archived students
  await raw(`
    SELECT status, COUNT(*) as count
    FROM "Student"
    GROUP BY status
    ORDER BY count DESC
  `, '9. توزيع حالات الطلاب');

  // 10. فحص آخر تحليل للأداء (ANALYZE)
  await raw(`
    SELECT
      relname AS table,
      last_analyze,
      last_autoanalyze,
      n_mod_since_analyze
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
      AND n_mod_since_analyze > 1000
    ORDER BY n_mod_since_analyze DESC
  `, '10. جداول تحتاج ANALYZE (إحصائيات قديمة)');

  // 11. Database size overall
  await raw(`
    SELECT
      pg_size_pretty(pg_database_size(current_database())) AS db_size,
      (SELECT count(*) FROM pg_stat_user_tables WHERE schemaname='public') AS table_count,
      (SELECT count(*) FROM pg_stat_user_indexes WHERE schemaname='public') AS index_count
  `, '11. الحجم الإجمالي للقاعدة');

  // 12. Connection stats
  await raw(`
    SELECT
      state,
      count(*) AS count
    FROM pg_stat_activity
    WHERE datname = current_database()
    GROUP BY state
  `, '12. حالات الاتصالات');

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   انتهى الفحص                                             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch(console.error).finally(() => db.$disconnect());
