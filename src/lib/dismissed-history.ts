type DismissalLogLike = {
  action?: unknown;
  reason?: unknown;
};

type DismissalNoteLike = {
  kind?: unknown;
  text?: unknown;
};

type OpportunityMovementLike = {
  action?: unknown;
  amount?: unknown;
  title?: unknown;
};

export const DISMISSED_TELEGRAM_DRAFT_MAX_LENGTH = 1800;
export const DISMISSED_TELEGRAM_ENCODED_URI_MAX_LENGTH = 8000;
export const DISMISSED_TELEGRAM_SINGLE_MESSAGE_MAX_LENGTH = 3800;

type TelegramDraftParts = {
  header: string;
  timeline: string;
  footer: string;
  maxLength?: number;
};

export type DismissedHistoryAccess = {
  grades: boolean;
  opportunities: boolean;
  correction: boolean;
  archives: boolean;
  calls: boolean;
  leaves: boolean;
  studentNotes: boolean;
};

type DismissedHistoryAccessInput = {
  isAdmin: boolean;
  permissions: string[];
  baseAccess: Pick<
    DismissedHistoryAccess,
    "grades" | "opportunities" | "correction" | "archives"
  >;
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

export function buildDismissedHistoryAccess({
  isAdmin,
  permissions,
  baseAccess,
}: DismissedHistoryAccessInput): DismissedHistoryAccess {
  const granted = new Set(permissions);
  const hasAny = (...tokens: string[]) =>
    isAdmin || tokens.some((token) => granted.has(token));
  const broadFollowUp = hasAny("follow-up.view", "follow-up.manage");
  const calls =
    broadFollowUp ||
    hasAny(
      "follow-up.calls.view",
      "follow-up.calls.manage",
      "page.follow-up-calls.view",
    );
  const leaves =
    broadFollowUp ||
    hasAny(
      "follow-up.leaves.view",
      "follow-up.leaves.manage",
      "page.follow-up-leaves.view",
    );
  return {
    ...baseAccess,
    calls,
    leaves,
    studentNotes: broadFollowUp,
  };
}

/**
 * Matches only the authoritative opportunity-log shapes used when a student
 * is dismissed. Reactivation logs deliberately mention "فصل الطالب" in their
 * reason, so a broad substring match would produce a false dismissal event.
 */
export function isDismissalOpportunityLog(log: DismissalLogLike): boolean {
  const action = cleanText(log.action);
  const reason = cleanText(log.reason);
  return (
    action === "فصل تلقائي" ||
    (action === "خصم" && reason.startsWith("فصل الطالب"))
  );
}

/**
 * Only an action note whose text records the dismissal is accepted as a
 * dismissal event; other administrative notes are ignored.
 */
export function isDismissalActionNote(note: DismissalNoteLike): boolean {
  if (cleanText(note.kind) !== "إجراء") return false;
  const noteText = cleanText(note.text);
  return /^(?:فصل الطالب|تم فصل الطالب)(?:\s|$|\(|:)/u.test(noteText);
}

export function classifyDismissedOpportunityMovement({
  action: actionValue,
  amount: amountValue,
  title: titleValue,
}: OpportunityMovementLike): "deduction" | "addition" | "neutral" {
  const action = cleanText(actionValue);
  const title = cleanText(titleValue);
  if (
    action === "خصم" ||
    action === "خصم تلقائي" ||
    title.startsWith("فقدان")
  ) {
    return "deduction";
  }
  if (
    action === "إضافة" ||
    action === "إعادة تعيين" ||
    action === "إعادة تفعيل" ||
    title.startsWith("إضافة")
  ) {
    return "addition";
  }
  const amount = Number(amountValue);
  if (Number.isFinite(amount) && amount < 0) return "deduction";
  if (Number.isFinite(amount) && amount > 0) return "addition";
  return "neutral";
}

export function buildBoundedTelegramDraft({
  header,
  timeline,
  footer,
  maxLength = DISMISSED_TELEGRAM_DRAFT_MAX_LENGTH,
}: TelegramDraftParts): string {
  const fullMessage = [header, timeline, footer].filter(Boolean).join("\n\n");
  if (fullMessage.length <= maxLength) return fullMessage;

  const notice =
    "تم اختصار الرسالة بسبب حد تيليجرام. السجل الكامل متاح عبر تصدير HTML.";
  const prefix = `${header}\n\n`;
  const suffix = `\n\n${notice}\n\n${footer}`;
  const availableTimelineLength = Math.max(
    0,
    maxLength - prefix.length - suffix.length - 1,
  );
  const clippedTimeline = timeline
    .slice(0, availableTimelineLength)
    .trimEnd();
  return `${prefix}${clippedTimeline}…${suffix}`;
}

/**
 * Telegram deep links encode Arabic text very aggressively. Enforce both a
 * readable-message limit and an encoded URI limit so the OS/browser does not
 * silently truncate or reject the hand-off to Telegram.
 */
export function canUseDirectDismissedTelegramDraft(
  message: string,
): boolean {
  return (
    message.length <= DISMISSED_TELEGRAM_DRAFT_MAX_LENGTH &&
    encodeURIComponent(message).length <=
      DISMISSED_TELEGRAM_ENCODED_URI_MAX_LENGTH
  );
}

export function canUseSingleDismissedTelegramMessage(
  message: string,
): boolean {
  return message.length <= DISMISSED_TELEGRAM_SINGLE_MESSAGE_MAX_LENGTH;
}

export type DismissedTelegramTimelineEvent = {
  date?: string;
  kind?: string;
  title?: string;
  details?: string[];
};

export type DismissedTelegramStudent = {
  name: string;
  code: string;
  courseName: string;
  dismissalDate?: string;
  dismissalReason?: string;
  dismissalNotes?: string;
};

type TelegramExamEntry = {
  courseName: string;
  examName: string;
  examDate: string;
  result: string;
  actions: string[];
  notes: string[];
  order: number;
};

function detailValue(details: string[], label: string): string {
  const prefix = `${label}:`;
  const row = details.find((detail) => detail.startsWith(prefix));
  return row ? row.slice(prefix.length).trim() : "";
}

function normalizeReportDate(value: string): string {
  const raw = cleanText(value);
  const match = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!match) return raw;
  return `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}`;
}

function compactScore(value: string): string {
  const cleaned = cleanText(value);
  if (!cleaned) return "";
  return cleaned.replace(/\s*\/\s*/g, " من ");
}

function opportunityCount(amountRaw: string): number {
  const amount = Number(amountRaw);
  return Number.isFinite(amount) ? Math.abs(Math.trunc(amount)) : 0;
}

function compactOpportunityAction(
  event: DismissedTelegramTimelineEvent,
): string {
  const details = Array.isArray(event.details) ? event.details : [];
  const amountRaw = detailValue(details, "التغيير في الرصيد");
  const amount = Number(amountRaw);
  const count = opportunityCount(amountRaw);
  const reason = detailValue(details, "السبب");
  const title = cleanText(event.title);
  const action = detailValue(details, "الإجراء المسجل");
  const movement = classifyDismissedOpportunityMovement({
    action,
    amount,
    title,
  });

  let result = "";
  if (title === "فصل الطالب" || action === "فصل تلقائي") {
    result = "تم فصل الطالب";
  } else if (movement === "deduction") {
    result =
      count === 1
        ? "تم خصم فرصة"
        : count > 1
          ? `تم خصم ${count} فرص`
          : "تم خصم فرصة";
  } else if (movement === "addition") {
    result =
      count === 1
        ? "تمت إضافة فرصة"
        : count > 1
          ? `تمت إضافة ${count} فرص`
          : action;
  } else {
    result = action || title;
  }

  return [result, reason ? `السبب: ${reason}` : ""]
    .filter(Boolean)
    .join(" — ");
}

function pushUnique(rows: string[], value: string) {
  const normalized = cleanText(value);
  if (normalized && !rows.includes(normalized)) rows.push(normalized);
}

/**
 * Builds a student-facing exam report from the permission-filtered timeline.
 * Internal correction/call metadata is intentionally omitted. Each exam is
 * consolidated once with its result, opportunity action and useful notes.
 */
export function buildDismissedTelegramReport(
  student: DismissedTelegramStudent,
  timelineEvents: DismissedTelegramTimelineEvent[],
): string {
  const exams = new Map<string, TelegramExamEntry>();
  const examKeysByBase = new Map<string, string[]>();

  const ensureExam = (event: DismissedTelegramTimelineEvent) => {
    const details = Array.isArray(event.details) ? event.details : [];
    const examName = detailValue(details, "الامتحان");
    if (!examName) return null;

    const courseName = detailValue(details, "الدورة") || student.courseName;
    const examDate = normalizeReportDate(
      detailValue(details, "تاريخ الامتحان"),
    );
    const baseKey = `${courseName}\u0000${examName}`;
    const exactKey = `${baseKey}\u0000${examDate}`;
    let entry = exams.get(exactKey);

    if (!entry) {
      const relatedKeys = examKeysByBase.get(baseKey) || [];
      if (!examDate && relatedKeys.length === 1) {
        entry = exams.get(relatedKeys[0]);
      } else if (examDate) {
        const undatedKey = relatedKeys.find(
          (key) => !exams.get(key)?.examDate,
        );
        if (undatedKey) {
          entry = exams.get(undatedKey);
          if (entry) {
            exams.delete(undatedKey);
            entry.examDate = examDate;
            exams.set(exactKey, entry);
            examKeysByBase.set(
              baseKey,
              relatedKeys.map((key) =>
                key === undatedKey ? exactKey : key,
              ),
            );
          }
        }
      }
    }

    if (!entry) {
      entry = {
        courseName,
        examName,
        examDate,
        result: "",
        actions: [],
        notes: [],
        order: exams.size,
      };
      exams.set(exactKey, entry);
      examKeysByBase.set(baseKey, [
        ...(examKeysByBase.get(baseKey) || []),
        exactKey,
      ]);
    }

    return entry;
  };

  for (const event of timelineEvents) {
    const kind = cleanText(event.kind);
    const details = Array.isArray(event.details) ? event.details : [];

    if (kind === "grade" || kind === "post-dismissal-grade") {
      const exam = ensureExam(event);
      if (!exam) continue;
      const grade = detailValue(details, "الدرجة");
      const statusLine =
        details.find((detail) => detail.startsWith("الحالة:")) || "";
      const status = statusLine
        .replace(/^الحالة:\s*/, "")
        .split("·")[0]
        .trim();
      if (exam.result.startsWith("درجة معلقة بعد الفصل")) {
        pushUnique(exam.notes, `توجد ${exam.result}`);
      }
      if (grade) exam.result = compactScore(grade);
      else if (status) {
        exam.result = status === "غائب" ? "غائب" : `الحالة: ${status}`;
      }
      pushUnique(exam.notes, detailValue(details, "الملاحظات"));
      if (kind === "post-dismissal-grade") {
        pushUnique(exam.notes, "تم تسجيل هذه النتيجة بعد الفصل");
      }
      continue;
    }

    if (kind === "pending-grade") {
      const exam = ensureExam(event);
      if (!exam) continue;
      const score = compactScore(detailValue(details, "الدرجة المدخلة"));
      const status = detailValue(details, "حالة المراجعة");
      const reason = detailValue(details, "السبب");
      if (!exam.result) {
        exam.result = score
          ? `درجة معلقة بعد الفصل: ${score}`
          : "درجة معلقة بعد الفصل";
      } else {
        pushUnique(
          exam.notes,
          score
            ? `توجد درجة معلقة بعد الفصل: ${score}`
            : "توجد درجة معلقة بعد الفصل",
        );
      }
      if (status) pushUnique(exam.notes, `حالة المراجعة: ${status}`);
      if (reason) pushUnique(exam.notes, `سبب التعليق: ${reason}`);
      continue;
    }

    if (kind === "opportunity" || kind === "dismissal") {
      const exam = ensureExam(event);
      if (!exam) continue;
      const reason = detailValue(details, "السبب");
      if (!exam.result && /(?:غياب|غائب)/u.test(reason)) {
        exam.result = "غائب";
      }
      pushUnique(exam.actions, compactOpportunityAction(event));
    }
  }

  const examDateOrder = (value: string): number => {
    const match = value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  };
  const examEntries = [...exams.values()].sort((a, b) => {
    const byDate = examDateOrder(a.examDate) - examDateOrder(b.examDate);
    return byDate || a.order - b.order;
  });

  const examLines = examEntries.length
    ? (() => {
        const courseGroups = new Map<string, TelegramExamEntry[]>();
        for (const exam of examEntries) {
          const course =
            exam.courseName || student.courseName || "دورة غير محددة";
          const list = courseGroups.get(course) || [];
          list.push(exam);
          courseGroups.set(course, list);
        }
        let sequence = 0;
        return [...courseGroups.entries()]
          .flatMap(([course, courseExams]) => [
            `الدورة: ${course}`,
            ...courseExams.flatMap((exam) => {
              sequence += 1;
              return [
                `${sequence}. ${exam.examName}${exam.examDate ? ` — ${exam.examDate}` : ""}`,
                `النتيجة: ${exam.result || "لا توجد نتيجة نهائية مسجلة"}`,
                ...exam.actions.map((action) => `الإجراء: ${action}`),
                ...exam.notes.map((note) => `ملاحظة: ${note}`),
                "",
              ];
            }),
          ])
          .join("\n")
          .trim();
      })()
    : "لا توجد امتحانات مسجلة للطالب.";

  const identityLines = [
    `الكود: ${cleanText(student.code) || "—"}`,
    `الدورة: ${cleanText(student.courseName) || "—"}`,
    cleanText(student.dismissalDate)
      ? `تاريخ الفصل: ${cleanText(student.dismissalDate)}`
      : "",
    `سبب الفصل: ${cleanText(student.dismissalReason) || "غير مسجل"}`,
    cleanText(student.dismissalNotes)
      ? `ملاحظات الفصل: ${cleanText(student.dismissalNotes)}`
      : "",
  ].filter(Boolean);
  const header = [
    "السلام عليكم",
    `هذا هو السجل الدراسي للطالب "${cleanText(student.name)}"`,
    "",
    ...identityLines,
    "",
    "سجل الامتحانات",
  ].join("\n");

  return `${header}\n\n${examLines}\n\nإدارة حسن فلاح\nمدرس مادة الأحياء`;
}

export function escapeDismissedHistoryHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function safeDismissedHistoryFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/* ========== تقرير تيليجرام من مصدر تصدير HTML (profile-log) ========== */

export type OpportunityTelegramStudent = {
  name: string;
  code: string;
  courseName: string;
  opportunities?: number | string | null;
  status?: string;
  dismissalDate?: string;
  dismissalReason?: string;
  dismissalNotes?: string;
};

export type OpportunityTelegramGrade = {
  examName: string;
  examType: string;
  examDate: string;
  score: number | null;
  fullMark: number | null;
  status: string;
};

export type OpportunityTelegramLog = {
  action: string;
  amount: number;
  reason: string | null;
  date: string;
  examName: string | null;
};

export type OpportunityTelegramDetails = {
  grades: OpportunityTelegramGrade[];
  opportunityLogs: OpportunityTelegramLog[];
};

/** نفس منطق fmtNum في ملف تصدير HTML: القيمة غير الرقمية تُعرض شرطة. */
function opportunityReportNumber(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : "—";
}

/** نفس تنسيق تاريخ تقرير HTML (ar-IQ-u-nu-latn بتوقيت بغداد) مع احتياط النص الخام. */
function opportunityReportDate(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return "—";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  try {
    return parsed.toLocaleDateString("ar-IQ-u-nu-latn", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Baghdad",
    });
  } catch {
    return raw;
  }
}

