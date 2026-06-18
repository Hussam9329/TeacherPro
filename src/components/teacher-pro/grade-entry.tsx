"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { formatAppDate, toLatinDigits } from "@/lib/format";
import { searchAny } from "@/lib/validation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useActionLock } from "@/hooks/use-action-lock";
import {
  STUDENT_FILTER_COURSE_PROGRAMS,
  STUDENT_FILTER_COURSE_TERMS,
  STUDENT_FILTER_STUDY_TYPES,
  getStudentLocationFilterOptions,
  studentMatchesListFilters,
} from "@/lib/student-list-filters";
import {
  hasActiveChapterLink,
  isExamAvailableForEntry,
  isExamOnOrAfterStudentRegistration,
  isGradeEntered,
  isExamWithinStudentGracePeriod,
  isScoreInsideExamRange,
  isAllMainSitesSelection,
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
    courseChapters,
    studentLeaves,
    opportunityLogs,
    addGrade,
    deleteGrade,
    clearAbsentGradesForExam,
    courseName,
    classification,
  } = useTeacherStore();

  const [selectedExamId, setSelectedExamId] = useState("");
  const [search, setSearch] = useState("");
  const [filterCourseProgram, setFilterCourseProgram] = useState("");
  const [filterCourseTerm, setFilterCourseTerm] = useState("");
  const [filterStudyType, setFilterStudyType] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [entryPage, setEntryPage] = useState(1);
  const [entryPageSize, setEntryPageSize] = useState(100);
  const [drafts, setDrafts] = useState<Record<string, DraftGrade>>({});
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const [savedRows, setSavedRows] = useState<Record<string, string>>({});
  const [editableRows, setEditableRows] = useState<Record<string, boolean>>({});
  const [reactivationWarningsAccepted, setReactivationWarningsAccepted] =
    useState<Record<string, boolean>>({});
  const [clockTick, setClockTick] = useState(0);
  const gradeInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const debouncedSearch = useDebouncedValue(search, 180);
  const { locked: clearingAbsentGrades, runLocked: runClearAbsentGradesLocked } = useActionLock();

  const locationFilterOptions = useMemo(
    () => getStudentLocationFilterOptions(students),
    [students],
  );

  useEffect(() => {
    if (filterCourseProgram !== "كورسات" && filterCourseTerm) {
      setFilterCourseTerm("");
    }
  }, [filterCourseProgram, filterCourseTerm]);

  useEffect(() => {
    setEntryPage(1);
  }, [
    selectedExamId,
    debouncedSearch,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    filterLocation,
    filterStatus,
  ]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setClockTick((tick) => tick + 1),
      30000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const selectedExam = exams.find((e) => e.id === selectedExamId);
  const activeExams = useMemo(
    () => exams.filter((e) => isExamAvailableForEntry(e)),
    [exams, clockTick],
  );

  const getGrade = (studentId: string) =>
    grades.find(
      (g) => g.studentId === studentId && g.examId === selectedExamId,
    );

  const getDraft = (studentId: string): DraftGrade => {
    const existing = getGrade(studentId);
    return (
      drafts[studentId] || {
        status:
          (existing?.status as string) === "مجاز"
            ? "غائب"
            : (existing?.status as DraftGrade["status"]) || "درجة",
        score:
          existing?.score !== null && existing?.score !== undefined
            ? String(existing.score)
            : "",
        notes: existing?.notes || "",
      }
    );
  };

  const updateDraft = (studentId: string, patch: Partial<DraftGrade>) => {
    setDrafts((prev) => ({
      ...prev,
      [studentId]: { ...getDraft(studentId), ...patch },
    }));
  };

  const getStudentLeaveForSelectedExam = (studentId: string) => {
    if (!selectedExam) return undefined;
    const examDate = String(selectedExam.date || "").slice(0, 10);
    return studentLeaves.find((leave) => {
      if (leave.studentId !== studentId) return false;
      if ((leave.leaveType || "exam") === "period") {
        const from = String(leave.dateFrom || leave.date || "").slice(0, 10);
        const to = String(
          leave.dateTo || leave.dateFrom || leave.date || "",
        ).slice(0, 10);
        return Boolean(
          examDate && from && to && examDate >= from && examDate <= to,
        );
      }
      return leave.examId === selectedExam.id;
    });
  };

  const isStudentInGraceForSelectedExam = (studentId: string) => {
    if (!selectedExam) return false;
    const student = students.find((item) => item.id === studentId);
    return Boolean(
      student && isExamWithinStudentGracePeriod(student, selectedExam),
    );
  };

  const gradeHasAutomaticEffect = (studentId: string, examId: string) =>
    opportunityLogs.some(
      (log) =>
        log.studentId === studentId &&
        log.examId === examId &&
        (log.action === "خصم تلقائي" ||
          log.action === "فصل تلقائي" ||
          String(log.reason || "").startsWith("تلقائي:")),
    );

  const canEditGradeForStudent = (studentId: string) => {
    const student = students.find((item) => item.id === studentId);
    const grade = getGrade(studentId);
    if (!student) return false;
    if (student.status !== "مفصول") return true;
    return Boolean(
      selectedExam &&
      grade &&
      grade.examId === selectedExam.id &&
      ((student.dismissalReason || "").includes(selectedExam.name) ||
        gradeHasAutomaticEffect(studentId, selectedExam.id)),
    );
  };

  const studentHasManualReactivation = (studentId: string) =>
    opportunityLogs.some(
      (log) => log.studentId === studentId && log.action === "إعادة تفعيل",
    );

  const examPenaltyAmount = (
    exam: typeof selectedExam,
    studentOpportunities: number,
  ) => {
    if (!exam || exam.noDiscount) return 0;
    if (exam.type === "فاينل" && exam.opportunitiesPenalty === "فصل مؤقت")
      return Math.max(1, studentOpportunities);
    return Math.max(0, Number(exam.opportunitiesPenalty || 0));
  };

  const draftMayReturnReactivatedStudentToDismissal = (
    studentId: string,
    draft: DraftGrade,
  ) => {
    if (!selectedExam) return false;
    const student = students.find((item) => item.id === studentId);
    if (!student || !studentHasManualReactivation(studentId)) return false;

    const normalizedScore = toLatinDigits(draft.score).trim();
    if (
      draft.status === "درجة" &&
      !isScoreInsideExamRange(normalizedScore, selectedExam.fullMark)
    )
      return false;

    const nextGrade = {
      id: getGrade(studentId)?.id || "preview",
      studentId,
      examId: selectedExam.id,
      status: draft.status,
      score: draft.status === "درجة" ? Number(normalizedScore) : null,
      notes: draft.notes,
      academicAccountingChecked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = classification(nextGrade, selectedExam, student);

    if (result.kind === "dismissal" || result.kind === "cheat") return true;
    if (result.kind === "deducted") {
      const remainingOpportunities = Math.max(
        0,
        Number(student.opportunities || 0),
      );
      return (
        examPenaltyAmount(selectedExam, remainingOpportunities) >=
        remainingOpportunities
      );
    }
    return false;
  };

  const reactivationWarningKey = (studentId: string) =>
    `${studentId}:${selectedExam?.id || ""}`;

  const needsReactivationWarning = (
    studentId: string,
    draftOverride?: DraftGrade,
  ) => {
    if (
      !selectedExam ||
      reactivationWarningsAccepted[reactivationWarningKey(studentId)]
    )
      return false;
    return draftMayReturnReactivatedStudentToDismissal(
      studentId,
      draftOverride || getDraft(studentId),
    );
  };

  const confirmReactivatedStudentGradeEdit = (
    studentId: string,
    draftOverride?: DraftGrade,
  ) => {
    if (!needsReactivationWarning(studentId, draftOverride)) return true;
    const student = students.find((item) => item.id === studentId);
    const confirmed = window.confirm(
      `درجة ${student?.name || "هذا الطالب"} الجديدة قد تستهلك الفرصة الأخيرة وتعيد الطالب إلى المفصولين. هل تريد المتابعة؟`,
    );
    if (confirmed) {
      const key = reactivationWarningKey(studentId);
      setReactivationWarningsAccepted((prev) => ({ ...prev, [key]: true }));
    }
    return confirmed;
  };

  const restoreDraftFromSavedGrade = (studentId: string) => {
    const existing = getGrade(studentId);
    setDrafts((prev) => {
      const next = { ...prev };
      if (existing) {
        next[studentId] = {
          status:
            (existing.status as string) === "مجاز"
              ? "غائب"
              : (existing.status as DraftGrade["status"]) || "درجة",
          score:
            existing.score !== null && existing.score !== undefined
              ? String(existing.score)
              : "",
          notes: existing.notes || "",
        };
      } else {
        delete next[studentId];
      }
      return next;
    });
    setEditableRows((prev) => ({ ...prev, [studentId]: false }));
    setSavingRows((prev) => ({ ...prev, [studentId]: false }));
    setSavedRows((prev) => ({ ...prev, [studentId]: "تم إلغاء التعديل" }));
  };

  const examStudents = useMemo(() => {
    if (!selectedExam) return [];
    const selectedMainSites = splitSelection(selectedExam.mainSite);
    const courseWideExam = isAllMainSitesSelection(selectedMainSites);

    return students
      .filter((student) => {
        if (!selectedExam.courseIds.includes(student.courseId)) return false;
        if (
          !courseWideExam &&
          !isExamOnOrAfterStudentRegistration(student, selectedExam)
        )
          return false;
        if (!hasActiveChapterLink(courseChapters, student.courseId))
          return false;
        if (!studentMatchesExamMainSites(student, selectedMainSites))
          return false;
        if (
          !studentMatchesListFilters(student, {
            courseProgram: filterCourseProgram,
            courseTerm: filterCourseTerm,
            studyType: filterStudyType,
            location: filterLocation,
          })
        )
          return false;
        if (
          debouncedSearch &&
          !searchAny(debouncedSearch, [
            student.name,
            student.code,
            student.telegram,
            student.phone,
            student.subSite,
            student.locationScope,
          ])
        )
          return false;
        const hasLeave = Boolean(getStudentLeaveForSelectedExam(student.id));
        const hasGrace = isExamWithinStudentGracePeriod(student, selectedExam);
        const grade = grades.find(
          (g) => g.studentId === student.id && g.examId === selectedExam.id,
        );
        const entered = !hasLeave && isGradeEntered(grade, selectedExam);
        if (filterStatus === "ضمن السماح" && !hasGrace) return false;
        if (filterStatus === "غير مسجل" && (entered || hasLeave)) return false;
        if (
          filterStatus &&
          !["غير مسجل", "ضمن السماح"].includes(filterStatus) &&
          (hasLeave || !entered || hasGrace || grade?.status !== filterStatus)
        )
          return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [
    selectedExam,
    students,
    grades,
    studentLeaves,
    courseChapters,
    debouncedSearch,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    filterLocation,
    filterStatus,
  ]);

  const entryTotalPages = Math.max(
    1,
    Math.ceil(examStudents.length / entryPageSize),
  );
  const safeEntryPage = Math.min(entryPage, entryTotalPages);
  const visibleExamStudents = useMemo(
    () =>
      examStudents.slice(
        (safeEntryPage - 1) * entryPageSize,
        safeEntryPage * entryPageSize,
      ),
    [examStudents, safeEntryPage, entryPageSize],
  );

  const gradeInputStudentIds = useMemo(() => {
    if (!selectedExam) return [];
    return visibleExamStudents
      .filter((student) => {
        const leave = getStudentLeaveForSelectedExam(student.id);
        if (leave || !canEditGradeForStudent(student.id)) return false;
        const grade = getGrade(student.id);
        const draft = getDraft(student.id);
        const entered = isGradeEntered(grade, selectedExam);
        const rowLocked = Boolean(entered && !editableRows[student.id]);
        return !rowLocked && draft.status === "درجة";
      })
      .map((student) => student.id);
  }, [
    selectedExam,
    visibleExamStudents,
    grades,
    studentLeaves,
    opportunityLogs,
    editableRows,
    drafts,
  ]);

  const focusGradeInputAt = (index: number) => {
    if (gradeInputStudentIds.length === 0) return false;
    const boundedIndex = Math.max(
      0,
      Math.min(index, gradeInputStudentIds.length - 1),
    );
    const targetStudentId = gradeInputStudentIds[boundedIndex];
    window.requestAnimationFrame(() => {
      gradeInputRefs.current[targetStudentId]?.focus();
      gradeInputRefs.current[targetStudentId]?.select();
    });
    return true;
  };

  const focusRelativeGradeInput = (
    studentId: string,
    direction: 1 | -1 = 1,
  ) => {
    const currentIndex = gradeInputStudentIds.indexOf(studentId);
    if (currentIndex === -1) return false;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= gradeInputStudentIds.length) return false;
    return focusGradeInputAt(nextIndex);
  };

  const missingChapterCourses = useMemo(() => {
    if (!selectedExam) return [];
    return selectedExam.courseIds
      .filter((courseId) => !hasActiveChapterLink(courseChapters, courseId))
      .map((courseId) => courseName(courseId));
  }, [selectedExam, courseChapters, courseName]);

  const saveGrade = async (
    studentId: string,
    draftOverride?: DraftGrade,
    options: { silent?: boolean; skipReactivationWarning?: boolean } = {},
  ) => {
    if (!selectedExam) return;
    const leave = getStudentLeaveForSelectedExam(studentId);
    if (leave) {
      toast.error(
        `الطالب مجاز لهذا الامتحان ولا يمكن إدخال درجة له${leave.reason ? `: ${leave.reason}` : ""}`,
      );
      return;
    }
    if (!canEditGradeForStudent(studentId)) {
      toast.error(
        "هذا الطالب مفصول ولا يمكن تعديل درجته إلا داخل الامتحان الذي سبب الفصل",
      );
      return;
    }
    const draft = draftOverride || getDraft(studentId);
    const status = draft.status;
    const normalizedScore = toLatinDigits(draft.score).trim();
    const score = status === "درجة" ? Number(normalizedScore) : null;

    if (status === "درجة") {
      if (
        !normalizedScore ||
        !isScoreInsideExamRange(normalizedScore, selectedExam.fullMark)
      ) {
        toast.error(
          `لا تُعد الدرجة مدخلة إلا إذا كانت رقماً بين 0 و ${selectedExam.fullMark}`,
        );
        return;
      }
    }

    if (
      !options.skipReactivationWarning &&
      !confirmReactivatedStudentGradeEdit(studentId, draft)
    )
      return;

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
    setSavedRows((prev) => ({
      ...prev,
      [studentId]: `تم ${new Date().toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}`,
    }));
    if (!options.silent) toast.success("تم حفظ الدرجة");
  };

  const autoSaveGrade = (studentId: string, draftOverride?: DraftGrade) => {
    const draft = draftOverride || getDraft(studentId);
    if (
      !selectedExam ||
      getStudentLeaveForSelectedExam(studentId) ||
      !canEditGradeForStudent(studentId)
    )
      return;
    const existing = getGrade(studentId);
    const normalizedScore = toLatinDigits(draft.score).trim();

    if (draft.status === "درجة") {
      if (!normalizedScore) {
        if (existing) {
          const deleted = deleteGrade(existing.id);
          if (deleted) {
            setDrafts((prev) => {
              const next = { ...prev };
              delete next[studentId];
              return next;
            });
            setEditableRows((prev) => ({ ...prev, [studentId]: false }));
            setSavedRows((prev) => ({ ...prev, [studentId]: "تم حذف الدرجة" }));
          }
        }
        return;
      }
      if (!isScoreInsideExamRange(normalizedScore, selectedExam.fullMark))
        return;
    }

    const nextScore = draft.status === "درجة" ? Number(normalizedScore) : null;
    if (
      existing &&
      existing.status === draft.status &&
      existing.score === nextScore &&
      (existing.notes || "") === (draft.notes || "")
    ) {
      setEditableRows((prev) => ({ ...prev, [studentId]: false }));
      return;
    }

    if (needsReactivationWarning(studentId, draft)) {
      const confirmed = confirmReactivatedStudentGradeEdit(studentId, draft);
      if (!confirmed) {
        restoreDraftFromSavedGrade(studentId);
        return;
      }
    }

    void saveGrade(studentId, draft, {
      silent: true,
      skipReactivationWarning: true,
    });
  };

  const missingVisibleStudents = selectedExam
    ? visibleExamStudents.filter((student) => {
        const leave = getStudentLeaveForSelectedExam(student.id);
        if (leave) return false;
        if (!canEditGradeForStudent(student.id)) return false;
        const grade = getGrade(student.id);
        return !isGradeEntered(grade, selectedExam);
      })
    : [];

  const absentGradesForSelectedExam = useMemo(
    () =>
      selectedExam
        ? grades.filter(
            (grade) =>
              grade.examId === selectedExam.id && grade.status === "غائب",
          )
        : [],
    [selectedExam, grades],
  );

  const handleClearAbsentGrades = runClearAbsentGradesLocked(async () => {
    if (!selectedExam) return;
    if (absentGradesForSelectedExam.length === 0) {
      toast.info("لا توجد حالات غياب محفوظة لهذا الامتحان");
      return;
    }

    const confirmed = window.confirm(
      `سيتم إلغاء حالة غائب من ${absentGradesForSelectedExam.length} طالب في امتحان ${selectedExam.name} وإرجاعهم كأن الدرجة لم تُسجل لهم. هل تريد المتابعة؟`,
    );
    if (!confirmed) return;

    const affectedStudentIds = new Set(
      absentGradesForSelectedExam.map((grade) => grade.studentId),
    );
    const removedCount = clearAbsentGradesForExam(selectedExam.id);

    if (removedCount > 0) {
      setDrafts((prev) => {
        const next = { ...prev };
        affectedStudentIds.forEach((studentId) => {
          delete next[studentId];
        });
        return next;
      });
      setEditableRows((prev) => {
        const next = { ...prev };
        affectedStudentIds.forEach((studentId) => {
          delete next[studentId];
        });
        return next;
      });
      setSavingRows((prev) => {
        const next = { ...prev };
        affectedStudentIds.forEach((studentId) => {
          delete next[studentId];
        });
        return next;
      });
      setSavedRows((prev) => {
        const next = { ...prev };
        affectedStudentIds.forEach((studentId) => {
          next[studentId] = "تم إلغاء الغياب";
        });
        return next;
      });
      toast.success(`تم إلغاء حالة غائب من ${removedCount} طالب`);
    }
  });

  const handleMarkVisibleMissingAsAbsent = () => {
    if (!selectedExam) return;
    if (missingVisibleStudents.length === 0) {
      toast.info("لا يوجد طلاب ظاهرون بدون درجة لتسجيلهم غائبين");
      return;
    }

    const confirmed = window.confirm(
      `سيتم تسجيل ${missingVisibleStudents.length} طالب من الصفحة الحالية بدون درجة كغائب في امتحان ${selectedExam.name}. لن يتم تعديل أي درجة موجودة مسبقًا. هل تريد المتابعة؟`,
    );
    if (!confirmed) return;

    const timestamp = new Date().toLocaleTimeString("ar-IQ", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const nextDrafts: Record<string, DraftGrade> = {};
    const nextSavedRows: Record<string, string> = {};
    const nextEditableRows: Record<string, boolean> = {};

    missingVisibleStudents.forEach((student) => {
      const draft: DraftGrade = {
        status: "غائب",
        score: "",
        notes: "تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم",
      };
      addGrade({
        studentId: student.id,
        examId: selectedExam.id,
        status: "غائب",
        score: null,
        notes: draft.notes,
      });
      nextDrafts[student.id] = draft;
      nextSavedRows[student.id] = `تم تسجيله غائب ${timestamp}`;
      nextEditableRows[student.id] = false;
    });

    setDrafts((prev) => ({ ...prev, ...nextDrafts }));
    setSavedRows((prev) => ({ ...prev, ...nextSavedRows }));
    setEditableRows((prev) => ({ ...prev, ...nextEditableRows }));
    toast.success(`تم تسجيل ${missingVisibleStudents.length} طالب من الصفحة الحالية كغائب`);
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
    setReactivationWarningsAccepted({});
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>تسجيل الدرجات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="grade-entry-exam">اختر الامتحان</Label>
              <Select
                name="examId"
                value={selectedExamId}
                onValueChange={handleExamChange}
              >
                <SelectTrigger id="grade-entry-exam">
                  <SelectValue placeholder="اختر الامتحان" />
                </SelectTrigger>
                <SelectContent>
                  {activeExams.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} ({e.type}) - {formatAppDate(e.date)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="grade-entry-program">نوع الدورة</Label>
              <Select
                value={filterCourseProgram || "all"}
                onValueChange={(v) =>
                  setFilterCourseProgram(v === "all" ? "" : v)
                }
              >
                <SelectTrigger id="grade-entry-program">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {STUDENT_FILTER_COURSE_PROGRAMS.map((program) => (
                    <SelectItem key={program} value={program}>
                      {program}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {filterCourseProgram === "كورسات" && (
              <div className="space-y-2">
                <Label htmlFor="grade-entry-term">الكورس</Label>
                <Select
                  value={filterCourseTerm || "all"}
                  onValueChange={(v) =>
                    setFilterCourseTerm(v === "all" ? "" : v)
                  }
                >
                  <SelectTrigger id="grade-entry-term">
                    <SelectValue placeholder="الكل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {STUDENT_FILTER_COURSE_TERMS.map((term) => (
                      <SelectItem key={term} value={term}>
                        {term}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="grade-entry-study-type">نوع الدراسة</Label>
              <Select
                value={filterStudyType || "all"}
                onValueChange={(v) => setFilterStudyType(v === "all" ? "" : v)}
              >
                <SelectTrigger id="grade-entry-study-type">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {STUDENT_FILTER_STUDY_TYPES.map((studyType) => (
                    <SelectItem key={studyType} value={studyType}>
                      {studyType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="grade-entry-location">المحافظة / الموقع</Label>
              <Select
                value={filterLocation || "all"}
                onValueChange={(v) => setFilterLocation(v === "all" ? "" : v)}
              >
                <SelectTrigger id="grade-entry-location">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {locationFilterOptions.map((location) => (
                    <SelectItem key={location} value={location}>
                      {location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="grade-entry-status-filter">حالة الدرجة</Label>
              <Select
                value={filterStatus || "all"}
                onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}
              >
                <SelectTrigger id="grade-entry-status-filter">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="غير مسجل">غير مسجل</SelectItem>
                  <SelectItem value="ضمن السماح">ضمن السماح</SelectItem>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleQuickScan}>
              بحث / مسح QR
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleMarkVisibleMissingAsAbsent}
              disabled={!selectedExam || missingVisibleStudents.length === 0}
              title="يسجل طلاب الصفحة الحالية الذين لا يملكون درجة محفوظة كغائبين"
            >
              تسجيل الصفحة كغائب ({missingVisibleStudents.length})
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
              title="يحذف كل سجلات الغياب لهذا الامتحان ويرجع الطلاب كأنهم غير مسجلين"
              className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
            >
              {clearingAbsentGrades
                ? "جاري الإلغاء..."
                : `إلغاء حالة غائب (${absentGradesForSelectedExam.length})`}
            </Button>
            {selectedExam && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge>{selectedExam.type}</Badge>
                <span>الدرجة الكاملة: {selectedExam.fullMark}</span>
                <span>النجاح: {selectedExam.passMark}</span>
                {selectedExam.noDiscount ? (
                  <span>بدون خصم: لا محاسبة على الدرجة أو الغياب</span>
                ) : selectedExam.type !== "فاينل" ? (
                  <>
                    <span>الخصم: {selectedExam.discountMark}</span>
                    <span>فرص الخصم: {selectedExam.opportunitiesPenalty}</span>
                  </>
                ) : (
                  <span>
                    درجة الفصل: {selectedExam.dismissalGrade ?? "لا يوجد"}
                  </span>
                )}
              </div>
            )}
          </div>

          {missingChapterCourses.length > 0 && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              الدورات التالية غير مربوطة بفصل نشط ولن تظهر ضمن إدخال الدرجات:{" "}
              {missingChapterCourses.join("، ")}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedExam && (
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <CardTitle>
                  إدخال الدرجات - {examStudents.length} طالب
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  البحث هنا داخل إطار إدخال الدرجات. اضغط Tab من البحث للانتقال
                  لأول خانة درجة، ثم Tab للتنقل بين درجات الطلاب.
                </p>
              </div>
              <div className="w-full space-y-2 lg:max-w-sm">
                <Label htmlFor="grade-entry-search">
                  بحث الطالب داخل الإدخال
                </Label>
                <Input
                  id="grade-entry-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Tab" && !event.shiftKey) {
                      const focused = focusGradeInputAt(0);
                      if (focused) event.preventDefault();
                    }
                  }}
                  placeholder="اسم / كود / تليكرام / محافظة"
                  autoComplete="off"
                  className="h-10"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {examStudents.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/30 p-3 text-sm text-muted-foreground">
                <span>
                  عرض {visibleExamStudents.length} من {examStudents.length} طالب
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="grade-entry-page-size" className="text-xs">
                    حجم الصفحة
                  </Label>
                  <Select
                    value={String(entryPageSize)}
                    onValueChange={(value) => {
                      setEntryPageSize(Number(value));
                      setEntryPage(1);
                    }}
                  >
                    <SelectTrigger
                      id="grade-entry-page-size"
                      className="h-8 w-24"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safeEntryPage <= 1}
                    onClick={() =>
                      setEntryPage((page) => Math.max(1, page - 1))
                    }
                  >
                    السابق
                  </Button>
                  <span className="text-xs">
                    صفحة {safeEntryPage} / {entryTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safeEntryPage >= entryTotalPages}
                    onClick={() =>
                      setEntryPage((page) =>
                        Math.min(entryTotalPages, page + 1),
                      )
                    }
                  >
                    التالي
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {examStudents.length === 0 ? (
                <p className="empty-state">
                  لا يوجد طلاب مطابقون للفلاتر أو للدورات المربوطة بفصل نشط.
                </p>
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
                  const canEdit = canEditGradeForStudent(student.id);
                  const rowLocked = Boolean(
                    !leave && entered && !editableRows[student.id],
                  );
                  const controlsDisabled =
                    Boolean(leave) || !canEdit || rowLocked;
                  return (
                    <div
                      key={student.id}
                      className="grid grid-cols-1 items-center gap-3 rounded-2xl border bg-card/80 p-3 shadow-sm xl:grid-cols-[1.5fr_130px_130px_1fr_170px]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-bold">
                            {student.name}
                          </p>
                          <Badge variant="outline" className="text-[10px]">
                            {student.subSite ||
                              student.locationScope ||
                              student.mainSite ||
                              "بدون موقع"}
                          </Badge>
                          {leave && (
                            <Badge variant="secondary" className="text-[10px]">
                              الطالب مجاز
                            </Badge>
                          )}
                          {!leave &&
                            isStudentInGraceForSelectedExam(student.id) && (
                              <Badge variant="outline" className="text-[10px]">
                                ضمن فترة السماح
                              </Badge>
                            )}
                          {student.status === "مفصول" && (
                            <Badge
                              variant={canEdit ? "secondary" : "destructive"}
                              className="text-[10px]"
                            >
                              {canEdit
                                ? "مفصول - يمكن تصحيح سبب الفصل"
                                : "مفصول - إدخال مقفل"}
                            </Badge>
                          )}
                          {studentHasManualReactivation(student.id) && (
                            <Badge variant="outline" className="text-[10px]">
                              إعادة تفعيل يدوي
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {student.code} - {courseName(student.courseId)}
                        </p>
                        {leave && (
                          <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                            الطالب مجاز لهذا الامتحان ولا يمكن إدخال درجة له
                            {leave.reason ? `: ${leave.reason}` : ""}
                          </p>
                        )}
                        {!leave &&
                          isStudentInGraceForSelectedExam(student.id) && (
                            <p className="mt-1 text-[11px] text-sky-700 dark:text-sky-300">
                              هذا الامتحان داخل فترة السماح؛ تحفظ الدرجة
                              للمتابعة فقط ولا تخصم فرصاً ولا تسبب فصلاً.
                            </p>
                          )}
                        {student.status === "مفصول" &&
                          student.dismissalReason && (
                            <p className="mt-1 text-[11px] text-destructive">
                              {student.dismissalReason}
                            </p>
                          )}
                      </div>

                      <Input
                        ref={(element) => {
                          gradeInputRefs.current[student.id] = element;
                        }}
                        type={draft.status === "درجة" ? "number" : "text"}
                        min={0}
                        max={selectedExam.fullMark}
                        disabled={controlsDisabled || draft.status !== "درجة"}
                        value={
                          !leave
                            ? draft.status === "درجة"
                              ? draft.score
                              : draft.status
                            : ""
                        }
                        onChange={(e) => {
                          const nextScore = normalizeGradeScoreInput(
                            e.target.value,
                            selectedExam.fullMark,
                          );
                          if (
                            nextScore !== toLatinDigits(e.target.value).trim()
                          ) {
                            toast.error(
                              `درجة الطالب يجب أن تكون بين 0 و ${selectedExam.fullMark}`,
                            );
                          }
                          updateDraft(student.id, {
                            score: nextScore,
                            status: "درجة",
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
                          draft.status === "درجة"
                            ? `0 - ${selectedExam.fullMark}`
                            : draft.status
                        }
                        className="h-10"
                      />

                      <Select
                        value={draft.status}
                        disabled={controlsDisabled}
                        onValueChange={(value) => {
                          const nextStatus = value as DraftGrade["status"];
                          const nextDraft = {
                            ...draft,
                            status: nextStatus,
                            score: nextStatus === "درجة" ? draft.score : "",
                          };
                          updateDraft(student.id, nextDraft);
                          if (nextStatus !== "درجة")
                            autoSaveGrade(student.id, nextDraft);
                        }}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Input
                        value={draft.notes}
                        disabled={controlsDisabled}
                        onChange={(e) =>
                          updateDraft(student.id, { notes: e.target.value })
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
                        className="h-10"
                      />

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {cls && (
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
                          variant={
                            savedRows[student.id] ? "default" : "outline"
                          }
                          className="text-[10px]"
                        >
                          {isSaving
                            ? "جاري الحفظ"
                            : leave
                              ? "الطالب مجاز"
                              : savedRows[student.id] ||
                                (entered ? "محفوظ" : "غير مدخل")}
                        </Badge>
                        {rowLocked ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!canEdit}
                            onClick={() =>
                              setEditableRows((prev) => ({
                                ...prev,
                                [student.id]: true,
                              }))
                            }
                          >
                            تعديل
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => void saveGrade(student.id)}
                            disabled={Boolean(leave) || !canEdit || isSaving}
                          >
                            {isSaving ? "حفظ..." : "حفظ"}
                          </Button>
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
