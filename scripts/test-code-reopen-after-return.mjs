// «رجعوا وكودهم مغلق»: a student active again while the platform code closed
// in a dismissal was never marked open keeps the green «فتح الكود», is listed
// in «اغلاق الكودات», and leaves the list once the code is marked open.
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const rule = read("src/lib/code-reopen-server.ts");
const alerts = read("src/app/api/stats/alerts/route.ts");
const reopen = read("src/app/api/students/code-closures/reopen/route.ts");
const buttons = read("src/components/teacher-pro/student-code-buttons.tsx");
const dialog = read("src/components/teacher-pro/code-closures-dialog.tsx");
const hook = read("src/hooks/use-shortcut-alerts.ts");

// Who is listed: active, a platform mark still set, returned since tracking began.
assert.ok(rule.includes('status: "نشط"') && rule.includes("closurePlatformEpoch: { not: null }"));
assert.ok(rule.includes('action: "إعادة تفعيل", date: { gte: CODE_REOPEN_TRACKING_SINCE }'));
for (const start of ["تم تعهد الطالب", "استعادة الطالب", "رجع الطالب تلقائياً"]) assert.ok(rule.includes(start), start);
assert.ok(alerts.includes('can(principal, ["students.view"])') && alerts.includes("where: awaitingCodeReopenWhere()"), "sent only to who may see students");

// Opening clears the mark of an active student, with its own audit line; a dismissed student as before.
assert.ok(reopen.includes('if (student.status === "نشط" && student.dismissedCheckEpoch === epoch) {'));
assert.ok(reopen.includes("data: { closurePlatformEpoch: null }") && reopen.includes('"فتح كود الطالب بعد رجوعه"'));
assert.ok(reopen.includes('if (student.status !== "مفصول" || student.dismissedCheckEpoch !== epoch) return { status: 409 as const };'));
assert.ok(reopen.includes('requirePermissionPrincipal(req, "students.edit")'), "the same permission");

// The card: the green button alone for a returned student in the list, nothing for any other active student.
assert.ok(buttons.includes("return awaitingReopen ? <ReturnedCodeButton"));
assert.ok(buttons.includes("await codeClosuresApi.reopenCode(student.id, epoch);") && buttons.includes("await refreshShortcutAlerts();"));
assert.equal((buttons.match(/tp-code-buttons__close/g) || []).length, 1, "☢️ stays for dismissed students only");
// Cards read the shared copy; they start no loading of their own.
const snapshot = hook.slice(hook.indexOf("export function useShortcutAlertsSnapshot"), hook.indexOf("export function useShortcutAlerts("));
assert.equal(/fetch\(|setInterval|refreshShortcutAlerts/.test(snapshot), false);

// The window lists them above the dismissed students.
assert.ok(dialog.includes("رجعوا وكودهم مغلق") && dialog.includes("codeReopens.map((student) =>"));
assert.ok(dialog.indexOf("رجعوا وكودهم مغلق</") < dialog.indexOf('aria-label="الطلاب المفصولون"'));
console.log("«رجعوا وكودهم مغلق»: listed, opened and cleared.");
