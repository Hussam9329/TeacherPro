"use client";

import type React from "react";
import { type Student, type Grade, type StudentLeave } from "@/lib/teacher-store";
import { type GradeSmartNoteRecord } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  SearchX,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { LoadingState, EmptyState } from "@/components/teacher-pro/ui-kit";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { editableGradeNote, isAutomaticGradeNote, withInternalGradeNotePrefix } from "@/lib/grade-note-banners";
import { studentCount, toLatinDigits } from "@/lib/format";
import {
  isGradeEntered,
  isExamOnOrAfterStudentRegistration,
  findExamGracePeriod,
  studentMatchesExamMainSites,
  splitSelection,
  isScoreInsideExamRange,
} from "@/lib/exam-utils";
import { describeExamGraceExclusion, GRACE_PERIOD_EXCUSE_LABEL, formatGraceDate } from "@/lib/grace-periods";
import { type Exam } from "@/lib/teacher-store";
import {
  formatGradeEntryTimestamp,
  normalizeGradeScoreInput,
  type DraftGrade,
  type GradeEntryNotice,
  type GradeRowSavePhase,
  type GradeRowSaveState,
} from "./grade-entry-shared";

export type GradeEntrySheetProps = {
  examStudents: Student[];
  entrySheetLoading: boolean;
  entrySheetError: string | null;
  visibleExamStudents: Student[];
  getGrade: (studentId: string) => Grade | undefined;
  getDraft: (studentId: string) => DraftGrade;
  getStudentLeaveForSelectedExam: (studentId: string) => StudentLeave | undefined;
  selectedExam: Exam;
  classification: (grade: Grade | undefined, exam: Exam, student?: Student) => { text: string; type: string; kind: string; baseText?: string; };
  savingRows: Record<string, boolean>;
  rowSaveStates: Record<string, GradeRowSaveState>;
  latestSmartNoteByStudentId: Map<string, GradeSmartNoteRecord>;
  canEditGradeForStudent: (studentId: string) => boolean;
  openNoteRows: Record<string, boolean>;
  studentHasManualReactivation: (studentId: string) => boolean;
  courseName: (id: string) => string;
  normalizedSearch: string;
  activeChapterCourseIds: Set<string>;
  gradeInputRefs: React.RefObject<Record<string, HTMLInputElement | null>>;
  showGradeEntryNotice: (type: GradeEntryNotice["type"], message: string) => void;
  updateDraft: (studentId: string, patch: Partial<DraftGrade>) => void;
  autoSaveGrade: (studentId: string, draftOverride?: DraftGrade) => void;
  saveGrade: (studentId: string, draftOverride?: DraftGrade, options?: { silent?: boolean; skipReactivationWarning?: boolean; }) => Promise<void>;
  focusRelativeGradeInput: (studentId: string, direction?: 1 | -1) => boolean;
  applyRowStatus: (studentId: string, draft: DraftGrade, pressed: "\u063A\u0627\u0626\u0628" | "\u063A\u0634") => void;
  canManageLeaves: boolean;
  setLeaveRequest: React.Dispatch<React.SetStateAction<{ studentId: string; reason: string; } | null>>;
  savedRows: Record<string, string>;
  setOpenNoteRows: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  entryTotalPages: number;
  safeEntryPage: number;
  setEntryPage: React.Dispatch<React.SetStateAction<number>>;
  entryPageSize: number;
  setEntryPageSize: React.Dispatch<React.SetStateAction<number>>;
};

