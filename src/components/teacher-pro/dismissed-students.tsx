"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type OpportunityLog, type Student } from "@/lib/teacher-store";
import { studentApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "sonner";
import {
  CustomFilterPresets,
  type FilterPresetValues,
} from "./custom-filter-presets";

type ViewMode = "cards" | "table";
type NotesFilter = "all" | "with-notes" | "without-notes";

type DismissalDetail = {
  studentId: string;
  type: string;
  reason: string;
  notes?: string;
  dismissalDate?: string;
  sourceType?: string;
  sourceId?: string;
  examName?: string;
  examType?: string;
  examDate?: string;
  lastGrade?: {
    status: string;
    score: number | null;
    fullMark: number | null;
    notes?: string;
    updatedAt?: string;
  } | null;
  hasPledge: boolean;
  pledgeText?: string;
  pledgeDate?: string;
};

const PLEDGE_NOTE_KIND = "تعهد ولي الأمر";

function dayKey(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "";
  return String(value || "").slice(0, 10);
}

function normalizeDismissalText(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[ـ]/g, "")
    .trim()
    .toLowerCase();
}

function isLikelyDismissalLog(log: OpportunityLog, dismissalReason: string): boolean {
  const rawReason = String(log.reason || "");
  const logReason = normalizeDismissalText(rawReason);
  const normalizedReason = normalizeDismissalText(dismissalReason);
  return (
    log.action === "فصل تلقائي" ||
    (log.action === "خصم" && rawReason.startsWith("فصل الطالب")) ||
    Boolean(normalizedReason && logReason.includes(normalizedReason))
  );
}

function formatDismissalGrade(detail: DismissalDetail | null): string {
  const grade = detail?.lastGrade;
  if (!grade) return "لا توجد درجة مرتبطة ظاهرة";
  if (grade.status === "درجة") {
    const fullMark = grade.fullMark ? ` / ${grade.fullMark}` : "";
    return `درجة: ${grade.score ?? "—"}${fullMark}`;
  }
  return grade.status || "درجة غير محددة";
}

