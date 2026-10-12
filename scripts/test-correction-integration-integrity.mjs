// The Correction app enters results through TeacherPro's own grade entry,
// never by writing TeacherPro's tables: same checks, same pending note for a
// dismissed student, same recalculation, same log, and a retry never saves twice.
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const proxy = read("src/proxy.ts");
const auth = read("src/lib/correction-integration-auth.ts");
const server = read("src/lib/correction-integration-server.ts");
const grade = read("src/app/api/integrations/correction/grade/route.ts");
const submission = read("src/app/api/integrations/correction/submission-received/route.ts");
const migration = read("prisma/migrations/20261012180000_correction_receipts/migration.sql");
const policy = JSON.parse(read("prisma/deployment-migration-policy.json"));
const pkg = JSON.parse(read("package.json"));
let count = 0;
const check = (name, fn) => { fn(); count += 1; console.log(`✅ ${name}`); };

check("only the two Correction paths skip the browser origin check, and only with Correction's token", () => {
  assert.match(auth, /"\/api\/integrations\/correction\/grade",\s*"\/api\/integrations\/correction\/submission-received",/);
  assert.match(proxy, /CORRECTION_INTEGRATION_PATHS\.includes\(url\.pathname\) && req\.method === 'POST'\) \{\s*return requireCorrectionToken\(req\) \|\| NextResponse\.next\(\);/);
  assert.match(auth, /readServerEnv\("CORRECTION_GRADES_TOKEN"\)/);
  assert.match(auth, /constantTimeEqual\(token, configured\)/);
  for (const route of [grade, submission]) assert.match(route, /const tokenError = requireCorrectionToken\(req\);\s*if \(tokenError\) return tokenError;/);
});

check("the final grade runs the grade entry screen's own handler as a short-lived «correction» session", () => {
  assert.match(grade, /import \{ POST as manualGradeEntry \} from "@\/app\/api\/grades\/route";/);
  assert.match(grade, /await manualGradeEntry\(new NextRequest\(new URL\("\/api\/grades", req\.url\)/);
  assert.match(grade, /cookie: `\$\{AUTH_COOKIE_NAME\}=\$\{await mintCorrectionSession\(account\.userId\)\}`/);
  assert.match(server, /CORRECTION_ACCOUNT_USERNAME = "correction"/);
  assert.match(server, /CORRECTION_SESSION_SECONDS = 120/);
  assert.match(server, /createSessionToken\(userId, CORRECTION_SESSION_SECONDS\)/);
  assert.match(server, /principal\.isAdmin \|\| principal\.permissions\.includes\("system\.oversight"\)/);
  assert.match(server, /hasPermission\(principal, "grades\.add"\)/);
  assert.doesNotMatch(submission, /mintCorrectionSession/);
});

check("the reply tells what TeacherPro actually kept, with the real balance before and after", () => {
  assert.match(grade, /storedAs = pending \? "pending_note" : result\.idempotentReplay \? "already_resolved" : asked \? "grade" : "changed_by_rules"/);
  assert.match(grade, /storedStatus,\s*storedScore,/);
  assert.match(grade, /recalculation\?\.students\?\.find\(\(item\) => item\.id === studentId\)/);
  assert.match(grade, /opportunitiesBefore: from\.opportunities,\s*opportunitiesAfter: after\.opportunities,/);
  assert.match(grade, /code: accountProblem \? "CORRECTION_ACCOUNT_UNAVAILABLE" : result\.code \?\? undefined,/);
  assert.match(grade, /requiresFreshGrade: result\.requiresFreshGrade === true \|\| undefined,/);
});

check("the same entry rules as the screen: leave confirmation, a dismissed student's statuses, an active chapter", () => {
  assert.match(grade, /\.\.\.\(confirmEndLeave \? \{ confirmEndLeave: true \} : \{\}\)/);
  assert.match(grade, /code: "DISMISSED_STUDENT_LOCKED"/);
  assert.match(grade, /before\.dismissalReason\.includes\(exam\.name\)/);
  for (const route of [grade, submission]) assert.match(route, /await noActiveChapter\(studentId, examId, before\.courseId\)/);
});

check("a received paper goes through the same save and checks, deciding inside its own transaction", () => {
  const receive = server.slice(server.indexOf("export async function receiveCorrectionSubmission"));
  assert.match(receive, /withSerializableTransaction\(async \(tx\)/);
  assert.ok(receive.indexOf("tx.grade.findUnique(") < receive.indexOf("syncAcademicGradeWriteback({"));
  for (const option of ["allowBlankGrade: true", "preserveExistingScoreWhenBlank: true", "blockOnLeave: true", "enforceExamAvailability: true", "allowDismissedExistingGradeCorrection: false"]) {
    assert.ok(receive.includes(option), option);
  }
});

check("Correction never ends a grace period or decides a pending note", () => {
  for (const source of [server, grade, submission]) {
    assert.doesNotMatch(source, /gracePeriod\.|gradeSmartNote\.(update|delete|create)|REJECTED/);
  }
});

check("the key is reserved before any write: a retry or duplicate never saves twice", () => {
  assert.ok(grade.indexOf("claimCorrectionKey(") < grade.indexOf("manualGradeEntry(new"));
  assert.ok(submission.indexOf("claimCorrectionKey(") < submission.indexOf("receiveCorrectionSubmission({"));
  assert.match(grade, /key = `grade:\$\{idempotencyKey\}`/);
  assert.match(submission, /const key = `submission:\$\{submissionId\}`/);
  assert.match(server, /code: "KEY_REUSED"/);
  assert.match(server, /code: "IN_PROGRESS", retryable: true/);
  assert.match(server, /STALE_CLAIM_MS = 120_000/);
  assert.match(grade, /if \(claim\.takeover\) \{/);
  for (const route of [grade, submission]) assert.match(route, /await releaseCorrectionKey\(key\);/);
});

check("the token must be long, and large bodies are refused", () => {
  assert.match(auth, /MIN_TOKEN_LENGTH = 32/);
  assert.match(server, /MAX_CORRECTION_BODY_BYTES = 16_384/);
  for (const route of [grade, submission]) assert.match(route, /const tooLarge = bodyTooLarge\(req\);/);
});

check("the receipts table is additive and in the deployment policy", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "CorrectionReceipt"/);
  assert.doesNotMatch(migration.replace(/--.*$/gm, ""), /\b(DROP|TRUNCATE|RENAME|DELETE|UPDATE)\b/i);
  assert.equal(policy["20261012180000_correction_receipts"].kind, "expand");
});

check("the test is part of the side-effects suite", () => {
  assert.match(pkg.scripts["test:side-effects"], /test:correction-integration-integrity/);
});

console.log(`correction integration integrity: ${count} checks passed`);