export function GradeEntrySheet({
  examStudents,
  entrySheetLoading,
  entrySheetError,
  visibleExamStudents,
  getGrade,
  getDraft,
  getStudentLeaveForSelectedExam,
  selectedExam,
  classification,
  savingRows,
  rowSaveStates,
  latestSmartNoteByStudentId,
  canEditGradeForStudent,
  openNoteRows,
  studentHasManualReactivation,
  courseName,
  normalizedSearch,
  activeChapterCourseIds,
  gradeInputRefs,
  showGradeEntryNotice,
  updateDraft,
  autoSaveGrade,
  saveGrade,
  focusRelativeGradeInput,
  applyRowStatus,
  canManageLeaves,
  setLeaveRequest,
  savedRows,
  setOpenNoteRows,
  entryTotalPages,
  safeEntryPage,
  setEntryPage,
  entryPageSize,
  setEntryPageSize,
}: GradeEntrySheetProps) {
  return (
    <section className="tp-grade-sheet" aria-label={`ورقة إدخال الدرجة - ${studentCount(examStudents.length)}`}>
        {entrySheetLoading && (
          <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-sm font-medium text-primary">
            جاري تحميل ورقة إدخال الدرجات...
          </div>
        )}
        {entrySheetError && (
          <div className="mb-4 rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-sm font-medium text-danger">
            {entrySheetError}
          </div>
        )}
        {examStudents.length > 0 && (
          <p className="mb-3 text-sm text-muted-foreground" data-count-scope="page">
            المعروض{" "}
            <strong className="tabular-nums text-foreground">
              {visibleExamStudents.length}
            </strong>{" "}
            من{" "}
            <strong className="tabular-nums text-foreground">
              {examStudents.length}
            </strong>{" "}
            طالب
          </p>
        )}
        <div className="space-y-2">
          {examStudents.length === 0 ? (
            entrySheetLoading ? (
              <LoadingState title="جاري تجهيز ورقة إدخال الدرجة..." />
            ) : (
              <EmptyState
                icon={entrySheetError ? AlertCircle : SearchX}
                title={entrySheetError
                  ? "تعذر تحميل طلاب هذا الامتحان."
                  : "ماكو طلاب مطابقون للفلاتر أو للدورات المربوطة بفصل نشط."}
              />
            )
          ) : (
            visibleExamStudents.map((student) => {
              const grade = getGrade(student.id);
              const draft = getDraft(student.id);
              const leave = getStudentLeaveForSelectedExam(student.id);
              const entered = !leave && isGradeEntered(grade, selectedExam);
              const cls = leave
                ? { text: "الطالب مجاز", type: "info", kind: "leave" }
                : entered && grade
                  ? classification(grade, selectedExam, student)
                  : null;
              const isSaving = Boolean(savingRows[student.id]);
              const explicitSaveState = rowSaveStates[student.id];
              const rowSmartNote = latestSmartNoteByStudentId.get(student.id);
              const effectiveSaveState =
                explicitSaveState?.phase === "pending" &&
                rowSmartNote?.status !== "PENDING"
                  ? undefined
                  : explicitSaveState;
              const savePhase: GradeRowSavePhase = isSaving
                ? "saving"
                : effectiveSaveState?.phase ||
                  (rowSmartNote?.status === "PENDING"
                    ? "pending"
                    : entered
                      ? "saved"
                      : "idle");
              const examBeforeRegistration =
                !isExamOnOrAfterStudentRegistration(student, selectedExam);
              const gracePeriod = leave
                ? null
                : findExamGracePeriod(student, selectedExam);
              const canEditPersistedGrade =
                canEditGradeForStudent(student.id) &&
                !examBeforeRegistration &&
                !leave &&
                student.status !== "مفصول";
              const protectedNumericCapture = Boolean(
                leave ||
                  examBeforeRegistration ||
                  student.status === "مفصول",
              );
              const siteLabel =
                student.subSite ||
                student.locationScope ||
                student.mainSite ||
                "";
              // صفوف الالتقاط المحمي لطلبة الفصل: الحفظ تلقائي عند
              // الخروج من الخلية — بلا زر حفظ يدوي ولا سطر تلميح منفصل؛
              // شارة الحالة وحدها تكفي.
              const isAutoSaveCaptureRow =
                protectedNumericCapture && student.status === "مفصول";
              // الإدخال المباشر للجميع دون استثناء: أُزيل القفل الذي كان
              // يفرض الضغط على «تعديل» قبل كتابة الدرجة. كل قيود
              // الصلاحيات الحقيقية (مؤرشف/مفصول/قبل التسجيل) تبقى مطبقة.
              const numericEntryMode =
                protectedNumericCapture || draft.status === "درجة";
              const numericInputDisabled =
                !canEditPersistedGrade && !protectedNumericCapture;
              const structuredControlsDisabled = !canEditPersistedGrade;
              const notesInputDisabled =
                !canEditPersistedGrade && !protectedNumericCapture;
              const leaveBlocked =
                student.status === "مفصول" || student.status === "مؤرشف";
              const noteOpen = Boolean(openNoteRows[student.id]);
              const hasNote = Boolean(editableGradeNote(draft.notes).trim());
              return (
                <div
                  key={student.id}
                  className="teacherpro-heavy-row tp-save-row tp-grade-row"
                  data-save-state={savePhase}
                  data-dismissed={student.status === "مفصول" || undefined}
                >
                  <div className="tp-grade-row__who min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 break-words text-sm font-bold [overflow-wrap:anywhere]">
                        {student.name}
                      </p>
                      {examBeforeRegistration && (
                        <Badge
                          variant="outline"
                          className="border-info-line bg-info-soft text-[10px] text-info"
                          title="هذا الامتحان يسبق تسجيل الطالب؛ عند إدخال درجة تُقدَّم نهاية تسجيله إلى تاريخ الامتحان وتُحتسب رسمياً في سجله. الغياب والغش غير متاحين هنا."
                        >
                          قبل تسجيله
                        </Badge>
                      )}
                      {gracePeriod && (
                        <Badge
                          variant="warning"
                          className="text-[10px]"
                          title={`${describeExamGraceExclusion(gracePeriod)}.`}
                        >
                          {GRACE_PERIOD_EXCUSE_LABEL} لغاية{" "}
                          {formatGraceDate(gracePeriod.endDate)} · خارج المحاسبة
                        </Badge>
                      )}
                      {student.status === "مفصول" && (
                        <Badge
                          variant="destructive"
                          className="text-[10px]"
                          title="أي درجة تنكتب لهذا الطالب تبقى معلّقة لحد ما ترجّعه الإدارة."
                        >
                          مفصول
                        </Badge>
                      )}
                      {studentHasManualReactivation(student.id) && (
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          title="رجّعته الإدارة بقرار يدوي؛ فصله مرة ثانية يحتاج قرار يدوي."
                        >
                          إرجاع يدوي
                        </Badge>
                      )}
                      {rowSmartNote?.status === "PENDING" && (
                        <Badge
                          variant="outline"
                          className="border-warning-line bg-warning-soft text-[10px] text-warning"
                        >
                          درجة معلّقة: {rowSmartNote.score ?? "—"}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      <bdi>{student.code}</bdi> · {courseName(student.courseId)}
                      {siteLabel ? ` · ${siteLabel}` : ""}
                    </p>
                    {normalizedSearch &&
                      grade &&
                      (!selectedExam.courseIds.includes(student.courseId) ||
                        !activeChapterCourseIds.has(student.courseId) ||
                        !studentMatchesExamMainSites(
                          student,
                          splitSelection(selectedExam.mainSite),
                        ) ||
                        student.status === "مؤرشف") && (
                        <p className="mt-1 text-[11px] text-warning">
                          له درجة مسجلة على هذا الامتحان، لذا ظهر حتى لو
                          لم يعد مطابقاً للدورة أو الموقع أو الفصل الحالي.
                        </p>
                      )}
                  </div>

                  <Input
                    ref={(element) => {
                      gradeInputRefs.current[student.id] = element;
                    }}
                    type={numericEntryMode ? "number" : "text"}
                    min={0}
                    max={selectedExam.fullMark}
                    step={1}
                    disabled={numericInputDisabled}
                    value={numericEntryMode ? draft.score : draft.status}
                    onChange={(e) => {
                      const nextScore = normalizeGradeScoreInput(
                        e.target.value,
                        selectedExam.fullMark,
                      );
                      if (
                        nextScore !== toLatinDigits(e.target.value).trim()
                      ) {
                        showGradeEntryNotice(
                          "error",
                          `درجة الطالب يجب أن تكون بين 0 و ${selectedExam.fullMark}`,
                        );
                      }
                      // ROOT-CAUSE FIX: When the teacher types a new score
                      // for a student whose previous status was a marker
                      // (غائب / غش / مجاز / قبل التسجيل),
                      // the draft.notes was initialized from the existing
                      // row's stale "تسجيل جماعي كغائب" note. Sending that
                      // note back to the API would leave the saved row with
                      // a real numeric grade BUT a contradictory "absent"
                      // note. Clear the notes here so the server gets a
                      // fresh empty value and applies its own sanitization
                      // (which clears the stale note — no automatic note).
                      const existing = getGrade(student.id);
                      const previousStatusWasMarker = Boolean(
                        existing && existing.status !== "درجة",
                      );
                      const hadStaleAbsenceNote =
                        previousStatusWasMarker &&
                        isAutomaticGradeNote(existing?.notes);
                      updateDraft(student.id, {
                        score: nextScore,
                        status: "درجة",
                        // Clear the stale note when transitioning from a
                        // marker status to a real grade. A user-typed
                        // note in the same row will be re-typed and
                        // saved as a fresh value.
                        ...(hadStaleAbsenceNote ? { notes: "" } : {}),
                      });
                    }}
                    onBlur={() => autoSaveGrade(student.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveGrade(student.id);
                      }
                      if (event.key === "Tab") {
                        const focused = focusRelativeGradeInput(
                          student.id,
                          event.shiftKey ? -1 : 1,
                        );
                        if (focused) event.preventDefault();
                      }
                    }}
                    placeholder={
                      numericEntryMode
                        ? `0 - ${selectedExam.fullMark}`
                        : draft.status
                    }
                    className="tp-grade-row__score h-10"
                  />

                  {/* غائب / مجاز / غش: one tap. The same rules as before:
                      a status clears the score and saves at once; مجاز
                      records an exam leave through the leaves system. */}
                  <div
                    className="tp-grade-row__status"
                    role="group"
                    aria-label={`حالة ${student.name} بهذا الامتحان`}
                  >
                    <button
                      type="button"
                      className="tp-grade-row__seg"
                      aria-pressed={!leave && draft.status === "غائب"}
                      disabled={structuredControlsDisabled}
                      onClick={() => applyRowStatus(student.id, draft, "غائب")}
                    >
                      غائب
                    </button>
                    <button
                      type="button"
                      className="tp-grade-row__seg"
                      data-tone="leave"
                      aria-pressed={Boolean(leave)}
                      disabled={!leave && (leaveBlocked || !canManageLeaves)}
                      title={
                        leave
                          ? "مجاز لهذا الامتحان. كتابة الدرجة تنهي الإجازة وتُحتسب الدرجة."
                          : !canManageLeaves
                            ? "تسجيل الإجازة يحتاج صلاحية إدارة الإجازات."
                            : leaveBlocked
                              ? "ما تنسجل إجازة لطالب مفصول أو مؤرشف."
                              : "تسجيل الطالب مجاز لهذا الامتحان"
                      }
                      onClick={() => {
                        if (leave) {
                          showGradeEntryNotice(
                            "info",
                            "الطالب مجاز لهذا الامتحان. لإنهاء الإجازة اكتب درجته، أو عدّلها من نافذة الإجازات.",
                          );
                          return;
                        }
                        setLeaveRequest({ studentId: student.id, reason: "" });
                      }}
                    >
                      مجاز
                    </button>
                    <button
                      type="button"
                      className="tp-grade-row__seg"
                      aria-pressed={!leave && draft.status === "غش"}
                      disabled={structuredControlsDisabled}
                      onClick={() => applyRowStatus(student.id, draft, "غش")}
                    >
                      غش
                    </button>
                  </div>

                  <div className="tp-grade-row__end">
                    {cls &&
                      !(gracePeriod && cls.kind === "grace") &&
                      cls.kind !== "leave" &&
                      // The lit button already says غائب / غش.
                      cls.text !== "غائب" &&
                      cls.text !== "غش" && (
                        <Badge
                          variant={
                            cls.type === "ok"
                              ? "default"
                              : cls.type === "danger"
                                ? "destructive"
                                : cls.type === "warn"
                                  ? "secondary"
                                  : "outline"
                          }
                        >
                          {cls.text}
                        </Badge>
                      )}
                    <Badge
                      variant="outline"
                      title={
                        [
                          leave
                            ? `الطالب مجاز لهذا الامتحان — إدخال درجة ينهي الإجازة وتُحتسب الدرجة في سجله${leave.reason ? `: ${leave.reason}` : ""}`
                            : "",
                          isAutoSaveCaptureRow ? "تُحفظ الدرجة تلقائياً عند الخروج من الخلية." : "",
                          grade?.createdAt ? `وقت الإدخال: ${formatGradeEntryTimestamp(grade.createdAt)}` : "",
                          grade?.updatedAt && grade?.createdAt && String(grade.updatedAt) !== String(grade.createdAt)
                            ? `آخر تعديل: ${formatGradeEntryTimestamp(grade.updatedAt)}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join("\n") || undefined
                      }
                      className={`tp-save-indicator ${
                        savePhase === "saving"
                          ? "tp-save-indicator--saving"
                          : savePhase === "saved"
                            ? "tp-save-indicator--saved"
                            : savePhase === "queued"
                              ? "border-info-line bg-info-soft text-info"
                            : savePhase === "pending"
                              ? "border-warning-line bg-warning-soft text-warning"
                              : ""
                      }`}
                    >
                      {savePhase === "saving"
                        ? "جاري الحفظ"
                        : savePhase === "queued"
                          ? effectiveSaveState?.message ||
                            "محفوظ محلياً — بانتظار الإنترنت"
                        : savePhase === "pending"
                          ? effectiveSaveState?.message || "درجة معلّقة"
                          : savePhase === "error"
                            ? effectiveSaveState?.message ||
                              "غير محفوظ — أعد المحاولة"
                            : savePhase === "dirty"
                              ? effectiveSaveState?.message ||
                                "تعديل غير محفوظ"
                              : leave
                                ? "مجاز"
                                : savePhase === "idle" && entered
                                  ? "✓ محفوظ"
                                  : savedRows[student.id] ||
                                    (savePhase === "saved"
                                      ? "✓ محفوظ"
                                      : "اكتب الدرجة أو اختر حالة")}
                    </Badge>
                  </div>

                  <button
                    type="button"
                    className="tp-grade-row__note-btn"
                    aria-expanded={noteOpen}
                    data-has-note={hasNote || undefined}
                    title={hasNote ? editableGradeNote(draft.notes) : "إضافة ملاحظة"}
                    onClick={() =>
                      setOpenNoteRows((prev) => ({ ...prev, [student.id]: !noteOpen }))
                    }
                  >
                    {hasNote ? "ملاحظة ✎" : "ملاحظة"}
                  </button>
                  {noteOpen ? (
                    <div className="tp-grade-row__note">
                  <Input
                    value={editableGradeNote(draft.notes)}
                    disabled={notesInputDisabled}
                    onChange={(e) =>
                      updateDraft(student.id, {
                        notes: withInternalGradeNotePrefix(draft.notes, e.target.value),
                      })
                    }
                    onBlur={() => {
                      if (
                        entered ||
                        isScoreInsideExamRange(
                          toLatinDigits(getDraft(student.id).score).trim(),
                          selectedExam.fullMark,
                        )
                      )
                        autoSaveGrade(student.id);
                    }}
                    placeholder="ملاحظات"
                    className="h-9"
                  />
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
        {examStudents.length > 0 && (entryTotalPages > 1 || examStudents.length > 25) && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2" data-grade-entry-pager="true">
            <Button
              variant="outline"
              size="sm"
              disabled={safeEntryPage <= 1}
              onClick={() => setEntryPage((page) => Math.max(1, page - 1))}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
              السابق
            </Button>
            <span className="text-sm text-muted-foreground">
              صفحة {safeEntryPage} من {entryTotalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safeEntryPage >= entryTotalPages}
              onClick={() => setEntryPage((page) => Math.min(entryTotalPages, page + 1))}
            >
              التالي
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <Select
              value={String(entryPageSize)}
              onValueChange={(value) => {
                setEntryPageSize(Number(value));
                setEntryPage(1);
              }}
            >
              <SelectTrigger
                aria-label="عدد الطلاب بالصفحة"
                className="h-8 w-auto min-w-24 tabular-nums"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 بالصفحة</SelectItem>
                <SelectItem value="50">50 بالصفحة</SelectItem>
                <SelectItem value="100">100 بالصفحة</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
    </section>
  );
}
