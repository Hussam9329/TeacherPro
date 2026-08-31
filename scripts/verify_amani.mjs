import { PrismaClient } from '@prisma/client';
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function main() {
  const s = await db.student.findFirst({
    where: { code: 'BIO-1830' },
    select: {
      name: true, code: true, status: true,
      opportunities: true, baseOpportunities: true,
      createdAt: true, accountingGraceDays: true,
      grades: {
        select: { id: true, status: true, score: true, exam: { select: { name: true, date: true } } },
        orderBy: { exam: { date: 'asc' } },
      },
      opportunityLogs: { select: { action: true, amount: true, reason: true, date: true }, orderBy: { date: 'desc' } },
    },
  });

  console.log('=== حالة أماني بعد التنظيف ===');
  console.log(`الاسم: ${s.name} (${s.code})`);
  console.log(`الحالة: ${s.status}`);
  console.log(`الفرص: ${s.opportunities}/${s.baseOpportunities}`);
  console.log(`تاريخ التسجيل: ${s.createdAt.toISOString().slice(0,10)}`);
  console.log(`فترة السماح: ${s.accountingGraceDays} يوم`);
  console.log(`\nالدرجات المتبقية (${s.grades.length}):`);
  for (const g of s.grades) {
    const d = g.exam?.date ? new Date(g.exam.date).toISOString().slice(0,10) : '?';
    console.log(`  ${d} | ${g.exam?.name} | ${g.status} | ${g.score ?? 'null'}`);
  }
  console.log(`\nسجلات الفرص (${s.opportunityLogs.length}):`);
  for (const log of s.opportunityLogs) {
    console.log(`  ${log.date.toISOString().slice(0,10)} | ${log.action} | ${log.amount} | ${log.reason}`);
  }
}

main().catch(console.error).finally(() => db.$disconnect());
