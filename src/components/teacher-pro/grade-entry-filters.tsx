"use client";

import type React from "react";
import { type Student, type Grade } from "@/lib/teacher-store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RowActionsMenu } from "@/components/teacher-pro/row-actions-menu";
import { ListChips, type ListChip } from "@/components/teacher-pro/list-toolbar";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { formatAppDate } from "@/lib/format";
import { type Course, type Exam } from "@/lib/teacher-store";
import { type ManualGradeCounts } from "@/lib/grade-entry-stats";
import { GradeEntrySearchInput } from "./grade-entry-shared";

export type GradeEntryFiltersProps = {
  filterCourseId: string;
  setFilterCourseId: React.Dispatch<React.SetStateAction<string>>;
  courses: Course[];
  selectedExamId: string;
  handleExamChange: (examId: string) => void;
  filteredActiveExams: Exam[];
  selectedExam: Exam | undefined;
  sheetProgress: { done: number; total: number; };
  entrySheetLoading: boolean;
  search: string;
  commitSearch: (value: string) => void;
  focusFirstGradeInput: () => boolean;
  statusChips: ListChip[];
  filterStatus: string;
  setFilterStatus: React.Dispatch<React.SetStateAction<string>>;
  entrySheetError: string | null;
  allManualGradesCount: ManualGradeCounts;
  handleQuickScan: () => void;
  handleMarkAllMissingAsAbsent: () => void;
  missingExamStudentsBeforeProtection: Student[];
  markingAllMissingAbsent: boolean;
  missingExamStudents: Student[];
  graceAbsentMissingStudents: Student[];
  preRegistrationMissingStudents: Student[];
  handleClearAbsentGrades: () => Promise<void>;
  absentGradesForSelectedExam: Grade[];
  clearingAbsentGrades: boolean;
  missingChapterCourses: string[];
};

