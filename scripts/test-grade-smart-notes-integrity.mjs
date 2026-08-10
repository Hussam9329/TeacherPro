import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  readFile(path.join(root, relativePath), "utf8");

const [
  schema,
  migration,
  gradesRoute,
  notesRoute,
  entrySheet,
  helper,
  graceExpiryHelper,
  graceCronRoute,
  academicRecalculation,
  vercelConfig,
  correctionSheetsRoute,
  telegramSubmissionsRoute,
] =
  await Promise.all([
    read("prisma/schema.prisma"),
    read("prisma/migrations/20260810090000_grade_smart_notes/migration.sql"),
    read("src/app/api/grades/route.ts"),
    read("src/app/api/grade-smart-notes/route.ts"),
    read("src/app/api/grades/entry-sheet/route.ts"),
    read("src/lib/grade-smart-notes-server.ts"),
    read("src/lib/grade-smart-note-grace-expiry-server.ts"),
    read("src/app/api/internal/grace-smart-notes/settle/route.ts"),
    read("src/lib/academic-recalculate-server.ts"),
    read("vercel.json"),
    read("src/app/api/correction-sheets/route.ts"),
    read("src/app/api/telegram-exam-submissions/route.ts"),
  ]);

for (const category of [
  "DISMISSED_PENDING",
  "GRACE_SCORED",
  "BEFORE_REGISTRATION_PENDING",
  "LEAVE_PENDING",
]) {
  assert.match(schema, new RegExp(`model GradeSmartNote[\\s\\S]*category`));
  assert.ok(migration.includes(`'${category}'`), `${category} missing from DB check`);
  assert.ok(helper.includes(`"${category}"`), `${category} missing from server contract`);
}
assert.ok(!migration.includes("'MANUAL'"), "MANUAL must stay in the legacy note API");
assert.ok(!helper.includes('"MANUAL"'), "MANUAL must not enter structured grade notes");

for (const status of ["PENDING", "PROCESSED", "CONFLICT", "REJECTED"]) {
  assert.ok(migration.includes(`'${status}'`), `${status} missing from DB check`);
  assert.ok(helper.includes(`"${status}"`), `${status} missing from server contract`);
}

assert.match(schema, /academicEffectExcluded\s+Boolean\s+@default\(false\)/);
assert.match(schema, /smartNoteId\s+String\?\s+@unique/);
assert.match(migration, /Grade_smartNoteId_fkey/);
assert.match(migration, /Grade_academicEffectExclusion_provenance_check/);

const blockedBranch = gradesRoute.indexOf("if (numericAttempt?.category)");
const writebackCall = gradesRoute.indexOf("syncAcademicGradeWriteback({", blockedBranch);
assert.ok(blockedBranch >= 0 && writebackCall > blockedBranch);
const blockedSource = gradesRoute.slice(blockedBranch, writebackCall);
assert.match(blockedSource, /status:\s*"PENDING"/);
assert.match(blockedSource, /grade:\s*null/);
assert.match(blockedSource, /academicRecalculation:\s*null/);
assert.match(gradesRoute, /NextResponse\.json\(result, \{ status: 202 \}\)/);

const graceBranch = gradesRoute.indexOf(
  'numericAttempt.category === "GRACE_SCORED"',
);
assert.ok(graceBranch > blockedBranch && graceBranch < writebackCall);
const graceSource = gradesRoute.slice(graceBranch, writebackCall);
assert.match(graceSource, /reconcileExpiredGracePendingGrades\(/);
assert.match(graceSource, /noteIds:\s*\[smartNote\.id\]/);
assert.match(graceSource, /graceMigration\.processed\s*>\s*0/);
assert.match(graceSource, /pendingSmartNote:\s*false/);
assert.match(graceSource, /smartNoteConflict:\s*true/);
assert.match(gradesRoute, /smartNote\.status === "PROCESSED"[\s\S]*isStudentCurrentlyInGrace\(numericAttempt\.student\)/);
assert.match(gradesRoute, /grandfatheredGraceGrade:\s*true/);
assert.match(gradesRoute, /score:\s*numericAttempt\.score[\s\S]*academicRecalculation:\s*null/);

assert.match(graceExpiryHelper, /category:\s*"GRACE_SCORED"/);
assert.match(graceExpiryHelper, /status:\s*"PENDING"/);
assert.match(graceExpiryHelper, /today\s*>=\s*graceWindow\.endExclusive/);
assert.match(graceExpiryHelper, /examSnapshotDate\s*&&\s*!examStillInsideCurrentWindow/);
assert.match(graceExpiryHelper, /eligibleRemaining/);
assert.match(graceExpiryHelper, /status:\s*GRACE_PLACEHOLDER_STATUS/);
assert.match(graceExpiryHelper, /academicEffectExcluded:\s*true/);
assert.match(graceExpiryHelper, /gradeSmartNoteExclusionSource\([\s\S]*"GRACE_SCORED"/);
assert.match(graceExpiryHelper, /status:\s*"CONFLICT"/);
assert.match(graceExpiryHelper, /note\.score\s*>\s*fullMark/);

assert.match(academicRecalculation, /reconcileExpiredGracePendingGrades\([\s\S]*studentIds/);
assert.match(graceCronRoute, /process\.env\.CRON_SECRET/);
assert.match(graceCronRoute, /timingSafeEqual/);
assert.match(graceCronRoute, /reconcileExpiredGracePendingGrades\(/);
assert.match(vercelConfig, /api\/internal\/grace-smart-notes\/settle/);
assert.match(vercelConfig, /5 21 \* \* \*/);

// Ordinary user-facing GET endpoints must remain read-only. Grace settlement
// is write-triggered or performed by the authenticated internal cron only.
assert.doesNotMatch(notesRoute, /reconcileExpiredGracePendingGrades/);
assert.doesNotMatch(entrySheet, /reconcileExpiredGracePendingGrades/);

assert.match(gradesRoute, /isProtectedSmartNoteHistoricalGrade\(freshTargetGrade\)[\s\S]*nextStatus !== "درجة"/);
assert.match(gradesRoute, /isProtectedSmartNoteHistoricalGrade\(targetGrade\)[\s\S]*لا يمكن حذف هذه الدرجة التاريخية/);
for (const deletionRoute of [correctionSheetsRoute, telegramSubmissionsRoute]) {
  assert.match(
    deletionRoute,
    /academicEffectExclusionSource:\s*\{[\s\S]*startsWith:\s*"GradeSmartNote:"/,
  );
}

assert.match(notesRoute, /requireAnyPermission\([\s\S]*"grades\.view"[\s\S]*"grades\.add"/);
assert.match(notesRoute, /requirePermission\(req, "grades\.edit"\)/);
assert.match(notesRoute, /updatedAt: expectedDate/);
assert.match(notesRoute, /requiresFreshNote:\s*true/);

assert.match(entrySheet, /Keep pre-registration students in the entry sheet/);
assert.doesNotMatch(entrySheet, /isExamOnOrAfterStudentRegistration/);

console.log("Grade smart notes integrity checks passed.");
