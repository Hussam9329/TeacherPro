export type AuditLogEntityLabels = {
  students?: Record<string, string>;
  exams?: Record<string, string>;
};

export type AuditLogDisplayItem = {
  label: string;
  value: string;
};

export type AuditLogDisplay = {
  summary: string;
  items: AuditLogDisplayItem[];
  technicalDetails: string | null;
  isStructured: boolean;
};

type AuditLogInput = {
  module?: string | null;
  action?: string | null;
  details?: string | null;
};

const FIELD_LABELS: Record<string, string> = {
  username: "اسم الحساب",
  studentId: "الطالب",
  examId: "الامتحان",
  status: "الحالة",
  score: "الدرجة",
  backedUpGrades: "الدرجات المحفوظة احتياطياً",
  restoredGradeCount: "الدرجات المستعادة",
  recalculatedStudents: "الطلاب المعاد احتسابهم",
  totalStudents: "إجمالي الطلاب",
  automaticOpportunityLogs: "سجلات الفرص التلقائية",
  batches: "دفعات المعالجة",
  leaveType: "نوع الإجازة",
  completed: "اكتمل الاتصال",
  completedAt: "وقت إكمال الاتصال",
  phone: "رقم التواصل",
  target: "سبب المتابعة",
  notes: "الملاحظات",
  category: "التصنيف",
  ok: "النتيجة",
  totalCount: "الإجمالي",
  count: "العدد",
  studentName: "اسم الطالب",
  studentCode: "كود الطالب",
  action: "نوع الحركة",
  amount: "المقدار",
  reason: "السبب",
  deleted: "السجلات المحذوفة",
  created: "السجلات المضافة",
  updated: "السجلات المعدلة",
  skipped: "السجلات المتروكة",
  failed: "السجلات التي فشلت",
  courseName: "الدورة",
  examName: "الامتحان",
  chapterName: "الفصل",
  oldStatus: "الحالة السابقة",
  newStatus: "الحالة الجديدة",
  oldValue: "القيمة السابقة",
  newValue: "القيمة الجديدة",
};

const TECHNICAL_ID_KEYS = new Set([
  "id",
  "gradeId",
  "leaveId",
  "userId",
  "roleId",
  "sourceId",
  "dismissalId",
  "opportunityLogId",
]);

function safeParseDetails(details: string): Record<string, unknown> | null {
  const trimmed = details.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function entityLabel(
  key: string,
  value: unknown,
  labels: AuditLogEntityLabels,
): string | null {
  const id = String(value ?? "").trim();
  if (!id) return null;
  if (key === "studentId") return labels.students?.[id] || null;
  if (key === "examId") return labels.exams?.[id] || null;
  return null;
}

function formatBoolean(value: boolean): string {
  return value ? "نعم" : "لا";
}

function formatValue(key: string, value: unknown, labels: AuditLogEntityLabels): string {
  const resolved = entityLabel(key, value, labels);
  if (resolved) return resolved;
  if (value === null || value === undefined || value === "") return "غير محدد";
  if (key === "ok") return value ? "نجحت" : "لم تكتمل";
  if (typeof value === "boolean") return formatBoolean(value);
  if (Array.isArray(value)) return value.map((item) => String(item)).join("، ") || "لا يوجد";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "بيانات إضافية";
    }
  }
  if (key === "leaveType") {
    if (value === "exam") return "إجازة امتحان";
    if (value === "period") return "إجازة لمدة زمنية";
  }
  return String(value);
}

function pluralStudents(value: unknown): string {
  const count = Number(value || 0);
  if (count === 1) return "طالب واحد";
  if (count === 2) return "طالبين";
  return `${count} طالباً`;
}

