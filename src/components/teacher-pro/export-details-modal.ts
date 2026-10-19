// Inline CSS, markup and page script of the interactive «عرض التفاصيل» modal
// inside the exported HTML report. buildHtml (export-dialog.tsx) embeds them
// verbatim; the script runs in the downloaded file, not in the app.
import { DISMISSED_NO_GRADE_TEXT, DURING_DISMISSAL_GRADE_MARK } from "@/lib/student-report-presentation";
import { GRACE_PERIOD_EXCUSE_LABEL } from "@/lib/grace-periods";

/** A typed score kept for review and never counted. */
export const PENDING_GRADE_STATUS = "غير محتسبة";

export const DETAILS_MODAL_CSS = `
  .tp-search-report-body { padding: 24px; color: #142B25; background: #F1EEE2; font-weight: 400; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  .report-search-mode { max-width: 1120px; margin: auto; border-radius: 20px; border-color: #E6E3D9; padding: 28px; }
  .report-search-mode .report-header { display: block; text-align: center; border: 0; margin-bottom: 24px; }
  .report-search-mode h1 { color: #0A1A17; font-size: clamp(23px, 4dvw, 32px); overflow-wrap: anywhere; }
  .tp-report-intro { margin: 10px 0; color: #586A64; line-height: 1.9; font-size: 15px; }
  .tp-search-wrap { width: 100%; max-width: 700px; margin: 0 auto 24px; }
  .tp-search-label { display: block; margin-bottom: 10px; font-size: 16px; font-weight: 700; }
  .tp-search-input { width: 100%; min-height: 52px; padding: 14px 16px; font: inherit; font-size: 16px; border: 2px solid #586A64; border-radius: 12px; background: #FBF9EB; color: #142B25; }
  .tp-search-input:focus { border-color: #142B25; outline: 3px solid #CECFC8; outline-offset: 2px; }
  .tp-search-hint { font-size: 14px; color: #586A64; line-height: 1.8; margin: 10px 0; }
  .tp-suggestions { display: none; max-height: min(360px, 48dvh); overflow-y: auto; border: 1px solid #E6E3D9; border-radius: 12px; margin-top: 10px; background: #FBF9EB; overscroll-behavior: contain; }
  .tp-suggestions.open { display: block; }
  .tp-suggestion { min-height: 44px; padding: 14px; border-bottom: 1px solid #E6E3D9; cursor: pointer; overflow-wrap: anywhere; }
  .tp-suggestion:last-child { border-bottom: 0; }
  .tp-suggestion:hover, .tp-suggestion.active, .tp-suggestion[aria-selected="true"] { background: #E4E4D9; box-shadow: inset -3px 0 #142B25; }
  .tp-suggestion-name { font-weight: 700; line-height: 1.8; }
  .tp-suggestion-meta { font-size: 13px; color: #586A64; margin-top: 4px; line-height: 1.7; }
  .tp-dismissed-badge { display: inline-block; margin-inline-start: 6px; border: 1px solid #E7C3B4; border-radius: 999px; padding: 2px 10px; color: #A1543A; background: #F6E6DF; font-size: 12px; line-height: 1.8; vertical-align: middle; }
  .tp-empty-search { padding: 16px; color: #586A64; }
  .tp-student-card { display: none; max-width: 700px; margin: auto; }
  .tp-student-card.visible { display: block; }
  .tp-student-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid #E6E3D9; }
  .tp-student-summary-name { flex: 1 1 220px; min-width: 0; font-weight: 700; line-height: 1.8; overflow-wrap: anywhere; }
  .tp-student-summary-balance { white-space: nowrap; }
  .tp-student-summary .tp-details-btn { margin-inline-start: auto; }
  .tp-details-btn, .tp-modal-close { min-height: 44px; max-width: 100%; touch-action: manipulation; padding: 10px 16px; border: 1px solid #142B25; border-radius: 10px; background: #142B25; color: #FBF9EB; cursor: pointer; font-family: inherit; font-size: 14px; font-weight: 700; white-space: normal; }
  .tp-details-btn:hover, .tp-modal-close:hover { background: #0A1A17; }
  .tp-details-btn:focus-visible, .tp-modal-close:focus-visible { outline: 3px solid #586A64; outline-offset: 3px; }
  .tp-modal-overlay { position: fixed; inset: 0; z-index: 100; display: none; padding: 16px; background: #0A1A17C9; overflow: hidden; }
  .tp-modal-overlay.open { display: flex; }
  .tp-modal { width: 100%; max-width: 1120px; min-width: 0; max-height: 100%; margin: auto; padding: 0 24px 24px; background: #FBF9EB; border-radius: 18px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
  .tp-modal:focus { outline: none; }
  .tp-modal-header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 0; margin-bottom: 18px; border-bottom: 1px solid #E6E3D9; background: #FBF9EB; }
  .tp-modal-header h2 { min-width: 0; margin: 0; font-size: clamp(17px, 3dvw, 23px); line-height: 1.6; overflow-wrap: anywhere; }
  .tp-modal-close { flex-shrink: 0; }
  .tp-report-summary { display: grid; grid-template-columns: minmax(0, 320px); margin-bottom: 16px; }
  .tp-summary-item { min-width: 0; padding: 18px; background: #F1EEE2; border: 1px solid #E6E3D9; border-radius: 14px; overflow-wrap: anywhere; }
  .tp-summary-item strong { display: block; font-size: 20px; color: #0A1A17; line-height: 1.6; }
  .tp-summary-item:first-child { background: #E4E4D9; border-color: #ACB0AD; }
  .tp-summary-item:first-child strong { font-size: 32px; }
  .tp-summary-label { display: block; font-size: 13px; color: #586A64; margin-bottom: 6px; }
  .tp-details-section { min-width: 0; margin: 28px 0 0; scroll-margin-top: 90px; }
  .tp-details-section h3 { font-size: 20px; line-height: 1.7; color: #0A1A17; margin: 0 0 6px; }
  .tp-details-table { width: 100%; min-width: 0; table-layout: fixed; border-collapse: separate; border-spacing: 0; font-size: 14px; font-weight: 400; border: 1px solid #E6E3D9; border-radius: 12px; }
  .tp-details-table th, .tp-details-table td { padding: 13px 10px; border: 0; border-bottom: 1px solid #E6E3D9; text-align: right; line-height: 1.9; vertical-align: top; white-space: normal; overflow-wrap: anywhere; }
  .tp-details-table th { background: #F1EEE2; color: #0A1A17; font-weight: 700; }
  .tp-details-table tr:last-child td { border-bottom: 0; }
  .tp-details-table tr:nth-child(even) { background: #F6F4E7; }
  .tp-grades-table th:first-child { width: 35%; }
  .tp-grades-table th:nth-child(2) { width: 20%; }
  .tp-grades-table th:nth-child(3) { width: 15%; }
  .tp-grades-table th:last-child { width: 30%; }
  .tp-mobile-field-label { display: none; }
  .tp-mobile-field-value { min-width: 0; }
  .tp-grades-table tbody tr[class*="tp-grade-row-"] { background: #FFFFFF; }
  .tp-grades-table tbody tr.tp-grade-row-excused { background: #EEF6F1; }
  .tp-grades-table tbody tr.tp-grade-row-deducted { background: #F6E6DF; }
  .tp-grades-table tbody tr.tp-grade-row-dismissed { background: #F2DCD2; }
  .tp-grades-table tbody tr.tp-grade-row-dismissed > td:first-child { border-inline-start: 4px solid #A1543A; padding-inline-start: 14px; }
  .tp-grade-deduction .tp-mobile-field-value { color: #A1543A; font-weight: 700; }
  .tp-grade-dismissal .tp-mobile-field-value { color: #8A4430; font-weight: 800; }
  .tp-grade-no-deduction .tp-mobile-field-value { color: #1D6A4B; font-weight: 700; }
  /* One colour per result: passed green, failed amber, deducted red,
     dismissed deep red, excused blue, not counted grey. */
  .tp-grades-table tbody tr.tp-result-passed { background: #EEF6F1; }
  .tp-grades-table tbody tr.tp-result-failed { background: #F9F2E1; }
  .tp-grades-table tbody tr.tp-result-deducted { background: #F6E6DF; }
  .tp-grades-table tbody tr.tp-result-dismissed { background: #F2DCD2; }
  .tp-grades-table tbody tr.tp-result-excused { background: #E8F3F1; }
  .tp-grades-table tbody tr.tp-result-neutral { background: #FFFFFF; }
  .tp-grades-table tbody tr[class*="tp-result-"] > td:first-child { border-inline-start: 4px solid #CDD6D2; padding-inline-start: 14px; }
  .tp-grades-table tbody tr.tp-result-passed > td:first-child { border-inline-start-color: #2E9A6E; }
  .tp-grades-table tbody tr.tp-result-failed > td:first-child { border-inline-start-color: #B98A35; }
  .tp-grades-table tbody tr.tp-result-deducted > td:first-child { border-inline-start-color: #BD6548; }
  .tp-grades-table tbody tr.tp-result-dismissed > td:first-child { border-inline-start-color: #A1543A; }
  .tp-grades-table tbody tr.tp-result-excused > td:first-child { border-inline-start-color: #2A7473; }
  .tp-result-passed .tp-result-effect .tp-mobile-field-value { color: #1D6A4B; font-weight: 700; }
  .tp-result-failed .tp-result-effect .tp-mobile-field-value { color: #8A5F22; font-weight: 700; }
  .tp-result-deducted .tp-result-effect .tp-mobile-field-value { color: #A1543A; font-weight: 700; }
  .tp-result-dismissed .tp-result-effect .tp-mobile-field-value { color: #8A4430; font-weight: 800; }
  .tp-result-excused .tp-result-effect .tp-mobile-field-value { color: #1F6766; font-weight: 700; }
  .tp-result-neutral .tp-result-effect .tp-mobile-field-value { color: #586A64; font-weight: 600; }
  .tp-result-pill { display: inline-block; margin-inline-start: 6px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 700; line-height: 1.9; white-space: nowrap; }
  .tp-result-pill-passed { background: #E4F2EA; color: #1D6A4B; }
  .tp-result-pill-failed { background: #F3E4C3; color: #8A5F22; }
  .tp-result-pill-excused { background: #DCECEA; color: #1F6766; }
  .tp-result-pill-neutral { background: #E2E8E5; color: #586A64; }
  .tp-report-generated { margin: 6px 0 0; color: #586A64; font-size: 13px; }
  .tp-grades-table tbody tr.tp-timeline-event { background: #EAF4EF; }
  .tp-grades-table tbody tr.tp-timeline-event-reset { background: #E8F2F0; }
  .tp-grades-table tbody tr.tp-timeline-event-deduct { background: #F6E6DF; }
  .tp-timeline-event > td { border-inline-start: 4px solid #23805A; padding: 16px; }
  .tp-timeline-event-reset > td { border-inline-start-color: #4A6B63; }
  .tp-timeline-event-deduct > td { border-inline-start-color: #A1543A; }
  .tp-timeline-notice { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 6px 18px; }
  .tp-timeline-notice strong { color: #12372A; font-size: 14px; line-height: 1.9; }
  .tp-timeline-event-deduct strong { color: #A1543A; }
  .tp-timeline-notice time { color: #586A64; font-size: 12px; line-height: 1.8; }
  /* Each kind of row has its own colour and icon (as in the staff window):
     bonus violet, admin addition green, admin deduction amber, correction grey,
     exam deduction red, dismissal dark red, chapter start / return blue. */
  .tp-cat-bonus { --cat: #6F5F8E; --cat-ink: #63557E; --cat-tint: #EFEBF5; }
  .tp-cat-admin-add { --cat: #2E9A6E; --cat-ink: #1D6A4B; --cat-tint: #EAF6EF; }
  .tp-cat-admin-deduct { --cat: #B98A35; --cat-ink: #8A5F22; --cat-tint: #F9F0DC; }
  .tp-cat-undo { --cat: #6F7F79; --cat-ink: #586A64; --cat-tint: #EEF3F1; }
  .tp-cat-exam-deduct { --cat: #BD6548; --cat-ink: #A1543A; --cat-tint: #F6E6DF; }
  .tp-cat-exam-dismissal, .tp-cat-admin-dismissal { --cat: #A1543A; --cat-ink: #8A4430; --cat-tint: #F2DCD2; }
  .tp-cat-chapter-start, .tp-cat-return, .tp-cat-set { --cat: #2A7473; --cat-ink: #1F6766; --cat-tint: #E8F2F0; }
  .tp-grades-table tbody tr[class*="tp-cat-"]:not(.tp-cat-exam) { background: var(--cat-tint); }
  .tp-grades-table tbody tr[class*="tp-cat-"]:not(.tp-cat-exam) > td:first-child { border-inline-start-color: var(--cat); }
  .tp-timeline-event[class*="tp-cat-"] > td { border-inline-start-color: var(--cat); }
  .tp-timeline-event[class*="tp-cat-"] strong { color: var(--cat-ink); }
  .tp-row-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; margin-inline-end: 8px; border-radius: 9px; background: #EEECE3; color: #586A64; vertical-align: middle; }
  tr[class*="tp-cat-"]:not(.tp-cat-exam) .tp-row-icon { background: #FFFFFF; color: var(--cat); box-shadow: inset 0 0 0 1px var(--cat); }
  .tp-timeline-notice .tp-row-icon { align-self: center; }
  .tp-timeline-notice strong { flex: 1 1 220px; }
  .tp-delta { display: inline-block; margin-inline-start: 6px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--cat, #ACB0AD); background: #FFFFFF; color: var(--cat-ink, #142B25); font-size: 13px; font-weight: 800; line-height: 1.9; white-space: nowrap; font-variant-numeric: tabular-nums; }
  /* The sum: where the remaining opportunities came from. */
  .tp-sum { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; margin-bottom: 16px; padding: 10px; border: 1px solid #E6E3D9; border-radius: 16px; background: #F1EEE2; }
  .tp-sum-term { display: grid; align-content: center; gap: 2px; min-width: 78px; padding: 8px 12px; border-radius: 12px; border: 1px solid var(--cat, #ACB0AD); background: var(--cat-tint, #FFFFFF); text-align: center; }
  .tp-sum-term b, .tp-sum-term strong { color: var(--cat-ink, #0A1A17); font-size: 20px; font-weight: 900; line-height: 1.4; font-variant-numeric: tabular-nums; }
  .tp-sum-term small { color: #586A64; font-size: 12px; font-weight: 700; line-height: 1.5; }
  .tp-sum-eq { align-self: center; color: #586A64; font-size: 22px; font-weight: 900; }
  .tp-sum-result { border-width: 2px; border-color: #142B25; background: #FFFFFF; min-width: 96px; }
  .tp-sum-result strong { font-size: 26px; }
  .tp-event-title { display: block; font-weight: 700; color: #142B25; margin-bottom: 4px; }
  .tp-event-exam { display: block; font-size: 12px; color: #586A64; margin-top: 5px; }
  .tp-empty-row td { padding: 20px; color: #586A64; text-align: center; }
  .tp-error-row td { color: #A1543A; }
  @media (forced-colors: active) {
    .tp-search-input:focus, .tp-suggestion.active { outline: 2px solid CanvasText; outline-offset: 2px; }
    .tp-grades-table tbody tr.tp-grade-row-dismissed { outline: 2px solid CanvasText; outline-offset: -2px; }
  }
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
    .tp-details-table, .tp-details-table tbody, .tp-details-table tr { display: block; width: 100%; min-width: 0; }
    .tp-details-table { border: 0; background: transparent; }
    .tp-details-table thead { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .tp-details-table tr { border: 1px solid #E6E3D9; border-radius: 12px; margin-bottom: 12px; padding: 6px 12px; background: #FBF9EB; }
    .tp-grades-table tbody tr.tp-grade-row-dismissed { border-color: #A1543A; border-inline-start-width: 4px; }
    .tp-grades-table tbody tr.tp-grade-row-dismissed > td:first-child { border-inline-start: 0; padding-inline-start: 0; }
    .tp-grades-table tbody tr[class*="tp-result-"] { border-inline-start-width: 4px; }
    .tp-grades-table tbody tr.tp-result-passed { border-inline-start-color: #2E9A6E; }
    .tp-grades-table tbody tr.tp-result-failed { border-inline-start-color: #B98A35; }
    .tp-grades-table tbody tr.tp-result-deducted { border-inline-start-color: #BD6548; }
    .tp-grades-table tbody tr.tp-result-dismissed { border-color: #A1543A; }
    .tp-grades-table tbody tr.tp-result-excused { border-inline-start-color: #2A7473; }
    .tp-grades-table tbody tr[class*="tp-result-"] > td:first-child { border-inline-start: 0; padding-inline-start: 0; }
    .tp-details-table tr:not(.tp-empty-row) td { display: grid; grid-template-columns: minmax(96px, 38%) minmax(0, 1fr); gap: 10px; width: 100%; min-width: 0; min-height: 44px; padding: 10px 0; border: 0; border-bottom: 1px solid #E6E3D9; }
    .tp-mobile-field-label { display: block; color: #586A64; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
    .tp-mobile-field-value { display: block; overflow-wrap: anywhere; }
    .tp-details-table tr:last-child td { border-bottom: 1px solid #E6E3D9; }
    .tp-details-table tr td:last-child { border-bottom: 0; }
    .tp-details-table tr.tp-timeline-event { padding: 12px 14px; border-inline-start: 4px solid #23805A; }
    .tp-details-table tr.tp-timeline-event-reset { border-inline-start-color: #4A6B63; }
    .tp-details-table tr.tp-timeline-event-deduct { border-inline-start-color: #A1543A; }
    .tp-details-table tr.tp-timeline-event > td { display: block; min-height: 0; padding: 0; border: 0; }
    .tp-timeline-notice { display: grid; gap: 5px; }
  }
  @media screen and (max-width: 420px) { .tp-details-table tr:not(.tp-empty-row) td { grid-template-columns: minmax(76px, 32%) minmax(0, 1fr); gap: 8px; } }
`;

