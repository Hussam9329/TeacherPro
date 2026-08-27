import assert from "node:assert/strict";
import test from "node:test";

import {
  DISMISSED_TELEGRAM_DRAFT_MAX_LENGTH,
  buildBoundedTelegramDraft,
  buildDismissedHistoryAccess,
  escapeDismissedHistoryHtml,
  isDismissalActionNote,
  isDismissalOpportunityLog,
  safeDismissedHistoryFileName,
} from "../src/lib/dismissed-history.ts";

test("dismissal logs reject reactivation text that only mentions dismissal", () => {
  assert.equal(
    isDismissalOpportunityLog({
      action: "إعادة تفعيل",
      reason:
        "تثبيت إعادة التفعيل: لا يعاد فصل الطالب بسبب سجلات قديمة",
    }),
    false,
  );
  assert.equal(
    isDismissalOpportunityLog({
      action: "خصم",
      reason: "فصل الطالب: نفاد الفرص",
    }),
    true,
  );
  assert.equal(
    isDismissalOpportunityLog({
      action: "فصل تلقائي",
      reason: "نفاد الفرص",
    }),
    true,
  );
});

test("only authoritative action notes are dismissal events", () => {
  assert.equal(
    isDismissalActionNote({ kind: "إجراء", text: "فصل الطالب: سبب" }),
    true,
  );
  assert.equal(
    isDismissalActionNote({ kind: "إجراء", text: "تم فصل الطالب (سبب)" }),
    true,
  );
  assert.equal(
    isDismissalActionNote({ kind: "ملاحظة", text: "نتائج الفصل الثاني" }),
    false,
  );
  assert.equal(
    isDismissalActionNote({
      kind: "تعهد ولي الأمر",
      text: "تعهد",
      dismissalType: "مفصول",
    }),
    false,
  );
});

test("follow-up permissions remain isolated by domain", () => {
  const baseAccess = {
    grades: false,
    opportunities: false,
    correction: false,
    archives: true,
  };
  const accessFor = (permissions) =>
    buildDismissedHistoryAccess({
      isAdmin: false,
      permissions,
      baseAccess,
    });

  assert.deepEqual(
    accessFor(["follow-up.calls.view"]),
    {
      ...baseAccess,
      calls: true,
      leaves: false,
      studentNotes: false,
      allStudentNotes: false,
    },
  );
  assert.deepEqual(
    accessFor(["follow-up.leaves.view"]),
    {
      ...baseAccess,
      calls: false,
      leaves: true,
      studentNotes: false,
      allStudentNotes: false,
    },
  );
  assert.deepEqual(
    accessFor(["follow-up.pledges.view"]),
    {
      ...baseAccess,
      calls: false,
      leaves: false,
      studentNotes: true,
      allStudentNotes: false,
    },
  );
  assert.deepEqual(
    accessFor(["follow-up.view"]),
    {
      ...baseAccess,
      calls: true,
      leaves: true,
      studentNotes: true,
      allStudentNotes: true,
    },
  );
  assert.equal(accessFor(["page.follow-up-calls.view"]).calls, true);
});

test("Telegram drafts are bounded and preserve the safety notice", () => {
  const message = buildBoundedTelegramDraft({
    header: "رأس الرسالة",
    timeline: "سجل داخلي طويل ".repeat(500),
    footer: "توقيع الإدارة",
  });
  assert.ok(message.length <= DISMISSED_TELEGRAM_DRAFT_MAX_LENGTH);
  assert.match(message, /^رأس الرسالة/);
  assert.match(message, /تم اختصار الرسالة بسبب حد تيليجرام/);
  assert.match(message, /توقيع الإدارة$/);
});

test("HTML and exported filenames neutralize unsafe user content", () => {
  assert.equal(
    escapeDismissedHistoryHtml(`<script>alert("x") & 'y'</script>`),
    "&lt;script&gt;alert(&quot;x&quot;) &amp; &#039;y&#039;&lt;/script&gt;",
  );
  const fileName = safeDismissedHistoryFileName(`${"طالب".repeat(80)}/:*?`);
  assert.ok(fileName.length <= 120);
  assert.doesNotMatch(fileName, /[\\/:*?"<>|]/);
});
