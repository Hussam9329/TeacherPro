"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAppDate, studentCount } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Download, FileCode, FileDown, FileSpreadsheet, FileText, Printer, RotateCcw } from "lucide-react";
import { FormDialogHero } from "@/components/teacher-pro/form-dialog";
import { toast } from "@/lib/user-toast";
import { humanizeTeacherProText } from "@/lib/teacherpro-language";
import { buildProfessionalXlsx } from "@/lib/xlsx-export";
import { opportunityLogWithinActiveChapter } from "@/lib/active-chapter-report";
import { buildReportOpportunityContext, buildStaffTimelineEvents, reportGradeTimelineDates, hasTwoOpportunityPledge, presentOpportunityMovement, reportGradePresentation, reportGradeOutcome, reportNumber, studentReportText, DISMISSED_NO_GRADE_TEXT, examHeldDuringDismissal, isDuringDismissalGrade, reportDismissalPeriods, type ReportBalanceNote, type ReportTimelineEvent, type ReportGradeTone, type ReportMovementKind } from "@/lib/student-report-presentation";
import { isBonusOpportunityLog } from "@/lib/bonus-opportunity";
import { withoutCancelledManualPairs } from "@/lib/opportunity-log-pairs";
import { GRACE_PERIOD_EXCUSE_LABEL, isStudentInGracePeriod, normalizeGracePeriodRanges } from "@/lib/grace-periods";
import { LEGACY_GRACE_PLACEHOLDER_STATUS, type AcademicOpportunityCommandEffect } from "@/lib/academic-types";
import { isExamOnOrAfterStudentRegistration } from "@/lib/exam-utils";
import { hasStudentLeaveForExam, type StudentLeaveLike } from "@/lib/grade-classification";
import { DETAILS_MODAL_CSS, DETAILS_MODAL_HTML, DETAILS_MODAL_JS, PENDING_GRADE_STATUS } from "./export-details-modal";

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
  /** Recorded effect time; only breaks ties within the same visible exam day. */
  timelineDate?: string;
  score: number | null;
  fullMark: number | null;
  status: string;
  /** داخلي فقط لتحديد حالة تقرير HTML؛ لا يُحقن في الملف المتولد. */
  notes?: string | null;
  outcome?: string;
  opportunityEffect?: string;
  opportunityTone?: ReportGradeTone;
  passMark?: number | null;
  /** A score typed while the student was dismissed, kept after the return for the record only. */
  duringDismissal?: boolean;
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
  /** Recorded balance changes, independent of which exams are shown. */
  balanceNotes?: ReportBalanceNote[];
  /** Public explanations of recorded changes, interleaved with exam results. */
  timelineEvents?: ReportTimelineEvent[];
  /**
   * Per timeline row (by its key): what kind of row it is, the opportunities it
   * moved and the balance after; plus the sum that explains the balance when
   * it adds up. Kinds and numbers only, so safe for the student's file.
   */
  opportunityView?: {
    rows: Record<string, { category: StaffOpportunityCategory; delta: number | null; balanceAfter: number | null }>;
    summary: StaffOpportunitySummary | null;
  };
  studentSnapshot?: {
    name: string; code: string; status: string; opportunities: number | null; courseName?: string;
    opportunityLimit: number | null; registeredAt: string | null;
  };
};

export type StudentDetailsMap = Record<string, StudentDetails>;

/* ============== The report's timeline, for in-app windows ============== */

/** One line of a student's timeline, exactly as the HTML report shows it. */
export type OpportunityTimelineEntry =
  | { type: "event"; key: string; date: string; text: string; kind: "add" | "return" | "reset" | "deduct" }
  | {
    type: "grade";
    key: string;
    examName: string;
    examType: string;
    examDate: string;
    /** passed / failed / deducted / dismissed / excused / neutral: the row's colour. */
    result: "passed" | "failed" | "deducted" | "dismissed" | "excused" | "neutral";
    /** The grade text, e.g. «41 / 50», «غياب», «إجازة». */
    score: string;
    /** «ناجح» / «الدرجة كاملة» / «راسب» next to the grade, when there is one. */
    pill: { text: string; tone: "passed" | "failed" } | null;
    duringDismissal: boolean;
    effect: string;
  };

/** The report's day key: the exam or event day in Baghdad. */
function reportTimelineDay(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Baghdad",
  }).formatToParts(date);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value || "").join("-");
}

function reportNumberText(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : String(Number(value));
}

/**
 * The same timeline the HTML report draws in «عرض التفاصيل» (export-dialog's
 * showDetails): exam results and recorded changes in one list, ordered by day,
 * then time, with a change before a result of the same moment.
 */