function opportunityStatusLine(status: string): string {
  const normalized = cleanText(status);
  return normalized === "مفصول" ? "مفصول" : "مفصول سابقاً";
}

function opportunityIdentityLines(student: OpportunityTelegramStudent): string[] {
  const lines = [
    `الكود: ${cleanText(student.code) || "—"}`,
    `الدورة: ${cleanText(student.courseName) || "—"}`,
  ];
  const opportunities = student.opportunities;
  if (opportunities !== null && opportunities !== undefined && opportunities !== "") {
    lines.push(`عدد الفرص: ${opportunityReportNumber(opportunities)}`);
  }
  if (cleanText(student.status)) {
    lines.push(`الحالة: ${opportunityStatusLine(cleanText(student.status))}`);
  }
  lines.push(`سبب الفصل: ${cleanText(student.dismissalReason) || "غير مسجل"}`);
  if (cleanText(student.dismissalDate)) {
    lines.push(`تاريخ الفصل: ${cleanText(student.dismissalDate)}`);
  }
  if (cleanText(student.dismissalNotes)) {
    lines.push(`ملاحظات الفصل: ${cleanText(student.dismissalNotes)}`);
  }
  return lines;
}

function opportunityExamLines(grades: OpportunityTelegramGrade[]): string {
  if (!grades.length) return "لا توجد امتحانات مسجلة لهذا الطالب.";
  return grades
    .flatMap((grade, index) => {
      const headParts = [
        cleanText(grade.examName),
        cleanText(grade.examType),
        cleanText(grade.examDate) ? opportunityReportDate(grade.examDate) : "",
      ].filter(Boolean);
      const score = opportunityReportNumber(grade.score);
      const fullMark = grade.fullMark;
      const scoreLine =
        fullMark === null || fullMark === undefined
          ? `الدرجة: ${score}`
          : `الدرجة: ${score} من ${opportunityReportNumber(fullMark)}`;
      const rows = [
        `${index + 1}. ${headParts.join(" — ")}`,
        scoreLine,
      ];
      if (cleanText(grade.status)) {
        rows.push(`الحالة: ${cleanText(grade.status)}`);
      }
      return [...rows, ""];
    })
    .join("\n")
    .trim();
}

