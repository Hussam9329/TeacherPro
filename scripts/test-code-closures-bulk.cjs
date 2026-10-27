// «اغلاق الكودات» bulk actions: each selected student goes through the same
// single action (platform tab, bot notice, «انسحاب»), so its rules hold.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, "src/components/teacher-pro", file), "utf8");
const bar = read("code-closures-bulk-bar.tsx");
const dialog = read("code-closures-dialog.tsx");

assert.ok(dialog.includes("<CodeClosuresBulkBar") && dialog.includes("selected={selectedStudents}"), "the bar acts on the selected cards");
assert.ok(dialog.includes("visibleStudents.filter((student) => selectedIds.has(student.id))"), "only cards still shown count as selected");
assert.ok(dialog.includes("setSelectedIds(new Set());\n    if (!open) return;"), "selection resets when the window opens");
assert.ok(dialog.includes("sendBotNotice={deliverBotNotice}"), "bulk and single sends share one path");

// Platform: one tab per click, the next student whose code is not closed yet.
assert.ok(bar.includes("selected.filter((student) => !platformDone(student))"));
assert.ok(bar.includes("openPlatform(nextPlatform, event.currentTarget)"));
assert.ok(!/window\.open/.test(bar), "the bar never opens tabs by itself");

// Bot: only the ones not sent yet with a known exam and result, after a confirm.
assert.ok(bar.includes("!botSentAt(student) && student.dismissalExamName && student.dismissalOutcome"));
assert.ok(bar.includes("canManage\n    ? selected.filter"), "the bot needs the manage permission");
assert.ok(bar.includes('setConfirm("bot")') && bar.includes('setConfirm("withdraw")'), "both send and withdraw ask first");

// Withdraw: closed codes only, through the same endpoint, one by one.
assert.ok(bar.includes("canWithdraw ? selected.filter((student) => student.dismissedChecked) : []"));
assert.ok(bar.includes("await studentApi.withdraw(student.id)"));
assert.ok(/for \(const \[index, student\] of queue\.entries\(\)\)/.test(bar), "sequential, never all at once");
console.log("PASS: «اغلاق الكودات» bulk actions keep each single action's rules.");
