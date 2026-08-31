"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  examName: string;
  examType: string;
  examDate: string;
  score: number | null;
  fullMark: number | null;
  status: string;
  /** داخلي فقط لتحديد حالة تقرير HTML؛ لا يُحقن في الملف المتولد. */
  notes?: string | null;
};

export type StudentOpportunityLogDetail = {
  action: string;
  amount: number;
  reason: string | null;
  date: string;
  examName: string | null;
};

export type StudentDetails = {
  grades: StudentGradeDetail[];
  opportunityLogs: StudentOpportunityLogDetail[];
};

export type StudentDetailsMap = Record<string, StudentDetails>;

/**
 * بيانات الطالب الأساسية المعروضة في الجدول/البطاقة عند اختياره من البحث.
 * تُحقن في ملف HTML كـ window.STUDENT_LIST لاستخدامها في البحث والفلترة.
 */
export type StudentRowBasic = {
  id: string;
  name: string;
  courseName: string;
  opportunities: number | string;
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

const HTML_VISIBLE_GRADE_STATUSES = new Set(["درجة", "غائب"]);
const GRACE_DEFERRED_REPORT_STATUS = "لا يحاسب الطالب ( ضمن فترة السماح )";
// تُهمل أنواع الملاحظات الأخرى عمداً لأن عمود الملاحظات أزيل من التقرير،
// وتلك الحالات لا تؤثر على عرض الحالة في التقرير.
const GRACE_DEFERRED_GRADE_NOTE_PREFIXES = [
  "درجة مؤجلة خلال فترة السماح",
  "درجة مؤجلة خلال فترة سماح الطالب",
  "درجة حقيقية داخل فترة السماح؛ محفوظة للمتابعة دون أثر أكاديمي",
] as const;
const HISTORICAL_OPPORTUNITY_RESET_REASON =
  "تسوية تاريخية: تجاهل آثار الامتحانات السابقة للتسوية حتى عند تعديل درجاتها لاحقاً";

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

function tidyReportText(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([:،؛])/g, "$1")
    .replace(/([:،؛]){2,}/g, "$1")
    .replace(/^[\s:،؛.\-–—|]+|[\s:،؛.\-–—|]+$/g, "")
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

function sanitizeOpportunityReasonForHtml(
  reason: string | null | undefined,
): string | null {
  let text = String(reason || "")
    .replace(/\s*\[academic-reactivation-link:[^\]]+\]/g, "")
    .trim();
  if (!text) return null;

  const normalized = normalizeArabicComparisonText(text);
  if (
    normalized.includes(
      normalizeArabicComparisonText(HISTORICAL_OPPORTUNITY_RESET_REASON),
    )
  ) {
    return "اعادة تعيين جميع الفرص";
  }

  // كلمة "تلقائي" ليست معلومة مفيدة للمستخدم داخل سبب سجل الفرص.
  text = text.replace(
    /(^|[\s:،؛\-–—])تلقائي(?=\s|[:،؛\-–—]|$)/g,
    "$1",
  );
  text = tidyReportText(text);
  return text || null;
}