export function buildOpportunityTimeline(details: StudentDetails): OpportunityTimelineEntry[] {
  type Item = { day: string; date: string; order: number; entry: OpportunityTimelineEntry };
  const grades: Item[] = (details.grades || []).map((g, index) => {
    const excused = g.status === "مجاز" || g.status === GRACE_PERIOD_EXCUSE_LABEL || g.status === "قبل تسجيل الطالب";
    const tone = g.opportunityTone && ["ordinary", "excused", "deducted", "dismissed"].includes(g.opportunityTone)
      ? g.opportunityTone : "ordinary";
    const passed = g.outcome === "ناجح" || g.outcome === "الدرجة كاملة";
    const result = tone === "dismissed" ? "dismissed"
      : tone === "deducted" ? "deducted"
        : excused || tone === "excused" ? "excused"
          : passed ? "passed"
            : g.outcome === "راسب" || g.status === "غائب" || g.status === "غش" ? "failed"
              : "neutral";
    const score = g.status === "غش" ? "غش"
      : g.score === null || g.score === undefined
        ? g.status === "مجاز" ? "إجازة"
          : g.status === GRACE_PERIOD_EXCUSE_LABEL ? "مجاز فترة سماح"
            : g.status === "غائب" ? "غياب"
              : g.status === PENDING_GRADE_STATUS ? PENDING_GRADE_STATUS
                : g.status === DISMISSED_NO_GRADE_TEXT ? DISMISSED_NO_GRADE_TEXT
                  : "بانتظار الدرجة"
        : `${reportNumberText(g.score)} / ${reportNumberText(g.fullMark)}`;
    const hasScore = g.status !== "غش" && g.score !== null && g.score !== undefined;
    const pill = !hasScore || g.duringDismissal ? null
      : passed ? { text: String(g.outcome), tone: "passed" as const }
        : g.outcome === "راسب" ? { text: "راسب", tone: "failed" as const } : null;
    const date = g.timelineDate || g.examDate;
    return {
      day: reportTimelineDay(g.examDate),
      date,
      order: index,
      entry: {
        type: "grade",
        key: `grade-${g.examId || index}`,
        examName: g.examName,
        examType: g.examType,
        examDate: g.examDate,
        result,
        score,
        pill,
        duringDismissal: hasScore && g.duringDismissal === true,
        effect: String(g.opportunityEffect || "لا تتوفر تفاصيل الأثر في هذه النسخة.").trim(),
      },
    };
  });
  const events: Item[] = (details.timelineEvents || []).map((event, index) => ({
    day: reportTimelineDay(event.date),
    date: event.date,
    order: index,
    entry: {
      type: "event",
      key: `event-${index}`,
      date: event.date,
      text: event.text,
      kind: ["add", "return", "reset", "deduct"].includes(event.kind) ? event.kind : "reset",
    },
  }));
  return [...grades, ...events]
    .sort((a, b) => {
      const isEventA = a.entry.type === "event";
      const isEventB = b.entry.type === "event";
      return a.day.localeCompare(b.day) ||
        (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0) ||
        (isEventA && !isEventB ? -1 : !isEventA && isEventB ? 1 : a.order - b.order);
    })
    .map((item) => item.entry);
}

/* ============== The staff view: the whole picture of a balance ============== */

export type StaffOpportunityCategory =
  | "exam" | "exam-deduct" | "exam-dismissal" | "bonus"
  | "admin-add" | "admin-deduct" | "undo" | "admin-dismissal"
  | "chapter-start" | "return" | "set";

export type StaffOpportunityRow = {
  key: string;
  category: StaffOpportunityCategory;
  /** The day and time the row happened, as the report shows it. */
  date: string;
  withTime: boolean;
  title: string;
  /** Exam rows: type, grade and pass/fail. */
  exam?: { type: string; score: string; pill: { text: string; tone: "passed" | "failed" } | null; result: string; duringDismissal: boolean };
  /** What the row meant for the opportunities, in words, when it moved nothing. */
  note: string;
  /** The reason typed with an admin command (filters and markers removed). */
  reason: string;
  /** Opportunities the row moved (+ added, − taken); null when none. */
  delta: number | null;
  /** The balance right after, when the record holds it. */
  balanceAfter: number | null;
  /** Before the movement the current balance counts from. */
  beforeOpening: boolean;
  /** The movement the current balance counts from (chapter start, return, set). */
  opening: boolean;
};

export type StaffOpportunitySummary = {
  opening: number | null;
  openingLabel: string;
  examDeducted: number;
  adminAdded: number;
  adminDeducted: number;
  bonus: number;
  /** opening − deductions + additions; null without an opening. */
  computed: number | null;
  /**
   * No recorded opening in the chapter: the sum starts from the chapter's
   * opportunities (every student starts full) and is only shown when it
   * lands exactly on the student's balance.
   */
  inferred: boolean;
};

const STAFF_REASON_LABELS = /^(النطاق|الحالة|عدد الفرص|البحث|عدا المفصولين|عدا|المطلوب|المطبّق)\s*:/u;

/** The words someone typed with a command, without its filters and markers. */
export function staffOpportunityReason(raw: unknown): string {
  const text = String(raw ?? "")
    .replace(/\s*\[[^\]]*\]/gu, "")
    .replace(/^تلقائي:\s*/u, "")
    .replace(/^تراجع موثق عن (?:إضافة|خصم)\s*:?\s*/u, "")
    .trim();
  return text
    .split(/\s+[-·]\s+/u)
    .map((part) => part.trim().replace(/^السبب\s*:\s*/u, ""))
    .filter((part) => part && !STAFF_REASON_LABELS.test(part))
    .join(" · ");
}

const STAFF_EVENT_TITLES: Record<NonNullable<ReportTimelineEvent["source"]>, string> = {
  "admin-add": "إضافة من الإدارة",
  "admin-deduct": "خصم من الإدارة",
  "undo-add": "تراجع عن إضافة",
  "undo-deduct": "تراجع عن خصم",
  "admin-dismissal": "فصل من الإدارة",
  "chapter-start": "بداية الفصل",
  "return": "إرجاع الطالب",
  "set": "تحديد الفرص من الإدارة",
};