function opportunityLogLines(logs: OpportunityTelegramLog[]): string | null {
  const rows = logs
    .map((log) => {
      const reason = cleanText(log.reason) || "غير مسجل";
      const parts = [
        `السبب: ${reason}`,
        `مقدار التغيير: ${opportunityReportNumber(log.amount)}`,
        `التاريخ: ${opportunityReportDate(log.date)}`,
        `الامتحان: ${cleanText(log.examName) || "—"}`,
      ];
      return `• ${parts.join(" · ")}`;
    });
  return rows.length ? rows.join("\n") : null;
}

/**
 * يبني رسالة تيليجرام من نفس لقطة تفاصيل الطالب التي تُحقن في ملف تصدير
 * HTML (profile-log بعد المرور بـ sanitizeStudentDetailsForHtml): نفس
 * الدرجات، نفس سجل الفرص، ونفس الترتيب (الأحدث أولاً).
 *
 * عمود «مقدار التغيير» يعرض المقدار كما هو مخزّن في قاعدة البيانات
 * (سالب للخصم، موجب للإضافة) — نفس القيمة التي يعرضها جدول الفرص في
 * ملف HTML تماماً.
 */
export function buildOpportunityTelegramReport(
  student: OpportunityTelegramStudent,
  details: OpportunityTelegramDetails,
): string {
  const header = [
    "السلام عليكم",
    `هذا هو السجل الدراسي للطالب "${cleanText(student.name)}"`,
    "",
    ...opportunityIdentityLines(student),
    "",
    "كل الامتحانات",
  ].join("\n");

  const examSection = opportunityExamLines(details.grades || []);
  const logSection = opportunityLogLines(details.opportunityLogs || []);

  const sections = [header, examSection];
  if (logSection) {
    sections.push(["سجل تغيّر الفرص", logSection].join("\n"));
  }
  sections.push("إدارة حسن فلاح\nمدرس مادة الأحياء");

  return sections.filter(Boolean).join("\n\n");
}