export const DETAILS_MODAL_HTML = `
<div class="tp-search-wrap">
  <label class="tp-search-label" for="tpStudentSearch">البحث عن الطالب</label>
  <input type="text" id="tpStudentSearch" class="tp-search-input" autocomplete="off" placeholder="أدخل الاسم الثنائي أو الكامل" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tpSuggestions" aria-describedby="tpSearchHint">
  <div id="tpSuggestions" class="tp-suggestions" role="listbox" aria-label="الطلاب المطابقون"></div>
  <p class="tp-search-hint" id="tpSearchHint" role="status" aria-live="polite">يرجى إدخال الاسم الثنائي أو الكامل، ثم اختيار الطالب من النتائج.</p>
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

export const DETAILS_MODAL_JS = `
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
  function fmtEventDate(s){
    var date = fmtDate(s);
    if (!s || String(s).indexOf('T') < 0) return date;
    var d = new Date(s);
    if (isNaN(d.getTime())) return date;
    try {
      return date + ' · ' + d.toLocaleTimeString('ar-EG-u-nu-latn', {hour:'numeric',minute:'2-digit',timeZone:'Asia/Baghdad'});
    } catch(e){ return date; }
  }

  // Use the same Baghdad calendar day the student sees, never the hidden
  // result-entry day. Recorded times may only order rows within that day.
  function timelineDay(s){
    var date = new Date(s);
    if (!s || isNaN(date.getTime())) return '';
    var parts = new Intl.DateTimeFormat('en-US', {
      year:'numeric', month:'2-digit', day:'2-digit', timeZone:'Asia/Baghdad'
    }).formatToParts(date);
    return ['year', 'month', 'day'].map(function(type){
      return parts.find(function(part){ return part.type === type; }).value;
    }).join('-');
  }

  function mobileCell(label, valueHtml, extraClass, afterHtml){
    var className = extraClass ? ' class="' + extraClass + '"' : '';
    return '<td role="cell" data-label="' + esc(label) + '"' + className + '>'
      + '<span class="tp-mobile-field-label" aria-hidden="true">' + esc(label) + '</span>'
      + '<span class="tp-mobile-field-value">' + valueHtml + '</span>'
      + (afterHtml || '')
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
      hintEl.textContent = 'ماكو طلاب مطابقون لهذا البحث.';
      return;
    }
    var html = '';
    for (var i = 0; i < limit; i++) {
      var s = currentMatches[i];
      html += '<div class="tp-suggestion" id="tpSuggestion-' + i + '" role="option" aria-selected="false" data-idx="' + i + '">'
        + '<div class="tp-suggestion-name">' + esc(s.name) + ' ' + dismissedBadgeHtml(s) + '</div>'
        + '<div class="tp-suggestion-meta">' + (s.code ? esc(s.code) + ' · ' : '') + 'اسم الدورة: ' + esc(s.courseName || '—') + ' · الفرص: ' + fmtNum(s.opportunities) + (isDismissed(s) ? ' · الطالب مفصول' : '') + '</div>'
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

  function renderStudentCard(student){
    var id = esc(student.id);
    var html = '<div class="tp-student-summary" role="group" aria-label="الطالب المختار">'
      + '<span class="tp-student-summary-name">' + esc(student.name) + dismissedBadgeHtml(student) + '</span>'
      + '<span class="tp-student-summary-balance">فرصك: <strong>' + fmtNum(student.opportunities) + '</strong></span>'
      + '<button type="button" class="tp-details-btn" data-sid="' + id + '">افتح التفاصيل</button>'
      + '</div>';
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
      hintEl.textContent = 'يرجى إدخال الاسم الثنائي أو الكامل، ثم اختيار الطالب من النتائج.';
      return;
    }

    if (wordCount < 2) {
      hideSuggestions();
      cardEl.classList.remove('visible');
      cardEl.innerHTML = '';
      hintEl.textContent = 'يرجى إدخال مقطعين من اسم الطالب على الأقل لعرض النتائج.';
      return;
    }

    hintEl.textContent = 'يرجى اختيار الطالب من النتائج.';

    var matches = STUDENTS.filter(function(s){
      return matchesQuery(s, q);
    });

    renderSuggestions(matches);
  }

  // Each kind of row has its own colour and icon, as in the staff window.
  var CATS = ['exam', 'exam-deduct', 'exam-dismissal', 'bonus', 'admin-add', 'admin-deduct', 'undo', 'admin-dismissal', 'chapter-start', 'return', 'set'];
  var ICON_PATHS = {
    exam: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    minus: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'
  };
  var CAT_ICON = { exam: 'exam', 'exam-deduct': 'minus', 'exam-dismissal': 'ban', bonus: 'star', 'admin-add': 'plus', 'admin-deduct': 'minus', undo: 'undo', 'admin-dismissal': 'ban', 'chapter-start': 'flag', 'return': 'flag', 'set': 'flag' };
  function rowIcon(cat){
    var name = CAT_ICON[cat] || 'exam';
    return '<span class="tp-row-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON_PATHS[name] + '</svg></span>';
  }
  function deltaChip(delta, cat){
    if (delta === null || delta === undefined || !isFinite(delta) || Number(delta) === 0) return '';
    var value = Number(delta);
    return ' <span class="tp-delta"><bdi dir="ltr">' + (cat === 'bonus' ? '⭐ ' : '') + (value > 0 ? '+' : '−') + fmtNum(Math.abs(value)) + '</bdi></span>';
  }

  function showDetails(studentId, studentLabel){
    var data = DATA[studentId];
    var student = STUDENTS.find(function(s){ return String(s.id) === String(studentId); }) || {};
    var balance = student.opportunities;
    var status = student.status;
    var badgeEl = document.getElementById('tpModalDismissedBadge');
    var overview = document.getElementById('tpStudentOverview');
    var gradesTitleEl = document.getElementById('tpGradesSectionTitle');
    if (badgeEl) badgeEl.style.display = status === 'مفصول' ? '' : 'none';
    if (titleTextEl) titleTextEl.textContent = studentLabel || student.name || 'درجاتك وفرصك';
    if (gradesTitleEl) gradesTitleEl.textContent = data && data.activeChapterName ? 'درجاتك — ' + data.activeChapterName : 'درجاتك في الامتحانات';
    if (overview) {
      var sum = data && data.sum;
      if (sum && sum.opening !== null && sum.opening !== undefined) {
        // Where the remaining opportunities came from, when the record adds up.
        var terms = [
          { v: sum.opening, s: '', l: sum.openingLabel || 'بداية الفصل', c: 'chapter-start' },
          { v: sum.examDeducted, s: '−', l: 'خُصمت بالامتحانات', c: 'exam-deduct' },
          { v: sum.adminDeducted, s: '−', l: 'خصمت الإدارة', c: 'admin-deduct' },
          { v: sum.adminAdded, s: '+', l: 'أضافت الإدارة', c: 'admin-add' },
          { v: sum.bonus, s: '+', l: 'فرص مكافأة', c: 'bonus' }
        ].filter(function(term, index){ return index === 0 || term.v > 0; });
        overview.innerHTML = '<div class="tp-sum" aria-label="من وين جات فرصك المتبقية">'
          + terms.map(function(term){
            return '<span class="tp-sum-term tp-cat-' + term.c + '"><b dir="ltr">' + term.s + fmtNum(term.v) + '</b><small>' + esc(term.l) + '</small></span>';
          }).join('')
          + '<span class="tp-sum-eq" aria-hidden="true">=</span>'
          + '<span class="tp-sum-term tp-sum-result"><strong>' + fmtNum(balance) + '</strong><small>فرصك المتبقية</small></span></div>';
      } else {
        overview.innerHTML = '<div class="tp-report-summary">'
          + '<div class="tp-summary-item"><span class="tp-summary-label">فرصك المتبقية</span><strong>' + fmtNum(balance) + '</strong></div></div>';
      }
    }
    if (!data) {
      gradesBody.innerHTML = '<tr class="tp-empty-row tp-error-row" role="row"><td colspan="4" role="cell">تفاصيل هذا الطالب غير موجودة في هذه النسخة. اطلب نسخة جديدة من الإدارة.</td></tr>';
    } else {
      var timeline = (data.grades || []).map(function(g, index){
        return { grade: g, day: timelineDay(g.examDate), date: g.timelineDate || g.examDate, order: index, event: null };
      }).concat((data.timelineEvents || []).map(function(event, index){
        return { event: event, day: timelineDay(event.date), date: event.date, order: index, grade: null };
      }));
      timeline.sort(function(a, b){
        var dayDifference = a.day.localeCompare(b.day);
        var difference = (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
        return dayDifference || difference || (a.event && !b.event ? -1 : !a.event && b.event ? 1 : a.order - b.order);
      });
      gradesBody.innerHTML = timeline.map(function(entry){
        if (entry.event) {
          var event = entry.event;
          var kind = ['add', 'return', 'reset', 'deduct'].indexOf(event.kind) >= 0 ? event.kind : 'reset';
          var eventCat = CATS.indexOf(event.cat) >= 0 ? event.cat : '';
          return '<tr role="row" class="tp-timeline-event tp-timeline-event-' + kind + (eventCat ? ' tp-cat-' + eventCat : '') + '"><td colspan="4" role="cell">'
            + '<div class="tp-timeline-notice">' + rowIcon(eventCat || (kind === 'add' ? 'admin-add' : kind === 'deduct' ? 'admin-deduct' : 'chapter-start'))
            + '<strong>' + esc(event.text) + '</strong>'
            + '<time datetime="' + esc(event.date) + '">' + fmtEventDate(event.date) + '</time>'
            + deltaChip(event.delta, eventCat) + '</div></td></tr>';
        }
        var g = entry.grade;
        var excused = g.status === 'مجاز' || g.status === ${JSON.stringify(GRACE_PERIOD_EXCUSE_LABEL)} || g.status === 'قبل تسجيل الطالب';
        var tone = ['ordinary', 'excused', 'deducted', 'dismissed'].indexOf(g.opportunityTone) >= 0 ? g.opportunityTone : 'ordinary';
        // One result decides the colour of the whole row.
        var result = tone === 'dismissed' ? 'dismissed'
          : tone === 'deducted' ? 'deducted'
          : excused || tone === 'excused' ? 'excused'
          : g.outcome === 'ناجح' || g.outcome === 'الدرجة كاملة' ? 'passed'
          : g.outcome === 'راسب' || g.status === 'غائب' || g.status === 'غش' ? 'failed'
          : 'neutral';
        var pill = g.outcome === 'ناجح' || g.outcome === 'الدرجة كاملة' ? '<span class="tp-result-pill tp-result-pill-passed">' + esc(g.outcome) + '</span>'
          : g.outcome === 'راسب' ? '<span class="tp-result-pill tp-result-pill-failed">راسب</span>' : '';
        // A score typed during a dismissal: on record only, so no pass/fail pill.
        var score = g.status === 'غش' ? 'غش' : g.score === null || g.score === undefined
          ? (g.status === 'مجاز' ? 'إجازة' : g.status === ${JSON.stringify(GRACE_PERIOD_EXCUSE_LABEL)} ? 'مجاز فترة سماح' : g.status === 'غائب' ? 'غياب' : g.status === ${JSON.stringify(PENDING_GRADE_STATUS)} ? ${JSON.stringify(PENDING_GRADE_STATUS)} : g.status === ${JSON.stringify(DISMISSED_NO_GRADE_TEXT)} ? ${JSON.stringify(DISMISSED_NO_GRADE_TEXT)} : 'بانتظار الدرجة')
          : g.duringDismissal === true
          ? '<bdi>' + fmtNum(g.score) + ' / ' + fmtNum(g.fullMark) + '</bdi> ' + ${JSON.stringify(DURING_DISMISSAL_GRADE_MARK)}
          : '<bdi>' + fmtNum(g.score) + ' / ' + fmtNum(g.fullMark) + '</bdi>' + pill;
        var effectText = String(g.opportunityEffect || 'لا تتوفر تفاصيل الأثر في هذه النسخة.').trim();
        var gradeCat = CATS.indexOf(g.cat) >= 0 ? g.cat : '';
        return '<tr role="row" class="tp-grade-row-' + tone + ' tp-result-' + result + (gradeCat ? ' tp-cat-' + gradeCat : '') + '">'
          + mobileCell('الامتحان', rowIcon(gradeCat || 'exam') + '<strong class="tp-event-title">' + esc(g.examName) + '</strong><span class="tp-event-exam">' + esc(g.examType) + '</span>')
          + mobileCell('تاريخ الامتحان', fmtDate(g.examDate) || 'غير مسجّل')
          + mobileCell('الدرجة', score)
          + mobileCell('الأثر على الفرص', esc(effectText), 'tp-result-effect', deltaChip(g.delta, gradeCat))
          + '</tr>';
      }).join('');
      if (!data.grades || !data.grades.length) gradesBody.innerHTML += '<tr class="tp-empty-row" role="row"><td colspan="4" role="cell">ماكو امتحانات لعرضها في هذه النسخة.</td></tr>';
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

  // إعادة فتح تفاصيل الطالب المختار من السطر المختصر.
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('.tp-details-btn');
    if (btn) {
      var sid = btn.getAttribute('data-sid') || '';
      showDetails(sid);
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
