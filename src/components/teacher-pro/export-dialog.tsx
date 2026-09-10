"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAppDate } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Download, FileCode, FileSpreadsheet, FileText, Printer, RotateCcw } from "lucide-react";
import { toast } from "@/lib/user-toast";
import { humanizeTeacherProText } from "@/lib/teacherpro-language";
import { buildProfessionalXlsx } from "@/lib/xlsx-export";
import { opportunityLogWithinActiveChapter } from "@/lib/active-chapter-report";
import { hasTwoOpportunityPledge, presentOpportunityMovement, reportGradeEffect, reportGradeOutcome, reportNumber, type ReportMovementKind } from "@/lib/student-report-presentation";

export type ExportColumn<T = Record<string, unknown>> = {
  key: string;
  label: string;
  value: (row: T, index?: number) => string | number | null | undefined;
  defaultSelected?: boolean;
  locked?: boolean;
};

type ExportFormat = "csv" | "excel" | "html" | "pdf";
type PageOrientation = "portrait" | "landscape";

/* ============================ تفاصيل الطالب المضمّنة ============================ */
export type StudentGradeDetail = {
  examId?: string;
  examName: string;
  examType: string;
  examDate: string;
  score: number | null;
  fullMark: number | null;
  status: string;
  /** داخلي فقط لتحديد حالة تقرير HTML؛ لا يُحقن في الملف المتولد. */
  notes?: string | null;
  outcome?: string;
  opportunityEffect?: string;
  passMark?: number | null;
};

export type StudentOpportunityLogDetail = {
  examId?: string;
  action: string;
  amount: number;
  reason: string | null;
  date: string;
  examName: string | null;
  appliedAmount?: number | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  movementKind?: ReportMovementKind;
  effectText?: string;
};

export type StudentDetails = {
  grades: StudentGradeDetail[];
  opportunityLogs: StudentOpportunityLogDetail[];
  /**
   * اسم الفصل النشط الحالي (اختياري): يُعرض في عنوان قسم الامتحانات داخل
   * ملف HTML ويُستخدم لصياغة حالة «لا توجد امتحانات للفصل النشط».
   */
  activeChapterName?: string | null;
  activeChapterSince?: string | null;
  generatedAt?: string | null;
  /** A recorded two-opportunity pledge grant, independent of the remaining balance. */
  hasTwoOpportunityPledge?: boolean;
  studentSnapshot?: {
    name: string; code: string; status: string; opportunities: number | null; courseName?: string;
    opportunityLimit: number | null; registeredAt: string | null;
  };
};

export type StudentDetailsMap = Record<string, StudentDetails>;

/** Derive the choices from the exact report snapshot, after chapter scoping. */
export function getHtmlReportExams(details: StudentDetailsMap) {
  const exams = new Map<string, { id: string; name: string; date: string; courseNames: string[] }>();
  for (const student of Object.values(details)) {
    for (const grade of student.grades) {
      if (grade.examId && !exams.has(grade.examId)) {
        exams.set(grade.examId, { id: grade.examId, name: grade.examName, date: grade.examDate, courseNames: [] });
      }
      const exam = grade.examId ? exams.get(grade.examId) : undefined;
      const courseName = student.studentSnapshot?.courseName;
      if (exam && courseName && !exam.courseNames.includes(courseName)) exam.courseNames.push(courseName);
    }
  }
  return [...exams.values()].sort((a, b) =>
    (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) ||
    a.name.localeCompare(b.name, "ar") || a.id.localeCompare(b.id));
}

/** Presentation only: the authoritative balance, status and pledge stay intact. */
export function selectHtmlReportExams(details: StudentDetailsMap, selectedExamIds: string[]): StudentDetailsMap {
  const selected = new Set(selectedExamIds);
  return Object.fromEntries(Object.entries(details).map(([id, student]) => [id, {
    ...student,
    grades: student.grades.filter(grade => Boolean(grade.examId && selected.has(grade.examId))),
    opportunityLogs: student.opportunityLogs.filter(log => !log.examId || selected.has(log.examId)),
  }]));
}

/**
 * بيانات الطالب الأساسية المعروضة في الجدول/البطاقة عند اختياره من البحث.
 * تُحقن في ملف HTML كـ window.STUDENT_LIST لاستخدامها في البحث والفلترة.
 */
export type StudentRowBasic = {
  id: string;
  name: string;
  courseName: string;
  opportunities: number | string;
  /** حالة الطالب في النظام (نشط / مفصول / مؤرشف) — تُستخدم لعرض شارة «مفصول» بجانب الاسم. */
  status?: string;
  [key: string]: unknown;
};

export type ExportFetchContext = {
  signal: AbortSignal;
  onProgress: (loaded: number, total: number) => void;
};

export type StudentDetailsFetcher = (
  studentIds: string[],
  context: ExportFetchContext,
) => Promise<StudentDetailsMap>;

const GRACE_DEFERRED_REPORT_STATUS = "لا يحاسب الطالب ( ضمن فترة السماح )";
// تُهمل أنواع الملاحظات الأخرى عمداً لأن عمود الملاحظات أزيل من التقرير،
// وتلك الحالات لا تؤثر على عرض الحالة في التقرير.
const GRACE_DEFERRED_GRADE_NOTE_PREFIXES = [
  "درجة مؤجلة خلال فترة السماح",
  "درجة مؤجلة خلال فترة سماح الطالب",
  "درجة حقيقية داخل فترة السماح؛ محفوظة للمتابعة دون أثر أكاديمي",
] as const;
function normalizeArabicComparisonText(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("ar-IQ")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\s\-_]+/g, " ")
    .trim();
}

function isGraceDeferredGradeForHtml(grade: StudentGradeDetail): boolean {
  // لا نحول أي حالة أخرى (مثل «غائب») حتى لو احتوت ملاحظة مشابهة.
  if (String(grade.status || "").trim() !== "درجة") return false;

  const normalizedNotes = normalizeArabicComparisonText(grade.notes);
  if (!normalizedNotes) return false;

  return GRACE_DEFERRED_GRADE_NOTE_PREFIXES.some((phrase) =>
    normalizedNotes.includes(normalizeArabicComparisonText(phrase)),
  );
}

export function sanitizeStudentDetailsForHtml(details: StudentDetailsMap): StudentDetailsMap {
  return Object.fromEntries(
    Object.entries(details).map(([studentId, studentDetails]) => [
      studentId,
      {
        activeChapterName: studentDetails.activeChapterName ?? null,
        activeChapterSince: studentDetails.activeChapterSince ?? null,
        generatedAt: studentDetails.generatedAt ?? null,
        hasTwoOpportunityPledge: studentDetails.hasTwoOpportunityPledge === true,
        studentSnapshot: studentDetails.studentSnapshot,
        grades: (studentDetails.grades || [])
          .map((grade) => {
            const { notes: _notes, ...reportGrade } = grade;
            return {
              ...reportGrade,
              status: isGraceDeferredGradeForHtml(grade)
                ? GRACE_DEFERRED_REPORT_STATUS
                : grade.status,
            };
          })
          .sort((a, b) => {
            const da = new Date(a.examDate).getTime() || 0;
            const db = new Date(b.examDate).getTime() || 0;
            return da - db;
          }),
        // سجل الفرص يصل هنا مقيداً بالفصل النشط من buildStudentDetailsFromProfileLog،
        // لذا تبقى صفوف التسوية (بداية رصيد الفصل) ظاهرة: هي الخط الفاصل الذي
        // يفسر أن خصومات الفصل السابق لا تُحسب على الرصيد الحالي.
        opportunityLogs: (studentDetails.opportunityLogs || [])
          .map((log) => ({
            ...log,
            ...presentOpportunityMovement(log),
          }))
          .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0)),
      },
    ]),
  );
}

export type StudentProfileLogSnapshot = {
  student?: Record<string, unknown> | null;
  generatedAt?: string;
  exams?: Array<Record<string, unknown>> | null;
  grades?: Array<Record<string, unknown>> | null;
  allCourseExams?: Array<Record<string, unknown>> | null;
  opportunityLogs?: Array<Record<string, unknown>> | null;
  /**
   * سياق الفصل النشط الحالي (من /api/students/profile-log): عند توفره
   * تُعرض درجات امتحانات الفصل النشط وحدها (الامتحانات المنشأة بعد بداية
   * الفصل النشط) بدل كل امتحانات الدورة. غيابه = بلا فلترة (سلوك قديم).
   */
  currentChapter?: {
    id?: unknown;
    name?: unknown;
    since?: unknown;
    examIds?: unknown;
  } | null;
};

/**
 * يستخرج فلتر امتحانات الفصل النشط الحالي من استجابة profile-log:
 * مجموعة معرفات امتحانات الفصل النشط (اسم الفصل أيضاً لعناوين التقرير).
 * يعيد set فارغاً فقط عندما تكون قائمة examIds فارغة فعلاً (فصل
 * نشط بلا امتحانات بعد)، ويعيد null عند غياب السياق كلياً (بلا فلترة).
 */
function resolveActiveChapterExamFilter(
  profile: StudentProfileLogSnapshot,
): { chapterExamIds: Set<string> | null; activeChapterName: string | null } {
  const currentChapter = profile.currentChapter;
  if (!currentChapter || typeof currentChapter !== "object") {
    return { chapterExamIds: null, activeChapterName: null };
  }
  const examIdsRaw = currentChapter.examIds;
  if (!Array.isArray(examIdsRaw)) {
    return { chapterExamIds: null, activeChapterName: null };
  }
  const chapterExamIds = new Set(
    examIdsRaw.map((id) => String(id || "").trim()).filter(Boolean),
  );
  const nameRaw = currentChapter.name;
  const activeChapterName =
    typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;
  return { chapterExamIds, activeChapterName };
}