function sanitizeStudentDetailsForHtml(details: StudentDetailsMap): StudentDetailsMap {
  return Object.fromEntries(
    Object.entries(details).map(([studentId, studentDetails]) => [
      studentId,
      {
        grades: (studentDetails.grades || [])
          .filter((grade) =>
            HTML_VISIBLE_GRADE_STATUSES.has(String(grade.status || "").trim()),
          )
          .map((grade) => {
            const { notes: _notes, ...reportGrade } = grade;
            return {
              ...reportGrade,
              status: isGraceDeferredGradeForHtml(grade)
                ? GRACE_DEFERRED_REPORT_STATUS
                : grade.status,
            };
          }),
        opportunityLogs: (studentDetails.opportunityLogs || []).map((log) => ({
          ...log,
          reason: sanitizeOpportunityReasonForHtml(log.reason),
        })),
      },
    ]),
  );
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

function escapeJsString(value: string): string {
  return JSON.stringify(String(value ?? ""));
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
  .tp-search-wrap {
    position: relative;
    margin-bottom: 22px;
  }
  .tp-search-input {
    width: 100%;
    padding: 15px 18px;
    font-size: 18px;
    font-weight: 800;
    font-family: inherit;
    border: 2px solid #111827;
    border-radius: 10px;
    background: #fff;
    color: #111827;
    outline: none;
    transition: border-color .15s;
  }
  .tp-search-input:focus { border-color: #2563eb; }
  .tp-search-input::placeholder { color: #9ca3af; font-weight: 700; }
  .tp-search-hint {
    margin-top: 8px;
    font-size: 14px;
    font-weight: 700;
    color: #475569;
  }
  .tp-suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 50;
    background: #fff;
    border: 1px solid #d1d5db;
    border-top: 0;
    border-radius: 0 0 10px 10px;
    max-height: 360px;
    overflow-y: auto;
    box-shadow: 0 12px 24px rgba(15,23,42,.12);
    display: none;
  }
  .tp-suggestions.open { display: block; }
  .tp-suggestion {
    padding: 12px 16px;
    cursor: pointer;
    border-bottom: 1px solid #f3f4f6;
    font-size: 16px;
    font-weight: 700;
    color: #111827;
    transition: background .1s;
  }
  .tp-suggestion:last-child { border-bottom: 0; }
  .tp-suggestion:hover, .tp-suggestion.active {
    background: #f9fafb;
  }
  .tp-suggestion-name { font-weight: 900; }
  .tp-suggestion-meta {
    font-size: 13px;
    font-weight: 700;
    color: #64748b;
    margin-top: 3px;
  }
  .tp-empty-search {
    padding: 15px 16px;
    text-align: center;
    color: #475569;
    font-size: 14px;
    font-weight: 700;
  }

  .tp-student-card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 0;
    overflow-x: auto;
    overflow-y: hidden;
    display: none;
  }
  .tp-student-card.visible { display: block; }
  .tp-student-card table {
    margin: 0;
    border: 0;
  }
  .tp-student-card th, .tp-student-card td {
    border: 0;
    border-bottom: 1px solid #f3f4f6;
  }
  .tp-student-card tr:last-child th,
  .tp-student-card tr:last-child td { border-bottom: 0; }

  .tp-details-cell { text-align: center; white-space: nowrap; }
  .tp-details-btn {
    background: #111827; color: #fff; border: 0; border-radius: 7px;
    padding: 9px 17px; cursor: pointer; font-size: 14px; font-weight: 800;
    font-family: inherit;
  }
  .tp-details-btn:hover { background: #1f2937; }
  .tp-modal-overlay {
    position: fixed; inset: 0; background: rgba(15,23,42,.55);
    display: none; align-items: flex-start; justify-content: center;
    z-index: 100; padding: 20px 16px; overflow: auto;
  }
  .tp-modal-overlay.open { display: flex; }
  .tp-modal {
    background: #fff; border-radius: 14px; padding: 22px;
    max-width: 1180px; width: 100%; margin: auto;
    box-shadow: 0 24px 60px rgba(15,23,42,.25);
  }
  .tp-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; margin-bottom: 18px; padding-bottom: 12px;
    border-bottom: 2px solid #111827;
  }
  .tp-modal-header h2 { font-size: 21px; font-weight: 900; margin: 0; color: #111827; }
  .tp-modal-close {
    background: #111827; color: #fff; border: 0; border-radius: 8px;
    padding: 8px 15px; cursor: pointer; font-weight: 800; font-size: 14px;
    font-family: inherit;
  }
  .tp-modal-close:hover { background: #1f2937; }
  .tp-details-section { margin-bottom: 20px; overflow-x: auto; }
  .tp-details-section:last-child { margin-bottom: 0; }
  .tp-details-section h3 {
    font-size: 17px; font-weight: 900; margin: 0 0 10px; color: #111827;
    border-right: 4px solid #111827; padding-right: 9px;
  }
  .tp-details-table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
    table-layout: auto;
    font-size: 14px;
    font-weight: 700;
  }
  .tp-details-table th, .tp-details-table td {
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
  .tp-details-table th { background: #f3f4f6; font-weight: 900; color: #111827; }
  .tp-details-table tr:nth-child(even) { background: #fafafa; }
  .tp-grades-table th:nth-child(1), .tp-grades-table td:nth-child(1) { min-width: 170px; }
  .tp-logs-table th:nth-child(3), .tp-logs-table td:nth-child(3) { min-width: 300px; }
  .tp-empty-row td { text-align: center !important; color: #64748b; padding: 16px !important; }
`;

const DETAILS_MODAL_HTML = `
<div class="tp-search-wrap">
  <input type="text" id="tpStudentSearch" class="tp-search-input" autocomplete="off" placeholder="اكتب اسم الطالب الثنائي فما فوق (مثال: محمد علي)">
  <div id="tpSuggestions" class="tp-suggestions"></div>
  <p class="tp-search-hint" id="tpSearchHint">اكتب كلمتين على الأقل (الاسم واسم الأب) لعرض قائمة الطلاب المطابقين.</p>
</div>

<div id="tpStudentCard" class="tp-student-card"></div>

<div id="tpDetailsModal" class="tp-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="tpModalTitle">
  <div class="tp-modal">
    <div class="tp-modal-header">
      <h2 id="tpModalTitle">تفاصيل الطالب</h2>
      <button type="button" class="tp-modal-close" id="tpModalClose">إغلاق</button>
    </div>
    <div class="tp-details-section">
      <h3>الامتحانات ذات الدرجة أو الغياب</h3>
      <table class="tp-details-table tp-grades-table">
        <thead>
          <tr>
            <th>الامتحان</th>
            <th>النوع</th>
            <th>التاريخ</th>
            <th>الدرجة</th>
            <th>الامتحان من</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody id="tpGradesBody"></tbody>
      </table>
    </div>
    <div class="tp-details-section">
      <h3>سجل الفرص (أسباب الفقدان والإضافة)</h3>
      <table class="tp-details-table tp-logs-table">
        <thead>
          <tr>
            <th>الإجراء</th>
            <th>العدد</th>
            <th>السبب</th>
            <th>التاريخ</th>
            <th>الامتحان</th>
          </tr>
        </thead>
        <tbody id="tpLogsBody"></tbody>
      </table>
    </div>
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
  var titleEl = document.getElementById('tpModalTitle');
  var gradesBody = document.getElementById('tpGradesBody');
  var logsBody = document.getElementById('tpLogsBody');
  var closeBtn = document.getElementById('tpModalClose');

  var activeIndex = -1;
  var currentMatches = [];

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
      return d.toLocaleDateString('ar-IQ-u-nu-latn', {day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Baghdad'});
    } catch(e){ return esc(s); }
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
    currentMatches = matches;
    activeIndex = -1;
    if (matches.length === 0) {
      suggestionsEl.innerHTML = '<div class="tp-empty-search">لا يوجد طلاب مطابقون لهذا البحث</div>';
      suggestionsEl.classList.add('open');
      return;
    }
    var limit = Math.min(matches.length, 50);
    var html = '';
    for (var i = 0; i < limit; i++) {
      var s = matches[i];
      html += '<div class="tp-suggestion" data-idx="' + i + '">'
        + '<div class="tp-suggestion-name">' + esc(s.name) + '</div>'
        + '<div class="tp-suggestion-meta">الدورة: ' + esc(s.courseName || '—') + ' · الفرص: ' + fmtNum(s.opportunities) + '</div>'
        + '</div>';
    }
    if (matches.length > limit) {
      html += '<div class="tp-empty-search">و' + (matches.length - limit) + ' طالب آخر — ضيّق البحث أكثر</div>';
    }
    suggestionsEl.innerHTML = html;
    suggestionsEl.classList.add('open');
  }

  function hideSuggestions(){
    suggestionsEl.classList.remove('open');
    currentMatches = [];
    activeIndex = -1;
  }

  function renderStudentCard(student){
    var id = esc(student.id);
    var html = '<table>'
      + '<thead><tr>'
      + '<th>الطالب</th>'
      + '<th>الدورة</th>'
      + '<th>عدد الفرص</th>'
      + '<th>تفاصيل الطالب</th>'
      + '</tr></thead>'
      + '<tbody><tr>'
      + '<td>' + esc(student.name) + '</td>'
      + '<td>' + esc(student.courseName || '—') + '</td>'
      + '<td>' + fmtNum(student.opportunities) + '</td>'
      + '<td class="tp-details-cell"><button type="button" class="tp-details-btn" data-sid="' + id + '">إظهار التفاصيل</button></td>'
      + '</tr></tbody>'
      + '</table>';
    cardEl.innerHTML = html;
    cardEl.classList.add('visible');
  }

  function selectStudent(student){
    searchInput.value = student.name;
    hideSuggestions();
    hintEl.textContent = 'تم اختيار: ' + student.name + ' — اضغط زر «إظهار التفاصيل» لعرض درجاته وسجل فرصه.';
    renderStudentCard(student);
  }

  function handleSearchInput(){
    var q = searchInput.value;
    var wordCount = countWords(q);

    if (!q.trim()) {
      hideSuggestions();
      cardEl.classList.remove('visible');
      cardEl.innerHTML = '';
      hintEl.textContent = 'اكتب كلمتين على الأقل (الاسم واسم الأب) لعرض قائمة الطلاب المطابقين.';
      return;
    }

    if (wordCount < 2) {
      hideSuggestions();
      cardEl.classList.remove('visible');
      cardEl.innerHTML = '';
      hintEl.textContent = 'اكتب كلمة أخرى على الأقل (مثال: «محمد علي» بدل «محمد» فقط) لعرض قائمة الطلاب.';
      return;
    }

    hintEl.textContent = 'البحث يتجاهل اختلافات الكتابة العربية الشائعة، مع بقاء شرط الاسم الثنائي أو أكثر.';

    var matches = STUDENTS.filter(function(s){
      return matchesQuery(s, q);
    });

    renderSuggestions(matches);
  }

  function showDetails(studentId, studentLabel){
    var data = DATA[studentId];
    titleEl.textContent = 'تفاصيل الطالب' + (studentLabel ? ' · ' + studentLabel : '');

    if (data && data.grades && data.grades.length > 0) {
      gradesBody.innerHTML = data.grades.map(function(g){
        return '<tr>'
          + '<td>' + esc(g.examName) + '</td>'
          + '<td>' + esc(g.examType) + '</td>'
          + '<td>' + fmtDate(g.examDate) + '</td>'
          + '<td>' + fmtNum(g.score) + '</td>'
          + '<td>' + fmtNum(g.fullMark) + '</td>'
          + '<td>' + esc(g.status) + '</td>'
          + '</tr>';
      }).join('');
    } else {
      gradesBody.innerHTML = '<tr class="tp-empty-row"><td colspan="6">لا توجد امتحانات بحالة «درجة» أو «غائب» لهذا الطالب</td></tr>';
    }

    if (data && data.opportunityLogs && data.opportunityLogs.length > 0) {
      logsBody.innerHTML = data.opportunityLogs.map(function(l){
        return '<tr>'
          + '<td>' + esc(l.action) + '</td>'
          + '<td>' + fmtNum(l.amount) + '</td>'
          + '<td>' + esc(l.reason) + '</td>'
          + '<td>' + fmtDate(l.date) + '</td>'
          + '<td>' + esc(l.examName) + '</td>'
          + '</tr>';
      }).join('');
    } else {
      logsBody.innerHTML = '<tr class="tp-empty-row"><td colspan="5">لا يوجد سجل فرص لهذا الطالب</td></tr>';
    }

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDetails(){
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // البحث أثناء الكتابة (debounce خفيف).
  var debounceTimer = null;
  searchInput.addEventListener('input', function(){
    clearTimeout(debounceTimer);
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
    }
  });

  function updateActiveSuggestion(){
    var items = suggestionsEl.querySelectorAll('.tp-suggestion');
    items.forEach(function(item, i){
      item.classList.toggle('active', i === activeIndex);
    });
    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].scrollIntoView({ block: 'nearest' });
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
        if (firstCell) label = firstCell.textContent.trim();
      }
      showDetails(sid, label);
    }
  });

  closeBtn.addEventListener('click', closeDetails);
  overlay.addEventListener('click', function(e){
    if (e.target === overlay) closeDetails();
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeDetails();
  });

  // ركّز على خانة البحث عند فتح الملف.
  setTimeout(function(){ try { searchInput.focus(); } catch(e){} }, 100);
})();
</script>
`;

function buildHtml<T>(
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
  const hasDetails = Boolean(options.studentDetails);
  // عند تمرير studentList يصبح الملف في وضع "بحث + اختيار طالب واحد" بدل
  // عرض كل الطلاب دفعة واحدة. لا نعرض الجدول الكامل ولا العدد الكلي.
  const searchMode = Boolean(options.studentList && options.studentList.length > 0);

  const printableToolbar = options.printable
    ? `<div class="toolbar"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div>`
    : "";
  const printableScript = options.printable
    ? `<script>document.title=${escapeJsString(documentTitle)};try{window.history.replaceState(null,document.title,'/${encodeURIComponent(safeUrlName)}.pdf');}catch(e){}</script>`
    : "";

  const detailsDataScript = hasDetails
    ? `<script>window.STUDENT_DETAILS=${JSON.stringify(options.studentDetails || {})};</script>`
    : "";
  const studentListScript = searchMode
    ? `<script>window.STUDENT_LIST=${JSON.stringify(options.studentList || [])};</script>`
    : "";
  const detailsModalHtml = hasDetails ? DETAILS_MODAL_HTML : "";
  const detailsModalJs = hasDetails ? DETAILS_MODAL_JS : "";
  const detailsCss = hasDetails ? DETAILS_MODAL_CSS : "";

  // في وضع البحث لا نعرض الجدول الكامل ولا «عدد الصفوف» — فقط خانة البحث (داخل detailsModalHtml)
  // والجدول يُعرض ديناميكياً عند اختيار طالب.
  const mainTableHtml = searchMode
    ? ""
    : `<div class="table-wrap"><table><thead><tr>${columns
        .map((col) => `<th>${escapeHtml(humanizeTeacherProText(col.label))}</th>`)
        .join("")}</tr></thead><tbody>${buildTableRows(rows, columns, {
          hasDetails: false,
          getRowId: options.getRowId,
        })}</tbody></table></div>`;
  const metaLine = searchMode
    ? ""
    : `<div class="meta">عدد الصفوف: ${rows.length} | عدد الأعمدة: ${columns.length}</div>`;

  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(humanizeTeacherProText(documentTitle))}</title><style>
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
  </style>${printableScript}</head><body>${printableToolbar}<main class="report"><header class="report-header"><h1>${escapeHtml(humanizeTeacherProText(title))}</h1>${metaLine}</header>${mainTableHtml}${detailsModalHtml}${studentListScript}${detailsDataScript}${detailsModalJs}</main></body></html>`;
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

  useEffect(
    () => () => {
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
        onProgress: (loaded, total) => setExportProgress({ loaded, total, phase: "rows" }),
      });
      return loadedRows;
    } catch (error) {
      console.error("[ExportDialog] failed to fetch server export rows:", error);
      if (!(error instanceof Error && error.name === "AbortError")) {
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
      }
      setExporting(false);
      setExportProgress(null);
    }
  };

  /**
   * يجلب تفاصيل كل طالب (درجاته + سجل فرصه) على دفعات متوازية ليبني ملف
   * HTML مستقل يعمل أوفلاين. لا يُوقف العملية كاملة عند فشل طالب واحد.
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
        onProgress: (loaded, total) =>
          setExportProgress({ loaded, total, phase: "details" }),
      });
      return details;
    } catch (error) {
      console.error("[ExportDialog] failed to fetch student details:", error);
      if (!(error instanceof Error && error.name === "AbortError")) {
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
      }
      setExporting(false);
      setExportProgress(null);
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

  const exportHtml = async (exportRows: T[]) => {
    if (!ensureExportable(exportRows)) return;

    let detailsMap: StudentDetailsMap | null = null;
    if (fetchStudentDetails) {
      exportAbortController.current?.abort();
      const controller = new AbortController();
      exportAbortController.current = controller;
      detailsMap = await loadStudentDetails(exportRows, controller);
      if (exportAbortController.current === null && detailsMap === null) {
        // تم الإلغاء أو فشل التحميل — لا نكمل التصدير.
        return;
      }
    }

    // ننظّف نسخة التقرير فقط: لا تتغير الدرجات أو السجلات الأصلية في النظام.
    const reportDetailsMap = detailsMap
      ? sanitizeStudentDetailsForHtml(detailsMap)
      : null;

    // في وضع البحث نمرّر قائمة الطلاب (id + name + courseName + opportunities)
    // لاستخدامها في خانة البحث بدل عرض كل الطلاب دفعة واحدة.
    const idGetter = getRowId || ((row: T) => String((row as Record<string, unknown>)?.id ?? ""));
    const nameGetter = (row: T) => String((row as Record<string, unknown>)?.name ?? "");
    const courseGetter = (row: T) =>
      String((row as Record<string, unknown>)?.courseName ?? "");
    const oppGetter = (row: T) => {
      const v = (row as Record<string, unknown>)?.opportunities;
      return v === null || v === undefined ? "" : (v as number | string);
    };

    const studentList: StudentRowBasic[] | undefined = fetchStudentDetails
      ? exportRows.map((row) => ({
          id: idGetter(row),
          name: nameGetter(row),
          courseName: courseGetter(row),
          opportunities: oppGetter(row),
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
    const pendingPdfWindow = format === "pdf" ? window.open("", `${safeFileName}-pdf`) : null;
    if (pendingPdfWindow) {
      pendingPdfWindow.document.write("<p dir='rtl' style='font-family:sans-serif;padding:16px'>جاري تجهيز التقرير...</p>");
      pendingPdfWindow.document.close();
    }
    const exportRows = await loadExportRows();
    if (!exportRows) {
      pendingPdfWindow?.close();
      return;
    }
    if (format === "csv") exportCsv(exportRows);
    if (format === "excel") exportExcel(exportRows);
    if (format === "html") await exportHtml(exportRows);
    if (format === "pdf") exportPdf(exportRows, pendingPdfWindow);
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
        if (!nextOpen) exportAbortController.current?.abort();
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" disabled={disabled}>
          <Download className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-2 rounded-xl border bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <p className="text-muted-foreground">
              عدد النتائج التي ستُصدّر:{" "}
              <b>{totalRowCount ?? (fetchRows ? "يُحسب عند التصدير" : rows.length)}</b>
            </p>
            <p className="text-muted-foreground">
              الأعمدة المختارة: <b>{selectedColumns.length}</b> من <b>{columns.length}</b>
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
                onClick={() => exportAbortController.current?.abort()}
              >
                إلغاء التصدير
              </Button>
            </div>
          ) : null}

          <div className="space-y-2">
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
                ? " زر «تصدير HTML» يُنتج ملف بحث: تكتب الاسم الثنائي فما فوق فيظهر قائمة بالطلاب المطابقين، وعند اختيار طالب تظهر بياناته (الاسم + الدورة + عدد الفرص) مع زر «إظهار التفاصيل» يفتح درجاته وسجل فرصه."
                : ""}
            </p>
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap">
          {availableFormats.map((format) => {
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
