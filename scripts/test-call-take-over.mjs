// A caller who searches for a student and opens them takes them, even from a
// colleague's batch; the hold moves and the move is logged.
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const route = read("src/app/api/student-calls/presence/route.ts");
const page = read("src/components/teacher-pro/follow-up.tsx");
assert.ok(route.includes('const takeOver = body?.takeOver === true && Boolean(holdStudentId);'));
assert.ok(route.includes("await dropCallHold(tx, holdStudentId, examId);"), "the colleague's hold is dropped first");
assert.ok(route.indexOf("await dropCallHold(tx, holdStudentId, examId);") < route.indexOf("await holdCallCase(tx,"), "then the student is held for this window");
assert.ok(route.includes('"أخذ طالب من دفعة موظف آخر"'), "the move is logged");
assert.ok(route.includes("changed = current !== null && seenStatus !== null && seenStatus !== current;"), "a stale card still cannot take a student whose status changed");
assert.ok(page.includes("if (callUsesBatches && debouncedCallGeneralSearch.trim() && !row.heldBy?.mine) void takeCallCase(row, true);"), "searching and opening a student makes them this caller's");
console.log("Search and open: the student moves to the caller, logged.");