/**
 * رسالة الإرفاق القصيرة عندما يتجاوز التقرير حد رسالة تيليجرام فيُنزّل
 * كملف HTML كامل من نفس المصدر — الملخص يُحصي من نفس بيانات الملف.
 */
export function buildOpportunityTelegramAttachment(
  student: OpportunityTelegramStudent,
  details: OpportunityTelegramDetails,
): string {
  const summary = [
    `- عدد الامتحانات: ${(details.grades || []).length}`,
    `- حركات الفرص في السجل: ${(details.opportunityLogs || []).length}`,
  ].join("\n");

  const header = `السلام عليكم
هذا هو سجل الطالب الكامل "${cleanText(student.name)}"

${opportunityIdentityLines(student).join("\n")}

تم تنزيل سجل الطالب الكامل بصيغة HTML على جهاز الإدارة لأن حجمه يتجاوز الحد الآمن لرابط تيليجرام. يرجى إرفاق الملف بهذه المحادثة.

ملخص الملف`;

  return buildBoundedTelegramDraft({
    header,
    timeline: summary,
    footer: "إدارة حسن فلاح مدرس مادة الأحياء",
  });
}

/**
 * ملف HTML الاحتياطي الذي يُنزّل عند تجاوز حد الرسالة: جداول «كل
 * الامتحانات» و«سجل تغيّر الفرص» من نفس لقطة تفاصيل تصدير HTML،
 * بنفس الأعمدة، حتى لا يختلف الملف المرفق عن التقرير المنشور.
 */