/**
 * يستخرج نطاق «الفصل النشط» لسجل حركات الفرص من استجابة profile-log:
 * نفس امتحانات الفصل النشط المستخدمة لفلترة الدرجات، مع لحظة الانتقال
 * (since) لفلترة الحركات غير المرتبطة بامتحان (التسوية، التعديلات اليدوية).
 * يعيد null عند غياب السياق كلياً = بلا فلترة (السلوك القديم).
 */
function resolveActiveChapterLogScope(
  profile: StudentProfileLogSnapshot,
): { examIds: string[]; since: string | null } | null {
  const currentChapter = profile.currentChapter;
  if (!currentChapter || typeof currentChapter !== "object") {
    return null;
  }
  const examIdsRaw = currentChapter.examIds;
  if (!Array.isArray(examIdsRaw)) {
    return null;
  }
  const sinceRaw = currentChapter.since;
  return {
    examIds: examIdsRaw
      .map((id) => String(id || "").trim())
      .filter(Boolean),
    since:
      typeof sinceRaw === "string" && sinceRaw.trim() ? sinceRaw.trim() : null,
  };
}

/**
 * يحوّل استجابة /api/students/profile-log إلى لقطة تفاصيل الطالب
 * (درجات الامتحانات + سجل الفرص مع الأسباب) — نفس التحويل الحرفي
 * الذي يستخدمه تصدير HTML من صفحة إدارة الفرص.
 *
 * الدالة مشتركة عمداً بين تصدير HTML وزر تيليجرام في إدارة المفصولين
 * حتى يبقى مصدر الرسالة ومصدر الملف المتولد واحداً لا يتفرع.
 */
export function buildStudentDetailsFromProfileLog(
  profile: StudentProfileLogSnapshot,
): StudentDetails {
  const { chapterExamIds, activeChapterName } =
    resolveActiveChapterExamFilter(profile);
  const examMap = new Map<string, Record<string, unknown>>();
  const exams = Array.isArray(profile.exams) ? profile.exams : [];
  for (const exam of exams) {
    const examRecord = exam as Record<string, unknown>;
    const examId = String(examRecord.id || "");
    if (examId) examMap.set(examId, examRecord);
  }

  const rawGrades = Array.isArray(profile.grades) ? profile.grades : [];
  const rawLogs = Array.isArray(profile.opportunityLogs) ? profile.opportunityLogs : [];
  const logScope = resolveActiveChapterLogScope(profile);
  const scopedLogs = rawLogs.filter(log => opportunityLogWithinActiveChapter(log, logScope));
  const gradeExamIds = new Set<string>();
  const grades: StudentGradeDetail[] = rawGrades
    // درجات امتحانات الفصل النشط الحالي فقط: عند توفر سياق الفصل النشط
    // (currentChapter) نخفي درجات الامتحانات المنشأة قبل بداية الفصل النشط
    // حتى يعرض التقرير فصل الطالب الحالي وحده — غياب السياق = بلا فلترة.
    .filter((rawGrade) =>
      chapterExamIds
        ? chapterExamIds.has(String((rawGrade as Record<string, unknown>).examId || ""))
        : true,
    )
    .map((rawGrade) => {
      const grade = rawGrade as Record<string, unknown>;
      const examId = String(grade.examId || "");
      gradeExamIds.add(examId);
      const exam = examMap.get(examId);
      const score = grade.score;
      const fullMark = exam?.fullMark;
      return {
        examId,
        examName: String(exam?.name || "امتحان غير محدد"),
        examType: String(exam?.type || ""),
        examDate: String(exam?.date || ""),
        score: score === null || score === undefined ? null : Number(score),
        fullMark:
          fullMark === null || fullMark === undefined ? null : Number(fullMark),
        status: String(grade.status || ""),
        notes: grade.notes ? String(grade.notes) : null,
        outcome: reportGradeOutcome(grade, exam),
        opportunityEffect: reportGradeEffect(grade, exam, scopedLogs.filter(log => log.examId === examId)),
        passMark: reportNumber(exam?.passMark),
      };
    });

  // إضافة امتحانات الدورة التي ليس للطالب سجل درجات فيها — ضمن امتحانات
  // الفصل النشط الحالي فقط عند توفر سياق الفصل النشط.
  const allCourseExams = Array.isArray(profile.allCourseExams)
    ? profile.allCourseExams
    : [];
  for (const rawExam of allCourseExams) {
    const examRecord = rawExam as Record<string, unknown>;
    const examId = String(examRecord.id || "");
    if (
      examId &&
      (!chapterExamIds || chapterExamIds.has(examId)) &&
      !gradeExamIds.has(examId)
    ) {
      examMap.set(examId, examRecord);
      grades.push({
        examId,
        examName: String(examRecord.name || "امتحان غير محدد"),
        examType: String(examRecord.type || ""),
        examDate: String(examRecord.date || ""),
        score: null,
        fullMark:
          examRecord.fullMark === null || examRecord.fullMark === undefined
            ? null
            : Number(examRecord.fullMark),
        status: "غائب",
        notes: null,
        outcome: "غياب",
        opportunityEffect: reportGradeEffect({ status: "غائب" }, examRecord, scopedLogs.filter(log => log.examId === examId)),
        passMark: reportNumber(examRecord.passMark),
      });
    }
  }

  const opportunityLogs: StudentOpportunityLogDetail[] = rawLogs
    // سجل الفرص مقيد بنفس حدود الفصل النشط المطبقة على الدرجات (حسب طلب
    // المالك): تُعرض حركات امتحانات الفصل النشط فقط، ومعها التسوية/الحركات
    // اليدوية الواقعة يوم انتقال الفصل أو بعده. خصومات امتحانات الفصل
    // السابق تُخفى لأن التسوية عند التحويل محت أثرها من الرصيد الحالي.
    .filter((rawLog) =>
      opportunityLogWithinActiveChapter(
        rawLog as Record<string, unknown>,
        logScope,
      ),
    )
    .map((rawLog) => {
      const log = rawLog as Record<string, unknown>;
      const exam = examMap.get(String(log.examId || ""));
      return {
        examId: String(log.examId || ""),
        action: String(log.action || ""),
        amount: Number(log.amount || 0),
        reason: log.reason ? String(log.reason) : null,
        date: String(log.date || ""),
        examName: exam?.name ? String(exam.name) : null,
        appliedAmount: reportNumber(log.appliedAmount),
        balanceBefore: reportNumber(log.balanceBefore),
        balanceAfter: reportNumber(log.balanceAfter),
      };
    });

  const student = profile.student;
  return {
    grades, opportunityLogs, activeChapterName,
    // Pledges from the full enrollment history must survive exam/chapter filters.
    hasTwoOpportunityPledge: hasTwoOpportunityPledge(rawLogs),
    activeChapterSince: logScope?.since ?? null,
    generatedAt: profile.generatedAt ?? null,
    studentSnapshot: student ? {
      name: String(student.name || ""), code: String(student.code || ""),
      status: String(student.status || ""), opportunities: reportNumber(student.opportunities),
      opportunityLimit: reportNumber(student.opportunityLimit), registeredAt: student.createdAt ? String(student.createdAt) : null,
    } : undefined,
  };
}

function normalizeExportValue(value: string | number | null | undefined): string | number {
  return typeof value === "string" ? humanizeTeacherProText(value) : value ?? "";
}

