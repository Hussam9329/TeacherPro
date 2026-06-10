"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore } from "@/lib/teacher-store";
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
import { toast } from "sonner";
import { toLatinDigits } from "@/lib/format";
import { searchAny } from "@/lib/validation";
import {
  hasActiveChapterLink,
  isExamAvailableForEntry,
  isExamOnOrAfterStudentRegistration,
  isGradeEntered,
  isScoreInsideExamRange,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";

type DraftGrade = {
  status: "درجة" | "غائب" | "غش";
  score: string;
  notes: string;
};

const statusOptions: DraftGrade["status"][] = ["درجة", "غائب", "غش"];

function normalizeGradeScoreInput(value: string, fullMark: number) {
  const normalized = toLatinDigits(value).trim();
  if (!normalized) return "";
  const score = Number(normalized);
  if (!Number.isFinite(score)) return normalized;
  if (score < 0) return "0";
  if (score > fullMark) return String(fullMark);
  return normalized;
}

export function GradeEntryView() {
  const {
    exams,
    students,
    grades,
    courses,
    courseChapters,
    studentLeaves,
    addGrade,
    courseName,
    classification,
  } = useTeacherStore();

  const [selectedExamId, setSelectedExamId] = useState("");
  const [search, setSearch] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftGrade>>({});
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const [savedRows, setSavedRows] = useState<Record<string, string>>({});
  const [editableRows, setEditableRows] = useState<Record<string, boolean>>({});
  const [clockTick, setClockTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((tick) => tick + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedExam = exams.find((e) => e.id === selectedExamId);
  const activeExams = useMemo(() => exams.filter((e) => isExamAvailableForEntry(e)), [exams, clockTick]);

  const getGrade = (studentId: string) =>
    grades.find((g) => g.studentId === studentId && g.examId === selectedExamId);

  const getDraft = (studentId: string): DraftGrade => {
    const existing = getGrade(studentId);
    return drafts[studentId] || {
      status: (existing?.status as string) === "مجاز" ? "غائب" : (existing?.status as DraftGrade["status"]) || "درجة",
      score: existing?.score !== null && existing?.score !== undefined ? String(existing.score) : "",
      notes: existing?.notes || "",
    };
  };

  const updateDraft = (studentId: string, patch: Partial<DraftGrade>) => {
    setDrafts((prev) => ({ ...prev, [studentId]: { ...getDraft(studentId), ...patch } }));
  };

  const getStudentLeaveForSelectedExam = (studentId: string) => {
    if (!selectedExam) return undefined;
    return studentLeaves.find((leave) => leave.studentId === studentId && leave.examId === selectedExam.id);
  };

  const canEditGradeForStudent = (studentId: string) => {
    const student = students.find((item) => item.id === studentId);
    const grade = getGrade(studentId);
    if (!student) return false;
    if (student.status !== "مفصول") return true;
    return Boolean(
      selectedExam &&
      grade &&
      grade.examId === selectedExam.id &&
      (student.dismissalReason || "").includes(selectedExam.name),
    );
  };

  const examStudents = useMemo(() => {
    if (!selectedExam) return [];
    const selectedMainSites = splitSelection(selectedExam.mainSite);

    return students
      .filter((student) => {
        if (!selectedExam.courseIds.includes(student.courseId)) return false;
        if (!isExamOnOrAfterStudentRegistration(student, selectedExam)) return false;
        if (!hasActiveChapterLink(courseChapters, student.courseId)) return false;
        if (!studentMatchesExamMainSites(student, selectedMainSites)) return false;
        if (filterCourseId && student.courseId !== filterCourseId) return false;
        if (search && !searchAny(search, [student.name, student.code, student.telegram, student.phone, student.subSite, student.locationScope])) return false;
        const hasLeave = studentLeaves.some((leave) => leave.studentId === student.id && leave.examId === selectedExam.id);
        const grade = grades.find((g) => g.studentId === student.id && g.examId === selectedExam.id);
        const entered = !hasLeave && isGradeEntered(grade, selectedExam);
        if (filterStatus === "غير مسجل" && (entered || hasLeave)) return false;
        if (filterStatus && filterStatus !== "غير مسجل" && (hasLeave || !entered || grade?.status !== filterStatus)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [selectedExam, students, grades, studentLeaves, courseChapters, search, filterCourseId, filterStatus]);

  const missingChapterCourses = useMemo(() => {
    if (!selectedExam) return [];
    return selectedExam.courseIds
      .filter((courseId) => !hasActiveChapterLink(courseChapters, courseId))
      .map((courseId) => courseName(courseId));
  }, [selectedExam, courseChapters, courseName]);

  const saveGrade = async (studentId: string, draftOverride?: DraftGrade, options: { silent?: boolean } = {}) => {
    if (!selectedExam) return;
    const leave = getStudentLeaveForSelectedExam(studentId);
    if (leave) {
      toast.error(`الطالب مجاز لهذا الامتحان ولا يمكن إدخال درجة له${leave.reason ? `: ${leave.reason}` : ""}`);
      return;
    }
    if (!canEditGradeForStudent(studentId)) {
      toast.error("هذا الطالب مفصول ولا يمكن تعديل درجته إلا داخل الامتحان الذي سبب الفصل");
      return;
    }
    const draft = draftOverride || getDraft(studentId);
    const status = draft.status;
    const normalizedScore = toLatinDigits(draft.score).trim();
    const score = status === "درجة" ? Number(normalizedScore) : null;

    if (status === "درجة") {
      if (!normalizedScore || !isScoreInsideExamRange(normalizedScore, selectedExam.fullMark)) {
        toast.error(`لا تُعد الدرجة مدخلة إلا إذا كانت رقماً بين 0 و ${selectedExam.fullMark}`);
        return;
      }
    }

    setSavingRows((prev) => ({ ...prev, [studentId]: true }));
    addGrade({
      studentId,
      examId: selectedExam.id,
      status,
      score,
      notes: draft.notes,
    });
    setSavingRows((prev) => ({ ...prev, [studentId]: false }));
    setEditableRows((prev) => ({ ...prev, [studentId]: false }));
    setSavedRows((prev) => ({ ...prev, [studentId]: new Date().toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" }) }));
    if (!options.silent) toast.success("تم حفظ الدرجة");
  };

  const autoSaveGrade = (studentId: string, draftOverride?: DraftGrade) => {
    if (!selectedExam || getStudentLeaveForSelectedExam(studentId) || !canEditGradeForStudent(studentId)) return;
    const draft = draftOverride || getDraft(studentId);
    if (draft.status === "درجة" && !isScoreInsideExamRange(toLatinDigits(draft.score).trim(), selectedExam.fullMark)) return;
    void saveGrade(studentId, draft, { silent: true });
  };

  const handleQuickScan = () => {
    const code = window.prompt("امسح QR/باركود أو اكتب كود الطالب للبحث");
    if (code?.trim()) setSearch(code.trim());
  };

  const handleExamChange = (examId: string) => {
    setSelectedExamId(examId);
    setDrafts({});
    setEditableRows({});
    setSavedRows({});
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>تسجيل الدرجات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="grade-entry-exam">اختر الامتحان</Label>
              <Select name="examId" value={selectedExamId} onValueChange={handleExamChange}>
                <SelectTrigger id="grade-entry-exam">
                  <SelectValue placeholder="اختر الامتحان" />
                </SelectTrigger>
                <SelectContent>
                  {activeExams.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} ({e.type}) - {e.date}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="grade-entry-search">بحث الطالب</Label>
              <Input
                id="grade-entry-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="اسم / كود / تليكرام / محافظة"
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="grade-entry-course">الدورة</Label>
              <Select value={filterCourseId || "all"} onValueChange={(v) => setFilterCourseId(v === "all" ? "" : v)}>
                <SelectTrigger id="grade-entry-course">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {courses
                    .filter((course) => selectedExam?.courseIds.includes(course.id))
                    .map((course) => (
                      <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="grade-entry-status-filter">حالة الدرجة</Label>
              <Select value={filterStatus || "all"} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
                <SelectTrigger id="grade-entry-status-filter">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="غير مسجل">غير مسجل</SelectItem>
                  {statusOptions.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleQuickScan}>بحث / مسح QR</Button>
            {selectedExam && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge>{selectedExam.type}</Badge>
                <span>الدرجة الكاملة: {selectedExam.fullMark}</span>
                <span>النجاح: {selectedExam.passMark}</span>
                {selectedExam.type === "يومي" ? (
                  <>
                    <span>الخصم: {selectedExam.discountMark}</span>
                    <span>فرص الخصم: {selectedExam.opportunitiesPenalty}</span>
                  </>
                ) : (
                  <span>درجة الفصل: {selectedExam.dismissalGrade ?? "لا يوجد"}</span>
                )}
              </div>
            )}
          </div>

          {missingChapterCourses.length > 0 && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              الدورات التالية غير مربوطة بفصل نشط ولن تظهر ضمن إدخال الدرجات: {missingChapterCourses.join("، ")}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedExam && (
        <Card>
          <CardHeader>
            <CardTitle>إدخال الدرجات - {examStudents.length} طالب</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {examStudents.length === 0 ? (
                <p className="empty-state">لا يوجد طلاب مطابقون للفلاتر أو للدورات المربوطة بفصل نشط.</p>
              ) : (
                examStudents.map((student) => {
                  const grade = getGrade(student.id);
                  const draft = getDraft(student.id);
                  const leave = getStudentLeaveForSelectedExam(student.id);
                  const entered = !leave && isGradeEntered(grade, selectedExam);
                  const cls = leave ? { text: "الطالب مجاز", type: "info", kind: "leave" } : entered && grade ? classification(grade, selectedExam, student) : null;
                  const isSaving = Boolean(savingRows[student.id]);
                  const canEdit = canEditGradeForStudent(student.id);
                  const rowLocked = Boolean(!leave && entered && !editableRows[student.id]);
                  const controlsDisabled = Boolean(leave) || !canEdit || rowLocked;
                  return (
                    <div key={student.id} className="grid grid-cols-1 items-center gap-3 rounded-2xl border bg-card/80 p-3 shadow-sm xl:grid-cols-[1.5fr_130px_130px_1fr_170px]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-bold">{student.name}</p>
                          <Badge variant="outline" className="text-[10px]">{student.subSite || student.locationScope || student.mainSite || "بدون موقع"}</Badge>
                          {leave && (
                            <Badge variant="secondary" className="text-[10px]">الطالب مجاز</Badge>
                          )}
                          {student.status === "مفصول" && (
                            <Badge variant={canEdit ? "secondary" : "destructive"} className="text-[10px]">
                              {canEdit ? "مفصول - يمكن تصحيح سبب الفصل" : "مفصول - إدخال مقفل"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{student.code} - {courseName(student.courseId)}</p>
                        {leave && (
                          <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                            الطالب مجاز لهذا الامتحان ولا يمكن إدخال درجة له{leave.reason ? `: ${leave.reason}` : ""}
                          </p>
                        )}
                        {student.status === "مفصول" && student.dismissalReason && (
                          <p className="mt-1 text-[11px] text-destructive">{student.dismissalReason}</p>
                        )}
                      </div>

                      <Input
                        type="number"
                        min={0}
                        max={selectedExam.fullMark}
                        disabled={controlsDisabled || draft.status !== "درجة"}
                        value={!leave && draft.status === "درجة" ? draft.score : ""}
                        onChange={(e) => {
                          const nextScore = normalizeGradeScoreInput(e.target.value, selectedExam.fullMark);
                          if (nextScore !== toLatinDigits(e.target.value).trim()) {
                            toast.error(`درجة الطالب يجب أن تكون بين 0 و ${selectedExam.fullMark}`);
                          }
                          updateDraft(student.id, { score: nextScore, status: "درجة" });
                        }}
                        onBlur={() => autoSaveGrade(student.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void saveGrade(student.id);
                          }
                        }}
                        placeholder={`0 - ${selectedExam.fullMark}`}
                        className="h-10"
                      />

                      <Select
                        value={draft.status}
                        disabled={controlsDisabled}
                        onValueChange={(value) => {
                          const nextStatus = value as DraftGrade["status"];
                          const nextDraft = { ...draft, status: nextStatus, score: nextStatus === "درجة" ? draft.score : "" };
                          updateDraft(student.id, nextDraft);
                          if (nextStatus !== "درجة") autoSaveGrade(student.id, nextDraft);
                        }}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                        </SelectContent>
                      </Select>

                      <Input
                        value={draft.notes}
                        disabled={controlsDisabled}
                        onChange={(e) => updateDraft(student.id, { notes: e.target.value })}
                        onBlur={() => { if (entered || isScoreInsideExamRange(toLatinDigits(getDraft(student.id).score).trim(), selectedExam.fullMark)) autoSaveGrade(student.id); }}
                        placeholder="ملاحظات"
                        className="h-10"
                      />

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {cls && (
                          <Badge variant={cls.type === "ok" ? "default" : cls.type === "danger" ? "destructive" : cls.type === "warn" ? "secondary" : "outline"}>
                            {cls.text}
                          </Badge>
                        )}
                        <Badge variant={savedRows[student.id] ? "default" : "outline"} className="text-[10px]">
                          {isSaving ? "جاري الحفظ" : leave ? "الطالب مجاز" : savedRows[student.id] ? `تم ${savedRows[student.id]}` : entered ? "محفوظ" : "غير مدخل"}
                        </Badge>
                        {rowLocked ? (
                          <Button size="sm" variant="secondary" disabled={!canEdit} onClick={() => setEditableRows((prev) => ({ ...prev, [student.id]: true }))}>تعديل</Button>
                        ) : (
                          <Button size="sm" onClick={() => void saveGrade(student.id)} disabled={Boolean(leave) || !canEdit || isSaving}>{isSaving ? "حفظ..." : "حفظ"}</Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