export function buildOpportunityTelegramHtml(
  student: OpportunityTelegramStudent,
  details: OpportunityTelegramDetails,
): string {
  const escape = escapeDismissedHistoryHtml;
  const fmtDate = (value: unknown) => {
    const raw = cleanText(value);
    if (!raw) return "—";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return escape(raw);
    try {
      return escape(
        parsed.toLocaleDateString("ar-IQ-u-nu-latn", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Asia/Baghdad",
        }),
      );
    } catch {
      return escape(raw);
    }
  };
  const fmtNum = (value: unknown) => escape(opportunityReportNumber(value));

  const grades = details.grades || [];
  const logs = details.opportunityLogs || [];

  const infoRows: Array<[string, string]> = [
    ["الاسم", cleanText(student.name)],
    ["الكود", cleanText(student.code) || "—"],
    ["الدورة", cleanText(student.courseName) || "—"],
  ];
  if (
    student.opportunities !== null &&
    student.opportunities !== undefined &&
    student.opportunities !== ""
  ) {
    infoRows.push(["عدد الفرص", opportunityReportNumber(student.opportunities)]);
  }
  if (cleanText(student.status)) {
    infoRows.push(["الحالة", opportunityStatusLine(cleanText(student.status))]);
  }
  infoRows.push(["سبب الفصل", cleanText(student.dismissalReason) || "غير مسجل"]);
  infoRows.push([
    "تاريخ الفصل",
    cleanText(student.dismissalDate) || "—",
  ]);
  if (cleanText(student.dismissalNotes)) {
    infoRows.push(["ملاحظات الفصل", cleanText(student.dismissalNotes)]);
  }

  const gradeRows = grades.length
    ? grades
        .map(
          (grade) => `<tr>
            <td>${escape(grade.examName)}</td>
            <td>${escape(grade.examType)}</td>
            <td>${fmtDate(grade.examDate)}</td>
            <td>${fmtNum(grade.score)}</td>
            <td>${fmtNum(grade.fullMark)}</td>
            <td>${escape(grade.status)}</td>
          </tr>`,
        )
        .join("")
    : '<tr class="empty-row"><td colspan="6">لا توجد امتحانات مسجلة لهذا الطالب</td></tr>';

  const logsSection = logs.length
    ? `<h2 class="section-title">سجل تغيّر الفرص</h2>
<table>
  <thead>
    <tr><th>السبب</th><th>مقدار التغيير</th><th>التاريخ</th><th>الامتحان</th></tr>
  </thead>
  <tbody>
    ${logs
      .map(
        (log) => `<tr>
          <td>${escape(cleanText(log.reason) || "غير مسجل")}</td>
          <td>${fmtNum(log.amount)}</td>
          <td>${fmtDate(log.date)}</td>
          <td>${escape(cleanText(log.examName) || "—")}</td>
        </tr>`,
      )
      .join("")}
  </tbody>
</table>`
    : "";

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>سجل الطالب - ${escape(cleanText(student.name))}</title>
<style>
:root{font-family:Arial,Tahoma,sans-serif;color:#111827;background:#f8fafc}
*{box-sizing:border-box}
body{margin:0;padding:24px}
.page{max-width:1000px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:28px;overflow-wrap:anywhere}
.header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;border-bottom:3px solid #111827;padding-bottom:18px;margin-bottom:20px}
.brand h1{font-size:24px;margin:0 0 6px}.brand p{margin:0;color:#6b7280}
.status{padding:8px 12px;border-radius:999px;background:#fee2e2;color:#991b1b;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}
.info-box{border:1px solid #e5e7eb;border-radius:12px;padding:10px;break-inside:avoid}
.info-box b{display:block;font-size:11px;color:#6b7280;margin-bottom:4px}
.section-title{font-size:18px;margin:26px 0 12px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{border:1px solid #d1d5db;padding:8px 10px;text-align:center;vertical-align:middle}
th{background:#f3f4f6;font-weight:900}
tbody tr:nth-child(even){background:#fafafa}
.empty-row td{color:#64748b;padding:16px}
.footer{margin-top:28px;border-top:1px solid #e5e7eb;padding-top:12px;font-size:12px;color:#6b7280;text-align:center}
@media(max-width:760px){body{padding:8px}.page{padding:14px;border-radius:10px}.header{display:block}.status{display:inline-block;margin-top:10px}.grid{grid-template-columns:1fr 1fr}}
@page{size:A4;margin:12mm}
@media print{body{padding:0;background:#fff}.page{max-width:none;border:0;border-radius:0;padding:0}tr,.info-box{page-break-inside:avoid;break-inside:avoid}}
</style>
</head>
<body>
<main class="page">
<header class="header"><div class="brand"><h1>سجل الطالب</h1><p>إدارة حسن فلاح مدرس مادة الأحياء</p></div><div class="status">${escape(opportunityStatusLine(cleanText(student.status)))}</div></header>
<div class="grid">${infoRows.map(([k, v]) => `<div class="info-box"><b>${escape(k)}</b><span>${escape(v)}</span></div>`).join("")}</div>
<h2 class="section-title">كل الامتحانات</h2>
<table>
  <thead>
    <tr><th>الامتحان</th><th>النوع</th><th>التاريخ</th><th>الدرجة</th><th>الامتحان من</th><th>الحالة</th></tr>
  </thead>
  <tbody>${gradeRows}</tbody>
</table>
${logsSection}
<footer class="footer">تم إنشاء هذا التقرير من نفس مصدر بيانات تصدير HTML في TeacherPro.</footer>
</main>
</body>
</html>`;
}
