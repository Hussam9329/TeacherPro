// «انسحاب»: the name gets «انسحاب» (once) and the student is archived the
// same way «أرشفة» does it, in one transaction; a clash or an archived student
// is refused before anything is written.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
const stubs = {
  // The relation counts and preview token are not under test here.
  "@/lib/student-delete-impact": {
    ARCHIVED_STUDENT_STATUS: "مؤرشف",
    buildStudentArchiveSummary: () => "ملاحظة واحدة",
    getStudentDeleteImpactInTransaction: async (tx, id) => {
      const student = tx.rows.find((row) => row.id === id);
      return student ? { student: { id, name: student.name, code: student.code, status: student.status }, counts: { notes: 1 } } : null;
    },
  },
};
Module._resolveFilename = function (request, parent, ...rest) {
  if (stubs[request]) return request;
  return resolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
const load = Module._load;
Module._load = function (request, ...rest) {
  return stubs[request] || load.call(this, request, ...rest);
};
require.extensions[".ts"] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  file,
);

const { withdrawStudentInTransaction, withdrawnStudentName, StudentWithdrawalError } = require("../src/lib/student-withdrawal-server.ts");
const { getStudentUniqueKeys } = require("../src/lib/student-utils.ts");

function fakeTx(rows) {
  const notes = [];
  const audits = [];
  const tx = {
    rows,
    notes,
    audits,
    student: {
      findUnique: async ({ where }) => rows.find((row) => row.id === where.id) || null,
      findFirst: async ({ where }) => rows.find((row) => row.nameKey === where.nameKey && row.id !== where.id.not) || null,
      update: async ({ where, data }) => Object.assign(rows.find((row) => row.id === where.id), data),
    },
    studentNote: { create: async ({ data }) => notes.push(data) },
    auditLog: { create: async ({ data }) => audits.push(data) },
  };
  return tx;
}
const row = (id, name, status = "مفصول") => ({
  id, name, code: `BIO-${id}`, status, phone: "", telegram: "", opportunities: 2, baseOpportunities: 3,
  nameKey: getStudentUniqueKeys({ id, name, phone: "", telegram: "" }).nameKey,
});
const actor = { id: "u1", name: "حسام" };

(async () => {
  assert.equal(withdrawnStudentName("حسام خليل"), "حسام خليل انسحاب");
  assert.equal(withdrawnStudentName("  حسام خليل انسحاب "), "حسام خليل انسحاب", "the word is added once");

  const tx = fakeTx([row("1", "حسام خليل")]);
  const student = await withdrawStudentInTransaction(tx, "1", actor);
  assert.equal(student.name, "حسام خليل انسحاب");
  assert.equal(student.status, "مؤرشف", "archived");
  assert.equal(student.opportunities, 0);
  assert.equal(student.baseOpportunities, 0);
  assert.equal(student.nameKey, getStudentUniqueKeys({ id: "1", name: "حسام خليل انسحاب", phone: "", telegram: "" }).nameKey, "the name key follows the new name");
  assert.equal(tx.notes.length, 1);
  assert.equal(tx.notes[0].sourceType, "student-archive");
  assert.match(tx.notes[0].text, /الاسم السابق: حسام خليل/);
  assert.equal(tx.audits.length, 1);
  assert.equal(tx.audits[0].action, "انسحاب طالب وأرشفته");

  await assert.rejects(withdrawStudentInTransaction(tx, "1", actor), (error) => error instanceof StudentWithdrawalError && error.status === 409, "an archived student is refused");

  const clash = fakeTx([row("2", "علي حسن"), row("3", "علي حسن انسحاب", "مؤرشف")]);
  await assert.rejects(withdrawStudentInTransaction(clash, "2", actor), (error) => error.status === 409 && /يوجد طالب آخر/.test(error.message));
  assert.equal(clash.rows[0].name, "علي حسن", "nothing is written on a clash");
  assert.equal(clash.rows[0].status, "مفصول");
  assert.equal(clash.notes.length + clash.audits.length, 0);

  await assert.rejects(withdrawStudentInTransaction(fakeTx([]), "x", actor), (error) => error.status === 404);

  const route = fs.readFileSync(path.join(root, "src/app/api/students/withdraw/route.ts"), "utf8");
  assert.ok(route.includes('requirePermissionPrincipal(req, "students.delete")'), "withdrawal needs the archive permission");
  assert.ok(route.includes("withSerializableTransaction"), "one transaction");
  for (const file of ["code-closures-dialog.tsx", "call-notes-management-dialog.tsx"]) {
    const source = fs.readFileSync(path.join(root, "src/components/teacher-pro", file), "utf8");
    assert.ok(source.includes("<WithdrawStudentDialog") && source.includes("canWithdraw"), `${file} offers «انسحاب» behind a permission`);
  }
  assert.ok(fs.readFileSync(path.join(root, "src/components/teacher-pro/code-closures-dialog.tsx"), "utf8").includes("canWithdraw && student.dismissedChecked"), "only on closed codes");
  console.log("PASS: «انسحاب» renames once and archives in one transaction; clashes, archived and missing students are refused untouched.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
