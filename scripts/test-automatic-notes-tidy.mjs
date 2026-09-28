import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createTypeScriptModuleLoader() {
  const cache = new Map();

  function resolveSource(specifier, parentFile) {
    const unresolved = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(parentFile), specifier)
        : null;
    if (!unresolved) return null;
    return [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`].find((candidate) =>
      fs.existsSync(candidate),
    ) || null;
  }

  function load(file) {
    const absoluteFile = path.resolve(file);
    if (cache.has(absoluteFile)) return cache.get(absoluteFile).exports;
    const moduleRecord = { exports: {} };
    cache.set(absoluteFile, moduleRecord);
    const compiled = ts.transpileModule(fs.readFileSync(absoluteFile, "utf8"), {
      fileName: absoluteFile,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        esModuleInterop: true,
      },
    }).outputText;
    const localRequire = (specifier) => {
      const resolved = resolveSource(specifier, absoluteFile);
      return resolved ? load(resolved) : require(specifier);
    };
    new Function("exports", "require", "module", "__filename", "__dirname", compiled)(
      moduleRecord.exports,
      localRequire,
      moduleRecord,
      absoluteFile,
      path.dirname(absoluteFile),
    );
    return moduleRecord.exports;
  }

  return (relativeFile) => load(path.join(root, relativeFile));
}

const loadTypeScriptModule = createTypeScriptModuleLoader();

// Automatic notes tidy-up (owner's report of 2026-09-28): what people see,
// what stays stored for the calculation, and what the migration changes.

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const { displayReasonText } = loadTypeScriptModule("src/lib/reason-display.ts");
const { displayOpportunityReason } = loadTypeScriptModule("src/lib/retired-followup-compat.ts");
const banners = loadTypeScriptModule("src/lib/grade-note-banners.ts");
const settlement = loadTypeScriptModule("src/lib/grade-settlement.ts");

test("opportunity and dismissal reasons are shown without technical markers", () => {
  assert.equal(displayReasonText("تلقائي: غياب في امتحان شهري: امتحان 4"), "غياب في امتحان شهري: امتحان 4");
  assert.equal(
    displayReasonText("إعادة تعيين الفرص من إدارة الفرص [قبل: 1 → بعد: 3، فرق: +2]"),
    "إعادة تعيين الفرص من إدارة الفرص (الرصيد من 1 إلى 3)",
  );
  assert.equal(
    displayReasonText("خصم يدوي [مطلوب: 2، مطبّق: 1، قبل: 1 → بعد: 0] [zero-balance-violation]"),
    "خصم يدوي (المطلوب 2، المطبّق 1، الرصيد من 1 إلى 0) (خصم والرصيد صفر)",
  );
  assert.equal(displayReasonText("تراجع موثق عن خصم: سبب قديم [undo-ref:log_1]"), "تراجع موثق عن خصم: سبب قديم");
  assert.equal(
    displayReasonText("إعادة تفعيل [academic-reactivation-link:sourceGradeId=g1&reactivationMode=x]"),
    "إعادة تفعيل",
  );
  assert.equal(
    displayReasonText("مخالفة بعد انتهاء الفرص - خصم يدوي: تأخير [zero-balance-violation]"),
    "مخالفة بعد انتهاء الفرص - خصم يدوي: تأخير (خصم والرصيد صفر)",
  );
  assert.equal(displayReasonText("فصل الطالب: غياب متكرر"), "فصل الطالب: غياب متكرر");
  assert.equal(displayReasonText(null), "");
});

test("the pledge re-activation reason no longer reads garbled", () => {
  const shown = displayOpportunityReason(
    "تثبيت إعادة التفعيل بعد تعهد الطالب: الطالب نشط برصيد فرصتين؛ الوصول إلى 0 لا يفصله",
  );
  assert.equal(shown, "تثبيت إعادة التفعيل: الطالب نشط برصيد فرصتين؛ الوصول إلى 0 لا يفصله");
  assert.doesNotMatch(shown, /بعد إعادة التفعيل الطالب/);
  assert.equal(displayOpportunityReason("تلقائي: غش في امتحان: امتحان 2"), "غش في امتحان: امتحان 2");
});

test("internal grade-note prefixes are hidden but always saved back", () => {
  const effect = "أثر أكاديمي فعّال بعد التسوية: غياب امتحان حالي";
  const settled = "تسوية تاريخية بلا أثر: درجة الفصل الأول";
  assert.equal(banners.visibleGradeNote(effect), "");
  assert.equal(banners.visibleGradeNote("أثر أكاديمي فعّال بعد التسوية: ملاحظة"), "ملاحظة");
  assert.equal(banners.visibleGradeNote(settled), "درجة الفصل الأول");
  assert.equal(banners.shortGradeNoteText(effect), "");

  // Unchanged input keeps the stored note exactly.
  assert.equal(banners.withInternalGradeNotePrefix(settled, banners.editableGradeNote(settled)), settled);
  // Editing or clearing keeps the prefix the calculation reads.
  assert.equal(banners.withInternalGradeNotePrefix(settled, "ملاحظة جديدة"), "تسوية تاريخية بلا أثر: ملاحظة جديدة");
  assert.equal(banners.withInternalGradeNotePrefix(effect, ""), "أثر أكاديمي فعّال بعد التسوية: غياب امتحان حالي");
  assert.equal(banners.withInternalGradeNotePrefix("تسوية تاريخية بلا أثر: x", ""), "تسوية تاريخية بلا أثر:");
  // Typing a space at the end is not eaten by the controlled input.
  const typed = banners.withInternalGradeNotePrefix(settled, "كلمة ");
  assert.equal(banners.editableGradeNote(typed), "كلمة ");
  // Ordinary notes pass through untouched.
  assert.equal(banners.withInternalGradeNotePrefix("ملاحظة عادية", "ملاحظة عادية "), "ملاحظة عادية ");

  const exam = { date: "2026-09-01T00:00:00.000Z" };
  for (const note of [
    banners.withInternalGradeNotePrefix(settled, "ملاحظة جديدة"),
    banners.withInternalGradeNotePrefix(settled, ""),
  ]) {
    assert.equal(settlement.historicalGradeExclusion({ notes: note }, exam, null), "درجة تاريخية محفوظة بلا أثر على الرصيد");
  }
  assert.equal(
    settlement.historicalGradeExclusion({ notes: banners.withInternalGradeNotePrefix(effect, "ملاحظة") }, exam, "2026-09-10"),
    null,
    "the effect prefix still keeps the grade counted",
  );
});

test("short labels for the texts the migration writes and the promoted grade", () => {
  assert.equal(banners.shortGradeNoteText("إجازة"), "إجازة");
  assert.equal(banners.shortGradeNoteText("إجازة: تسوية قديمة"), "إجازة: تسوية قديمة");
  assert.equal(banners.shortGradeNoteText("قبل تسجيل الطالب"), "قبل تسجيل الطالب");
  assert.equal(banners.shortGradeNoteText("فترة سماح"), "فترة سماح");
  assert.equal(banners.shortGradeNoteText("غياب تلقائي"), "غياب تلقائي");
  const promoted = "درجة مدخلة يدوياً لامتحان سابق لتسجيل الطالب؛ قُدّم تاريخ التسجيل إلى تاريخ الامتحان واعتُمدت الدرجة محتسبة.";
  assert.equal(banners.resolveGradeNoteBanner(promoted)?.key, "promoted");
  assert.equal(banners.shortGradeNoteText(promoted), "درجة قبل التسجيل (معتمدة)");
});

test("a leave keeps the teacher's note and uses the covering leave's reason", () => {
  const { composeExcusedGradeNote, teacherPartOfGradeNote, resolveGradeNoteBanner } = banners;
  assert.equal(composeExcusedGradeNote("سفر", ""), "إجازة: سفر");
  assert.equal(composeExcusedGradeNote("سفر", "ولي الأمر اتصل"), "إجازة: سفر — ولي الأمر اتصل");
  assert.equal(composeExcusedGradeNote("", "ولي الأمر اتصل"), "إجازة — ولي الأمر اتصل");
  assert.equal(composeExcusedGradeNote("", ""), "إجازة");
  // Saving again neither loses nor repeats the teacher's words.
  assert.equal(composeExcusedGradeNote("سفر", "إجازة: سفر — ولي الأمر اتصل"), "إجازة: سفر — ولي الأمر اتصل");
  assert.equal(composeExcusedGradeNote("مرض", "إجازة — ولي الأمر اتصل"), "إجازة: مرض — ولي الأمر اتصل");
  // Automatic notes are replaced, never kept as the teacher's note.
  assert.equal(composeExcusedGradeNote("سفر", "قبل تسجيل الطالب"), "إجازة: سفر");
  assert.equal(
    composeExcusedGradeNote("سفر", "تسجيل جماعي كغائب للطلاب", (note) => note.includes("تسجيل جماعي كغائب")),
    "إجازة: سفر",
  );
  assert.equal(teacherPartOfGradeNote("إجازة: سفر"), "");
  assert.deepEqual(
    { key: resolveGradeNoteBanner("إجازة — ولي الأمر اتصل")?.key, detail: resolveGradeNoteBanner("إجازة — ولي الأمر اتصل")?.detail },
    { key: "excused", detail: "ولي الأمر اتصل" },
  );

  const writeback = read("src/lib/academic-grade-writeback-server.ts");
  assert.ok(writeback.includes("async function findBlockingLeave("));
  assert.ok(writeback.includes("excusedLeaveReason = blockingLeave?.reason"));
  assert.ok(!writeback.includes('OR: [{ examId }, { leaveType: "period" }]'), "no uncovered period leave lookup");
  assert.ok(writeback.includes("composeExcusedGradeNote("));
  assert.ok(!writeback.includes("تم تحديث الدرجة من"), "no automatic «updated from» note");
});

test("calls, derived absences and transfers write no automatic clutter", () => {
  const followUp = read("src/components/teacher-pro/follow-up.tsx");
  assert.ok(!followUp.includes("| ${item.exam.name} |"), "the calls page writes no «reason | exam | score» note");
  assert.ok(followUp.includes('notes: existing?.notes || "",'));
  assert.ok(read("src/lib/call-absence.ts").includes('notes: "لم تُسجّل له درجة",'));
  const students = read("src/app/api/students/route.ts");
  assert.ok(students.includes("transferCourseName(lockedStudent.courseId)"));
  assert.ok(!students.includes("${lockedStudent.courseId} إلى دورة"), "the transfer reason names courses, not ids");
});

test("every place that shows a dismissal or opportunity reason cleans it", () => {
  for (const file of [
    "src/components/teacher-pro/student-profile-dialog.tsx",
    "src/components/teacher-pro/opportunities.tsx",
    "src/components/teacher-pro/student-registry-results.tsx",
    "src/components/teacher-pro/code-closures-dialog.tsx",
    "src/components/teacher-pro/dismissed-management.tsx",
    "src/components/teacher-pro/student-registry-helpers.ts",
    "src/components/teacher-pro/student-registry.tsx",
    "src/app/api/dismissed-management/history/route.ts",
    "src/app/api/dismissed-management/list/route.ts",
  ]) {
    assert.ok(read(file).includes("displayReasonText("), `${file} cleans the reason`);
  }
  assert.ok(read("src/lib/retired-followup-compat.ts").includes("return displayReasonText(value)"));
  for (const file of [
    "src/components/teacher-pro/grade-note-banner.tsx",
    "src/components/teacher-pro/grade-records.tsx",
    "src/components/teacher-pro/exam-records.tsx",
    "src/components/teacher-pro/follow-up.tsx",
    "src/app/api/dismissed-management/history/route.ts",
  ]) {
    assert.match(read(file), /visibleGradeNote\(|shortGradeNoteText\(/, `${file} hides internal grade-note prefixes`);
  }
  for (const file of ["src/components/teacher-pro/grade-entry.tsx", "src/components/teacher-pro/grade-records.tsx"]) {
    const source = read(file);
    assert.ok(source.includes("editableGradeNote(") && source.includes("withInternalGradeNotePrefix("), `${file} keeps the prefix when editing`);
  }
});

test("the data migration is reviewed, idempotent in shape, and touches only automatic texts", async () => {
  const name = "20260928160000_tidy_automatic_notes";
  const sql = read(`prisma/migrations/${name}/migration.sql`);
  const policy = JSON.parse(read("prisma/deployment-migration-policy.json"))[name];
  assert.equal(policy?.kind, "audited-data-reconciliation");
  const { validatePendingMigration } = await import(path.join(root, "scripts/check-deployment-contract.mjs"));
  validatePendingMigration(name, sql, policy, true);

  const statements = sql.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(statements, /\b(?:DELETE|INSERT|DROP|TRUNCATE|ALTER)\b/i);
  assert.equal((statements.match(/^UPDATE /gm) || []).length, 6, "six targeted updates");
  for (const text of [
    "'تم تصحيح الدرجة يدوياً بدلاً من التسجيل التلقائي السابق.'",
    "'الطالب مجاز من هذا الامتحان.'",
    "'تسجيل تلقائي: الامتحان يسبق تاريخ تسجيل الطالب'",
    "'تسجيل تلقائي: الطالب ضمن فترة السماح لهذا الامتحان'",
    "'تسجيل تلقائي: لم تُدخل درجة الطالب في امتحان سابق'",
    "'تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم'",
    "'مجاز تلقائياً من تسوية تاريخية'",
    "'إجازة (تسوية قديمة)'",
    "'تم إنشاء هذا السجل تلقائياً من تسوية تاريخية للدرجات المحوّلة من غائب إلى مجاز.'",
  ]) {
    assert.ok(statements.includes(text), `migration handles ${text}`);
  }
  // Texts the calculation reads are never rewritten.
  for (const guarded of ["بلا أثر", "أثر أكاديمي فعّال", "تسوية تاريخية:", "'تلقائي:"]) {
    assert.ok(!statements.includes(guarded), `migration leaves «${guarded}» alone`);
  }
  assert.ok(statements.includes("COALESCE(category, '') <> 'call-student-note'"), "a person's call notes are never touched");
  assert.ok(statements.includes("pg_temp.tp_try_jsonb(snapshot)") && statements.includes("WHERE parsed.doc IS NOT NULL"), "an unreadable snapshot is left as it is");
  assert.ok(statements.includes("tidy.doc IS DISTINCT FROM tidy.original"), "only changed snapshots are rewritten");
});