export function GradeEntryFilters({
  filterCourseId,
  setFilterCourseId,
  courses,
  selectedExamId,
  handleExamChange,
  filteredActiveExams,
  selectedExam,
  sheetProgress,
  entrySheetLoading,
  search,
  commitSearch,
  focusFirstGradeInput,
  statusChips,
  filterStatus,
  setFilterStatus,
  entrySheetError,
  allManualGradesCount,
  handleQuickScan,
  handleMarkAllMissingAsAbsent,
  missingExamStudentsBeforeProtection,
  markingAllMissingAbsent,
  missingExamStudents,
  graceAbsentMissingStudents,
  preRegistrationMissingStudents,
  handleClearAbsentGrades,
  absentGradesForSelectedExam,
  clearingAbsentGrades,
  missingChapterCourses,
}: GradeEntryFiltersProps) {
  return (
    <Card className="tp-filter-card">
      <CardContent className="tp-filter-content">
        <div className="tp-filter-grid tp-grade-entry-pick grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="tp-filter-field tp-filter-primary">
            <Label htmlFor="grade-entry-course">الدورة</Label>
            <Select
              value={filterCourseId || "all"}
              onValueChange={(v) => setFilterCourseId(v === "all" ? "" : v)}
            >
              <SelectTrigger id="grade-entry-course">
                <SelectValue placeholder="كل الدورات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الدورات</SelectItem>
                {courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    {course.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="tp-filter-field tp-filter-primary">
            <Label htmlFor="grade-entry-exam">الامتحان</Label>
            <Select
              name="examId"
              value={selectedExamId}
              onValueChange={handleExamChange}
            >
              <SelectTrigger id="grade-entry-exam">
                <SelectValue placeholder="اختر الامتحان" />
              </SelectTrigger>
              <SelectContent>
                {filteredActiveExams.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} · {formatAppDate(e.date)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

        </div>

        {selectedExam && (
          <div className="tp-exam-bar" data-grade-exam-bar="true">
            <span className="tp-exam-bar__fact">
              <Badge>{selectedExam.type}</Badge>
              {formatAppDate(selectedExam.date)}
            </span>
            <span className="tp-exam-bar__fact">
              الدرجة الكاملة <strong>{selectedExam.fullMark}</strong>
            </span>
            <span className="tp-exam-bar__fact">
              النجاح <strong>{selectedExam.passMark}</strong>
            </span>
            {selectedExam.noDiscount ? (
              <span
                className="tp-exam-bar__fact"
                title="لا خصم فرص على الدرجة أو الغياب"
              >
                بدون خصم
              </span>
            ) : selectedExam.type !== "فاينل" ? (
              <span className="tp-exam-bar__fact">
                الخصم تحت <strong>{selectedExam.discountMark}</strong>
                <span aria-hidden="true">·</span>
                فرص الخصم <strong>{selectedExam.opportunitiesPenalty}</strong>
              </span>
            ) : (
              <span className="tp-exam-bar__fact">
                درجة الفصل <strong>{selectedExam.dismissalGrade ?? "ماكو"}</strong>
              </span>
            )}
            <span
              className="tp-exam-bar__progress"
              role="status"
              aria-live="polite"
              data-sheet-progress="true"
              data-complete={
                sheetProgress.total > 0 &&
                sheetProgress.done >= sheetProgress.total
                  ? "true"
                  : undefined
              }
            >
              <span className="tp-exam-bar__meter" aria-hidden="true">
                <span
                  style={{
                    inlineSize: `${
                      sheetProgress.total
                        ? Math.round((sheetProgress.done / sheetProgress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </span>
              {entrySheetLoading ? (
                "جاري التحميل…"
              ) : (
                <span>
                  <strong>{sheetProgress.done}</strong> من{" "}
                  <strong>{sheetProgress.total}</strong> مسجّلة
                </span>
              )}
            </span>
          </div>
        )}

        {/* The search and the counters sit on top, with the exam, like the
            proposal: type a name, see how many sheets are in. */}
        {selectedExam && (
            <div className="mt-4 grid w-full gap-3 lg:grid-cols-[minmax(14rem,1fr)_minmax(18rem,1fr)] lg:items-stretch" data-grade-entry-top="true">
              <div className="space-y-2 text-right">
                <Label htmlFor="grade-entry-search">
                  بحث الطالب داخل الإدخال
                </Label>
                <GradeEntrySearchInput
                  value={search}
                  onCommit={commitSearch}
                  onForwardTab={focusFirstGradeInput}
                />
                {/* «حالة الدرجة»: buttons that carry their count, like the system's lists. */}
                <ListChips
                  label="حالة الدرجة"
                  className="pt-1"
                  chips={entrySheetLoading ? statusChips.map((chip) => ({ ...chip, count: null })) : statusChips}
                  activeChip={filterStatus || "all"}
                  onChipChange={(key) => setFilterStatus(key === "all" ? "" : key)}
                />
              </div>
              <div
                className="grid min-h-[5.5rem] w-full grid-cols-[minmax(0,1fr)_auto] items-stretch gap-3 rounded-xl border border-success-line bg-gradient-to-l from-success-soft to-transparent p-3 text-right shadow-sm sm:p-4"
                data-manual-grade-count="true"
                role="status"
                aria-live="polite"
                aria-label={`إجمالي الأوراق المدخلة يدوياً: ${
                  entrySheetLoading || entrySheetError
                    ? "غير متاح الآن"
                    : allManualGradesCount.total
                }`}
                title="كل طالب انكتبت له درجة رقمية بهذا الامتحان، مرة وحدة: المحتسبة، وقبل التسجيل، والمعلّقة للمراجعة (مفصولين، مجازين، سماح قديم). ما تنحسب: الغياب والغش والإجازة بدون درجة، والدرجات المرفوضة."
              >
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5 text-xs font-black leading-5 text-success">
                    <span>الأوراق المدخلة يدوياً</span>
                  </p>
                  <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-muted-foreground">
                    <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-success-line bg-success-soft px-2 py-1 text-[10px] leading-none">
                      <span className="size-1.5 shrink-0 rounded-full bg-success-vivid" aria-hidden="true" />
                      <span>رقمية</span>
                      <strong className="font-black tabular-nums text-success">
                        {entrySheetLoading || entrySheetError ? "—" : allManualGradesCount.numeric}
                      </strong>
                    </span>
                    {allManualGradesCount.preRegistration > 0 && (
                      <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-info-line bg-info-soft px-2 py-1 text-[10px] leading-none">
                        <span className="size-1.5 shrink-0 rounded-full bg-info-vivid" aria-hidden="true" />
                        <span>قبل التسجيل</span>
                        <strong className="font-black tabular-nums text-info">
                          {allManualGradesCount.preRegistration}
                        </strong>
                      </span>
                    )}
                    {allManualGradesCount.pending > 0 && (
                      <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-warning-line bg-warning-soft px-2 py-1 text-[10px] leading-none">
                        <span className="size-1.5 shrink-0 rounded-full bg-warning-vivid" aria-hidden="true" />
                        <span>معلقة</span>
                        <strong className="font-black tabular-nums text-warning">
                          {allManualGradesCount.pending}
                        </strong>
                      </span>
                    )}
                    {/* Smart Notes من السجل المنظّم */}
                    {allManualGradesCount.dismissed > 0 && (
                      <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-danger-line bg-danger-soft px-2 py-1 text-[10px] leading-none">
                        <span className="size-1.5 shrink-0 rounded-full bg-danger-vivid" aria-hidden="true" />
                        <span>مفصولين</span>
                        <strong className="font-black tabular-nums text-danger">
                          {allManualGradesCount.dismissed}
                        </strong>
                      </span>
                    )}
                    {allManualGradesCount.leave > 0 && (
                      <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] leading-none">
                        <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                        <span>مجازين</span>
                        <strong className="font-black tabular-nums text-primary">
                          {allManualGradesCount.leave}
                        </strong>
                      </span>
                    )}
                    {allManualGradesCount.graceArchive > 0 && (
                      <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-info-line bg-info-soft px-2 py-1 text-[10px] leading-none">
                        <span className="size-1.5 shrink-0 rounded-full bg-info-vivid" aria-hidden="true" />
                        <span>سماح قديم (أرشيف)</span>
                        <strong className="font-black tabular-nums text-info">
                          {allManualGradesCount.graceArchive}
                        </strong>
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid min-h-14 min-w-16 shrink-0 place-items-center self-stretch rounded-lg border border-success-line bg-success-soft px-2">
                  <span
                    className="text-3xl font-black leading-none tabular-nums text-success"
                    data-manual-grade-count-value="true"
                  >
                    {entrySheetLoading || entrySheetError
                      ? "—"
                      : allManualGradesCount.total}
                  </span>
                </div>
              </div>
            </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleQuickScan} title="بحث / مسح QR" aria-label="بحث / مسح QR">
            QR
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleMarkAllMissingAsAbsent}
            disabled={
              !selectedExam ||
              missingExamStudentsBeforeProtection.length === 0 ||
              markingAllMissingAbsent
            }
            title={`يسجل ${missingExamStudents.length} غائب${graceAbsentMissingStudents.length ? ` (منهم ${graceAbsentMissingStudents.length} فترة سماح)` : ""}${preRegistrationMissingStudents.length ? `، و${preRegistrationMissingStudents.length} «قبل التسجيل»` : ""}. الدرجات المسجلة ما تتغير.`}
          >
            {markingAllMissingAbsent ? (
              "جارٍ تسجيل الحالات..."
            ) : missingExamStudentsBeforeProtection.length > 0 ? (
              <>
                تسجيل الباقين غائب
                <span className="tp-count-chip">{missingExamStudentsBeforeProtection.length}</span>
              </>
            ) : (
              "ماكو طلاب باقين"
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAbsentGrades}
            disabled={
              !selectedExam ||
              absentGradesForSelectedExam.length === 0 ||
              clearingAbsentGrades
            }
            title="يلغي غياب الطلاب النشطين فقط؛ تبقى سجلات المفصولين والمؤرشفين محفوظة"
            className="hidden border-warning-line text-warning hover:bg-warning-soft sm:inline-flex"
          >
            {clearingAbsentGrades
              ? "جاري الإلغاء..."
              : `إلغاء حالة غائب (${absentGradesForSelectedExam.length})`}
          </Button>
          {/* On a phone the rarely used action folds under «المزيد». */}
          <span className="sm:hidden">
            <RowActionsMenu
              label="إجراءات أخرى للامتحان"
              triggerText="المزيد"
              actions={[
                {
                  key: "clear-absent",
                  label: clearingAbsentGrades
                    ? "جاري الإلغاء..."
                    : `إلغاء حالة غائب (${absentGradesForSelectedExam.length})`,
                  disabled:
                    !selectedExam ||
                    absentGradesForSelectedExam.length === 0 ||
                    clearingAbsentGrades,
                  onSelect: () => void handleClearAbsentGrades(),
                },
              ]}
            />
          </span>
        </div>

        {missingChapterCourses.length > 0 && (
          <div className="mt-4 rounded-2xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-3 text-sm text-warning">
            الدورات التالية غير مربوطة بفصل نشط ولن تظهر ضمن إدخال الدرجات:{" "}
            {missingChapterCourses.join("، ")}
          </div>
        )}

      </CardContent>
    </Card>
  );
}