/**
 * The student's opportunities for staff: the same rows, order and source as
 * the HTML report (exam results and recorded commands of the active
 * chapter), each tagged with what it did, how many opportunities it moved
 * and the balance after when recorded, plus the sum that explains today's
 * balance from the latest opening (chapter start, return or set balance).
 */
export function buildStaffOpportunityView(details: StudentDetails): { rows: StaffOpportunityRow[]; summary: StaffOpportunitySummary } {
  const timeline = buildOpportunityTimeline(details);
  const grades = details.grades || [];
  const events = details.timelineEvents || [];
  const logsByExam = new Map<string, StudentOpportunityLogDetail[]>();
  for (const log of details.opportunityLogs || []) {
    if (!log.examId) continue;
    logsByExam.set(log.examId, [...(logsByExam.get(log.examId) || []), log]);
  }
  const applied = (log: StudentOpportunityLogDetail) =>
    Math.max(0, Math.abs(Number(log.appliedAmount ?? log.amount) || 0));

  const rows: StaffOpportunityRow[] = timeline.map((entry) => {
    if (entry.type === "event") {
      const event = events[Number(entry.key.replace("event-", ""))];
      const source = event?.source;
      const category: StaffOpportunityCategory = source === "undo-add" || source === "undo-deduct" ? "undo"
        : source === "admin-add" || source === "admin-deduct" || source === "admin-dismissal" || source === "chapter-start" || source === "return" || source === "set"
          ? source
          : entry.kind === "add" ? "admin-add" : entry.kind === "deduct" ? "admin-deduct" : entry.kind === "return" ? "return" : "set";
      const amount = event?.amount ?? null;
      const setter = category === "chapter-start" || category === "return" || category === "set";
      const delta = setter || amount === null ? null
        : source === "admin-add" || source === "undo-deduct" || (!source && entry.kind === "add") ? amount : -amount;
      const title = source ? STAFF_EVENT_TITLES[source]
        : entry.kind === "add" ? "إضافة من الإدارة" : entry.kind === "deduct" ? "خصم من الإدارة" : entry.kind === "return" ? "إرجاع الطالب" : "تحديد الفرص";
      return {
        key: entry.key,
        category,
        date: entry.date,
        withTime: true,
        title: category === "chapter-start" && details.activeChapterName ? `بداية ${details.activeChapterName}` : title,
        note: setter && event?.balanceAfter !== null && event?.balanceAfter !== undefined ? `الفرص صارت ${event.balanceAfter}` : delta === 0 ? "بدون تغيير (الفرص بحدّها الأعلى)" : "",
        reason: category === "chapter-start" ? "" : staffOpportunityReason(event?.reason),
        delta: delta === 0 ? null : delta,
        balanceAfter: event?.balanceAfter ?? null,
        beforeOpening: false,
        opening: false,
      };
    }
    const grade = grades.find((item, index) => `grade-${item.examId || index}` === entry.key);
    const logs = grade?.examId ? logsByExam.get(grade.examId) || [] : [];
    const bonus = logs.filter(isBonusOpportunityLog).reduce((sum, log) => sum + applied(log), 0);
    const taken = logs.filter((log) => log.action === "خصم تلقائي").reduce((sum, log) => sum + applied(log), 0);
    const category: StaffOpportunityCategory = entry.result === "dismissed" ? "exam-dismissal"
      : bonus > 0 ? "bonus" : taken > 0 || entry.result === "deducted" ? "exam-deduct" : "exam";
    const delta = bonus > 0 ? bonus : taken > 0 ? -taken : null;
    return {
      key: entry.key,
      category,
      date: entry.examDate,
      withTime: false,
      title: entry.examName,
      exam: { type: entry.examType, score: entry.score, pill: entry.pill, result: entry.result, duringDismissal: entry.duringDismissal },
      note: category === "bonus" ? "نجاح ثاني على التوالي" : entry.effect,
      reason: "",
      delta,
      balanceAfter: null,
      beforeOpening: false,
      opening: false,
    };
  });

  // Today's balance counts from the latest opening.
  let openingIndex = -1;
  rows.forEach((row, index) => {
    if ((row.category === "chapter-start" || row.category === "return" || row.category === "set") && row.balanceAfter !== null) openingIndex = index;
  });
  if (openingIndex >= 0) rows[openingIndex].opening = true;
  const summary: StaffOpportunitySummary = {
    opening: openingIndex >= 0 ? rows[openingIndex].balanceAfter : null,
    openingLabel: openingIndex >= 0 ? rows[openingIndex].title : "",
    examDeducted: 0, adminAdded: 0, adminDeducted: 0, bonus: 0, computed: null, inferred: false,
  };
  const limit = details.studentSnapshot?.opportunityLimit;
  if (openingIndex < 0 && typeof limit === "number" && Number.isFinite(limit)) {
    summary.opening = limit;
    summary.openingLabel = details.activeChapterName ? `بداية ${details.activeChapterName}` : "بداية الفصل";
    summary.inferred = true;
  }
  rows.forEach((row, index) => {
    if (index < openingIndex) { row.beforeOpening = true; return; }
    if (index === openingIndex || row.delta === null) return;
    if (row.category === "bonus") summary.bonus += row.delta;
    else if (row.category === "exam-deduct" || row.category === "exam-dismissal") summary.examDeducted += -row.delta;
    else if (row.delta > 0) summary.adminAdded += row.delta;
    else summary.adminDeducted += -row.delta;
  });
  if (summary.opening !== null) {
    summary.computed = summary.opening - summary.examDeducted - summary.adminDeducted + summary.adminAdded + summary.bonus;
  }
  return { rows, summary };
}

