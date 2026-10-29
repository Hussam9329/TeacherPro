// «الغاء الانسحاب»: the exact reverse of «انسحاب». «انسحاب» leaves the end of
// the name, and the student leaves the archive through the shared
// «استعادة من الأرشيف» core back to the state they held before: «مفصول» with
// the same reason, or «نشط». Every refusal happens before anything is written.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const recalculations = [];
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
  // The academic engine is tested on its own; here it only records the call
  // and may decide a new state, as a replay of the student's exams would.
  "@/lib/academic-recalculate-server": {
    recalculateStudentsAcademicState: async (ids, options) => {
      recalculations.push({ ids, hasTx: Boolean(options?.tx) });
      const row = options.tx.rows.find((item) => item.id === ids[0]);
      if (row?.replayDismisses) Object.assign(row, { status: "مفصول", opportunities: 0, dismissalReason: "غياب امتحان" });
      return { automaticOpportunityLogs: [] };
    },
  },
};
const resolve = Module._resolveFilename;
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

const {
  StudentWithdrawalError,
  statusBeforeWithdrawal,
  unwithdrawStudentInTransaction,
  unwithdrawnStudentName,
  withdrawStudentInTransaction,
} = require("../src/lib/student-withdrawal-server.ts");
const { ArchiveRestoreError, restoreArchivedStudentInTransaction } = require("../src/lib/student-archive-restore-server.ts");
const { getStudentUniqueKeys } = require("../src/lib/student-utils.ts");

const nameKeyOf = (id, name) => getStudentUniqueKeys({ id, name, phone: "", telegram: "" }).nameKey;

function fakeTx(rows, chapters = [{ chapter: { id: "c1", name: "الفصل الأول", opportunities: 3 } }]) {
  const notes = [];
  const audits = [];
  const updates = [];
  return {
    rows,
    notes,
    audits,
    updates,
    student: {
      // Prisma returns a fresh copy; a later update never changes it.
      findUnique: async ({ where }) => { const found = rows.find((row) => row.id === where.id); return found ? { ...found } : null; },
      findUniqueOrThrow: async ({ where }) => ({ ...rows.find((row) => row.id === where.id) }),
      findFirst: async ({ where }) => rows.find((row) => row.nameKey === where.nameKey && row.id !== where.id.not) || null,
      update: async ({ where, data }) => {
        updates.push(data);
        return Object.assign(rows.find((row) => row.id === where.id), data);
      },
    },
    courseChapter: { findMany: async () => chapters },
    studentNote: { create: async ({ data }) => { notes.push(data); return data; } },
    auditLog: { create: async ({ data }) => audits.push(data) },
  };
}
const row = (id, name, { status = "مؤرشف", dismissalReason = "", dismissalNotes = "" } = {}) => ({
  id, name, code: `BIO-${id}`, courseId: "k1", status, dismissalReason, dismissalNotes,
  phone: "", telegram: "", opportunities: 0, baseOpportunities: 0, nameKey: nameKeyOf(id, name),
});
const actor = { id: "u1", name: "حسام" };
const untouched = (tx) => tx.updates.length + tx.notes.length + tx.audits.length === 0;

