#!/usr/bin/env node
// اختبار سلامة إزالة ميزة "فك ارتباط تيليجرام" بالكامل من المشروع.
// المبدأ: لا يبقى أي جذر للميزة — لا مسار API، لا زر، لا نافذة تأكيد،
// لا دالة في طبقة الطلبات، ولا إدخال في سياسة إعادة تشغيل الطفرات.
// وفك الارتباط أصبح يسيراً عبر مسح حقل التيليجرام من نافذة تعديل الطالب
// (للمدير فقط) مع إعادة حساب telegramKey تلقائياً إلى null على الخادم.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

const checks = [];
function check(label, condition) {
  checks.push({ label, ok: Boolean(condition) });
}

const srcFiles = walk(src);
const codeFiles = srcFiles.filter((f) => /\.(ts|tsx|js|jsx|css)$/.test(f));

// 1) لا يوجد أي ملف لمسار فك الارتباط
check('مجلد المسار src/app/api/students/unlink-telegram محذوف نهائياً', !fs.existsSync(path.join(root, 'src/app/api/students/unlink-telegram')));

// 2) لا يوجد أي ذكر للميزة في أي ملف شيفرة داخل src
const offending = codeFiles.filter((f) => {
  const text = fs.readFileSync(f, 'utf8');
  return (
    text.includes('unlink-telegram') ||
    text.includes('unlinkTelegram') ||
    text.includes('TelegramUnlink') ||
    text.includes('فك ارتباط تيليجرام') ||
    text.includes('فك الارتباط') ||
    text.includes('تأكيد فك')
  );
});
check(
  'لا يوجد أي ذكر لفك ارتباط تيليجرام في شيفرة src بالكامل' + (offending.length ? ` (المخالف: ${offending.map((f) => path.relative(root, f)).join(', ')})` : ''),
  offending.length === 0,
);

// 3) طبقة الطلبات لم تعد تعرف unlinkTelegram
const apiText = fs.readFileSync(path.join(root, 'src/lib/api.ts'), 'utf8');
check('طبقة الطلبات api.ts خالية من unlinkTelegram', !apiText.includes('unlinkTelegram'));

// 4) سياسة إعادة تشغيل الطفرات لم تعد تعرف المسار المحذوف
const replayText = fs.readFileSync(path.join(root, 'src/lib/mutation-replay-policy.ts'), 'utf8');
check('سياسة إعادة تشغيل الطفرات خالية من مسار unlink-telegram', !replayText.includes('unlink-telegram'));

// 5) مسار تحديث الطالب: مسح التيليجرام مسموح للمدير ويعيد حساب telegramKey
const studentsRoute = fs.readFileSync(path.join(root, 'src/app/api/students/route.ts'), 'utf8');
check('مسار تحديث الطالب يبقي تعديل التيليجرام حصرياً لمدير النظام', studentsRoute.includes('تعديل ارتباط تيليجرام متاح لمدير النظام فقط'));
check('مسار تحديث الطالب يعيد حساب telegramKey عند تغيير التيليجرام (يفك الارتباط عند المسح)', studentsRoute.includes('if (data.telegram !== undefined)') && studentsRoute.includes('data.telegramKey = identityKeys.telegramKey'));
check('مسار تحديث الطالب لا يعود يحظر مسح التيليجرام أو يذكر زراً محذوفاً', !studentsRoute.includes('استخدم زر فك ارتباط تيليجرام'));

// 6) واجهة سجل الطلاب تحتفظ بحقل تعديل التيليجرام للمدير فقط
const registry = fs.readFileSync(path.join(root, 'src/components/teacher-pro/student-registry.tsx'), 'utf8');
check('واجهة السجل تحتفظ بحقل تعديل التيليجرام (يصلح لربط حساب جديد)', registry.includes('updateEditTelegram') && registry.includes('edit-telegram'));

// 7) تسجيل اختبار الإزالة في package.json ضمن سلسلة الفحوصات
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check('اختبار إزالة فك الارتباط مسجل في package.json', Boolean(pkg.scripts['test:telegram-unlink-removal']));
check('اختبار الإزالة مدمج في سلسلة test:side-effects', typeof pkg.scripts['test:side-effects'] === 'string' && pkg.scripts['test:side-effects'].includes('test:telegram-unlink-removal'));

let failed = 0;
for (const { label, ok } of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} فحوصات ناجحة`);
process.exit(failed ? 1 : 0);
