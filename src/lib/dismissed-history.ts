type DismissalLogLike = {
  action?: unknown;
  reason?: unknown;
};

type DismissalNoteLike = {
  kind?: unknown;
  text?: unknown;
  dismissalType?: unknown;
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
  allStudentNotes: boolean;
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
  const pledgeNotes = hasAny(
    "follow-up.pledges.view",
    "follow-up.pledges.manage",
    "page.follow-up-pledges.view",
  );

  return {
    ...baseAccess,
    calls,
    leaves,
    studentNotes: broadFollowUp || pledgeNotes,
    allStudentNotes: broadFollowUp,
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
 * Pledge notes also carry dismissal metadata, but they are not dismissal
 * events. Only an action note whose text records the dismissal is accepted.
 */
export function isDismissalActionNote(note: DismissalNoteLike): boolean {
  if (cleanText(note.kind) !== "إجراء") return false;
  const noteText = cleanText(note.text);
  return (
    /^(?:فصل الطالب|تم فصل الطالب)(?:\s|$|\(|:)/u.test(noteText) ||
    Boolean(cleanText(note.dismissalType) && noteText.startsWith("فصل"))
  );
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

  let result = "";
  if (title === "فصل الطالب" || action === "فصل تلقائي") {
    result = "تم فصل الطالب";
  } else if (
    action === "خصم" ||
    action === "خصم تلقائي" ||
    title.startsWith("فقدان")
  ) {
    result =
      count === 1
        ? "تم خصم فرصة"
        : count > 1
          ? `تم خصم ${count} فرص`
          : "تم خصم فرصة";
  } else if (
    action === "إضافة" ||
    action === "إعادة تعيين" ||
    action === "إعادة تفعيل" ||
    title.startsWith("إضافة")
  ) {
    result =
      count === 1
        ? "تمت إضافة فرصة"
        : count > 1
          ? `تمت إضافة ${count} فرص`
          : action;
  } else if (Number.isFinite(amount) && amount < 0) {
    result = count === 1 ? "تم خصم فرصة" : `تم خصم ${count} فرص`;
  } else if (Number.isFinite(amount) && amount > 0) {
    result = count === 1 ? "تمت إضافة فرصة" : `تمت إضافة ${count} فرص`;
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
