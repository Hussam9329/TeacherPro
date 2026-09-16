import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const filename = "src/components/teacher-pro/student-edit-recovery.ts";
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", "require", compiled)(module, module.exports, require);
const { prepareStudentEditRecovery: prepare, resolveStudentEditRecovery: resolve } = module.exports;
const base = {
  name: "student", school: "school", gender: "ذكر", phone: "", parentPhone: "",
  telegram: "", courseProgram: "منهج كامل", courseTerm: "", studyType: "إلكتروني",
  locationScope: "محافظات", baghdadMode: "", courseId: "course-1", subSite: "كركوك",
  createdAt: "2026-06-17", accountingGraceDays: "5",
};

const draft = { ...base, accountingGraceDays: "6" };
const latest = { ...base, school: "updated school" };
const before = structuredClone({ base, draft, latest });
const disjoint = prepare(base, draft, latest);
assert.equal(disjoint.conflicts.length, 0);
assert.equal(resolve(disjoint, {}).school, "updated school", "untouched fields use fresh source");
assert.equal(resolve(disjoint, {}).accountingGraceDays, "6", "typed six-day grant survives refresh");
assert.deepEqual({ base, draft, latest }, before, "review must never mutate baseline, draft or source");

const conflicting = prepare(base, draft, { ...base, accountingGraceDays: "10" });
assert.deepEqual(conflicting.conflicts.map((row) => row.field), ["accountingGraceDays"]);
assert.equal(resolve(conflicting, {}), null, "save cannot proceed without explicit conflict choice");
assert.equal(resolve(conflicting, { accountingGraceDays: "draft" }).accountingGraceDays, "6");
assert.equal(resolve(conflicting, { accountingGraceDays: "latest" }).accountingGraceDays, "10");
assert.equal(resolve(conflicting, { accountingGraceDays: "bogus" }), null);

const parallelEnrollment = prepare(base, { ...base, subSite: "بابل" }, { ...base, courseId: "course-2" });
assert.deepEqual(parallelEnrollment.conflicts.map((row) => row.field).sort(), ["courseId", "subSite"], "related enrollment fields require review even when changes are disjoint");
assert.equal(resolve(parallelEnrollment, {}), null);

const alreadySaved = prepare(base, draft, draft);
assert.equal(alreadySaved.matchesDraft, true, "lost save response may already be reflected in source");
assert.equal(alreadySaved.conflicts.length, 0);
assert.deepEqual(resolve(alreadySaved, {}), draft);
const unchangedServer = prepare(base, draft, base);
assert.equal(unchangedServer.matchesDraft, false);
assert.equal(resolve(unchangedServer, {}).accountingGraceDays, "6");
assert.equal(prepare(draft, { ...draft, accountingGraceDays: "06" }, draft).matchesDraft, true);

const view = fs.readFileSync("src/components/teacher-pro/student-registry.tsx", "utf8");
const recoveryHandlers = view.slice(view.indexOf("const loadEditRecovery"), view.indexOf("const updateEditForm"));
assert.match(recoveryHandlers, /student\.id !== requestedId/);
assert.match(recoveryHandlers, /!student\.mutationToken/);
assert.match(recoveryHandlers, /request !== editRecoveryRequest\.current/);
assert.match(recoveryHandlers, /setEditOriginalStudent\(editRecovery\.student\)/);
assert.doesNotMatch(recoveryHandlers, /studentApi\.(?:update|statusAction)\(/, "review does not replay a possibly committed save");
assert.match(view, /result\.status === 409 \|\| result\.outcomeUnknown/);
assert.match(view, /if \(editRecoveryReason\) \{\s*editRecoveryPanel\.current\?\.focus\(\);\s*return;/);
assert.match(view, /expectedMutationToken: editOriginalStudent\?\.mutationToken/);
assert.match(view, /إغلاق بدون إعادة الحفظ/);
assert.match(view, /editRecoveryChoices\.accountingGraceDays === "latest"/);
assert.match(view, /finally \{\s*if \(currentEditorRequest === editRecoveryRequest\.current\)/);
console.log("PASS: safe three-way student edit recovery, preserved six-day draft, explicit conflicts, already-saved detection, unchanged concurrency guards and no automatic save replay");
