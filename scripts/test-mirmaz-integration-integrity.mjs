// Grades from «Mirmaz Pro» enter TeacherPro only through the grade entry
// screen's own handler: the student is found by name exactly as «أداة مرماز»
// finds one, the exam is the one exam of the student's course on that day,
// anything uncertain is held for «مرماز برو», and nothing is saved twice.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const proxy = read("src/proxy.ts");
const auth = read("src/lib/mirmaz-integration-auth.ts");
const server = read("src/lib/mirmaz-integration-server.ts");
const intake = read("src/app/api/integrations/mirmaz/grade/route.ts");
const courses = read("src/app/api/integrations/mirmaz/courses/route.ts");
const holds = read("src/app/api/mirmaz-holds/route.ts");
const dialog = read("src/components/teacher-pro/mirmaz-pro-dialog.tsx");
const dashboard = read("src/components/teacher-pro/dashboard.tsx");
const migrationName = "20261024180000_mirmaz_holds";
const migration = read(`prisma/migrations/${migrationName}/migration.sql`);
const policy = JSON.parse(read("prisma/deployment-migration-policy.json"));
const schema = read("prisma/schema.prisma");
let count = 0;
const check = (name, fn) => { fn(); count += 1; console.log(`✅ ${name}`); };

check("only the Mirmaz paths skip the browser origin check, and only with Mirmaz's own token", () => {
  assert.match(auth, /MIRMAZ_INTEGRATION_PATHS = \["\/api\/integrations\/mirmaz\/grade", "\/api\/integrations\/mirmaz\/courses"\]/);
  assert.match(proxy, /MIRMAZ_INTEGRATION_PATHS\.includes\(url\.pathname\) && req\.method === 'POST'\) \{\s*return requireMirmazToken\(req\) \|\| NextResponse\.next\(\);/);
  assert.match(auth, /readServerEnv\("MIRMAZ_GRADES_TOKEN"\)/);
  assert.match(auth, /constantTimeEqual\(token, configured\)/);
  assert.match(intake, /const tokenError = requireMirmazToken\(req\);\s*if \(tokenError\) return tokenError;/);
  assert.match(courses, /const tokenError = requireMirmazToken\(req\);\s*if \(tokenError\) return tokenError;/);
});

check("the students' courses are only read, and found by the tool's own name matching", () => {
  assert.doesNotMatch(courses, /\.(create|update|upsert|delete)\w*\(/, "the course list only reads");
  assert.match(courses, /import \{ nameWords, wordsMatch \} from "@\/lib\/mirmaz-name-match";/);
  assert.match(courses, /matches\[answerId\] = found\.size === 1 \? \[\.\.\.found\]\[0\] : null;/, "several courses or none: no course, never a guess");
});

check("grades are saved by the grade entry screen's own handler, as a «grades.add»-only account", () => {
  assert.match(server, /import \{ POST as manualGradeEntry \} from "@\/app\/api\/grades\/route";/);
  assert.match(server, /principal\.isAdmin \|\| principal\.permissions\.includes\("system\.oversight"\)/);
  assert.match(server, /hasPermission\(principal, "grades\.add"\)/);
  assert.match(intake, /saveThroughGradeEntry\(req\.url, await mirmazSessionCookie\(account\.userId\)/);
  assert.doesNotMatch(intake, /db\.grade\.(create|update|upsert|delete)/, "the intake never writes grades itself");
  assert.doesNotMatch(holds, /db\.grade\.(create|update|upsert|delete)/, "placing a held grade never writes grades itself");
});

check("the student is found with the tool's own name matching; only one certain student with one certain exam is saved", () => {
  assert.match(server, /import \{ findStudentsByName \} from "@\/lib\/mirmaz-name-match";/);
  assert.match(server, /const full = found\.filter\(\(student\) => student\.nameMatch\.full\);/);
  assert.match(server, /if \(withExam\.length === 1\)/);
  assert.match(server, /exam\.courseIds\.includes\(courseId\)/, "the exam must belong to the student's course");
  assert.match(server, /fullMark \? \{ fullMark \} : \{\}/, "the full mark must match");
});

check("a result already there is held, not overwritten, unless it came from this same paper", () => {
  assert.match(intake, /if \(hasResult && !earlier\)/);
  assert.match(intake, /hold\("EXISTING_RESULT"/);
  assert.match(holds, /body\?\.confirmReplace !== true/);
});

check("the same paper and score never save twice", () => {
  assert.match(intake, /key = mirmazKey\(answerId, score\);/);
  assert.match(intake, /claimCorrectionKey\(\{ key, kind: "mirmaz-grade"/);
  assert.match(intake, /await releaseCorrectionKey\(key\);/);
});

check("a held grade is placed as the signed-in person, with «إدخال درجات»", () => {
  assert.match(holds, /requirePermissionPrincipal\(req, "grades\.add"\)/g);
  assert.match(holds, /saveThroughGradeEntry\(req\.url, req\.headers\.get\("cookie"\) \|\| ""/);
  assert.match(dashboard, /actor\.permissions\?\.includes\("grades\.add"\)/);
  assert.match(dashboard, /<MirmazProDialog /);
  assert.match(dialog, /mirmazHoldsApi\.resolve\(hold\.id, studentId, examId, confirmReplace\)/);
});

check("the holds table is additive and its migration is reviewed by checksum", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "MirmazHold"/);
  assert.doesNotMatch(migration.replace(/--[^\n]*/g, ""), /\b(DROP|TRUNCATE|RENAME|ALTER|UPDATE|DELETE|INSERT)\b/i);
  assert.equal(policy[migrationName]?.kind, "expand");
  assert.equal(policy[migrationName]?.checksum, createHash("sha256").update(migration).digest("hex"));
  assert.match(schema, /model MirmazHold \{[\s\S]*answerId\s+String\s+@unique/);
});

check("every grade that came from Mirmaz is listed in «مرماز برو», by exam, read-only", () => {
  const saves = intake.match(/await recordSavedMirmazGrade\(/g) || [];
  assert.equal(saves.length, 2, "a grade saved, and a grade already there, are both kept on the paper's row");
  assert.match(server, /status: "SAVED"/);
  assert.match(server, /resolved\?\.status === "RESOLVED" \|\| resolved\?\.status === "SAVED"/, "a re-correction goes where the saved grade went");
  assert.match(holds, /params\.get\("view"\) === "all"/);
  assert.doesNotMatch(holds.slice(holds.indexOf("async function allGrades"), holds.indexOf("export async function GET")), /\.(create|update|upsert|delete)\w*\(/, "the list only reads");
  assert.match(dialog, /useState<MirmazView>\("ALL"\)/, "«كل الدرجات» opens first");
});

console.log(`\n${count} Mirmaz Pro integration checks passed.`);