function buildKnownSummary(
  input: AuditLogInput,
  data: Record<string, unknown>,
  labels: AuditLogEntityLabels,
): string | null {
  const action = String(input.action || "");
  const student = entityLabel("studentId", data.studentId, labels) || "الطالب المحدد";
  const exam = entityLabel("examId", data.examId, labels) || "الامتحان المحدد";

  if (action.includes("نجاح تسجيل دخول")) {
    const username = String(data.username || "الحساب المحدد");
    return `تم تسجيل الدخول بنجاح باستخدام الحساب «${username}».`;
  }

  if (action.includes("حفظ درجة") || action.includes("تسجيل درجة")) {
    const status = String(data.status || "درجة");
    const score = data.score === null || data.score === undefined ? "" : ` بدرجة ${data.score}`;
    return `تم حفظ حالة «${status}»${score} للطالب ${student} في ${exam}، ثم أُعيد احتساب وضعه الأكاديمي.`;
  }

  if (action.includes("تسجيل إجازة")) {
    const type = data.leaveType === "period" ? "إجازة زمنية" : "إجازة امتحان";
    const restored = Number(data.restoredGradeCount || 0);
    const backedUp = Number(data.backedUpGrades || 0);
    return `تم تسجيل ${type} للطالب ${student} في ${exam}. حُفظت ${backedUp} درجة احتياطياً واستُعيدت ${restored} درجة، ثم أُعيد الاحتساب.`;
  }

  if (action.includes("إصلاح أكاديمي شامل")) {
    const total = pluralStudents(data.totalStudents);
    const batches = Number(data.batches || 0);
    const logs = Number(data.automaticOpportunityLogs || 0);
    return `اكتمل الإصلاح الأكاديمي لـ${total} ضمن ${batches} دفعة، مع تحديث ${logs} سجل فرصة تلقائي.`;
  }

  if (action.includes("مكالمة") || action.includes("التواصل")) {
    const status = String(data.status || (data.completed ? "تم الاتصال" : "بدون إجراء"));
    return `تم تحديث متابعة الاتصال مع ${student} إلى «${status}»${exam ? ` بخصوص ${exam}` : ""}.`;
  }

  return null;
}

export function extractAuditEntityIds(details?: string | null): {
  studentIds: string[];
  examIds: string[];
} {
  const data = safeParseDetails(String(details || ""));
  if (!data) return { studentIds: [], examIds: [] };
  const studentId = String(data.studentId || "").trim();
  const examId = String(data.examId || "").trim();
  return {
    studentIds: studentId ? [studentId] : [],
    examIds: examId ? [examId] : [],
  };
}

export function formatAuditLogDisplay(
  input: AuditLogInput,
  labels: AuditLogEntityLabels = {},
): AuditLogDisplay {
  const rawDetails = String(input.details || "").trim();
  if (!rawDetails) {
    return {
      summary: "تم تنفيذ العملية بدون تفاصيل إضافية.",
      items: [],
      technicalDetails: null,
      isStructured: false,
    };
  }

  const data = safeParseDetails(rawDetails);
  if (!data) {
    return {
      summary: rawDetails,
      items: [],
      technicalDetails: null,
      isStructured: false,
    };
  }

  const items = Object.entries(data).flatMap(([key, value]) => {
    if (value === null || value === undefined || value === "") return [];
    const resolvedEntity = entityLabel(key, value, labels);
    if (TECHNICAL_ID_KEYS.has(key)) return [];
    if (/Ids?$/i.test(key) && !resolvedEntity) return [];
    if ((key === "studentId" || key === "examId") && !resolvedEntity) return [];
    const label = FIELD_LABELS[key];
    if (!label && !resolvedEntity) return [];
    return [
      {
        label: label || (key === "studentId" ? "الطالب" : "الامتحان"),
        value: formatValue(key, value, labels),
      },
    ];
  });

  const knownSummary = buildKnownSummary(input, data, labels);
  const fallbackSummary = items.length
    ? items
        .slice(0, 3)
        .map((item) => `${item.label}: ${item.value}`)
        .join(" — ")
    : "تم تنفيذ العملية بنجاح، والتفاصيل التقنية متاحة عند الحاجة.";

  return {
    summary: knownSummary || fallbackSummary,
    items,
    technicalDetails: rawDetails,
    isStructured: true,
  };
}