export function DismissedStudentsView() {
  const {
    students,
    courses,
    exams,
    grades,
    opportunityLogs,
    studentNotes,
    courseName,
    reactivateStudent,
    updateStudent,
    mergeStudentsCache,
  } = useTeacherStore();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterDismissalType, setFilterDismissalType] = useState("");
  const [filterNotes, setFilterNotes] = useState<NotesFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [dismissalDetails, setDismissalDetails] = useState<Record<string, DismissalDetail>>({});
  const [dismissedServerStudents, setDismissedServerStudents] = useState<Student[]>([]);
  const [dismissedStudentsSearchLoading, setDismissedStudentsSearchLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // استخدم بحث الخادم بدلاً من listAll. السبب: listAll يحمل كل المفصولين
    // دفعة واحدة ويفلتر محلياً، مما يخفي نتائج معينة عند المفصولين الكثيرين
    // ويبطئ الصفحة. بحث الخادم يدعم q + status + courseId بشكل كامل.
    if (!dismissedStudentsSearchLoading) setDismissedStudentsSearchLoading(true);
    studentApi
      .list({
        status: "مفصول",
        q: debouncedSearch || undefined,
        courseId: filterCourseId || undefined,
        pageSize: 100,
      })
      .then((result) => {
        if (cancelled) return;
        const next = (result?.students || []) as unknown as Student[];
        setDismissedServerStudents(next);
        mergeStudentsCache(next);
      })
      .catch(() => {
        if (!cancelled) setDismissedServerStudents([]);
      })
      .finally(() => {
        if (!cancelled) setDismissedStudentsSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, filterCourseId, mergeStudentsCache]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dismissed-students/details", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { details?: DismissalDetail[] } | null) => {
        if (cancelled || !payload?.details) return;
        setDismissalDetails(
          Object.fromEntries(payload.details.map((detail) => [detail.studentId, detail])),
        );
      })
      .catch(() => {
        // عند فشل الاتصال نستخدم السياق المتاح محلياً بدون تعطيل الصفحة.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissedTypes = useMemo(
    () =>
      Array.from(
        new Set(
          dismissedServerStudents
            .filter((student) => student.status === "مفصول")
            .map((student) => student.dismissalType || "مفصول"),
        ),
      ).filter(Boolean),
    [dismissedServerStudents],
  );

  const dismissedStudents = useMemo(() => {
    // نعتمد على نتائج الخادم (dismissedServerStudents) لأنها تأتي مباشرةً
    // من قاعدة البيانات وتدعم البحث الكامل بدون قيد على أول N طالب.
    // الفلاتر المحلية المتبقية (dismissalType / notes) لا يمكن إجراؤها
    // عبر الخادم لأنها ليست حقول منفصلة في جدول الطلاب، فنبقيها هنا.
    return dismissedServerStudents
      .filter((student) => student.status === "مفصول")
      .filter((student) => {
        const hasNotes = Boolean(String(student.dismissalNotes || "").trim());
        if (filterCourseId && student.courseId !== filterCourseId) return false;
        if (
          filterDismissalType &&
          (student.dismissalType || "مفصول") !== filterDismissalType
        )
          return false;
        if (filterNotes === "with-notes" && !hasNotes) return false;
        if (filterNotes === "without-notes" && hasNotes) return false;
        // لا حاجة لإعادة فلترة debouncedSearch محلياً لأن الخادم قام بها
        // عبر ?q=. هذا يقلل العمل المحلي ويضمن نتائج متطابقة.
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [
    dismissedServerStudents,
    filterCourseId,
    filterDismissalType,
    filterNotes,
  ]);

  const buildLocalDismissalDetail = (student: Student): DismissalDetail => {
    const type = student.dismissalType || "مفصول";
    const reason = student.dismissalReason || "لا يوجد سبب مسجل";
    const studentLogs = opportunityLogs
      .filter((log) => log.studentId === student.id)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const dismissalLog =
      studentLogs.find((log) => log.action === "فصل تلقائي") ||
      studentLogs.find((log) => isLikelyDismissalLog(log, reason));
    const studentGrades = grades
      .filter((grade) => grade.studentId === student.id)
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    const linkedGrade = dismissalLog?.examId
      ? studentGrades.find((grade) => grade.examId === dismissalLog.examId)
      : undefined;
    const reasonGrade = linkedGrade || studentGrades.find((grade) => {
      const exam = exams.find((item) => item.id === grade.examId);
      const examName = normalizeDismissalText(exam?.name || "");
      return Boolean(examName && normalizeDismissalText(reason).includes(examName));
    });
    const exam = dismissalLog?.examId
      ? exams.find((item) => item.id === dismissalLog.examId)
      : reasonGrade
        ? exams.find((item) => item.id === reasonGrade.examId)
        : undefined;
    const sourceNote = studentNotes
      .filter((note) => note.studentId === student.id && note.kind === "إجراء")
      .find((note) => {
        const text = normalizeDismissalText(note.text);
        return text.includes("فصل الطالب") || text.includes(normalizeDismissalText(reason));
      });
    const sourceType = dismissalLog ? "opportunity-log" : sourceNote ? "student-note" : "student-dismissal";
    const sourceId = dismissalLog?.id || sourceNote?.id || student.id;
    const dismissalDate = dayKey(dismissalLog?.date || sourceNote?.date || student.createdAt);
    const normalizedReason = normalizeDismissalText(reason);
    const pledgeNote = studentNotes
      .filter((note) => note.studentId === student.id && note.kind === PLEDGE_NOTE_KIND)
      .find((note) => {
        if (note.sourceType && note.sourceId) return note.sourceType === sourceType && note.sourceId === sourceId;
        const noteReason = normalizeDismissalText(note.dismissalReason || note.text);
        return !noteReason || noteReason.includes(normalizedReason) || normalizedReason.includes(noteReason);
      });

    return {
      studentId: student.id,
      type,
      reason,
      notes: student.dismissalNotes || "",
      dismissalDate,
      sourceType,
      sourceId,
      examName: exam?.name || "",
      examType: exam?.type || "",
      examDate: dayKey(exam?.date),
      lastGrade: reasonGrade
        ? {
            status: reasonGrade.status,
            score: reasonGrade.score,
            fullMark: exam?.fullMark ?? null,
            notes: reasonGrade.notes || "",
            updatedAt: reasonGrade.updatedAt,
          }
        : null,
      hasPledge: Boolean(pledgeNote),
      pledgeText: pledgeNote?.text || "",
      pledgeDate: dayKey(pledgeNote?.date),
    };
  };

  const dismissalDetailForStudent = (student: Student) =>
    dismissalDetails[student.id] || buildLocalDismissalDetail(student);

  const handleReactivate = (student: Student) => {
    const detail = dismissalDetailForStudent(student);
    if (!detail.hasPledge) {
      const ok = window.confirm(
        `لم يتم تسجيل تعهد لهذا الفصل.\n\nالطالب: ${student.name}\nنوع الفصل: ${detail.type || "مفصول"}\nالسبب: ${detail.reason || "لا يوجد سبب مسجل"}\n\nهل تريد إعادة التفعيل رغم عدم وجود تعهد؟`,
      );
      if (!ok) return;
      toast.warning("تمت إعادة التفعيل بدون تعهد مسجل لهذا الفصل");
    }
    reactivateStudent(student.id);
    toast.success("تمت إعادة تفعيل الطالب");
  };

  const renderDismissalContext = (student: Student) => {
    const detail = dismissalDetailForStudent(student);
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">سبب الفصل</p>
            <p className="mt-1 break-words font-medium text-destructive">
              {detail.reason || student.dismissalReason || "لا يوجد سبب مسجل"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">نوع الفصل</p>
            <p className="mt-1 font-medium">{detail.type || student.dismissalType || "مفصول"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">الامتحان المرتبط</p>
            <p className="mt-1">
              {detail.examName
                ? `${detail.examName}${detail.examType ? ` - ${detail.examType}` : ""}${detail.examDate ? ` - ${detail.examDate}` : ""}`
                : "لا يوجد امتحان مرتبط ظاهر"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">آخر درجة سببت الفصل</p>
            <p className="mt-1">{formatDismissalGrade(detail)}</p>
            {detail.lastGrade?.notes ? (
              <p className="mt-1 text-xs text-muted-foreground">ملاحظة الدرجة: {detail.lastGrade.notes}</p>
            ) : null}
          </div>
        </div>
        <div
          className={
            detail.hasPledge
              ? "mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300"
              : "mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200"
          }
        >
          {detail.hasPledge
            ? `يوجد تعهد مسجل لهذا الفصل${detail.pledgeDate ? ` بتاريخ ${detail.pledgeDate}` : ""}.`
            : "لم يتم تسجيل تعهد لهذا الفصل. راجع التعهد قبل إعادة التفعيل."}
        </div>
      </div>
    );
  };

  const handleSaveNote = (studentId: string) => {
    const student = students.find((item) => item.id === studentId);
    if (!student) return;
    const nextNote = noteDrafts[studentId] ?? student.dismissalNotes ?? "";
    const result = updateStudent(studentId, { dismissalNotes: nextNote });
    if (result.ok) toast.success("تم حفظ ملاحظات الفصل");
    else toast.error(result.message);
  };

  const applyPreset = (values: FilterPresetValues) => {
    setSearch(String(values.search || ""));
    setFilterCourseId(String(values.courseId || ""));
    setFilterDismissalType(String(values.dismissalType || ""));
    setFilterNotes((values.notesFilter as NotesFilter) || "all");
    setViewMode((values.viewMode as ViewMode) || "cards");
  };

  const clearFilters = () => {
    setSearch("");
    setFilterCourseId("");
    setFilterDismissalType("");
    setFilterNotes("all");
    setViewMode("cards");
  };

  const renderNotesEditor = (student: (typeof students)[number]) => {
    const value = noteDrafts[student.id] ?? student.dismissalNotes ?? "";
    return (
      <div className="space-y-2">
        <Label className="text-xs">ملاحظات الفصل</Label>
        <textarea
          value={value}
          onChange={(event) =>
            setNoteDrafts((prev) => ({
              ...prev,
              [student.id]: event.target.value,
            }))
          }
          placeholder="اكتب ملاحظات خاصة بهذا الطالب المفصول..."
          className="min-h-20 w-full rounded-2xl border bg-background/70 px-3 py-2 text-sm shadow-xs outline-none focus:border-primary"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleSaveNote(student.id)}
        >
          حفظ الملاحظات
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>الطلاب المفصولون</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="space-y-1">
              <Label htmlFor="dismissed-course" className="text-xs">
                الدورة
              </Label>
              <Select
                value={filterCourseId || "all"}
                onValueChange={(value) =>
                  setFilterCourseId(value === "all" ? "" : value)
                }
              >
                <SelectTrigger id="dismissed-course">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dismissed-type" className="text-xs">
                نوع الفصل
              </Label>
              <Select
                value={filterDismissalType || "all"}
                onValueChange={(value) =>
                  setFilterDismissalType(value === "all" ? "" : value)
                }
              >
                <SelectTrigger id="dismissed-type">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {dismissedTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dismissed-notes" className="text-xs">
                الملاحظات
              </Label>
              <Select
                value={filterNotes}
                onValueChange={(value) => setFilterNotes(value as NotesFilter)}
              >
                <SelectTrigger id="dismissed-notes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="with-notes">لديهم ملاحظات</SelectItem>
                  <SelectItem value="without-notes">بدون ملاحظات</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="dismissed-search" className="text-xs">
                بحث ذكي
              </Label>
              <Input
                id="dismissed-search"
                name="search"
                data-teacherpro-search="true"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="اسم / كود / سبب / ملاحظات / تليكرام"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dismissed-view" className="text-xs">
                طريقة العرض
              </Label>
              <Select
                value={viewMode}
                onValueChange={(value) => setViewMode(value as ViewMode)}
              >
                <SelectTrigger id="dismissed-view">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cards">الكارتات</SelectItem>
                  <SelectItem value="table">الجدول</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <CustomFilterPresets
            storageKey="teacherpro.dismissed.customFilters"
            currentFilters={{
              search,
              courseId: filterCourseId,
              dismissalType: filterDismissalType,
              notesFilter: filterNotes,
              viewMode,
            }}
            onApply={applyPreset}
            onClear={clearFilters}
          />
        </CardContent>
      </Card>

      {viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {dismissedStudents.map((student) => (
            <Card key={student.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold">{student.name}</h3>
                      <Badge variant="destructive">
                        {student.dismissalType || "مفصول"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {student.code} - {courseName(student.courseId)} -{" "}
                      {student.subSite || student.locationScope || "بدون موقع"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleReactivate(student)}
                  >
                    إعادة تفعيل
                  </Button>
                </div>
                {renderDismissalContext(student)}
                {renderNotesEditor(student)}
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>الهاتف: {student.phone || "—"}</span>
                  <span>ولي الأمر: {student.parentPhone || "—"}</span>
                  <span>التليكرام: {student.telegram || "—"}</span>
                  <span>
                    الفرص: {student.opportunities}/{student.baseOpportunities}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="responsive-table text-sm">
            <thead>
              <tr>
                <th className="p-3 text-right">الطالب</th>
                <th className="p-3 text-right">الكود</th>
                <th className="p-3 text-right">الدورة</th>
                <th className="p-3 text-right">نوع الفصل</th>
                <th className="p-3 text-right">تفاصيل الفصل</th>
                <th className="p-3 text-right">التعهد</th>
                <th className="p-3 text-right">الملاحظات</th>
                <th className="p-3 text-right">الفرص</th>
                <th className="p-3 text-right">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {dismissedStudents.map((student) => (
                <tr key={student.id} className="border-t align-top">
                  <td className="p-3 font-medium">{student.name}</td>
                  <td className="p-3">{student.code}</td>
                  <td className="p-3">{courseName(student.courseId)}</td>
                  <td className="p-3">
                    <Badge variant="destructive">
                      {student.dismissalType || "مفصول"}
                    </Badge>
                  </td>
                  <td className="p-3 min-w-80">
                    {(() => {
                      const detail = dismissalDetailForStudent(student);
                      return (
                        <div className="space-y-1 text-xs">
                          <p className="font-semibold text-destructive">{detail.reason || student.dismissalReason || "لا يوجد سبب مسجل"}</p>
                          <p>الامتحان: {detail.examName || "—"}</p>
                          <p>آخر درجة: {formatDismissalGrade(detail)}</p>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-3 min-w-56">
                    {(() => {
                      const detail = dismissalDetailForStudent(student);
                      return detail.hasPledge ? (
                        <Badge variant="outline">تعهد مسجل{detail.pledgeDate ? ` - ${detail.pledgeDate}` : ""}</Badge>
                      ) : (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
                          لم يتم تسجيل تعهد لهذا الفصل.
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-3 min-w-72">{renderNotesEditor(student)}</td>
                  <td className="p-3">
                    {student.opportunities}/{student.baseOpportunities}
                  </td>
                  <td className="p-3">
                    <Button
                      size="sm"
                      onClick={() => handleReactivate(student)}
                    >
                      إعادة تفعيل
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dismissedStudents.length === 0 && (
        <p className="empty-state">لا يوجد طلاب مفصولون حسب الفلترة الحالية.</p>
      )}
    </div>
  );
}