(async () => {
  // The name rule removes only the «انسحاب» that withdrawal added.
  assert.equal(unwithdrawnStudentName("حسام خليل انسحاب"), "حسام خليل");
  assert.equal(unwithdrawnStudentName("  حسام خليل   انسحاب "), "حسام خليل");
  assert.equal(unwithdrawnStudentName("حسام خليل"), null, "no word, nothing to remove");
  assert.equal(unwithdrawnStudentName("حسام انسحابي"), null, "only the whole word");
  assert.equal(unwithdrawnStudentName("انسحاب"), null, "never an empty name");
  assert.equal(statusBeforeWithdrawal({ dismissalReason: "غياب امتحان" }), "مفصول");
  assert.equal(statusBeforeWithdrawal({ dismissalReason: "  " }), "نشط");

  // A dismissed student withdrawn from «اغلاق الكودات» returns dismissed, same reason, 0 opportunities.
  {
    const tx = fakeTx([row("1", "حسام خليل", { status: "مفصول", dismissalReason: "غياب امتحان", dismissalNotes: "ملاحظة" })]);
    await withdrawStudentInTransaction(tx, "1", actor);
    assert.equal(tx.rows[0].name, "حسام خليل انسحاب");
    tx.notes.length = 0; tx.audits.length = 0; tx.updates.length = 0; recalculations.length = 0;

    const result = await unwithdrawStudentInTransaction(tx, "1", actor);
    assert.equal(result.student.name, "حسام خليل", "the name is back");
    assert.equal(result.student.nameKey, nameKeyOf("1", "حسام خليل"), "the name key follows the name");
    assert.equal(result.student.status, "مفصول", "back to dismissed");
    assert.equal(result.student.dismissalReason, "غياب امتحان", "the same dismissal reason");
    assert.equal(result.student.dismissalNotes, "ملاحظة");
    assert.equal(result.student.opportunities, 0);
    assert.equal(result.student.baseOpportunities, 3, "the active chapter's limit");
    assert.equal(tx.updates.length, 1, "name and state in one write");
    assert.deepEqual(recalculations, [{ ids: ["1"], hasTx: true }], "recalculated inside the transaction");
    assert.equal(tx.notes.length, 1);
    assert.equal(tx.notes[0].sourceType, "student-archive-restore");
    assert.match(tx.notes[0].text, /الغاء انسحاب الطالب/);
    assert.match(tx.notes[0].text, /الاسم السابق: حسام خليل انسحاب/);
    assert.equal(tx.audits.length, 1);
    assert.equal(tx.audits[0].action, "الغاء انسحاب طالب");
    assert.equal(tx.audits[0].details, "حسام خليل انسحاب ← حسام خليل - BIO-1 - مفصول - رصيد 0/3");
    assert.equal(tx.audits[0].userName, "حسام");
  }

  // An active student withdrawn returns active at the active chapter's balance.
  {
    const tx = fakeTx([row("2", "علي حسن", { status: "نشط" })]);
    await withdrawStudentInTransaction(tx, "2", actor);
    const result = await unwithdrawStudentInTransaction(tx, "2", actor);
    assert.equal(result.student.name, "علي حسن");
    assert.equal(result.student.status, "نشط");
    assert.equal(result.student.dismissalReason, "");
    assert.equal(result.student.opportunities, 3);
    assert.equal(result.student.baseOpportunities, 3);
  }

  // The answer is the state after recalculation, as for «استعادة من الأرشيف».
  {
    const tx = fakeTx([{ ...row("3", "زيد علي انسحاب"), replayDismisses: true }]);
    const result = await unwithdrawStudentInTransaction(tx, "3", actor);
    assert.equal(result.student.status, "مفصول", "the replay decided");
    assert.match(tx.notes[0].text, /وحالته الآن: مفصول/);
  }

  // Refusals write nothing.
  {
    const notArchived = fakeTx([row("4", "سعد انسحاب", { status: "نشط" })]);
    await assert.rejects(unwithdrawStudentInTransaction(notArchived, "4", actor), (error) => error instanceof StudentWithdrawalError && error.status === 409);
    assert.ok(untouched(notArchived), "an unarchived student is refused untouched");

    const plainArchive = fakeTx([row("5", "سعد كريم")]);
    await assert.rejects(unwithdrawStudentInTransaction(plainArchive, "5", actor), (error) => error.status === 409 && /استعادة من الأرشيف/.test(error.message));
    assert.ok(untouched(plainArchive), "an archived student without «انسحاب» is refused untouched");

    const clash = fakeTx([row("6", "مريم احمد انسحاب"), row("7", "مريم احمد", { status: "نشط" })]);
    await assert.rejects(unwithdrawStudentInTransaction(clash, "6", actor), (error) => error.status === 409 && /يوجد طالب آخر/.test(error.message));
    assert.ok(untouched(clash), "a name clash is refused untouched");
    assert.equal(clash.rows[0].status, "مؤرشف");

    const noChapter = fakeTx([row("8", "نور انسحاب")], []);
    await assert.rejects(unwithdrawStudentInTransaction(noChapter, "8", actor), (error) => error instanceof ArchiveRestoreError && error.errorKind === "missing-active-chapter");
    assert.ok(untouched(noChapter), "no active chapter, nothing written");

    const twoChapters = fakeTx([row("9", "هدى انسحاب")], [{ chapter: { id: "a", name: "أ", opportunities: 3 } }, { chapter: { id: "b", name: "ب", opportunities: 3 } }]);
    await assert.rejects(unwithdrawStudentInTransaction(twoChapters, "9", actor), (error) => error.errorKind === "conflicting-active-chapters");
    assert.ok(untouched(twoChapters));

    await assert.rejects(unwithdrawStudentInTransaction(fakeTx([]), "x", actor), (error) => error.status === 404);
  }

  // The plain restore keeps its behaviour through the shared core: active, dismissal cleared.
  {
    const tx = fakeTx([row("10", "كرار", { dismissalReason: "غياب امتحان", dismissalNotes: "س" })]);
    const restored = await restoreArchivedStudentInTransaction(tx, tx.rows[0]);
    assert.equal(restored.updatedStudent.status, "نشط");
    assert.equal(restored.updatedStudent.dismissalReason, "");
    assert.equal(restored.updatedStudent.dismissalNotes, "");
    assert.equal(restored.updatedStudent.opportunities, 3);
    assert.equal(restored.updatedStudent.name, "كرار", "the plain restore keeps the name");
    assert.equal(restored.activeChapter.name, "الفصل الأول");
  }

  // Wiring: one transaction, the restore permission, the shared core, archived cards only.
  const route = fs.readFileSync(path.join(root, "src/app/api/students/unwithdraw/route.ts"), "utf8");
  assert.ok(route.includes('requirePermissionPrincipal(req, "students.edit")'), "the same permission as «استعادة من الأرشيف»");
  assert.ok(route.includes("withSerializableTransaction"), "one transaction");
  const statusRoute = fs.readFileSync(path.join(root, "src/app/api/students/status-action/route.ts"), "utf8");
  assert.ok(statusRoute.includes("restoreArchivedStudentInTransaction(tx, student)"), "«استعادة من الأرشيف» uses the same core");
  const results = fs.readFileSync(path.join(root, "src/components/teacher-pro/student-registry-results.tsx"), "utf8");
  assert.ok(
    results.includes("canEdit && student.status === ARCHIVED_STUDENT_STATUS && unwithdrawnStudentName(student.name)") &&
      results.includes('label: "الغاء الانسحاب"'),
    "the action shows only on archived students whose name ends with «انسحاب»",
  );
  const registry = fs.readFileSync(path.join(root, "src/components/teacher-pro/student-registry.tsx"), "utf8");
  assert.ok(registry.includes("<UnwithdrawStudentDialog") && registry.includes("onUnwithdraw={setUnwithdrawStudent}"), "confirmed in a dialog");
  const dialog = fs.readFileSync(path.join(root, "src/components/teacher-pro/unwithdraw-student-dialog.tsx"), "utf8");
  assert.ok(dialog.includes("studentApi.unwithdraw(student.id)"));

  console.log("PASS: «الغاء الانسحاب» removes only «انسحاب», returns the student to «مفصول» (same reason) or «نشط» through the shared restore in one write, records a note and audit line, and refuses untouched.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
