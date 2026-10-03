#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

// An archived student is frozen: a balance of 0 always, hidden from every
// list and count, and no write of any kind until «استعادة من الأرشيف».
const root = process.cwd();
const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
let failed = false;
const check = (condition, message) => {
  if (condition) console.log(`✅ ${message}`);
  else { failed = true; console.error(`❌ ${message}`); }
};

// 1. The database itself holds an archived balance at 0.
const migrationName = "20261003150000_archived_students_hold_no_opportunities";
const migrationSql = read(`prisma/migrations/${migrationName}/migration.sql`);
const policy = JSON.parse(read("prisma/deployment-migration-policy.json"));
const policyEntry = JSON.stringify(policy).includes(crypto.createHash("sha256").update(migrationSql).digest("hex"));
check(
  /BEFORE INSERT OR UPDATE OF "status", "opportunities", "baseOpportunities" ON "Student"/.test(migrationSql) &&
    /IF NEW\."status" = 'مؤرشف' THEN[\s\S]*NEW\."opportunities" := 0;[\s\S]*NEW\."baseOpportunities" := 0;/.test(migrationSql),
  "قاعدة البيانات تصفّر فرص المؤرشف عند كل حفظ، ولا تقبل غير 0",
);
check(
  /UPDATE "Student" SET "opportunities" = 0, "baseOpportunities" = 0\s+WHERE "status" = 'مؤرشف'/.test(migrationSql),
  "المؤرشفون الحاليون تتصفّر فرصهم مرة واحدة عند النشر",
);
check(policyEntry, "الترحيل مسجّل في سياسة النشر ببصمته الصحيحة");
check(read("src/lib/schema-readiness.ts").includes(`"${migrationName}"`) || read("src/lib/schema-readiness.ts").includes(`'${migrationName}'`),
  "النظام ينتظر هذا الترحيل قبل العمل");

// 2. Archiving zeroes the balance and says so; the snapshot never shows more.
const students = read("src/app/api/students/route.ts");
check(
  /status: ARCHIVED_STUDENT_STATUS,\s*opportunities: 0,\s*baseOpportunities: 0,/.test(students) &&
    students.includes("الفرص قبل الأرشفة:"),
  "الأرشفة تصفّر الفرص وتكتب الرصيد السابق بالملاحظة",
);
const snapshot = read("src/lib/student-opportunity-snapshot-server.ts");
check(
  snapshot.includes("const current = archived ? 0 : opportunityNumber(student.opportunities)") &&
    snapshot.includes("const storedBase = archived ? 0 : opportunityNumber(student.baseOpportunities)"),
  "رصيد المؤرشف المعروض 0 دائماً",
);

// 3. Hidden: «الكل», the dashboard and the follow-up searches leave them out.
check(!read("src/components/teacher-pro/student-registry.tsx").includes("includeArchived"), "سجل الطلاب «الكل» بدون المؤرشفين");
check(read("src/app/api/stats/route.ts").includes('tx.student.count({ where: { status: { not: "مؤرشف" } } })'), "عدد الطلاب في الرئيسية بدون المؤرشفين");
check(read("src/app/api/students/stats/route.ts").includes("- archived;"), "مجموع «الكل» في السجل بدون المؤرشفين");
check((read("src/app/api/student-leaves/students/route.ts").match(/status: \{ not: "مؤرشف" \}/g) || []).length >= 3, "بحث الإجازات وقائمتها بدون المؤرشفين");
check(read("src/app/api/grace-periods/list/route.ts").includes('{ status: { not: "مؤرشف" } }'), "قائمة فترات السماح بدون المؤرشفين");
check(read("src/app/api/grace-periods/search/route.ts").includes('{ status: { not: "مؤرشف" } }'), "بحث فترات السماح بدون المؤرشفين");