/** «7 أكتوبر 2026», and «· 3:15 م» for a change saved at a time (as the report). */
export function formatReportTimelineDate(value: string, withTime = false): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Baghdad" });
  if (!withTime || !value.includes("T")) return day;
  return `${day} · ${date.toLocaleTimeString("ar-EG-u-nu-latn", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Baghdad" })}`;
}

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
  return Object.fromEntries(Object.entries(details).map(([id, student]) => {
    const grades = student.grades.filter(grade => Boolean(grade.examId && selected.has(grade.examId)));
    return [id, {
      ...student,
      grades,
      opportunityLogs: student.opportunityLogs.filter(log => !log.examId || selected.has(log.examId)),
      // With exams left out the sum would not match the rows shown.
      opportunityView: student.opportunityView && grades.length !== student.grades.length
        ? { ...student.opportunityView, summary: null } : student.opportunityView,
    }];
  }));
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

export function sanitizeStudentDetailsForHtml(details: StudentDetailsMap): StudentDetailsMap {
  return Object.fromEntries(
    Object.entries(details).map(([studentId, studentDetails]) => [
      studentId,
      {
        activeChapterName: studentDetails.activeChapterName ?? null,
        activeChapterSince: studentDetails.activeChapterSince ?? null,
        generatedAt: studentDetails.generatedAt ?? null,
        hasTwoOpportunityPledge: studentDetails.hasTwoOpportunityPledge === true,
        balanceNotes: (studentDetails.balanceNotes || []).map(({ text, date }) => ({ text, date })),
        timelineEvents: (studentDetails.timelineEvents || []).map(({ date, text, kind, balanceAfter }) => ({ date, text, kind, balanceAfter })),
        studentSnapshot: studentDetails.studentSnapshot,
        grades: (studentDetails.grades || [])
          .map((grade) => {
            const { notes: _notes, ...reportGrade } = grade;
            return reportGrade;
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

const PUBLIC_GRADE_OUTCOMES = new Set(["ناجح", "راسب", "الدرجة كاملة"]);

/** Each row's kind, the opportunities it moved and the balance after (null when unknown). */
type PublicRowView = { cat: StaffOpportunityCategory | null; delta: number | null; after: number | null };
type PublicStudentHtmlDetails = Pick<StudentDetails, "activeChapterName"> & {
  timelineEvents: Array<Pick<ReportTimelineEvent, "date" | "text" | "kind" | "balanceAfter"> & PublicRowView>;
  grades: Array<Pick<StudentGradeDetail,
    "examName" | "examType" | "examDate" | "timelineDate" | "score" | "fullMark" | "status" | "outcome" | "opportunityEffect" | "opportunityTone" | "duringDismissal"
  > & PublicRowView>;
  /** The sum that explains the balance, when it adds up (numbers and labels only). */
  sum: Pick<StaffOpportunitySummary, "opening" | "openingLabel" | "examDeducted" | "adminAdded" | "adminDeducted" | "bonus"> | null;
};

function publicRowView(view: StudentDetails["opportunityView"], key: string): PublicRowView {
  const row = view?.rows[key];
  return { cat: row?.category ?? null, delta: row?.delta ?? null, after: row?.balanceAfter ?? null };
}

/** Final public-file boundary. Keep the shared/internal details intact and
 * explicitly copy only fields consumed by this HTML's display and search. */
function buildPublicStudentHtmlData(details: StudentDetailsMap, students: StudentRowBasic[]) {
  const publicDetails: Array<[string, PublicStudentHtmlDetails]> = [];
  const publicStudents = students.map(student => {
    const detail = Object.hasOwn(details, student.id) ? details[student.id] : undefined;
    const snapshot = detail?.studentSnapshot;
    const code = snapshot ? snapshot.code : student.code;
    if (detail) publicDetails.push([student.id, {
      activeChapterName: detail.activeChapterName ?? null,
      timelineEvents: (detail.timelineEvents || []).map(({ date, text, kind, balanceAfter }, index) => ({
        date, text, kind, balanceAfter, ...publicRowView(detail.opportunityView, `event-${index}`),
      })),
      sum: detail.opportunityView?.summary ? {
        opening: detail.opportunityView.summary.opening,
        openingLabel: detail.opportunityView.summary.openingLabel,
        examDeducted: detail.opportunityView.summary.examDeducted,
        adminAdded: detail.opportunityView.summary.adminAdded,
        adminDeducted: detail.opportunityView.summary.adminDeducted,
        bonus: detail.opportunityView.summary.bonus,
      } : null,
      grades: (detail.grades || []).map((grade, index) => ({
        ...publicRowView(detail.opportunityView, `grade-${grade.examId || index}`),
        examName: grade.examName,
        examType: grade.examType,
        examDate: grade.examDate,
        timelineDate: grade.timelineDate || grade.examDate,
        score: grade.score,
        fullMark: grade.fullMark,
        status: grade.status,
        // «ناجح» / «راسب» / «الدرجة كاملة»: the row's result and colour.
        // Any other stored outcome stays out of the public file.
        outcome: PUBLIC_GRADE_OUTCOMES.has(String(grade.outcome)) ? grade.outcome : "",
        opportunityEffect: grade.opportunityEffect,
        opportunityTone: grade.opportunityTone,
        duringDismissal: grade.duringDismissal === true,
      })).sort((a, b) => (new Date(a.examDate).getTime() || 0) - (new Date(b.examDate).getTime() || 0)),
    }]);
    // Resolve the latest database snapshot before dropping its duplicate copy.
    // Whitelist the fallback too: rows may carry private fields in other exports.
    return {
      id: student.id,
      name: snapshot?.name || student.name,
      code: code ? String(code) : "",
      courseName: snapshot?.courseName || student.courseName,
      opportunities: snapshot ? snapshot.opportunities : student.opportunities,
      status: snapshot ? snapshot.status : student.status,
    };
  });
  return { details: Object.fromEntries(publicDetails), students: publicStudents };
}

export type StudentProfileLogSnapshot = {
  student?: Record<string, unknown> | null;
  generatedAt?: string;
  exams?: Array<Record<string, unknown>> | null;
  grades?: Array<Record<string, unknown>> | null;
  allCourseExams?: Array<Record<string, unknown>> | null;
  opportunityLogs?: Array<Record<string, unknown>> | null;
  /** Read-only command effects from this snapshot's authoritative engine. */
  opportunityCommandEffects?: AcademicOpportunityCommandEffect[];
  studentLeaves?: StudentLeaveLike[] | null;
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
  /**
   * Facts the report needs whatever sections the exporter may read (status,
   * registration day, leave days, recorded dismissals, pending scores).
   */
  reportContext?: {
    status?: unknown;
    registeredAt?: unknown;
    leaves?: StudentLeaveLike[] | null;
    dismissals?: Array<{ date?: unknown; reason?: unknown }> | null;
    pendingGrades?: Array<{ examId?: unknown; score?: unknown; category?: unknown }> | null;
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
): { examIds: string[]; since: string | null; chapterId: string | null } | null {
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
    chapterId: typeof currentChapter.id === "string" && currentChapter.id.trim() ? currentChapter.id.trim() : null,
  };
}

/** «28 سبتمبر 2026 · 3:45 م» in Baghdad time, for the report's opening page. */
function reportGeneratedText(date: Date): string {
  try {
    const day = date.toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Baghdad" });
    const time = date.toLocaleTimeString("ar-EG-u-nu-latn", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Baghdad" });
    return `${day} · ${time}`;
  } catch {
    return date.toISOString();
  }
}

const DISMISSAL_PAIR_WINDOW_MS = 60_000;

function isReportDismissalLog(log: Record<string, unknown>): boolean {
  const action = String(log.action || "").trim();
  return action.startsWith("فصل") ||
    (action === "خصم" && /^فصل الطالب/u.test(String(log.reason || "").trim()));
}

/**
 * Dismissal lines the movement timeline cannot carry:
 * - a manual dismissal of a student whose balance was already 0 writes no
 *   opportunity movement, only its dismissal record;
 * - a student dismissed during an earlier chapter who is still dismissed now:
 *   each chapter starts afresh, so one line explains the status carried in.
 */
function reportDismissalEvents(
  profile: StudentProfileLogSnapshot,
  rawLogs: Array<Record<string, unknown>>,
  scopedLogs: Array<Record<string, unknown>>,
  logScope: { examIds: string[]; since: string | null; chapterId: string | null } | null,
  studentStatus: string,
): ReportTimelineEvent[] {
  const events: ReportTimelineEvent[] = [];
  const sinceTime = logScope?.since ? Date.parse(logScope.since) : NaN;
  const dismissalLogTimes = rawLogs
    .filter(isReportDismissalLog)
    .map((log) => Date.parse(String(log.date || "")))
    .filter(Number.isFinite);
  const dismissals = (profile.reportContext?.dismissals || [])
    .map((item) => ({ time: Date.parse(String(item.date || "")), reason: studentReportText(item.reason) }))
    .filter((item) => Number.isFinite(item.time));

  for (const dismissal of dismissals) {
    if (Number.isFinite(sinceTime) && dismissal.time < sinceTime) continue;
    if (dismissalLogTimes.some((time) => Math.abs(time - dismissal.time) <= DISMISSAL_PAIR_WINDOW_MS)) continue;
    events.push({
      date: new Date(dismissal.time).toISOString(),
      text: dismissal.reason ? `فصلتك الإدارة بسبب: ${dismissal.reason}` : "فصلتك الإدارة",
      kind: "deduct",
      balanceAfter: 0,
    });
  }

  if (studentStatus === "مفصول" && logScope?.since && !events.length && !scopedLogs.some(isReportDismissalLog)) {
    const examNames = new Map(
      [...(profile.allCourseExams || []), ...(profile.exams || [])]
        .map((exam) => [String(exam.id || ""), String(exam.name || "")] as const),
    );
    const previousLog = rawLogs
      .filter((log) => isReportDismissalLog(log) && !opportunityLogWithinActiveChapter(log, logScope))
      .sort((a, b) => (Date.parse(String(b.date || "")) || 0) - (Date.parse(String(a.date || "")) || 0))[0];
    const previousNote = dismissals
      .filter((item) => !Number.isFinite(sinceTime) || item.time < sinceTime)
      .sort((a, b) => b.time - a.time)[0];
    if (previousLog || previousNote) {
      const chapterName = String(previousLog?.chapterNameSnapshot || "").trim() || "الفصل السابق";
      const examName = previousLog ? examNames.get(String(previousLog.examId || "")) || "" : "";
      const manualReason = previousLog
        ? studentReportText(String(previousLog.reason || "").replace(/^فصل الطالب\s*:?\s*/u, ""))
        : previousNote?.reason || "";
      const cause = examName ? ` بسبب ${examName}` : manualReason ? ` بسبب: ${manualReason}` : "";
      events.push({
        date: logScope.since,
        text: `فُصلت خلال ${chapterName}${cause}، وبقيت حالتك «مفصول» عند بدء هذا الفصل`,
        kind: "deduct",
        balanceAfter: null,
      });
    }
  }
  return events;
}

/**
 * يحوّل استجابة /api/students/profile-log إلى لقطة تفاصيل الطالب
 * (درجات الامتحانات + سجل الفرص مع الأسباب) — نفس التحويل الحرفي
 * الذي يستخدمه تصدير HTML من صفحة إدارة الفرص.
 *
 * الدالة مشتركة عمداً بين تصدير HTML وزر تليگرام في إدارة المفصولين
 * حتى يبقى مصدر الرسالة ومصدر الملف المتولد واحداً لا يتفرع.
 */
export function buildStudentDetailsFromProfileLog(
  profile: StudentProfileLogSnapshot,
  options: { staff?: boolean } = {},
): StudentDetails {
  const { chapterExamIds, activeChapterName } =
    resolveActiveChapterExamFilter(profile);
  const examMap = new Map<string, Record<string, unknown>>();
  const exams = Array.isArray(profile.exams) ? profile.exams : [];
  const allCourseExams = Array.isArray(profile.allCourseExams) ? profile.allCourseExams : [];
  for (const exam of [...allCourseExams, ...exams]) {
    const examRecord = exam as Record<string, unknown>;
    const examId = String(examRecord.id || "");
    if (examId) examMap.set(examId, examRecord);
  }

  const rawGrades = Array.isArray(profile.grades) ? profile.grades : [];
  // A mistaken command and its documented undo are not part of the file.
  const rawLogs = withoutCancelledManualPairs(Array.isArray(profile.opportunityLogs) ? profile.opportunityLogs : []);
  const logScope = resolveActiveChapterLogScope(profile);
  const scopedLogs = rawLogs.filter(log => opportunityLogWithinActiveChapter(log, logScope));
  // Staff windows also get each command's source and reason; the student's
  // report and Telegram file never do.
  const staffTimelineEvents = buildStaffTimelineEvents(scopedLogs, profile.currentChapter?.id,
    profile.opportunityCommandEffects, profile.student?.opportunityLimit);
  const timelineEvents = options.staff
    ? staffTimelineEvents
    : staffTimelineEvents.map(({ date, text, kind, balanceAfter }) => ({ date, text, kind, balanceAfter }));
  const gracePeriods = normalizeGracePeriodRanges(profile.student?.gracePeriods);
  // The report context is given to every exporter who can see grades or
  // opportunities; the profile's own fields are only a fallback.
  const reportContext = profile.reportContext || null;
  const studentLeaves = Array.isArray(reportContext?.leaves)
    ? reportContext.leaves
    : Array.isArray(profile.studentLeaves) ? profile.studentLeaves : [];
  const studentStatus = String(reportContext?.status ?? profile.student?.status ?? "");
  const registeredAt = (reportContext?.registeredAt ?? profile.student?.createdAt) as string | Date | null | undefined;
  timelineEvents.push(...reportDismissalEvents(profile, rawLogs, scopedLogs, logScope, studentStatus));
  timelineEvents.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  // The days the student spent dismissed, so an exam held then with nothing
  // recorded reads «الطالب مفصول - بلا درجة» instead of awaiting a grade.
  const dismissalPeriods = reportDismissalPeriods({
    logs: rawLogs,
    manualDismissals: reportContext?.dismissals || [],
    examDates: new Map([...examMap].map(([id, exam]) => [id, exam.date])),
    dismissedNow: studentStatus === "مفصول",
  });
  const opportunityContext = {
    ...buildReportOpportunityContext(rawLogs, String(profile.currentChapter?.id || "")),
    gracePeriods,
    registeredAt,
    historical: true,
  };
  const includeExam = (status: unknown, exam: Record<string, unknown> | undefined): boolean =>
    status !== "قبل تسجيل الطالب" && isExamOnOrAfterStudentRegistration(
      { createdAt: opportunityContext.registeredAt },
      { date: exam?.date as string | Date | null | undefined },
    );
  // Keep incidents visible; classify excuses from the actual leave/period data.
  // An empty result never establishes an absence.
  const reportStatus = (status: unknown, exam: Record<string, unknown> | undefined): string =>
    status === "غش" ? "غش"
      : status === "مجاز" || hasStudentLeaveForExam(studentLeaves, {
        id: String(exam?.id || ""), date: exam?.date as string | Date | null | undefined,
      }) ? "مجاز"
      : isStudentInGracePeriod(gracePeriods, exam?.date as string | Date | null | undefined)
      ? GRACE_PERIOD_EXCUSE_LABEL
      : status === LEGACY_GRACE_PLACEHOLDER_STATUS ? "" : String(status || "");
  // Include filtered records so a hidden pre-registration marker cannot be
  // reintroduced as a missing grade from the course exam list.
  const gradeExamIds = new Set(rawGrades.map(grade => String(grade.examId || "")));
  // درجات امتحانات الفصل النشط الحالي فقط: عند توفر سياق الفصل النشط
  // (currentChapter) نخفي درجات الامتحانات المنشأة قبل بداية الفصل النشط
  // حتى يعرض التقرير فصل الطالب الحالي وحده — غياب السياق = بلا فلترة.
  // In the engine's exam order (date, then exam), so results that share a
  // place in the timeline are shown as the engine replays them.
  const shownGrades = rawGrades.filter((rawGrade) => {
    const examId = String(rawGrade.examId || "");
    return (!chapterExamIds || chapterExamIds.has(examId)) && includeExam(rawGrade.status, examMap.get(examId));
  }).sort((a, b) =>
    String(examMap.get(String(a.examId || ""))?.date || a.createdAt || "")
      .localeCompare(String(examMap.get(String(b.examId || ""))?.date || b.createdAt || "")) ||
    String(a.examId || "").localeCompare(String(b.examId || "")));
  // With the report's own status, so a leave or grace day keeps its place.
  const gradeTimelineDates = reportGradeTimelineDates(
    shownGrades.map((rawGrade) => ({ ...rawGrade, status: reportStatus(rawGrade.status, examMap.get(String(rawGrade.examId || ""))) })),
    (rawGrade) => examMap.get(String(rawGrade.examId || "")), timelineEvents,
  );
  const grades: StudentGradeDetail[] = shownGrades
    .map((rawGrade, index) => {
      const examId = String(rawGrade.examId || "");
      const exam = examMap.get(examId);
      const grade: Record<string, unknown> & { status: string } = { ...rawGrade, status: reportStatus(rawGrade.status, exam) };
      const presentation = reportGradePresentation(grade, exam, scopedLogs.filter(log => log.examId === examId), opportunityContext);
      const score = grade.score;
      const fullMark = exam?.fullMark;
      return {
        examId,
        examName: String(exam?.name || "امتحان غير محدد"),
        examType: String(exam?.type || ""),
        examDate: String(exam?.date || ""),
        timelineDate: gradeTimelineDates[index],
        score: score === null || score === undefined ? null : Number(score),
        fullMark:
          fullMark === null || fullMark === undefined ? null : Number(fullMark),
        status: grade.status,
        notes: grade.notes ? String(grade.notes) : null,
        outcome: reportGradeOutcome(grade, exam),
        opportunityEffect: presentation.text,
        opportunityTone: presentation.tone,
        passMark: reportNumber(exam?.passMark),
        duringDismissal: isDuringDismissalGrade(rawGrade),
      };
    });

  // A score typed while it could not count (the student was dismissed, on
  // leave or not yet registered) waits for review and is never counted.
  const pendingExamIds = new Set(
    (reportContext?.pendingGrades || [])
      .map((item) => String(item.examId || ""))
      .filter((examId) => examId && !gradeExamIds.has(examId)),
  );
  for (const examId of pendingExamIds) {
    const examRecord = examMap.get(examId);
    if (!examRecord || (chapterExamIds && !chapterExamIds.has(examId))) continue;
    gradeExamIds.add(examId);
    grades.push({
      examId,
      examName: String(examRecord.name || "امتحان غير محدد"),
      examType: String(examRecord.type || ""),
      examDate: String(examRecord.date || ""),
      score: null,
      fullMark: examRecord.fullMark === null || examRecord.fullMark === undefined ? null : Number(examRecord.fullMark),
      status: PENDING_GRADE_STATUS,
      notes: null,
      outcome: PENDING_GRADE_STATUS,
      opportunityEffect: "بدون أثر على الفرص",
      opportunityTone: "ordinary",
      passMark: reportNumber(examRecord.passMark),
    });
  }

  // إضافة امتحانات الدورة التي ليس للطالب سجل درجات فيها — ضمن امتحانات
  // الفصل النشط الحالي فقط عند توفر سياق الفصل النشط.
  for (const rawExam of allCourseExams) {
    const examRecord = rawExam as Record<string, unknown>;
    const examId = String(examRecord.id || "");
    if (
      examId &&
      (!chapterExamIds || chapterExamIds.has(examId)) &&
      !gradeExamIds.has(examId) &&
      includeExam(undefined, examRecord)
    ) {
      examMap.set(examId, examRecord);
      // A leave or grace period explains the exam first; otherwise an exam
      // held while the student was dismissed has no grade, by design.
      const excuse = reportStatus("", examRecord);
      const grade = {
        status: excuse || (examHeldDuringDismissal(examRecord.date, dismissalPeriods) ? DISMISSED_NO_GRADE_TEXT : ""),
        score: null,
      };
      const presentation = reportGradePresentation(grade, examRecord, scopedLogs.filter(log => log.examId === examId), opportunityContext);
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
        status: grade.status,
        notes: null,
        outcome: reportGradeOutcome(grade, examRecord),
        opportunityEffect: presentation.text,
        opportunityTone: presentation.tone,
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
  const details: StudentDetails = {
    grades, opportunityLogs, activeChapterName, timelineEvents,
    // Pledges from the full enrollment history must survive exam/chapter filters.
    hasTwoOpportunityPledge: hasTwoOpportunityPledge(rawLogs),
    balanceNotes: opportunityContext.balanceNotes,
    activeChapterSince: logScope?.since ?? null,
    generatedAt: profile.generatedAt ?? null,
    studentSnapshot: student ? {
      name: String(student.name || ""), code: String(student.code || ""),
      status: studentStatus, opportunities: reportNumber(student.opportunities),
      opportunityLimit: reportNumber(student.opportunityLimit), registeredAt: registeredAt ? String(registeredAt) : null,
    } : undefined,
  };
  details.opportunityView = opportunityViewData({ ...details, timelineEvents: staffTimelineEvents });
  return details;
}

/** The kinds and numbers of a student's rows, and the sum when it adds up. */
function opportunityViewData(details: StudentDetails): NonNullable<StudentDetails["opportunityView"]> {
  const { rows, summary } = buildStaffOpportunityView(details);
  const balance = details.studentSnapshot?.opportunities;
  return {
    rows: Object.fromEntries(rows.map((row) => [row.key, { category: row.category, delta: row.delta, balanceAfter: row.balanceAfter }])),
    summary: summary.opening !== null && summary.computed !== null && balance !== null && balance !== undefined && summary.computed === balance
      ? summary : null,
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
  const { details: reportDetails, students: reportStudents } = interactiveMode
    ? buildPublicStudentHtmlData(options.studentDetails || {}, options.studentList || [])
    : { details: {}, students: [] };
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
    ? `<p class="tp-report-intro">اعرف درجاتك، وفرصك المتبقية، وأثر كل امتحان عليها.</p><p class="tp-report-generated">آخر تحديث: ${escapeHtml(reportGeneratedText(new Date()))}</p>`
    : `<div class="meta">عدد الصفوف: ${rows.length} | عدد الأعمدة: ${columns.length}</div>`;

  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">${viewportMeta}<title>${escapeHtml(humanizeTeacherProText(interactiveMode && !options.documentTitle ? reportHeading : documentTitle))}</title><style>
  @page { size: A4 ${options.orientation || "portrait"}; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
    padding: 16px;
    color: #142B25;
    background: #F1EEE2;
    font-size: 16px;
    font-weight: 700;
  }
  .toolbar { position: sticky; top: 0; display: flex; gap: 8px; margin: -16px -16px 14px; padding: 10px 12px; background: #0A1A17; color: #FBF9EB; z-index: 3; }
  .toolbar button { border: 0; border-radius: 10px; padding: 9px 14px; cursor: pointer; font-weight: 800; font-size: 14px; }
  .report { background: #FBF9EB; border: 1px solid #E6E3D9; border-radius: 14px; padding: 18px; box-shadow: 0 10px 30px #0A1A1714; }
  .report-header { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 8px; margin-bottom: 14px; border-bottom: 2px solid #0A1A17; padding-bottom: 11px; }
  h1 { font-size: 24px; font-weight: 900; line-height: 1.5; margin: 0; }
  .meta { color: #586A64; font-size: 14px; font-weight: 800; white-space: nowrap; }
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
    border: 1px solid #CACAC5;
    padding: 8px 10px;
    text-align: center;
    vertical-align: middle;
    line-height: 1.6;
    white-space: normal;
    word-break: normal;
    overflow-wrap: normal;
    hyphens: none;
  }
  th { background: #F1EEE2; font-weight: 900; color: #0A1A17; }
  tr:nth-child(even) { background: #F6F4E7; }
  a[href]::after { content: "" !important; }
  ${detailsCss}
  @media print {
    html, body { width: 100%; margin: 0 !important; padding: 0 !important; background: #FBF9EB !important; font-weight: 700; }
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
  open: controlledOpen,
  onOpenChange: onControlledOpenChange,
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
  /** Opened from elsewhere (e.g. a ⋯ menu): no button of its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlled) onControlledOpenChange?.(next);
    else setUncontrolledOpen(next);
  };
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
      toast.error("ماكو بيانات للتصدير");
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

    // buildHtml creates the minimal public payload after exam selection;
    // internal details remain available to the other report consumers.
    const reportDetailsMap = detailsMap;

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
      ? ` مع تفاصيل ${studentCount(Object.keys(reportDetailsMap).length)}`
      : "";
    toast.success(
      `تم تصدير ${studentCount(exportRows.length)} بصيغة HTML${detailsNote}`,
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
      {controlled ? null : (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2" disabled={disabled}>
            <Download className="h-4 w-4" />
            {triggerLabel}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent dir="rtl" className="tp-form-dialog sm:max-w-2xl">
        <FormDialogHero
          icon={FileDown}
          title={htmlExamSelectionOpen ? "اختر امتحانات تقرير HTML" : title}
          description={description || null}
        />
        <div className="tp-form-dialog__body">
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
                  {visibleHtmlReportExams.length === 0 && <p className="p-3 text-sm text-muted-foreground">{htmlReportExams.length ? "ماكو امتحانات مطابقة للبحث." : "ماكو امتحانات ضمن نطاق هذا التقرير."}</p>}
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
