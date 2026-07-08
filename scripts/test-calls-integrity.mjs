import fs from 'node:fs';

const files = {
  followUp: 'src/components/teacher-pro/follow-up.tsx',
  candidates: 'src/app/api/student-calls/candidates/route.ts',
  stats: 'src/app/api/student-calls/stats/route.ts',
  callsRoute: 'src/app/api/student-calls/route.ts',
  api: 'src/lib/api.ts',
  classification: 'src/lib/grade-classification.ts',
};

const read = (file) => fs.readFileSync(file, 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
};

const followUp = read(files.followUp);
const candidates = read(files.candidates);
const stats = read(files.stats);
const callsRoute = read(files.callsRoute);
const api = read(files.api);
const classification = read(files.classification);

assert(
  followUp.includes('const callRows = callRowsFromDb;'),
  'تبويبة المكالمات تعرض الصفوف القادمة من قاعدة البيانات فقط',
);
assert(
  !followUp.includes('const callRows = useMemo<CallStudentRow'),
  'لا يوجد بناء محلي لصفوف المكالمات من كاش الطلاب/الدرجات',
);
assert(
  !followUp.includes('[...studentCalls, ...callPageStudentCalls]'),
  'حالات المكالمات داخل التبويبة لا تختلط مع كاش studentCalls العام',
);
assert(
  followUp.includes('callCourseExamsApi') && followUp.includes('callCourseExamsFromDb'),
  'قائمة امتحانات تبويبة المكالمات تأتي من API قاعدة البيانات',
);
assert(
  followUp.includes('studentCallApi.upsert') && callsRoute.includes('db.$transaction'),
  'حفظ المكالمات يستخدم upsert آمن داخل transaction',
);
assert(
  callsRoute.includes('findFirst') && callsRoute.includes('deleteMany'),
  'منع تكرار سجل المكالمة لنفس الطالب/الامتحان/السبب',
);
assert(
  candidates.includes('rows,') && candidates.includes('source: "database"'),
  'API المرشحين يرجع rows جاهزة من قاعدة البيانات',
);
assert(
  candidates.includes('sortTime: new Date(exam.date).getTime()'),
  'آخر امتحان/آخر امتحانين يعتمد على تاريخ الامتحان لا updatedAt',
);
assert(
  classification.includes('"academic-accounting"') && stats.includes('kind === "passed" || kind === "full"'),
  'فلتر طلاب المحاسبة والناجحين موحد بين stats والقائمة',
);
assert(
  followUp.includes('https://wa.me/') || followUp.includes('whatsappLink(phone || "")'),
  'روابط واتساب تستخدم https://wa.me المناسب للديسكتوب والموبايل',
);
assert(
  !followUp.includes('whatsapp://send'),
  'لا توجد روابط whatsapp:// داخل تبويبة المكالمات',
);

if (process.exitCode) {
  console.error('\nفشل اختبار سلامة تبويبة المكالمات. راجع الرسائل أعلاه.');
  process.exit(process.exitCode);
}
console.log('\nكل اختبارات سلامة تبويبة المكالمات نجحت.');
