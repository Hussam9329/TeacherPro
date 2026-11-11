// «المخصومين» in «سجل الدرجات» (list and export) is the calls' rule, read
// from one place, so both pages list the same students for an exam.
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const lib = read("src/lib/call-deduction-server.ts");
const calls = read("src/app/api/student-calls/candidates/route.ts");
const list = read("src/app/api/grades/route.ts");
const exported = read("src/app/api/grades/export/route.ts");
for (const kind of ["absent-deducted", "absent-dismissal", "discounted", "dismissal", "cheating"]) {
  assert.ok(lib.includes(`kind === "${kind}"`), `${kind} counts as deducted`);
}
assert.ok(calls.includes('import { isCallDeductedImpact as isDeductedImpact } from "@/lib/call-deduction-server";'));
assert.equal(calls.includes("function isDeductedImpact("), false, "the calls keep no copy of the rule");
assert.ok(list.includes('if (statusFilter === "discounted") {') && list.includes("loadCallDeductedCases("), "the list reads the calls' rule");
assert.ok(exported.includes('if (statusFilter === "discounted") {') && exported.includes("loadCallDeductedCases("), "the export reads the calls' rule");
assert.ok(lib.includes("resolveCallAbsenceSource(") && lib.includes("buildImplicitCallAbsenceGrade("), "students with no grade count as the calls count them");
console.log("«المخصومين»: grade records and calls share one rule.");
