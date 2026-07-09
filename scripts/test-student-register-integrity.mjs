import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    console.error(`✖ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${message}`);
  }
};

const registerView = read('src/components/teacher-pro/student-register.tsx');
const studentsRoute = read('src/app/api/students/route.ts');
const api = read('src/lib/api.ts');
const contextPath = 'src/app/api/students/register-context/route.ts';
const contextRoute = existsSync(join(root, contextPath)) ? read(contextPath) : '';
const packageJson = JSON.parse(read('package.json'));

assert(
  registerView.includes('studentRegisterApi.context()'),
  'صفحة تسجيل الطالب تحمل سياق التسجيل من API قاعدة البيانات',
);
assert(
  registerView.includes('studentApi.add({'),
  'صفحة تسجيل الطالب تحفظ الطالب Server-first عبر studentApi.add',
);
assert(
  !/const\s*\{[^}]*\baddStudent\b[^}]*\}\s*=\s*useTeacherStore/s.test(registerView),
  'صفحة تسجيل الطالب لا تستخدم addStudent المحلي المتفائل',
);
assert(
  !registerView.includes('activeChapterForCourse'),
  'صفحة تسجيل الطالب لا تعتمد على activeChapterForCourse من الكاش المحلي',
);
const addCall = registerView.slice(registerView.indexOf('studentApi.add({'), registerView.indexOf('});', registerView.indexOf('studentApi.add({')) + 3);
assert(
  !/\bopportunities\s*:/.test(addCall) && !/\bbaseOpportunities\s*:/.test(addCall),
  'العميل لا يرسل opportunities/baseOpportunities عند التسجيل',
);
assert(
  registerView.includes('selectedCourseHasChapterConflict') && registerView.includes('selectedCourseCannotRegister'),
  'الواجهة تمنع التسجيل عند وجود تعارض فصل نشط',
);
assert(
  existsSync(join(root, contextPath)),
  'يوجد API خاص بسياق تسجيل الطالب',
);
assert(
  contextRoute.includes('requirePermission(req, "students.add")'),
  'API سياق التسجيل محمي بصلاحية students.add',
);
assert(
  contextRoute.includes('source: "database"') && contextRoute.includes('activeChapterCount'),
  'API سياق التسجيل يرجع مصدر قاعدة البيانات وعدد الفصول النشطة',
);
assert(
  api.includes('studentRegisterApi') && api.includes('StudentRegisterContextResponse'),
  'طبقة API تحتوي أنواع ودالة سياق التسجيل',
);
assert(
  /requirePermissionPrincipal\(\s*req,\s*"students\.add"/s.test(studentsRoute),
  'حفظ الطالب يستخدم principal من السيرفر لتسجيل audit log',
);
assert(
  studentsRoute.includes('getNextStudentCode') && !studentsRoute.includes('code: body.code'),
  'السيرفر يولّد كود الطالب ولا يثق بكود مرسل من العميل',
);
assert(
  studentsRoute.includes('course.active === false'),
  'السيرفر يرفض التسجيل في دورة موقوفة عن التسجيل',
);
assert(
  studentsRoute.includes('activeCourseChapters.length > 1'),
  'السيرفر يرفض التسجيل عند وجود أكثر من فصل نشط للدورة',
);
assert(
  studentsRoute.includes('...initialOpportunities'),
  'السيرفر يحسب فرص البداية حصراً من الفصل النشط',
);
assert(
  packageJson.scripts?.['test:student-register-integrity'] === 'node scripts/test-student-register-integrity.mjs',
  'package.json يحتوي سكربت test:student-register-integrity',
);

if (process.exitCode) {
  console.error('\nStudent register integrity checks failed.');
  process.exit(process.exitCode);
}

console.log('\nStudent register integrity checks passed.');