// 4. Every write path refuses an archived student.
const guarded = [
  ["src/app/api/grades/route.ts", 3, "الدرجات: تعديل الملاحظة/التدقيق والحذف بالمعرّف وبالطالب+الامتحان"],
  ["src/app/api/student-calls/route.ts", 3, "المكالمات: الحفظ والتعديل والحذف"],
  ["src/app/api/grade-smart-notes/route.ts", 1, "الملاحظات الذكية: المعالجة"],
  ["src/app/api/student-leaves/route.ts", 2, "الإجازات: التعديل والحذف"],
];
for (const [file, minimum, label] of guarded) {
  const source = read(file);
  const calls = (source.match(/await assertStudentsNotArchived\(tx, \[/g) || []).length;
  check(calls >= minimum && source.includes("if (isArchivedStudentError(error)) return archivedStudentLockedResponse();"),
    `${label} — مقفلة للمؤرشف برسالة واضحة`);
}
check(
  /if \(currentStudent\.status === ARCHIVED_STUDENT_STATUS\) \{\s*return archivedStudentLockedResponse\(\);/.test(students) &&
    /if \(lockedStudent\.status === ARCHIVED_STUDENT_STATUS\) \{\s*throw new ArchivedStudentError\(\);/.test(students),
  "تعديل ملف الطالب المؤرشف مرفوض قبل القراءة وداخل المعاملة",
);
const callNotes = read("src/lib/call-note-management-server.ts");
check(
  callNotes.includes('SELECT "id", "courseId", "status" FROM "Student"') &&
    callNotes.includes("throw new CallNoteMutationError(ARCHIVED_STUDENT_LOCKED_MESSAGE, 409);"),
  "ملاحظات المكالمات: إضافة وتعديل وإنجاز مرفوضة للمؤرشف",
);
check(
  !read("src/components/teacher-pro/student-registry-results.tsx").includes('  if (canEdit) {\n    actions.push({\n      key: "edit",'),
  "زر «تعديل» لا يظهر للمؤرشف؛ «استعادة من الأرشيف» وحده",
);

// 5. System-wide maintenance skips them.
const archivedFilter = 'student: { status: { not: "مؤرشف" } }';
check(read("src/lib/protected-grade-markers-server.ts").includes(archivedFilter), "تعديل الامتحان لا يعيد كتابة علامات درجات المؤرشف");
check(read("src/lib/pre-registration-absence-repair-server.ts").includes(archivedFilter), "إصلاح «قبل التسجيل» لا يمس المؤرشف");
check((read("src/lib/pre-registration-grade-promotion-server.ts").match(/student: \{ status: \{ not: "مؤرشف" \} \}/g) || []).length === 2, "اعتماد محاولات «قبل التسجيل» يتجاوز المؤرشف ولا يعدّه");
check(read("src/app/api/students/academic-repair/route.ts").includes('status: "غائب", student: { status: { not: "مؤرشف" } }'), "صيانة الأثر الأكاديمي لا تمس غيابات المؤرشف");
check(read("src/app/api/course-chapters/second-chapter-transition/route.ts").includes('courseStudents.filter((student) => student.status !== "مؤرشف")'), "الانتقال للفصل الثاني لا يكتب ملاحظة على المؤرشف");
const exams = read("src/app/api/exams/route.ts");
check(
  exams.includes("archived.status = 'مؤرشف'") &&
    exams.includes("leaveType: 'exam', student: { status: { not: 'مؤرشف' } }") &&
    exams.includes("where: { examId: exam.id, student: { status: { not: 'مؤرشف' } } }"),
  "تعديل الامتحان (الاسم/التاريخ/النطاق) لا يغيّر سجل المؤرشف أو إجازاته",
);

// 6. The guard itself.
const ts = require("typescript");
const { NextResponse } = require("next/server");
const guardSource = ts.transpileModule(read("src/lib/archived-student-guard.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const guard = { exports: {} };
new Function("module", "exports", "require", guardSource)(guard, guard.exports, (name) => {
  if (name === "next/server") return { NextResponse };
  if (name === "@/lib/student-scope") return { STUDENT_STATUS_ARCHIVED: "مؤرشف" };
  throw new Error(`unexpected dependency: ${name}`);
});
const { assertStudentsNotArchived, isArchivedStudentError, archivedStudentLockedResponse } = guard.exports;
const rows = { a: "نشط", d: "مفصول", x: "مؤرشف" };
const client = {
  student: {
    count: async ({ where }) => where.id.in.filter((id) => rows[id] === where.status).length,
  },
};
await assertStudentsNotArchived(client, ["a", "d", null, undefined, ""]);
check(true, "الطالب النشط والمفصول يمرّان");
let thrown = null;
try { await assertStudentsNotArchived(client, ["a", "x"]); } catch (error) { thrown = error; }
check(isArchivedStudentError(thrown) && thrown.statusCode === 409, "أي مؤرشف بالقائمة يوقف العملية كلها");
const response = archivedStudentLockedResponse();
const body = await response.json();
check(
  response.status === 409 && response.headers.get("X-TeacherPro-Retryable") === "0" &&
    body.code === "ARCHIVED_STUDENT_LOCKED" && body.error.includes("استعادة من الأرشيف"),
  "الرد 409 برسالة عربية تدل على «استعادة من الأرشيف» ولا يُعاد تلقائياً",
);

if (failed) process.exit(1);