function protectSpreadsheetCell(value: string | number | null | undefined): string {
  const normalized = normalizeExportValue(value);
  const text = String(normalized);
  // Spreadsheet applications interpret these leading characters as formulas.
  // Prefix only string input so legitimate negative numeric values remain numeric.
  return typeof normalized === "string" && /^\s*[=+\-@]/.test(text)
    ? `'${text}`
    : text;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = protectSpreadsheetCell(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Serializes values for an inline classic script without allowing user data to
 * terminate the surrounding <script> element. The escaped code points are
 * decoded by JavaScript back to their original characters at runtime.
 */
function serializeForInlineScript(value: unknown): string {
  return (JSON.stringify(value) ?? "null")
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003C")
    .replaceAll(">", "\\u003E")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeJsString(value: string): string {
  return serializeForInlineScript(String(value ?? ""));
}

function sanitizeExportFileName(value: string): string {
  return (
    String(value || "export")
      .trim()
      .replace(/[\/:*?"<>|]+/g, "-")
      .replace(/[^\w؀-ۿ .-]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "export"
  );
}

function buildCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const header = columns.map((col) => escapeCsvCell(col.label)).join(",");
  const body = rows
    .map((row, rowIndex) =>
      columns
        .map((col) => escapeCsvCell(col.value(row, rowIndex)))
        .join(","),
    )
    .join("\r\n");
  // BOM for Excel Arabic support
  return "\uFEFF" + header + "\r\n" + body;
}

const DETAILS_COLUMN_KEY = "__student_details__";

function buildTableRows<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  options: {
    hasDetails?: boolean;
    getRowId?: (row: T) => string;
  } = {},
): string {
  const hasDetails = Boolean(options.hasDetails);
  const getRowId =
    options.getRowId ||
    ((row: T) => String((row as Record<string, unknown>)?.id ?? ""));

  return rows
    .map((row, rowIndex) => {
      const cells = columns
        .map((col) => {
          if (col.key === DETAILS_COLUMN_KEY && hasDetails) {
            const id = escapeHtml(getRowId(row));
            return `<td class="tp-details-cell"><button type="button" class="tp-details-btn" data-sid="${id}">عرض التفاصيل</button></td>`;
          }
          const cellValue = normalizeExportValue(col.value(row, rowIndex));
          return `<td>${escapeHtml(String(cellValue))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
}

const DETAILS_MODAL_CSS = `
  .tp-search-report-body { padding: 24px; color: #172b3a; background: #f3f6f8; font-weight: 400; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  .report-search-mode { max-width: 1120px; margin: auto; border-radius: 20px; border-color: #dbe5e9; padding: 28px; }
  .report-search-mode .report-header { display: block; text-align: center; border: 0; margin-bottom: 24px; }
  .report-search-mode h1 { color: #123f4d; font-size: clamp(23px, 4dvw, 32px); overflow-wrap: anywhere; }
  .tp-report-intro { margin: 10px 0; color: #435d6b; line-height: 1.9; font-size: 15px; }
  .tp-search-wrap { width: 100%; max-width: 700px; margin: 0 auto 24px; }
  .tp-search-label { display: block; margin-bottom: 10px; font-size: 16px; font-weight: 700; }
  .tp-search-input { width: 100%; min-height: 52px; padding: 14px 16px; font: inherit; font-size: 16px; border: 2px solid #8faab5; border-radius: 12px; background: white; color: #172b3a; }
  .tp-search-input:focus { border-color: #087f80; outline: 3px solid #c2ece6; outline-offset: 2px; }
  .tp-search-hint { font-size: 14px; color: #536974; line-height: 1.8; margin: 10px 0; }
  .tp-suggestions { display: none; max-height: min(360px, 48dvh); overflow-y: auto; border: 1px solid #cfdee3; border-radius: 12px; margin-top: 10px; background: white; overscroll-behavior: contain; }
  .tp-suggestions.open { display: block; }
  .tp-suggestion { min-height: 44px; padding: 14px; border-bottom: 1px solid #e7eef1; cursor: pointer; overflow-wrap: anywhere; }
  .tp-suggestion:last-child { border-bottom: 0; }
  .tp-suggestion:hover, .tp-suggestion.active, .tp-suggestion[aria-selected="true"] { background: #e7f5f1; box-shadow: inset -3px 0 #087f80; }
  .tp-suggestion-name { font-weight: 700; line-height: 1.8; }
  .tp-suggestion-meta { font-size: 13px; color: #536974; margin-top: 4px; line-height: 1.7; }
  .tp-dismissed-badge { display: inline-block; margin-inline-start: 6px; border: 1px solid #efb7b7; border-radius: 999px; padding: 2px 10px; color: #9d2222; background: #fff0f0; font-size: 12px; line-height: 1.8; vertical-align: middle; }
  .tp-empty-search { padding: 16px; color: #536974; }
  .tp-student-card { display: none; max-width: 700px; margin: auto; }
  .tp-student-card.visible { display: block; }
  .tp-student-card table { width: 100%; min-width: 0; table-layout: fixed; font-weight: 400; }
  .tp-student-card td, .tp-student-card th { overflow-wrap: anywhere; }
  .tp-details-btn, .tp-modal-close { min-height: 44px; max-width: 100%; touch-action: manipulation; padding: 10px 16px; border: 1px solid #087f80; border-radius: 10px; background: #087f80; color: white; cursor: pointer; font-family: inherit; font-size: 14px; font-weight: 700; white-space: normal; }
  .tp-details-btn:hover, .tp-modal-close:hover { background: #076366; }
  .tp-details-btn:focus-visible, .tp-modal-close:focus-visible { outline: 3px solid #287bab; outline-offset: 3px; }
  .tp-modal-overlay { position: fixed; inset: 0; z-index: 100; display: none; padding: 16px; background: #17333ec9; overflow: hidden; }
  .tp-modal-overlay.open { display: flex; }
  .tp-modal { width: 100%; max-width: 1120px; min-width: 0; max-height: 100%; margin: auto; padding: 0 24px 24px; background: #fff; border-radius: 18px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
  .tp-modal:focus { outline: none; }
  .tp-modal-header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 0; margin-bottom: 18px; border-bottom: 1px solid #dbe5e9; background: white; }
  .tp-modal-header h2 { min-width: 0; margin: 0; font-size: clamp(17px, 3dvw, 23px); line-height: 1.6; overflow-wrap: anywhere; }
  .tp-modal-close { flex-shrink: 0; }
  .tp-report-summary { display: grid; grid-template-columns: minmax(0, 320px); margin-bottom: 16px; }
  .tp-summary-item { min-width: 0; padding: 18px; background: #f2f7f8; border: 1px solid #dbe5e9; border-radius: 14px; overflow-wrap: anywhere; }
  .tp-summary-item strong { display: block; font-size: 20px; color: #123f4d; line-height: 1.6; }
  .tp-summary-item:first-child { background: #e5f5ef; border-color: #b1d9c9; }
  .tp-summary-item:first-child strong { font-size: 32px; }
  .tp-summary-label { display: block; font-size: 13px; color: #435d6b; margin-bottom: 6px; }
  .tp-pledge-note { display: block; margin-top: 6px; font-size: 13px; font-weight: 400; line-height: 1.8; color: #435d6b; overflow-wrap: anywhere; }
  .tp-details-section { min-width: 0; margin: 28px 0 0; scroll-margin-top: 90px; }
  .tp-details-section h3 { font-size: 20px; line-height: 1.7; color: #123f4d; margin: 0 0 6px; }
  .tp-details-table { width: 100%; min-width: 0; table-layout: fixed; border-collapse: separate; border-spacing: 0; font-size: 14px; font-weight: 400; border: 1px solid #dbe5e9; border-radius: 12px; }
  .tp-details-table th, .tp-details-table td { padding: 13px 10px; border: 0; border-bottom: 1px solid #e4ecef; text-align: right; line-height: 1.9; vertical-align: top; white-space: normal; overflow-wrap: anywhere; }
  .tp-details-table th { background: #edf4f6; color: #314f5e; font-weight: 700; }
  .tp-details-table tr:last-child td { border-bottom: 0; }
  .tp-details-table tr:nth-child(even) { background: #f9fbfc; }
  .tp-grades-table th:first-child { width: 35%; }
  .tp-grades-table th:nth-child(2) { width: 20%; }
  .tp-grades-table th:nth-child(3) { width: 15%; }
  .tp-grades-table th:last-child { width: 30%; }
  .tp-mobile-field-label { display: none; }
  .tp-mobile-field-value { min-width: 0; }
  .tp-grade-deduction .tp-mobile-field-value { color: #b42318; font-weight: 700; }
  .tp-grade-no-deduction .tp-mobile-field-value { color: #067647; font-weight: 700; }
  .tp-event-title { display: block; font-weight: 700; color: #172b3a; margin-bottom: 4px; }
  .tp-event-exam { display: block; font-size: 12px; color: #536974; margin-top: 5px; }
  .tp-empty-row td { padding: 20px; color: #536974; text-align: center; }
  .tp-error-row td { color: #a0382d; }
  @media (forced-colors: active) { .tp-search-input:focus, .tp-suggestion.active { outline: 2px solid CanvasText; outline-offset: 2px; } }
  @media screen and (max-width: 960px) { .tp-modal { padding-inline: 16px; } .tp-details-table { font-size: 13px; } }
  @media screen and (max-width: 720px) {
    .tp-search-report-body { padding: 12px; padding-top: max(12px, env(safe-area-inset-top, 0px)); padding-bottom: max(12px, env(safe-area-inset-bottom, 0px)); }
    .report-search-mode { padding: 18px 14px; }
    .tp-modal-overlay { padding: 0; }
    .tp-modal { max-height: 100%; height: 100%; border-radius: 0; padding: 0 12px max(16px, env(safe-area-inset-bottom, 0px)); }
    .tp-modal-header { padding-top: max(12px, env(safe-area-inset-top, 0px)); gap: 8px; }
    .tp-modal-close { padding-inline: 10px; }
    .tp-summary-item { padding: 12px; }
    .tp-summary-item strong { font-size: 16px; }
    .tp-details-table, .tp-details-table tbody, .tp-details-table tr, .tp-student-card table, .tp-student-card tbody, .tp-student-card tr { display: block; width: 100%; min-width: 0; }
    .tp-details-table, .tp-student-card table { border: 0; background: transparent; }
    .tp-details-table thead, .tp-student-card thead { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .tp-details-table tr, .tp-student-card tr { border: 1px solid #dbe5e9; border-radius: 12px; margin-bottom: 12px; padding: 6px 12px; background: white; }
    .tp-details-table tr:not(.tp-empty-row) td, .tp-student-card td { display: grid; grid-template-columns: minmax(96px, 38%) minmax(0, 1fr); gap: 10px; width: 100%; min-width: 0; min-height: 44px; padding: 10px 0; border: 0; border-bottom: 1px solid #e4ecef; }
    .tp-mobile-field-label { display: block; color: #536974; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
    .tp-mobile-field-value { display: block; overflow-wrap: anywhere; }
    .tp-details-table tr:last-child td { border-bottom: 1px solid #e4ecef; }
    .tp-details-table tr td:last-child, .tp-student-card td:last-child { border-bottom: 0; }
  }
  @media screen and (max-width: 420px) { .tp-details-table tr:not(.tp-empty-row) td { grid-template-columns: minmax(76px, 32%) minmax(0, 1fr); gap: 8px; } }
`;

const DETAILS_MODAL_HTML = `
<div class="tp-search-wrap">
  <label class="tp-search-label" for="tpStudentSearch">ابحث عن اسمك</label>
  <input type="text" id="tpStudentSearch" class="tp-search-input" autocomplete="off" placeholder="اكتب اسمك واسم أبيك" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tpSuggestions" aria-describedby="tpSearchHint">
  <div id="tpSuggestions" class="tp-suggestions" role="listbox" aria-label="الطلاب المطابقون"></div>
  <p class="tp-search-hint" id="tpSearchHint" role="status" aria-live="polite">اكتب اسمك واسم أبيك، ثم اختر اسمك الكامل من النتائج.</p>
</div>
<div id="tpStudentCard" class="tp-student-card" aria-live="polite"></div>
<div id="tpDetailsModal" class="tp-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="tpModalTitle" aria-hidden="true">
  <div class="tp-modal" role="document" tabindex="-1">
    <div class="tp-modal-header">
      <h2 id="tpModalTitle"><span id="tpModalTitleText">درجاتك وفرصك</span> <span class="tp-dismissed-badge" id="tpModalDismissedBadge" style="display:none">مفصول</span></h2>
      <button type="button" class="tp-modal-close" id="tpModalClose">رجوع للبحث</button>
    </div>
    <div id="tpStudentOverview"></div>
    <section class="tp-details-section" aria-labelledby="tpGradesSectionTitle">
      <h3 id="tpGradesSectionTitle">درجاتك في الامتحانات</h3>
      <table class="tp-details-table tp-grades-table" role="table" aria-label="درجات الطالب">
        <thead><tr role="row">
          <th scope="col" role="columnheader">الامتحان</th>
          <th scope="col" role="columnheader">تاريخ الامتحان</th>
          <th scope="col" role="columnheader">الدرجة</th>
          <th scope="col" role="columnheader">الأثر على الفرص</th>
        </tr></thead>
        <tbody id="tpGradesBody"></tbody>
      </table>
    </section>
  </div>
</div>
`;

const DETAILS_MODAL_JS = `
<script>
(function(){
  var DATA = window.STUDENT_DETAILS || {};
  var STUDENTS = window.STUDENT_LIST || [];

  var searchInput = document.getElementById('tpStudentSearch');
  var suggestionsEl = document.getElementById('tpSuggestions');
  var hintEl = document.getElementById('tpSearchHint');
  var cardEl = document.getElementById('tpStudentCard');
  var overlay = document.getElementById('tpDetailsModal');
  var titleTextEl = document.getElementById('tpModalTitleText');
  var gradesBody = document.getElementById('tpGradesBody');
  var closeBtn = document.getElementById('tpModalClose');

  var activeIndex = -1;
  var currentMatches = [];
  var debounceTimer = null;
  var previouslyFocusedElement = null;
  var previousBodyOverflow = '';

  function esc(s){
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function fmtNum(n){
    return (n !== null && n !== undefined && !isNaN(Number(n))) ? Number(n) : '—';
  }
  function fmtDate(s){
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d.getTime())) return esc(s);
    try {
      return d.toLocaleDateString('ar-EG-u-nu-latn', {day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Baghdad'});
    } catch(e){ return esc(s); }
  }

  function mobileCell(label, valueHtml, extraClass){
    var className = extraClass ? ' class="' + extraClass + '"' : '';
    return '<td role="cell" data-label="' + esc(label) + '"' + className + '>'
      + '<span class="tp-mobile-field-label" aria-hidden="true">' + esc(label) + '</span>'
      + '<span class="tp-mobile-field-value">' + valueHtml + '</span>'
      + '</td>';
  }

  // شارة «مفصول» بجانب اسم الطالب المفصول — نفس معنى الشارة الحمراء داخل النظام.
  function isDismissed(student){
    return Boolean(student) && String(student.status || '').trim() === 'مفصول';
  }
  function dismissedBadgeHtml(student){
    return isDismissed(student) ? '<span class="tp-dismissed-badge">مفصول</span>' : '';
  }

  // نفس تطبيع البحث في البرنامج، مع إضافة مساواة ض/ظ المطلوبة للتقرير.
  function normalizeArabicSearch(value){
    return String(value || '')
      .toLocaleLowerCase('ar-IQ')
      .normalize('NFKD')
      .replace(/[\\u064B-\\u065F\\u0670]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[ضظ]/g, 'ض')
      .replace(/ـ/g, '')
      .replace(/[\\u200B-\\u200D\\uFEFF]/g, '')
      .replace(/[\\s\\-_]+/g, ' ')
      .trim();
  }

  // لا تظهر أي نتائج قبل كتابة اسمين على الأقل.
  function countWords(q){
    var normalized = normalizeArabicSearch(q);
    return normalized ? normalized.split(/\\s+/).filter(Boolean).length : 0;
  }

  // مطابقة كلمات متتالية مع السماح بإكمال كل جزء من الاسم (prefix matching).
  function matchesQuery(student, q){
    var nq = normalizeArabicSearch(q);
    var nname = normalizeArabicSearch(student && student.name);
    if (!nq || !nname) return false;
    if (nname.startsWith(nq)) return true;

    var nameParts = nname.split(/\\s+/);
    var qParts = nq.split(/\\s+/);
    for (var i = 0; i <= nameParts.length - qParts.length; i++) {
      var ok = true;
      for (var j = 0; j < qParts.length; j++) {
        if (!nameParts[i + j].startsWith(qParts[j])) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  function renderSuggestions(matches){
    var totalMatches = matches.length;
    var limit = Math.min(totalMatches, 50);
    currentMatches = matches.slice(0, limit);
    activeIndex = -1;
    searchInput.removeAttribute('aria-activedescendant');
    if (totalMatches === 0) {
      suggestionsEl.innerHTML = '';
      suggestionsEl.classList.remove('open');
      searchInput.setAttribute('aria-expanded', 'false');
      hintEl.textContent = 'لا يوجد طلاب مطابقون لهذا البحث.';
      return;
    }
    var html = '';
    for (var i = 0; i < limit; i++) {
      var s = currentMatches[i];
      html += '<div class="tp-suggestion" id="tpSuggestion-' + i + '" role="option" aria-selected="false" data-idx="' + i + '">'
        + '<div class="tp-suggestion-name">' + esc(s.name) + ' ' + dismissedBadgeHtml(s) + '</div>'
        + '<div class="tp-suggestion-meta">' + (s.code ? esc(s.code) + ' · ' : '') + 'الدورة: ' + esc(s.courseName || '—') + ' · الفرص: ' + fmtNum(s.opportunities) + (isDismissed(s) ? ' · الطالب مفصول' : '') + '</div>'
        + '</div>';
    }
    if (totalMatches > limit) {
      html += '<div class="tp-empty-search" role="presentation" aria-hidden="true">و' + (totalMatches - limit) + ' طالب آخر — ضيّق البحث أكثر</div>';
      hintEl.textContent = 'تم عرض أول ' + limit + ' طالب من أصل ' + totalMatches + ' نتيجة؛ ضيّق البحث لنتائج أدق.';
    } else {
      hintEl.textContent = 'تم العثور على ' + totalMatches + ' طالب مطابق.';
    }
    suggestionsEl.innerHTML = html;
    suggestionsEl.classList.add('open');
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function hideSuggestions(){
    suggestionsEl.classList.remove('open');
    currentMatches = [];
    activeIndex = -1;
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
  }

  function pledgeNoteHtml(studentId){
    return DATA[studentId] && DATA[studentId].hasTwoOpportunityPledge === true
      ? '<span class="tp-pledge-note">تم منح الطالب فرصتين بسبب تعهده</span>' : '';
  }

  function renderStudentCard(student){
    var id = esc(student.id);
    var html = '<table class="tp-student-summary-table" role="table" aria-label="ملخص الطالب المختار">'
      + '<thead><tr role="row">'
      + '<th scope="col" role="columnheader">الطالب</th>'
      + '<th scope="col" role="columnheader">الدورة</th>'
      + '<th scope="col" role="columnheader">عدد الفرص</th>'
      + '<th scope="col" role="columnheader">تفاصيل الطالب</th>'
      + '</tr></thead>'
      + '<tbody><tr role="row">'
      + mobileCell('الطالب', esc(student.name) + ' ' + dismissedBadgeHtml(student), 'tp-student-name-cell')
      + mobileCell('الدورة', esc(student.courseName || '—'))
      + mobileCell('عدد الفرص', fmtNum(student.opportunities) + pledgeNoteHtml(student.id))
      + mobileCell('تفاصيل الطالب', '<button type="button" class="tp-details-btn" data-sid="' + id + '">إظهار التفاصيل</button>', 'tp-details-cell')
      + '</tr></tbody>'
      + '</table>';
    cardEl.innerHTML = html;
    cardEl.classList.add('visible');
  }

  function selectStudent(student){
    clearTimeout(debounceTimer);
    searchInput.value = student.name;
    hideSuggestions();
    hintEl.textContent = 'تم اختيار: ' + student.name + '. يمكنك الرجوع للبحث عن اسم آخر.';
    renderStudentCard(student);
    showDetails(student.id, student.name);
  }

  function handleSearchInput(){
    var q = searchInput.value;
    var wordCount = countWords(q);

    if (!q.trim()) {
      hideSuggestions();
      cardEl.classList.remove('visible');
      cardEl.innerHTML = '';
      hintEl.textContent = 'اكتب اسمك واسم أبيك، ثم اختر اسمك الكامل.';
      return;
    }

    if (wordCount < 2) {
      hideSuggestions();
      cardEl.classList.remove('visible');
      cardEl.innerHTML = '';
      hintEl.textContent = 'اكتب كلمة أخرى على الأقل (مثال: «محمد علي» بدل «محمد» فقط) لعرض قائمة الطلاب.';
      return;
    }

    hintEl.textContent = 'اختر اسمك الكامل من النتائج.';

    var matches = STUDENTS.filter(function(s){
      return matchesQuery(s, q);
    });

    renderSuggestions(matches);
  }

  function showDetails(studentId, studentLabel){
    var data = DATA[studentId];
    var student = STUDENTS.find(function(s){ return String(s.id) === String(studentId); }) || {};
    var snapshot = data && data.studentSnapshot;
    var balance = snapshot ? snapshot.opportunities : student.opportunities;
    var status = snapshot ? snapshot.status : student.status;
    var badgeEl = document.getElementById('tpModalDismissedBadge');
    var overview = document.getElementById('tpStudentOverview');
    var gradesTitleEl = document.getElementById('tpGradesSectionTitle');
    if (badgeEl) badgeEl.style.display = status === 'مفصول' ? '' : 'none';
    if (titleTextEl) titleTextEl.textContent = studentLabel || student.name || 'درجاتك وفرصك';
    if (gradesTitleEl) gradesTitleEl.textContent = data && data.activeChapterName ? 'درجاتك — ' + data.activeChapterName : 'درجاتك في الامتحانات';
    if (overview) {
      overview.innerHTML = '<div class="tp-report-summary">'
        + '<div class="tp-summary-item"><span class="tp-summary-label">فرصك المتبقية</span><strong>' + fmtNum(balance) + '</strong>' + pledgeNoteHtml(studentId) + '</div></div>';
    }
    if (!data) {
      gradesBody.innerHTML = '<tr class="tp-empty-row tp-error-row" role="row"><td colspan="4" role="cell">تفاصيل هذا الطالب غير موجودة في هذه النسخة. اطلب نسخة جديدة من الإدارة.</td></tr>';
    } else {
      gradesBody.innerHTML = data.grades && data.grades.length ? data.grades.map(function(g){
        var score = g.score === null || g.score === undefined ? 'غياب' : '<bdi>' + fmtNum(g.score) + ' / ' + fmtNum(g.fullMark) + '</bdi>';
        var effectText = String(g.opportunityEffect || 'لا تتوفر تفاصيل الأثر في هذه النسخة.').trim();
        var effectClass = effectText === 'لا يوجد خصم لهذا الامتحان' ? 'tp-grade-no-deduction'
          : /^(تم خصم |عدد الفرص المخصومة لهذا الامتحان:)/.test(effectText) ? 'tp-grade-deduction' : '';
        return '<tr role="row">'
          + mobileCell('الامتحان', '<strong class="tp-event-title">' + esc(g.examName) + '</strong><span class="tp-event-exam">' + esc(g.examType) + '</span>')
          + mobileCell('تاريخ الامتحان', fmtDate(g.examDate) || 'غير مسجّل')
          + mobileCell('الدرجة', score)
          + mobileCell('الأثر على الفرص', esc(effectText), effectClass)
          + '</tr>';
      }).join('') : '<tr class="tp-empty-row" role="row"><td colspan="4" role="cell">لا توجد امتحانات لعرضها في هذه النسخة.</td></tr>';
    }
    if (!overlay.classList.contains('open')) {
      previouslyFocusedElement = document.activeElement;
      previousBodyOverflow = document.body.style.overflow;
    }
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    var panel = overlay.querySelector('.tp-modal');
    if (panel) panel.scrollTop = 0;
    setTimeout(function(){ try { closeBtn.focus({ preventScroll: true }); } catch(e){ closeBtn.focus(); } }, 0);
  }

  function closeDetails(){
    if (!overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    document.body.style.overflow = previousBodyOverflow;
    if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
      try { previouslyFocusedElement.focus({ preventScroll: true }); } catch(e){ previouslyFocusedElement.focus(); }
    }
    overlay.setAttribute('aria-hidden', 'true');
    previouslyFocusedElement = null;
  }

  // البحث أثناء الكتابة (debounce خفيف).
  searchInput.addEventListener('input', function(){
    clearTimeout(debounceTimer);
    cardEl.classList.remove('visible');
    cardEl.innerHTML = '';
    hideSuggestions();
    debounceTimer = setTimeout(handleSearchInput, 150);
  });

  // التنقل بلوحة المفاتيح داخل قائمة الاقتراحات.
  searchInput.addEventListener('keydown', function(e){
    if (!suggestionsEl.classList.contains('open')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, currentMatches.length - 1);
      updateActiveSuggestion();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActiveSuggestion();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < currentMatches.length) {
        selectStudent(currentMatches[activeIndex]);
      } else if (currentMatches.length > 0) {
        selectStudent(currentMatches[0]);
      }
    } else if (e.key === 'Escape') {
      hideSuggestions();
    } else if (e.key === 'Tab') {
      hideSuggestions();
    }
  });

  function updateActiveSuggestion(){
    var items = suggestionsEl.querySelectorAll('.tp-suggestion');
    items.forEach(function(item, i){
      item.classList.toggle('active', i === activeIndex);
      item.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
    });
    if (activeIndex >= 0 && items[activeIndex]) {
      searchInput.setAttribute('aria-activedescendant', items[activeIndex].id);
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else {
      searchInput.removeAttribute('aria-activedescendant');
    }
  }

  // اختيار طالب عند الضغط على اقتراح.
  suggestionsEl.addEventListener('click', function(e){
    var item = e.target.closest && e.target.closest('.tp-suggestion');
    if (!item) return;
    var idx = parseInt(item.getAttribute('data-idx') || '0', 10);
    if (idx >= 0 && idx < currentMatches.length) {
      selectStudent(currentMatches[idx]);
    }
  });

  // إغلاق القائمة عند الضغط خارجها.
  document.addEventListener('click', function(e){
    if (!searchInput.contains(e.target) && !suggestionsEl.contains(e.target)) {
      hideSuggestions();
    }
  });

  // فتح نافذة التفاصيل عند الضغط على زر «إظهار التفاصيل».
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('.tp-details-btn');
    if (btn) {
      var sid = btn.getAttribute('data-sid') || '';
      var label = '';
      var row = btn.closest('tr');
      if (row) {
        var firstCell = row.querySelector('td:not(.tp-details-cell)');
        if (firstCell) {
          // اسم الطالب فقط بدون نص شارة «مفصول» — الشارة تُعرض في رأس النافذة.
          var valueCell = firstCell.querySelector('.tp-mobile-field-value') || firstCell;
          var labelClone = valueCell.cloneNode(true);
          var badgeInLabel = labelClone.querySelector('.tp-dismissed-badge');
          if (badgeInLabel && badgeInLabel.parentNode) badgeInLabel.parentNode.removeChild(badgeInLabel);
          label = labelClone.textContent.trim();
        }
      }
      showDetails(sid, label);
    }
  });

  closeBtn.addEventListener('click', closeDetails);
  overlay.addEventListener('click', function(e){
    if (e.target === overlay) closeDetails();
  });
  overlay.addEventListener('keydown', function(e){
    if (e.key !== 'Tab' || !overlay.classList.contains('open')) return;
    var focusable = Array.prototype.slice.call(
      overlay.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter(function(el){ return el.offsetParent !== null; });
    if (focusable.length === 0) {
      e.preventDefault();
      closeBtn.focus();
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeDetails();
  });

  // على أجهزة المؤشر الدقيق فقط؛ لا نفتح لوحة مفاتيح الهاتف فور فتح الملف.
  setTimeout(function(){
    try {
      if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
        searchInput.focus({ preventScroll: true });
      }
    } catch(e){}
  }, 100);
})();
</script>
`;

/**
 * يبني ملف تقرير HTML مستقلاً (يعمل أوفلاين) من الصفوف والأعمدة المختارة.
 * مُصدَّر عمداً ليستخدمه تصدير HTML واختبارات السلامة/أدوات التقارير بنفس
 * القالب الواحد دون نسخ ثانية تتباعد عن مصدر التوليد.
 */
export function buildHtml<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  title: string,
  options: {
    printable?: boolean;
    orientation?: PageOrientation;
    documentTitle?: string;
    safeUrlName?: string;
    studentDetails?: StudentDetailsMap;
    studentList?: StudentRowBasic[];
    getRowId?: (row: T) => string;
  } = {},
): string {
  const documentTitle = options.documentTitle || title;
  const safeUrlName = options.safeUrlName || sanitizeExportFileName(documentTitle);
  const printableHistoryPath = `/${encodeURIComponent(safeUrlName)}.pdf`;
  // لا ندخل وضع البحث التفاعلي إلا عندما تتوفر القائمة والتفاصيل معاً.
  // أي تركيبة ناقصة ترجع تلقائياً إلى التقرير الجدولي العادي بدلاً من ملف فارغ.
  const interactiveMode = Boolean(
    options.studentDetails && options.studentList && options.studentList.length > 0,
  );
  const reportDetails = interactiveMode ? sanitizeStudentDetailsForHtml(options.studentDetails || {}) : {};
  // Prefer the per-student database snapshot over the earlier list request.
  const reportStudents = (options.studentList || []).map(student => {
    const snapshot = reportDetails[student.id]?.studentSnapshot;
    return snapshot ? {
      id: student.id, name: snapshot.name || student.name, code: snapshot.code,
      courseName: snapshot.courseName || student.courseName,
      opportunities: snapshot.opportunities, status: snapshot.status,
    } : student;
  });
  const reportHeading = interactiveMode ? "درجاتك وفرصك" : title;
  const bodyClassName = interactiveMode ? "tp-search-report-body" : "";
  const reportClassName = interactiveMode ? "report report-search-mode" : "report";
  const viewportMeta = interactiveMode
    ? '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    : '<meta name="viewport" content="width=device-width, initial-scale=1">';

  const printableToolbar = options.printable
    ? `<div class="toolbar"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div>`
    : "";
  const printableScript = options.printable
    ? `<script>document.title=${escapeJsString(documentTitle)};try{window.history.replaceState(null,document.title,${escapeJsString(printableHistoryPath)});}catch(e){}</script>`
    : "";

  const detailsDataScript = interactiveMode
    ? `<script>window.STUDENT_DETAILS=${serializeForInlineScript(reportDetails)};</script>`
    : "";
  const studentListScript = interactiveMode
    ? `<script>window.STUDENT_LIST=${serializeForInlineScript(reportStudents)};</script>`
    : "";
  const detailsModalHtml = interactiveMode ? DETAILS_MODAL_HTML : "";
  const detailsModalJs = interactiveMode ? DETAILS_MODAL_JS : "";
  const detailsCss = interactiveMode ? DETAILS_MODAL_CSS : "";

  // في وضع البحث لا نعرض الجدول الكامل ولا «عدد الصفوف» — فقط خانة البحث (داخل detailsModalHtml)
  // والجدول يُعرض ديناميكياً عند اختيار طالب.
  const mainTableHtml = interactiveMode
    ? ""
    : `<div class="table-wrap"><table><thead><tr>${columns
        .map((col) => `<th>${escapeHtml(humanizeTeacherProText(col.label))}</th>`)
        .join("")}</tr></thead><tbody>${buildTableRows(rows, columns, {
          hasDetails: false,
          getRowId: options.getRowId,
        })}</tbody></table></div>`;
  const metaLine = interactiveMode
    ? '<p class="tp-report-intro">اعرف درجاتك، وفرصك المتبقية، وأثر كل امتحان عليها.</p>'
    : `<div class="meta">عدد الصفوف: ${rows.length} | عدد الأعمدة: ${columns.length}</div>`;

  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">${viewportMeta}<title>${escapeHtml(humanizeTeacherProText(interactiveMode && !options.documentTitle ? reportHeading : documentTitle))}</title><style>
  @page { size: A4 ${options.orientation || "portrait"}; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
    padding: 16px;
    color: #111827;
    background: #eef2f7;
    font-size: 16px;
    font-weight: 700;
  }
  .toolbar { position: sticky; top: 0; display: flex; gap: 8px; margin: -16px -16px 14px; padding: 10px 12px; background: #111827; color: white; z-index: 3; }
  .toolbar button { border: 0; border-radius: 10px; padding: 9px 14px; cursor: pointer; font-weight: 800; font-size: 14px; }
  .report { background: white; border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px; box-shadow: 0 10px 30px rgba(15,23,42,.08); }
  .report-header { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 8px; margin-bottom: 14px; border-bottom: 2px solid #111827; padding-bottom: 11px; }
  h1 { font-size: 24px; font-weight: 900; line-height: 1.5; margin: 0; }
  .meta { color: #475569; font-size: 14px; font-weight: 800; white-space: nowrap; }
  .table-wrap { width: 100%; overflow-x: auto; overflow-y: visible; }
  table {
    border-collapse: collapse;
    width: max-content;
    min-width: 100%;
    table-layout: auto;
    font-size: 14px;
    font-weight: 700;
  }
  th, td {
    border: 1px solid #d1d5db;
    padding: 8px 10px;
    text-align: center;
    vertical-align: middle;
    line-height: 1.6;
    white-space: normal;
    word-break: normal;
    overflow-wrap: normal;
    hyphens: none;
  }
  th { background: #f3f4f6; font-weight: 900; color: #111827; }
  tr:nth-child(even) { background: #fafafa; }
  a[href]::after { content: "" !important; }
  ${detailsCss}
  @media print {
    html, body { width: 100%; margin: 0 !important; padding: 0 !important; background: white !important; font-weight: 700; }
    .toolbar { display: none !important; }
    .report { box-shadow: none !important; border: 0 !important; border-radius: 0 !important; padding: 0 !important; }
    .report-header { margin-bottom: 8px; padding-bottom: 8px; }
    h1 { font-size: 20px; font-weight: 900; }
    .meta { font-size: 11px; }
    table { font-size: 11px; page-break-inside: auto; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    thead { display: table-header-group; }
    th, td { padding: 5px 6px; }
    .tp-modal-overlay, .tp-suggestions { display: none !important; }
  }
  </style>${printableScript}</head><body class="${bodyClassName}">${printableToolbar}<main class="${reportClassName}"><header class="report-header"><h1>${escapeHtml(humanizeTeacherProText(reportHeading))}</h1>${metaLine}</header>${mainTableHtml}${detailsModalHtml}${studentListScript}${detailsDataScript}${detailsModalJs}</main></body></html>`;
}

function downloadBlob(content: BlobPart | Blob, fileName: string, mime: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function defaultColumnKeys<T>(columns: ExportColumn<T>[], preferredKeys?: string[]): string[] {
  const availableKeys = new Set(columns.map((column) => column.key));
  const lockedKeys = columns.filter((column) => column.locked).map((column) => column.key);
  const preferred = preferredKeys?.filter((key) => availableKeys.has(key)) || [];

  if (preferred.length > 0) {
    return Array.from(new Set([...lockedKeys, ...preferred]));
  }

  return columns
    .filter((column) => column.locked || column.defaultSelected !== false)
    .map((column) => column.key);
}

const exportFormatLabels: Record<ExportFormat, string> = {
  csv: "تصدير CSV",
  excel: "تصدير Excel",
  html: "تصدير HTML",
  pdf: "طباعة / PDF",
};

const exportFormatIcons: Record<ExportFormat, React.ElementType> = {
  csv: FileSpreadsheet,
  excel: FileText,
  html: FileCode,
  pdf: Printer,
};

export function ExportDialog<T = Record<string, unknown>>({
  title,
  fileName,
  rows,
  columns,
  triggerLabel = "تصدير",
  description,
  formats = ["csv", "excel", "html", "pdf"],
  defaultSelectedColumnKeys,
  pageOrientation = "portrait",
  pdfTitle,
  pdfFileName,
  fetchRows,
  totalRowCount,
  disabled = false,
  fetchStudentDetails,
  getRowId,
  selectHtmlExams = false,
}: {
  title: string;
  fileName: string;
  rows: T[];
  columns: ExportColumn<T>[];
  triggerLabel?: string;
  description?: string;
  formats?: ExportFormat[];
  defaultSelectedColumnKeys?: string[];
  pageOrientation?: PageOrientation;
  pdfTitle?: string;
  pdfFileName?: string;
  fetchRows?: (context: ExportFetchContext) => Promise<T[]>;
  /** Exact number of rows that fetchRows will export (not the current page). */
  totalRowCount?: number | null;
  disabled?: boolean;
  /**
   * عند تمريره يضيف زر "عرض التفاصيل" في كل صف عند تصدير HTML، يفتح نافذة
   * تعرض درجات الطالب في كل الامتحانات + سجل الفرص. البيانات تُحقن داخل
   * الملف نفسه (window.STUDENT_DETAILS) فيعمل الملف أوفلاين بدون API.
   */
  fetchStudentDetails?: StudentDetailsFetcher;
  /** يستخرج معرّف الطالب من كل صف لربطه بتفاصيله. افتراضياً row.id */
  getRowId?: (row: T) => string;
  /** Ask which exams to include in this HTML file; other formats are unaffected. */
  selectHtmlExams?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<string[]>(() =>
    defaultColumnKeys(columns, defaultSelectedColumnKeys),
  );
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{
    loaded: number;
    total: number;
    phase: "rows" | "details";
  } | null>(null);
  const exportAbortController = useRef<AbortController | null>(null);
  const exportBusyRef = useRef(false);
  const exportAttemptRef = useRef(0);
  const [htmlExamSelectionOpen, setHtmlExamSelectionOpen] = useState(false);
  const [preparedHtmlExport, setPreparedHtmlExport] = useState<{ rows: T[]; details: StudentDetailsMap } | null>(null);
  const [selectedHtmlExamIds, setSelectedHtmlExamIds] = useState<string[]>([]);
  const [htmlExamSearch, setHtmlExamSearch] = useState("");
  const htmlReportExams = useMemo(() => getHtmlReportExams(preparedHtmlExport?.details || {}), [preparedHtmlExport]);
  const visibleHtmlReportExams = useMemo(() => {
    const query = normalizeArabicComparisonText(htmlExamSearch);
    return htmlReportExams.filter(exam => normalizeArabicComparisonText(exam.name).includes(query));
  }, [htmlReportExams, htmlExamSearch]);

  const cancelExportPreparation = () => {
    exportAttemptRef.current += 1;
    exportAbortController.current?.abort();
    exportAbortController.current = null;
    exportBusyRef.current = false;
    setExporting(false);
    setExportProgress(null);
    setPreparedHtmlExport(null);
    setSelectedHtmlExamIds([]);
    setHtmlExamSearch("");
    setHtmlExamSelectionOpen(false);
  };

  useEffect(
    () => () => {
      exportAttemptRef.current += 1;
      exportAbortController.current?.abort();
    },
    [],
  );

  const safeFileName = useMemo(() => {
    const base = String(fileName || "export").trim().replace(/[^\w\u0600-\u06FF-]+/g, "-");
    return base || "export";
  }, [fileName]);

  const columnSignature = useMemo(
    () => columns.map((column) => `${column.key}:${column.defaultSelected}:${column.locked}`).join("|"),
    [columns],
  );

  useEffect(() => {
    setSelectedColumnKeys(defaultColumnKeys(columns, defaultSelectedColumnKeys));
  }, [columnSignature, columns, defaultSelectedColumnKeys]);

  const selectedColumns = useMemo(() => {
    const selected = new Set(selectedColumnKeys);
    return columns.filter((column) => selected.has(column.key));
  }, [columns, selectedColumnKeys]);

  const lockedKeys = useMemo(
    () => new Set(columns.filter((column) => column.locked).map((column) => column.key)),
    [columns],
  );

  const availableFormats: ExportFormat[] = formats.length > 0 ? formats : ["csv"];

  const ensureExportable = (exportRows: T[]) => {
    if (exportRows.length === 0) {
      toast.error("لا توجد بيانات للتصدير");
      return false;
    }
    if (selectedColumns.length === 0) {
      toast.error("اختر عموداً واحداً على الأقل قبل التصدير");
      return false;
    }
    return true;
  };

  const loadExportRows = async (): Promise<T[] | null> => {
    if (!fetchRows) return rows;
    exportAbortController.current?.abort();
    const controller = new AbortController();
    exportAbortController.current = controller;
    setExporting(true);
    setExportProgress({ loaded: 0, total: Math.max(0, totalRowCount || 0), phase: "rows" });
    try {
      const loadedRows = await fetchRows({
        signal: controller.signal,
        onProgress: (loaded, total) => {
          if (!controller.signal.aborted && exportAbortController.current === controller)
            setExportProgress({ loaded, total, phase: "rows" });
        },
      });
      return controller.signal.aborted ? null : loadedRows;
    } catch (error) {
      console.error("[ExportDialog] failed to fetch server export rows:", error);
      if (!controller.signal.aborted && exportAbortController.current === controller && !(error instanceof Error && error.name === "AbortError")) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "تعذر تحميل بيانات التصدير الكاملة من النظام",
        );
      }
      return null;
    } finally {
      if (exportAbortController.current === controller) {
        exportAbortController.current = null;
        setExporting(false);
        setExportProgress(null);
      }
    }
  };

  /**
   * يجلب تفاصيل كل طالب (درجاته + سجل فرصه) على دفعات متوازية ليبني ملف
   * HTML مستقل يعمل أوفلاين. فشل تحميل التفاصيل يمنع إنشاء تقرير ناقص.
   */
  const loadStudentDetails = async (
    exportRows: T[],
    controller: AbortController,
  ): Promise<StudentDetailsMap | null> => {
    if (!fetchStudentDetails || exportRows.length === 0) return null;
    const idGetter = getRowId || ((row: T) => String((row as Record<string, unknown>)?.id ?? ""));
    const studentIds = Array.from(
      new Set(
        exportRows
          .map(idGetter)
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      ),
    );
    if (studentIds.length === 0) return null;

    setExporting(true);
    setExportProgress({ loaded: 0, total: studentIds.length, phase: "details" });
    try {
      const details = await fetchStudentDetails(studentIds, {
        signal: controller.signal,
        onProgress: (loaded, total) => {
          if (!controller.signal.aborted && exportAbortController.current === controller)
            setExportProgress({ loaded, total, phase: "details" });
        },
      });
      return controller.signal.aborted ? null : details;
    } catch (error) {
      console.error("[ExportDialog] failed to fetch student details:", error);
      if (!controller.signal.aborted && exportAbortController.current === controller && !(error instanceof Error && error.name === "AbortError")) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "تعذر تحميل تفاصيل الطلاب من النظام",
        );
      }
      return null;
    } finally {
      if (exportAbortController.current === controller) {
        exportAbortController.current = null;
        setExporting(false);
        setExportProgress(null);
      }
    }
  };

  const exportCsv = (exportRows: T[]) => {
    if (!ensureExportable(exportRows)) return;
    const csv = buildCsv(exportRows, selectedColumns);
    downloadBlob(csv, `${safeFileName}.csv`, "text/csv;charset=utf-8");
    toast.success(`تم تصدير ${exportRows.length} صف و ${selectedColumns.length} عمود بصيغة CSV`);
    setOpen(false);
  };

  const exportExcel = (exportRows: T[]) => {
    if (!ensureExportable(exportRows)) return;
    const workbook = buildProfessionalXlsx(
      exportRows,
      selectedColumns.map((column) => ({
        label: humanizeTeacherProText(column.label),
        value: (row: T, index?: number) => {
          const normalized = normalizeExportValue(column.value(row, index));
          return typeof normalized === "number"
            ? normalized
            : protectSpreadsheetCell(normalized);
        },
      })),
      {
        title: humanizeTeacherProText(title),
        orientation: pageOrientation,
      },
    );
    const workbookBlob = new Blob(
      [workbook.buffer as ArrayBuffer],
      {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    );
    downloadBlob(
      workbookBlob,
      `${safeFileName}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    toast.success(`تم إنشاء ملف Excel احترافي يضم ${exportRows.length} طالباً`);
    setOpen(false);
  };

  const exportHtml = (exportRows: T[], detailsMap: StudentDetailsMap | null = null) => {
    if (!ensureExportable(exportRows)) return;

    // ننظّف نسخة التقرير فقط: لا تتغير الدرجات أو السجلات الأصلية في النظام.
    const reportDetailsMap = detailsMap
      ? sanitizeStudentDetailsForHtml(detailsMap)
      : null;

    // في وضع البحث نمرّر قائمة الطلاب (id + name + courseName + opportunities + status)
    // لاستخدامها في خانة البحث بدل عرض كل الطلاب دفعة واحدة؛ الحالة تُستخدم
    // لعرض شارة «مفصول» بجانب اسم الطالب المفصول داخل التقرير.
    const idGetter = getRowId || ((row: T) => String((row as Record<string, unknown>)?.id ?? ""));
    const nameGetter = (row: T) => String((row as Record<string, unknown>)?.name ?? "");
    const courseGetter = (row: T) =>
      String((row as Record<string, unknown>)?.courseName ?? "");
    const oppGetter = (row: T) => {
      const v = (row as Record<string, unknown>)?.opportunities;
      return v === null || v === undefined ? "" : (v as number | string);
    };
    const statusGetter = (row: T) =>
      String((row as Record<string, unknown>)?.status ?? "");

    const studentList: StudentRowBasic[] | undefined = fetchStudentDetails
      ? exportRows.map((row) => ({
          id: idGetter(row),
          name: nameGetter(row),
          courseName: courseGetter(row),
          opportunities: oppGetter(row),
          status: statusGetter(row),
        }))
      : undefined;

    const html = buildHtml(exportRows, selectedColumns, title, {
      studentDetails: reportDetailsMap || undefined,
      studentList,
      getRowId,
    });
    downloadBlob(html, `${safeFileName}.html`, "text/html;charset=utf-8");
    const detailsNote = reportDetailsMap
      ? ` مع تفاصيل ${Object.keys(reportDetailsMap).length} طالب`
      : "";
    toast.success(
      `تم تصدير ${exportRows.length} طالب بصيغة HTML${detailsNote}`,
    );
    setOpen(false);
  };

  const exportPdf = (exportRows: T[], pendingWindow?: Window | null) => {
    if (!ensureExportable(exportRows)) {
      pendingWindow?.close();
      return;
    }
    const printableTitle = String(pdfTitle || title || "تقرير").trim() || "تقرير";
    const printableFileName = sanitizeExportFileName(pdfFileName || printableTitle || safeFileName);
    const html = buildHtml(exportRows, selectedColumns, printableTitle, {
      printable: true,
      orientation: pageOrientation,
      documentTitle: printableTitle,
      safeUrlName: printableFileName,
    });
    const win = pendingWindow || window.open("", `${printableFileName}-pdf`);
    if (!win) {
      toast.error("المتصفح منع نافذة الطباعة");
      return;
    }
    win.document.write(html);
    win.document.close();
    win.document.title = printableTitle;
    try {
      win.history.replaceState(null, printableTitle, `/${encodeURIComponent(printableFileName)}.pdf`);
    } catch {}
    win.focus();
    toast.success(`تم فتح تقرير PDF بـ ${exportRows.length} صف و ${selectedColumns.length} عمود`);
    setOpen(false);
  };

  const handleExport = async (format: ExportFormat) => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    const attempt = ++exportAttemptRef.current;
    setExporting(true);
    if (format === "html" && selectHtmlExams && fetchStudentDetails) {
      setHtmlExamSelectionOpen(true);
      setPreparedHtmlExport(null);
      setSelectedHtmlExamIds([]);
      setHtmlExamSearch("");
    }
    const pendingPdfWindow = format === "pdf" ? window.open("", `${safeFileName}-pdf`) : null;
    try {
    if (pendingPdfWindow) {
      pendingPdfWindow.document.write("<p dir='rtl' style='font-family:sans-serif;padding:16px'>جاري تجهيز التقرير...</p>");
      pendingPdfWindow.document.close();
    }
    const exportRows = await loadExportRows();
    if (attempt !== exportAttemptRef.current || !exportRows || !ensureExportable(exportRows)) {
      pendingPdfWindow?.close();
      return;
    }
    if (format === "csv") exportCsv(exportRows);
    if (format === "excel") exportExcel(exportRows);
    if (format === "html") {
      let details: StudentDetailsMap | null = null;
      if (fetchStudentDetails) {
        const controller = new AbortController();
        exportAbortController.current = controller;
        details = await loadStudentDetails(exportRows, controller);
        if (attempt !== exportAttemptRef.current || !details) return;
      }
      if (selectHtmlExams && details) {
        setPreparedHtmlExport({ rows: exportRows, details });
        setSelectedHtmlExamIds(getHtmlReportExams(details).map(exam => exam.id));
      } else exportHtml(exportRows, details);
    }
    if (format === "pdf") exportPdf(exportRows, pendingPdfWindow);
    } catch (error) {
      pendingPdfWindow?.close();
      console.error("[ExportDialog] failed to prepare export:", error);
      if (attempt === exportAttemptRef.current) toast.error("تعذر تجهيز التقرير. أعد المحاولة.");
    } finally {
      if (attempt === exportAttemptRef.current) {
        exportBusyRef.current = false;
        setExporting(false);
        setExportProgress(null);
      }
    }
  };

  const downloadSelectedHtmlExams = () => {
    if (!preparedHtmlExport || exportBusyRef.current) return;
    exportBusyRef.current = true;
    try {
      exportHtml(preparedHtmlExport.rows, selectHtmlReportExams(preparedHtmlExport.details, selectedHtmlExamIds));
      cancelExportPreparation();
    } catch (error) {
      console.error("[ExportDialog] failed to build selected HTML report:", error);
      toast.error("تعذر إنشاء التقرير. اختياراتك محفوظة للمحاولة مجدداً.");
    } finally {
      exportBusyRef.current = false;
    }
  };

  const toggleColumn = (key: string, checked: boolean) => {
    if (lockedKeys.has(key)) return;
    setSelectedColumnKeys((current) => {
      if (checked) return Array.from(new Set([...current, key]));
      return current.filter((item) => item !== key);
    });
  };

  const selectAllColumns = () => setSelectedColumnKeys(columns.map((column) => column.key));
  const clearOptionalColumns = () => setSelectedColumnKeys(columns.filter((column) => column.locked).map((column) => column.key));
  const resetColumns = () => setSelectedColumnKeys(defaultColumnKeys(columns, defaultSelectedColumnKeys));

  const progressLabel = exportProgress?.phase === "details"
    ? "جاري تحميل تفاصيل الطلاب (الدرجات وسجل الفرص)…"
    : "جاري تحميل جميع الطلاب…";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) cancelExportPreparation();
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" disabled={disabled}>
          <Download className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90dvh] min-w-0 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{htmlExamSelectionOpen ? "اختر امتحانات تقرير HTML" : title}</DialogTitle>
          {htmlExamSelectionOpen ? <DialogDescription>أزل علامة الصح عن أي امتحان لا تريد عرضه في التقرير. رصيد الفرص يبقى حسب سجل الطالب في النظام.</DialogDescription>
            : description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-2 rounded-xl border bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <p className="text-muted-foreground">
              عدد النتائج التي ستُصدّر:{" "}
              <b>{preparedHtmlExport?.rows.length ?? totalRowCount ?? (fetchRows ? "يُحسب عند التصدير" : rows.length)}</b>
            </p>
            <p className="text-muted-foreground">
              {htmlExamSelectionOpen
                ? <>الامتحانات المختارة: <b>{selectedHtmlExamIds.length}</b> من <b>{htmlReportExams.length}</b></>
                : <>الأعمدة المختارة: <b>{selectedColumns.length}</b> من <b>{columns.length}</b></>}
            </p>
          </div>

          {exporting && exportProgress ? (
            <div
              className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <strong>{progressLabel}</strong>
                <span>
                  {exportProgress.loaded} / {exportProgress.total || "…"}
                </span>
              </div>
              <progress
                className="h-2 w-full accent-primary"
                max={Math.max(1, exportProgress.total)}
                value={exportProgress.loaded}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelExportPreparation}
              >
                إلغاء التصدير
              </Button>
            </div>
          ) : null}

          {htmlExamSelectionOpen ? (
            <div className="min-w-0 space-y-3">
              {preparedHtmlExport ? <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedHtmlExamIds(htmlReportExams.map(exam => exam.id))}>تحديد الكل</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedHtmlExamIds([])}>إلغاء تحديد الكل</Button>
                </div>
                <Input aria-label="بحث في امتحانات التقرير" placeholder="ابحث عن امتحان…" value={htmlExamSearch} onChange={event => setHtmlExamSearch(event.target.value)} />
                <div className="max-h-[45dvh] min-w-0 space-y-2 overflow-y-auto rounded-xl border p-2" role="group" aria-label="امتحانات التقرير">
                  {visibleHtmlReportExams.map(exam => (
                    <label key={exam.id} className="flex min-h-12 min-w-0 cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 text-sm hover:bg-muted/40">
                      <Checkbox className="mt-1 shrink-0" checked={selectedHtmlExamIds.includes(exam.id)} onCheckedChange={checked => setSelectedHtmlExamIds(current => checked === true ? [...new Set([...current, exam.id])] : current.filter(id => id !== exam.id))} />
                      <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                        <span className="block font-medium">{exam.name}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{formatAppDate(exam.date)}</span>
                        {exam.courseNames.length > 0 && <span className="mt-1 block text-xs text-muted-foreground">{exam.courseNames.join(" · ")}</span>}
                      </span>
                    </label>
                  ))}
                  {visibleHtmlReportExams.length === 0 && <p className="p-3 text-sm text-muted-foreground">{htmlReportExams.length ? "لا توجد امتحانات مطابقة للبحث." : "لا توجد امتحانات ضمن نطاق هذا التقرير."}</p>}
                </div>
                {selectedHtmlExamIds.length === 0 && <p className="text-sm text-muted-foreground">سيحتوي التقرير على الطلاب وفرصهم فقط، دون عرض امتحانات.</p>}
              </> : !exporting ? <div role="alert" className="space-y-3 rounded-xl border p-3 text-sm">
                <p>لم يكتمل تجهيز قائمة الامتحانات. أعد المحاولة لتحميل التقرير كاملاً.</p>
                <Button type="button" variant="outline" onClick={() => void handleExport("html")}>إعادة المحاولة</Button>
              </div> : null}
            </div>
          ) : <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-sm font-bold">اختر الأعمدة المطلوبة في التصدير</Label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={selectAllColumns}>تحديد الكل</Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearOptionalColumns}>مسح الاختيار</Button>
                <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={resetColumns}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  الافتراضي
                </Button>
              </div>
            </div>
            <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
              {columns.map((column) => {
                const checked = selectedColumnKeys.includes(column.key);
                const locked = lockedKeys.has(column.key);
                return (
                  <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-lg border bg-background/70 px-3 py-2 text-sm hover:bg-muted/40">
                    <Checkbox
                      checked={checked}
                      disabled={locked}
                      onCheckedChange={(value) => toggleColumn(column.key, Boolean(value))}
                    />
                    <span className="flex-1">{column.label}</span>
                    {locked ? <span className="text-[10px] text-muted-foreground">ثابت</span> : null}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              سيتم تصدير الأعمدة المختارة فقط وبنفس ترتيبها الظاهر في هذه القائمة (للملفات CSV / Excel / PDF).
              {fetchStudentDetails
                ? " زر «تصدير HTML» يُنتج ملف بحث: خانة البحث وسطية ومرنة لكل الشاشات، تكتب الاسم الثنائي فما فوق فيظهر قائمة بالطلاب المطابقين، وعند اختيار طالب تظهر بياناته (الاسم + الدورة + عدد الفرص) مع زر «إظهار التفاصيل» يفتح درجات امتحانات الفصل النشط الحالي وسجل فرصه، والطالب المفصول تظهر بجانب اسمه شارة «مفصول»."
                : ""}
            </p>
          </div>}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap">
          {htmlExamSelectionOpen ? <>
            <Button type="button" variant="outline" onClick={cancelExportPreparation}>رجوع</Button>
            <Button type="button" className="gap-2" disabled={exporting || !preparedHtmlExport} onClick={downloadSelectedHtmlExams}><Download className="h-4 w-4" />تنزيل تقرير HTML</Button>
          </> : availableFormats.map((format) => {
            const Icon = exportFormatIcons[format];
            return (
              <Button
                key={format}
                variant="outline"
                className="gap-2"
                onClick={() => handleExport(format)}
                disabled={exporting || (!fetchRows && rows.length === 0) || selectedColumns.length === 0}
              >
                <Icon className="h-4 w-4" />
                {exporting ? "جاري التحضير..." : exportFormatLabels[format]}
              </Button>
            );
          })}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
