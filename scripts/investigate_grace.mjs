import { PrismaClient } from '@prisma/client';
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

function norm(s) {
  return String(s || '').trim()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').toLowerCase();
}

async function main() {
  console.log('=== التحقيق في مشكلة فترة السماح والغياب ===\n');

  // 1. Find the student
  const students = await db.student.findMany({
    select: {
      id: true, name: true, code: true, status: true,
      opportunities: true, baseOpportunities: true,
      createdAt: true, accountingGraceDays: true,
      courseId: true,
      course: { select: { name: true } },
    },
  });

  const target = students.find(s => norm(s.name).includes(norm('اماني حميد مجيد')));
  if (!target) {
    console.log('لم يتم العثور على الطالبة. البحث الجزئي...');
    const partial = students.filter(s => norm(s.name).includes('اماني') && norm(s.name).includes('حميد'));
    if (partial.length > 0) {
      console.log(`وجدت ${partial.length} طالبة:`);
      partial.forEach(s => console.log(`  ${s.code} | ${s.name} | ${s.status}`));
    }
    return;
  }

  console.log(`الطالبة: ${target.name} (${target.code})`);
  console.log(`  الدورة: ${target.course?.name}`);
  console.log(`  الحالة: ${target.status}`);
  console.log(`  الفرص: ${target.opportunities}/${target.baseOpportunities}`);
  console.log(`  تاريخ التسجيل: ${target.createdAt.toISOString().slice(0, 10)}`);
  console.log(`  فترة السماح: ${target.accountingGraceDays} يوم`);

  // Calculate grace window
  const graceDays = Number(target.accountingGraceDays || 0);
  const regDate = new Date(target.createdAt);
  const graceEnd = new Date(regDate);
  graceEnd.setUTCDate(graceEnd.getUTCDate() + graceDays);
  console.log(`  نهاية فترة السماح: ${graceEnd.toISOString().slice(0, 10)}`);

  // 2. Fetch her grades
  const grades = await db.grade.findMany({
    where: { studentId: target.id },
    include: { exam: { select: { name: true, date: true } } },
    orderBy: { exam: { date: 'asc' } },
  });

  console.log(`\n=== الدرجات (${grades.length}) ===`);
  for (const g of grades) {
    const examDate = g.exam?.date ? new Date(g.exam.date) : null;
    const examDateStr = examDate ? examDate.toISOString().slice(0, 10) : '?';
    const isWithinGrace = graceDays > 0 && examDate && examDate >= regDate && examDate < graceEnd;
    const graceFlag = isWithinGrace ? '🔴 ضمن فترة السماح!' : '✅ خارج فترة السماح';
    console.log(`  ${examDateStr} | ${g.exam?.name || '?'} | status: ${g.status} | score: ${g.score ?? 'null'} | ${graceFlag}`);
  }

  // 3. Fetch her opportunity logs
  const oppLogs = await db.opportunityLog.findMany({
    where: { studentId: target.id },
    orderBy: { date: 'desc' },
    select: { id: true, action: true, amount: true, reason: true, date: true, examId: true },
  });

  console.log(`\n=== سجلات الفرص (${oppLogs.length}) ===`);
  for (const log of oppLogs) {
    console.log(`  ${log.date.toISOString().slice(0, 10)} | ${log.action} | amount: ${log.amount} | ${log.reason || ''}`);
  }

  // 4. Fetch her student calls
  const calls = await db.studentCall.findMany({
    where: { studentId: target.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, category: true, target: true, status: true, notes: true, createdAt: true, examId: true },
  });

  console.log(`\n=== المكالمات (${calls.length}) ===`);
  for (const c of calls) {
    console.log(`  ${c.createdAt.toISOString().slice(0, 10)} | ${c.category} | target: ${c.target} | status: ${c.status} | notes: ${c.notes || ''}`);
  }

  // 5. Check if grace period actually protects in the academic engine
  console.log(`\n=== تحليل المنطق ===`);
  console.log(`  تاريخ التسجيل: ${regDate.toISOString().slice(0, 10)}`);
  console.log(`  فترة السماح: ${graceDays} يوم`);
  console.log(`  نهاية فترة السماح: ${graceEnd.toISOString().slice(0, 10)}`);
  
  const gradesInGrace = grades.filter(g => {
    const examDate = g.exam?.date ? new Date(g.exam.date) : null;
    return graceDays > 0 && examDate && examDate >= regDate && examDate < graceEnd;
  });
  console.log(`  درجات ضمن فترة السماح: ${gradesInGrace.length}`);
  
  const absenceInGrace = gradesInGrace.filter(g => g.status === 'غائب');
  console.log(`  غيابات ضمن فترة السماح: ${absenceInGrace.length}`);
  
  if (absenceInGrace.length > 0) {
    console.log(`\n  🔴 المشكلة مؤكدة: يوجد ${absenceInGrace.length} غياب ضمن فترة السماح!`);
    console.log(`  هذا يعني أن النظام سمح بإدخال درجة "غائب" لامتحان ضمن فترة السماح،`);
    console.log(`  ثم ربما خصم الفرص وأدرج اسمها في المكالمات.`);
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
