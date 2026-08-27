import assert from "node:assert/strict";
import test from "node:test";

import {
  DISMISSED_TELEGRAM_DRAFT_MAX_LENGTH,
  buildBoundedTelegramDraft,
  buildDismissedTelegramReport,
  buildDismissedHistoryAccess,
  canUseDirectDismissedTelegramDraft,
  canUseSingleDismissedTelegramMessage,
  classifyDismissedOpportunityMovement,
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

test("professional Telegram report consolidates exams and follows action semantics", () => {
  const message = buildDismissedTelegramReport(
    {
      name: "شهد علي سامي ناجي",
      code: "BIO-1061",
      courseName: "الدورة الصيفية الثانية",
      dismissalDate: "2026/8/20",
      dismissalReason: "انتهاء الفرص",
    },
    [
      {
        date: "2026-07-05T10:00:00Z",
        kind: "grade",
        title: "درجة امتحان",
        details: [
          "الدورة: الدورة الصيفية الثانية",
          "الامتحان: الامتحان 1",
          "تاريخ الامتحان: 2026/07/05",
          "الدرجة: 87 / 100",
        ],
      },
      {
        date: "2026-07-12T10:00:00Z",
        kind: "grade",
        title: "درجة امتحان",
        details: [
          "الدورة: الدورة الصيفية الثانية",
          "الامتحان: الامتحان 2",
          "تاريخ الامتحان: 2026/7/12",
          "الحالة: غائب",
        ],
      },
      {
        date: "2026-07-12T12:00:00Z",
        kind: "opportunity",
        title: "إضافة 1 فرصة",
        details: [
          "الدورة: الدورة الصيفية الثانية",
          "الإجراء المسجل: خصم تلقائي",
          "التغيير في الرصيد: +1",
          "السبب: غياب في الامتحان",
          "الامتحان: الامتحان 2",
          "تاريخ الامتحان: 2026/7/12",
        ],
      },
      {
        date: "2026-07-12T13:00:00Z",
        kind: "correction",
        title: "سجل تصحيح ورقة امتحان",
        details: [
          "الامتحان: الامتحان 2",
          "حالة التصحيح: مكتمل",
          "المصحح: موظف داخلي",
        ],
      },
    ],
  );

  assert.match(message, /1\. الامتحان 1 — 2026\/7\/5\nالنتيجة: 87 من 100/);
  assert.match(message, /2\. الامتحان 2 — 2026\/7\/12\nالنتيجة: غائب/);
  assert.match(message, /الإجراء: تم خصم فرصة — السبب: غياب في الامتحان/);
  assert.equal((message.match(/الامتحان 2 —/g) || []).length, 1);
  assert.doesNotMatch(message, /تمت إضافة فرصة|المصحح|حالة التصحيح|HTML/);
});

test("automatic deductions are deductions even when legacy amounts are positive", () => {
  assert.equal(
    classifyDismissedOpportunityMovement({
      action: "خصم تلقائي",
      amount: 1,
    }),
    "deduction",
  );
  assert.equal(
    classifyDismissedOpportunityMovement({ action: "إضافة", amount: -2 }),
    "addition",
  );
});

test("pending and post-dismissal grades stay inside one exam entry", () => {
  const message = buildDismissedTelegramReport(
    {
      name: "طالب",
      code: "BIO-2",
      courseName: "الدورة الحالية",
    },
    [
      {
        kind: "pending-grade",
        details: [
          "الدورة: الدورة الحالية",
          "الامتحان: امتحان موحد",
          "الدرجة المدخلة: 60 / 100",
          "حالة المراجعة: PENDING",
        ],
      },
      {
        kind: "post-dismissal-grade",
        details: [
          "الدورة: الدورة الحالية",
          "الامتحان: امتحان موحد",
          "تاريخ الامتحان: 2026/8/2",
          "الدرجة: 70 / 100",
        ],
      },
    ],
  );

  assert.equal((message.match(/امتحان موحد —/g) || []).length, 1);
  assert.match(message, /النتيجة: 70 من 100/);
  assert.match(message, /تم تسجيل هذه النتيجة بعد الفصل/);
  assert.match(message, /توجد درجة معلقة بعد الفصل: 60 من 100/);
});

test("full Telegram history uses a file fallback before deep links become unsafe", () => {
  assert.equal(canUseDirectDismissedTelegramDraft("سجل قصير"), true);
  assert.equal(
    canUseDirectDismissedTelegramDraft("تفاصيل سجل طويلة ".repeat(500)),
    false,
  );
  assert.equal(
    canUseDirectDismissedTelegramDraft("ع".repeat(1700)),
    false,
    "Arabic URI expansion must be checked even below the character cap",
  );
  assert.equal(canUseSingleDismissedTelegramMessage("سجل ".repeat(500)), true);
  assert.equal(canUseSingleDismissedTelegramMessage("سجل ".repeat(1000)), false);
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
