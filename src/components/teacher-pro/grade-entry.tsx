"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useTeacherStore,
  type CourseChapter,
  type Grade,
  type OpportunityLog,
  type Student,
  type StudentLeave,
} from "@/lib/teacher-store";
import { gradeEntrySheetApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatAppDate, toLatinDigits } from "@/lib/format";
import { normalizeForSearch } from "@/lib/validation";
import {
  deleteGradeEntryMissingNote,
  findGradeEntryMissingNote,
  upsertGradeEntryMissingNote,
} from "@/lib/grade-entry-notes";
import { useActionLock } from "@/hooks/use-action-lock";
import { studentMatchesListFilters } from "@/lib/student-list-filters";
import {
  hasActiveChapterLink,
  isExamAvailableForEntry,
  isExamOnOrAfterStudentRegistration,
  isGradeEntered,
  isExamWithinStudentGracePeriod,
  isScoreInsideExamRange,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";
import {
  examMatchesAcademicFilters,
  getAcademicCourseProgramFilterOptions,
  getAcademicLocationFilterOptions,
  getAcademicStudyTypeFilterOptions,
} from "@/lib/filter-sequence";

type DraftGrade = {
  status: "درجة" | "غائب" | "غش";
  score: string;
  notes: string;
};

const statusOptions: DraftGrade["status"][] = ["درجة", "غائب", "غش"];

type GradeEntryNotice = {
  type: "success" | "error" | "info";
  message: string;
  at: number;
};

type PendingConfirm = {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

const GRADE_ENTRY_NOTES_STORAGE_KEY = "teacherpro-grade-entry-notes-v1";

function readStoredGradeEntryNotes(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(GRADE_ENTRY_NOTES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          ([key, value]) =>
            typeof key === "string" && typeof value === "string",
        )
        .map(([key, value]) => [key, value as string]),
    );
  } catch (error) {
    console.warn("[GradeEntry] Failed to read local entry notes:", error);
    return {};
  }
}

function writeStoredGradeEntryNotes(notes: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    const compactNotes = Object.fromEntries(
      Object.entries(notes).filter(([, value]) => value.trim().length > 0),
    );
    window.localStorage.setItem(
      GRADE_ENTRY_NOTES_STORAGE_KEY,
      JSON.stringify(compactNotes),
    );
  } catch (error) {
    console.warn("[GradeEntry] Failed to write local entry notes:", error);
  }
}

const GradeEntrySearchInput = React.memo(function GradeEntrySearchInput({
  value,
  onCommit,
  onForwardTab,
}: {
  value: string;
  onCommit: (value: string) => void;
  onForwardTab: () => boolean;
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const timer = window.setTimeout(() => onCommit(localValue), 90);
    return () => window.clearTimeout(timer);
  }, [localValue, onCommit]);

  return (
    <Input
      id="grade-entry-search"
      name="search"
      data-teacherpro-search="true"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Tab" && !event.shiftKey) {
          const focused = onForwardTab();
          if (focused) event.preventDefault();
        }
      }}
      placeholder="اسم / كود / تليكرام / محافظة"
      autoComplete="off"
      className="h-10"
    />
  );
});

function normalizeGradeScoreInput(value: string, fullMark: number) {
  const normalized = toLatinDigits(value).trim();
  if (!normalized) return "";
  const score = Number(normalized);
  if (!Number.isFinite(score)) return normalized;
  if (score < 0) return "0";
  if (score > fullMark) return String(fullMark);
  return normalized;
}

function formatGradeEntryTimestamp(value?: string | Date | null): string {
  if (!value) return "غير معروف";
  // حوّل القيمة إلى كائن Date أولاً.
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "غير معروف";
  // احسب وقت بغداد بإضافة فرق التوقيت (+3 ساعات) إلى UTC، ثم استخدم
  // en-GB لتنسيق التاريخ والوقت بالإنكليزية بدل ar-IQ الذي يعطي
  // أرقاماً عربية ومحررات سياق RTL.
  // التحويل اليدوي يضمن أن الناتج دائماً بتوقيت بغداد بصرف النظر
  // عن منطقة زمن المتصفح.
  const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
  const baghdad = new Date(date.getTime() + BAGHDAD_OFFSET_MS);
  const y = baghdad.getUTCFullYear();
  const m = String(baghdad.getUTCMonth() + 1).padStart(2, "0");
  const d = String(baghdad.getUTCDate()).padStart(2, "0");
  const hh = String(baghdad.getUTCHours()).padStart(2, "0");
  const mm = String(baghdad.getUTCMinutes()).padStart(2, "0");
  // صيغة: 2026-07-05 03:00 ( Baghdad )
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function GradeEntryView() {
  const {
    exams,
    students,
    courses,
    grades,
    courseChapters,
    studentLeaves,
    opportunityLogs,
    addGrade,
    deleteGrade,
    clearAbsentGradesForExam,
    courseName,
    classification,
    mergeStudentsCache,
    mergeGradesCache,
  } = useTeacherStore();

  const [selectedExamId, setSelectedExamId] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null,
  );
  const [quickScanOpen, setQuickScanOpen] = useState(false);
  const [quickScanValue, setQuickScanValue] = useState("");
  const [search, setSearch] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterCourseProgram, setFilterCourseProgram] = useState("");
  const [filterCourseTerm, setFilterCourseTerm] = useState("");
  const [filterStudyType, setFilterStudyType] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [entryPage, setEntryPage] = useState(1);
  const [entryPageSize, setEntryPageSize] = useState(50);
  const [drafts, setDrafts] = useState<Record<string, DraftGrade>>({});
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const [savedRows, setSavedRows] = useState<Record<string, string>>({});
  const [gradeEntryNotice, setGradeEntryNotice] =
    useState<GradeEntryNotice | null>(null);
  const [entryNotesByExam, setEntryNotesByExam] = useState<
    Record<string, string>
  >({});
  const [missingStudentsNote, setMissingStudentsNote] = useState("");
  const [editableRows, setEditableRows] = useState<Record<string, boolean>>({});
  const [reactivationWarningsAccepted, setReactivationWarningsAccepted] =
    useState<Record<string, boolean>>({});
  const [clockTick, setClockTick] = useState(0);
  const [entrySheetStudents, setEntrySheetStudents] = useState<Student[]>([]);
  const [entrySheetGrades, setEntrySheetGrades] = useState<Grade[]>([]);
  const [entrySheetLeaves, setEntrySheetLeaves] = useState<StudentLeave[]>([]);
  const [entrySheetOpportunityLogs, setEntrySheetOpportunityLogs] = useState<
    OpportunityLog[]
  >([]);
  const [entrySheetCourseChapters, setEntrySheetCourseChapters] = useState<
    CourseChapter[]
  >([]);
  const [entrySheetLoading, setEntrySheetLoading] = useState(false);
  const [entrySheetError, setEntrySheetError] = useState<string | null>(null);
  const gradeInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const missingStudentsNoteLoadedRef = useRef("");
  const {
    locked: clearingAbsentGrades,
    runLocked: runClearAbsentGradesLocked,
  } = useActionLock();

  useEffect(() => {
    setEntryNotesByExam(readStoredGradeEntryNotes());
  }, []);

  useEffect(() => {
    writeStoredGradeEntryNotes(entryNotesByExam);
  }, [entryNotesByExam]);

  const showGradeEntryNotice = useCallback(
    (type: GradeEntryNotice["type"], message: string) => {
      setGradeEntryNotice({ type, message, at: Date.now() });
    },
    [],
  );

  useEffect(() => {
    if (!gradeEntryNotice) return;
    const timeout = window.setTimeout(
      () =>
        setGradeEntryNotice((current) =>
          current?.at === gradeEntryNotice.at ? null : current,
        ),
      gradeEntryNotice.type === "success" ? 2200 : 5000,
    );
    return () => window.clearTimeout(timeout);
  }, [gradeEntryNotice]);

  useEffect(() => {
    const selectedExam = exams.find((exam) => exam.id === selectedExamId);
    if (!selectedExam) {
      setEntrySheetStudents([]);
      setEntrySheetGrades([]);
      setEntrySheetLeaves([]);
      setEntrySheetOpportunityLogs([]);
      setEntrySheetCourseChapters([]);
      setEntrySheetError(null);
      setEntrySheetLoading(false);
      return;
    }

    let cancelled = false;
    setEntrySheetLoading(true);
    setEntrySheetError(null);

    gradeEntrySheetApi
      .get(selectedExam.id)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setEntrySheetStudents([]);
          setEntrySheetGrades([]);
          setEntrySheetLeaves([]);
          setEntrySheetOpportunityLogs([]);
          setEntrySheetCourseChapters([]);
          setEntrySheetError(
            "تعذر تحميل ورقة إدخال الدرجات من قاعدة البيانات. حدّث الصفحة أو تحقق من صلاحية الحساب.",
          );
          return;
        }

        const loadedStudents = (result.students || []) as unknown as Student[];
        const loadedGrades = (result.grades || []) as unknown as Grade[];
        const loadedLeaves = (result.studentLeaves ||
          []) as unknown as StudentLeave[];
        const loadedOpportunityLogs = (result.opportunityLogs ||
          []) as unknown as OpportunityLog[];
        const loadedCourseChapters = (result.courseChapters ||
          []) as unknown as CourseChapter[];

        setEntrySheetStudents(loadedStudents);
        setEntrySheetGrades(loadedGrades);
        setEntrySheetLeaves(loadedLeaves);
        setEntrySheetOpportunityLogs(loadedOpportunityLogs);
        setEntrySheetCourseChapters(loadedCourseChapters);
        mergeStudentsCache(loadedStudents);
        mergeGradesCache(loadedGrades);
      })
      .catch(() => {
        if (cancelled) return;
        setEntrySheetStudents([]);
        setEntrySheetGrades([]);
        setEntrySheetLeaves([]);
        setEntrySheetOpportunityLogs([]);
        setEntrySheetCourseChapters([]);
        setEntrySheetError(
          "تعذر تحميل ورقة إدخال الدرجات من قاعدة البيانات. حدّث الصفحة أو تحقق من صلاحية الحساب.",
        );
      })
      .finally(() => {
        if (!cancelled) setEntrySheetLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedExamId, exams, mergeStudentsCache, mergeGradesCache]);

  const availableProgramsForFilter = useMemo(
    () =>
      getAcademicCourseProgramFilterOptions(
        courses,
        { courseId: filterCourseId },
        students,
      ),
    [courses, students, filterCourseId],
  );

  const availableStudyTypesForFilter = useMemo(
    () =>
      getAcademicStudyTypeFilterOptions(
        courses,
        { courseId: filterCourseId, courseProgram: filterCourseProgram },
        students,
      ),
    [courses, students, filterCourseId, filterCourseProgram],
  );

  const locationFilterOptions = useMemo(
    () =>
      getAcademicLocationFilterOptions(students, {
        courseId: filterCourseId,
        courseProgram: filterCourseProgram,
        courseTerm: filterCourseProgram === "كورسات" ? filterCourseTerm : "",
        studyType: filterStudyType,
      }),
    [
      students,
      filterCourseId,
      filterCourseProgram,
      filterCourseTerm,
      filterStudyType,
    ],
  );

  useEffect(() => {
    if (
      filterCourseProgram &&
      !availableProgramsForFilter.includes(filterCourseProgram as any)
    ) {
      setFilterCourseProgram("");
      return;
    }
    if (filterCourseProgram !== "كورسات" && filterCourseTerm) {
      setFilterCourseTerm("");
    }
    if (
      filterStudyType &&
      !availableStudyTypesForFilter.includes(filterStudyType as any)
    ) {
      setFilterStudyType("");
    }
    if (filterLocation && !locationFilterOptions.includes(filterLocation)) {
      setFilterLocation("");
    }
  }, [
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    filterLocation,
    availableProgramsForFilter,
    availableStudyTypesForFilter,
    locationFilterOptions,
  ]);

  useEffect(() => {
    setEntryPage(1);
  }, [
    selectedExamId,
    search,
    filterCourseId,
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

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      showGradeEntryNotice(
        "error",
        detail?.message ||
          "تعذر مزامنة التغيير الآن، وتم الاحتفاظ به محلياً للمحاولة لاحقاً.",
      );
    };
    window.addEventListener("teacherpro:grade-entry-sync-error", handler);
    return () =>
      window.removeEventListener("teacherpro:grade-entry-sync-error", handler);
  }, [showGradeEntryNotice]);

  const selectedExam = exams.find((e) => e.id === selectedExamId);
  const selectedExamEntryNotes = selectedExamId
    ? entryNotesByExam[selectedExamId] || ""
    : "";

  const entryStudentsSource = useMemo(
    () => (selectedExam ? entrySheetStudents : students),
    [selectedExam, entrySheetStudents, students],
  );

  const entryGradesSource = useMemo(() => {
    if (!selectedExamId) return grades;
    const byKey = new Map<string, Grade>();
    for (const grade of entrySheetGrades) {
      byKey.set(`${grade.studentId}:${grade.examId}`, grade);
    }
    for (const grade of grades) {
      if (grade.examId === selectedExamId) {
        byKey.set(`${grade.studentId}:${grade.examId}`, grade);
      }
    }
    return Array.from(byKey.values());
  }, [entrySheetGrades, grades, selectedExamId]);

  const entryLeavesSource = useMemo(
    () => (selectedExam ? entrySheetLeaves : studentLeaves),
    [selectedExam, entrySheetLeaves, studentLeaves],
  );

  const entryOpportunityLogsSource = useMemo(() => {
    if (!selectedExamId) return opportunityLogs;
    const byId = new Map<string, OpportunityLog>();
    for (const log of entrySheetOpportunityLogs) byId.set(log.id, log);
    for (const log of opportunityLogs) {
      if (log.examId === selectedExamId || log.action === "إعادة تفعيل") {
        byId.set(log.id, log);
      }
    }
    return Array.from(byId.values());
  }, [entrySheetOpportunityLogs, opportunityLogs, selectedExamId]);

  const entryCourseChaptersSource = useMemo(
    () => (selectedExam ? entrySheetCourseChapters : courseChapters),
    [selectedExam, entrySheetCourseChapters, courseChapters],
  );

  useEffect(() => {
    const savedNote = selectedExam
      ? findGradeEntryMissingNote(selectedExam.id)?.text || ""
      : "";
    missingStudentsNoteLoadedRef.current = savedNote;
    setMissingStudentsNote(savedNote);
  }, [selectedExam?.id]);

  useEffect(() => {
    if (!selectedExam) return;
    const timer = window.setTimeout(() => {
      const normalizedCurrent = missingStudentsNote.trim();
      const normalizedLoaded = missingStudentsNoteLoadedRef.current.trim();
      if (normalizedCurrent === normalizedLoaded) return;

      upsertGradeEntryMissingNote({
        examId: selectedExam.id,
        examName: selectedExam.name,
        examDate: selectedExam.date,
        text: missingStudentsNote,
      });
      missingStudentsNoteLoadedRef.current = normalizedCurrent;
    }, 450);
    return () => window.clearTimeout(timer);
  }, [missingStudentsNote, selectedExam]);
  const activeExams = useMemo(
    () => exams.filter((e) => isExamAvailableForEntry(e)),
    [exams, clockTick],
  );

  const filteredActiveExams = useMemo(
    () =>
      activeExams.filter((exam) =>
        examMatchesAcademicFilters(
          exam,
          {
            courseId: filterCourseId,
            courseProgram: filterCourseProgram,
            courseTerm: filterCourseTerm,
            studyType: filterStudyType,
          },
          { courses, students },
        ),
      ),
    [
      activeExams,
      courses,
      students,
      filterCourseId,
      filterCourseProgram,
      filterCourseTerm,
      filterStudyType,
    ],
  );

  useEffect(() => {
    if (
      selectedExamId &&
      !filteredActiveExams.some((exam) => exam.id === selectedExamId)
    ) {
      setSelectedExamId("");
      setDrafts({});
      setEditableRows({});
      setSavedRows({});
      setReactivationWarningsAccepted({});
    }
  }, [filteredActiveExams, selectedExamId]);
  const normalizedSearch = useMemo(() => normalizeForSearch(search), [search]);
  const studentById = useMemo(
    () => new Map(entryStudentsSource.map((student) => [student.id, student])),
    [entryStudentsSource],
  );
  const activeChapterCourseIds = useMemo(
    () =>
      new Set(
        entryCourseChaptersSource
          .filter((link) => link.active && !link.archived)
          .map((link) => link.courseId),
      ),
    [entryCourseChaptersSource],
  );
  const gradeByStudentId = useMemo(() => {
    const map = new Map<string, (typeof grades)[number]>();
    if (!selectedExamId) return map;
    for (const grade of entryGradesSource) {
      if (grade.examId === selectedExamId) map.set(grade.studentId, grade);
    }
    return map;
  }, [entryGradesSource, selectedExamId]);
  const leaveByStudentId = useMemo(() => {
    const map = new Map<string, (typeof studentLeaves)[number]>();
    if (!selectedExam) return map;
    const examDate = String(selectedExam.date || "").slice(0, 10);
    for (const leave of entryLeavesSource) {
      if ((leave.leaveType || "exam") === "period") {
        const from = String(leave.dateFrom || leave.date || "").slice(0, 10);
        const to = String(
          leave.dateTo || leave.dateFrom || leave.date || "",
        ).slice(0, 10);
        if (examDate && from && to && examDate >= from && examDate <= to) {
          map.set(leave.studentId, leave);
        }
      } else if (leave.examId === selectedExam.id) {
        map.set(leave.studentId, leave);
      }
    }
    return map;
  }, [selectedExam, entryLeavesSource]);
  const automaticEffectStudentIds = useMemo(() => {
    const set = new Set<string>();
    if (!selectedExamId) return set;
    for (const log of entryOpportunityLogsSource) {
      if (
        log.examId === selectedExamId &&
        (log.action === "خصم تلقائي" ||
          log.action === "فصل تلقائي" ||
          String(log.reason || "").startsWith("تلقائي:"))
      ) {
        set.add(log.studentId);
      }
    }
    return set;
  }, [entryOpportunityLogsSource, selectedExamId]);
  const manuallyReactivatedStudentIds = useMemo(() => {
    const set = new Set<string>();
    for (const log of entryOpportunityLogsSource) {
      if (log.action === "إعادة تفعيل") set.add(log.studentId);
    }
    return set;
  }, [entryOpportunityLogsSource]);
  const studentSearchTextById = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of entryStudentsSource) {
      map.set(
        student.id,
        normalizeForSearch(
          [
            student.name,
            student.code,
            student.telegram,
            student.phone,
            student.parentPhone,
            student.school,
            student.subSite,
            student.locationScope,
            student.mainSite,
          ].join(" "),
        ),
      );
    }
    return map;
  }, [entryStudentsSource]);

  const getGrade = (studentId: string) => gradeByStudentId.get(studentId);

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

  const getStudentLeaveForSelectedExam = (studentId: string) =>
    leaveByStudentId.get(studentId);

  const isStudentInGraceForSelectedExam = (studentId: string) => {
    if (!selectedExam) return false;
    const student = studentById.get(studentId);
    return Boolean(
      student && isExamWithinStudentGracePeriod(student, selectedExam),
    );
  };

  const gradeHasAutomaticEffect = (studentId: string, examId: string) =>
    examId === selectedExamId && automaticEffectStudentIds.has(studentId);

  const canEditGradeForStudent = (studentId: string) => {
    const student = studentById.get(studentId);
    const grade = getGrade(studentId);
    if (!student) return false;
    if (student.status === "مؤرشف") return false;
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
    manuallyReactivatedStudentIds.has(studentId);

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
    const student = studentById.get(studentId);
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
    } as Grade;
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

  const requestReactivatedStudentGradeEdit = (
    studentId: string,
    draftOverride: DraftGrade | undefined,
    onConfirm: () => void,
    onCancel?: () => void,
  ) => {
    if (!needsReactivationWarning(studentId, draftOverride)) {
      onConfirm();
      return;
    }
    const student = studentById.get(studentId);
    setPendingConfirm({
      title: "تأكيد تعديل درجة طالب مُعاد تنشيطه",
      description: `درجة ${student?.name || "هذا الطالب"} الجديدة قد تستهلك الفرصة الأخيرة وتعيد الطالب إلى المفصولين. هل تريد المتابعة؟`,
      confirmLabel: "متابعة",
      destructive: true,
      onConfirm: () => {
        const key = reactivationWarningKey(studentId);
        setReactivationWarningsAccepted((prev) => ({ ...prev, [key]: true }));
        onConfirm();
      },
      onCancel,
    });
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

    return entryStudentsSource
      .filter((student) => {
        const grade = gradeByStudentId.get(student.id);
        const hasSavedGradeForExam = Boolean(grade);
        const matchesSearch = normalizedSearch
          ? (studentSearchTextById.get(student.id) || "").includes(
              normalizedSearch,
            )
          : true;

        if (normalizedSearch && !matchesSearch) return false;

        // عند البحث: إذا كان للطالب درجة محفوظة لهذا الامتحان، اعرضه حتى لو
        // تغيرت دورته/موقعه أو لم يعد ضمن الفصل النشط. هذا يحمي السجل من
        // الاختفاء ويجعل البحث يجد أي طالب درجته موجودة.
        const forceShowSavedGradeSearchResult = Boolean(
          normalizedSearch && hasSavedGradeForExam && matchesSearch,
        );

        if (!forceShowSavedGradeSearchResult) {
          if (student.status === "مؤرشف") return false;
          if (!selectedExam.courseIds.includes(student.courseId)) return false;
          if (filterCourseId && student.courseId !== filterCourseId) return false;
          if (!isExamOnOrAfterStudentRegistration(student, selectedExam))
            return false;
          if (!activeChapterCourseIds.has(student.courseId)) return false;
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
        }

        const hasLeave = leaveByStudentId.has(student.id);
        const hasGrace = isExamWithinStudentGracePeriod(student, selectedExam);
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
    entryStudentsSource,
    gradeByStudentId,
    leaveByStudentId,
    activeChapterCourseIds,
    normalizedSearch,
    studentSearchTextById,
    filterCourseId,
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

  const commitSearch = useCallback((value: string) => {
    setSearch((current) => (current === value ? current : value));
  }, []);

  const focusFirstGradeInput = useCallback(
    () => focusGradeInputAt(0),
    [gradeInputStudentIds],
  );

  const missingChapterCourses = useMemo(() => {
    if (!selectedExam) return [];
    return selectedExam.courseIds
      .filter(
        (courseId) =>
          !hasActiveChapterLink(entryCourseChaptersSource, courseId),
      )
      .map((courseId) => courseName(courseId));
  }, [selectedExam, entryCourseChaptersSource, courseName]);

  const saveGrade = async (
    studentId: string,
    draftOverride?: DraftGrade,
    options: { silent?: boolean; skipReactivationWarning?: boolean } = {},
  ) => {
    if (!selectedExam) return;
    const leave = getStudentLeaveForSelectedExam(studentId);
    if (leave) {
      showGradeEntryNotice(
        "error",
        `الطالب مجاز لهذا الامتحان ولا يمكن إدخال درجة له${leave.reason ? `: ${leave.reason}` : ""}`,
      );
      return;
    }
    if (!canEditGradeForStudent(studentId)) {
      showGradeEntryNotice(
        "error",
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
        showGradeEntryNotice(
          "error",
          `لا تُعد الدرجة مدخلة إلا إذا كانت رقماً بين 0 و ${selectedExam.fullMark}`,
        );
        return;
      }
    }

    if (
      !options.skipReactivationWarning &&
      needsReactivationWarning(studentId, draft)
    ) {
      requestReactivatedStudentGradeEdit(
        studentId,
        draft,
        () =>
          void saveGrade(studentId, draft, {
            ...options,
            skipReactivationWarning: true,
          }),
      );
      return;
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
    // اعرض وقت الحفظ بتوقيت بغداد بصيغة إنكليزية (HH:MM) لتطابق صيغة
    // formatGradeEntryTimestamp المستخدمة في عرض وقت الإدخال.
    const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
    const baghdadNow = new Date(Date.now() + BAGHDAD_OFFSET_MS);
    const hh = String(baghdadNow.getUTCHours()).padStart(2, "0");
    const mm = String(baghdadNow.getUTCMinutes()).padStart(2, "0");
    setSavedRows((prev) => ({
      ...prev,
      [studentId]: `تم حفظها ${hh}:${mm}`,
    }));
    if (!options.silent)
      showGradeEntryNotice(
        "success",
        "تم حفظ الدرجة محلياً وستتم مزامنتها تلقائياً",
      );
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
            setEntrySheetGrades((current) =>
              current.filter((grade) => grade.id !== existing.id),
            );
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
      requestReactivatedStudentGradeEdit(
        studentId,
        draft,
        () =>
          void saveGrade(studentId, draft, {
            silent: true,
            skipReactivationWarning: true,
          }),
        () => restoreDraftFromSavedGrade(studentId),
      );
      return;
    }

    void saveGrade(studentId, draft, {
      silent: true,
      skipReactivationWarning: true,
    });
  };

  const missingExamStudents = useMemo(() => {
    if (!selectedExam) return [];
    const selectedMainSites = splitSelection(selectedExam.mainSite);

    return entryStudentsSource
      .filter((student) => {
        if (!selectedExam.courseIds.includes(student.courseId)) return false;
        if (filterCourseId && student.courseId !== filterCourseId) return false;
        if (!isExamOnOrAfterStudentRegistration(student, selectedExam))
          return false;
        if (!activeChapterCourseIds.has(student.courseId)) return false;
        if (!studentMatchesExamMainSites(student, selectedMainSites))
          return false;
        const leave = getStudentLeaveForSelectedExam(student.id);
        if (leave) return false;
        if (!canEditGradeForStudent(student.id)) return false;
        const grade = getGrade(student.id);
        return !isGradeEntered(grade, selectedExam);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [
    selectedExam,
    entryStudentsSource,
    activeChapterCourseIds,
    leaveByStudentId,
    gradeByStudentId,
    automaticEffectStudentIds,
  ]);

  const absentGradesForSelectedExam = useMemo(
    () =>
      selectedExam
        ? entryGradesSource.filter(
            (grade) =>
              grade.examId === selectedExam.id && grade.status === "غائب",
          )
        : [],
    [selectedExam, entryGradesSource],
  );

  const handleClearAbsentGrades = runClearAbsentGradesLocked(async () => {
    if (!selectedExam) return;
    if (absentGradesForSelectedExam.length === 0) {
      toast.info("لا توجد حالات غياب محفوظة لهذا الامتحان");
      return;
    }

    setPendingConfirm({
      title: "إلغاء حالات الغياب",
      description: `سيتم إلغاء حالة غائب من ${absentGradesForSelectedExam.length} طالب في امتحان ${selectedExam.name} وإرجاعهم كأن الدرجة لم تُسجل لهم. هل تريد المتابعة؟`,
      confirmLabel: "إلغاء الغياب",
      destructive: true,
      onConfirm: () => {
        void handleClearAbsentGradesConfirmed();
      },
    });
  });

  const handleClearAbsentGradesConfirmed = async () => {
    if (!selectedExam) return;
    const affectedStudentIds = new Set(
      absentGradesForSelectedExam.map((grade) => grade.studentId),
    );
    const removedCount = clearAbsentGradesForExam(selectedExam.id);

    if (removedCount > 0) {
      setEntrySheetGrades((current) =>
        current.filter(
          (grade) =>
            grade.examId !== selectedExam.id || grade.status !== "غائب",
        ),
      );
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
  };

  const handleMarkAllMissingAsAbsent = () => {
    if (!selectedExam) return;
    if (missingExamStudents.length === 0) {
      toast.info("لا يوجد طلاب بدون درجة لتسجيلهم غائبين في هذا الامتحان");
      return;
    }
    setPendingConfirm({
      title: "تسجيل غير المدخلين كغائبين",
      description: `سيتم تسجيل ${missingExamStudents.length} طالب من كل طلاب الدورة المرتبطين بامتحان ${selectedExam.name} كغائبين. لن يتم تعديل أي درجة موجودة مسبقًا. هل تريد المتابعة؟`,
      confirmLabel: "تسجيل كغائب",
      destructive: true,
      onConfirm: handleMarkAllMissingAsAbsentConfirmed,
    });
  };

  const handleMarkAllMissingAsAbsentConfirmed = () => {
    if (!selectedExam) return;

    const timestamp = new Date().toLocaleTimeString("ar-IQ", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const nextDrafts: Record<string, DraftGrade> = {};
    const nextSavedRows: Record<string, string> = {};
    const nextEditableRows: Record<string, boolean> = {};

    missingExamStudents.forEach((student) => {
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
    toast.success(
      `تم تسجيل ${missingExamStudents.length} طالب من كل طلاب الامتحان كغائب وستتم المزامنة تلقائياً`,
    );
  };

  const handleQuickScan = () => {
    setQuickScanValue(search);
    setQuickScanOpen(true);
  };

  const submitQuickScan = () => {
    const value = quickScanValue.trim();
    if (value) setSearch(value);
    setQuickScanOpen(false);
  };

  const handleExamChange = (examId: string) => {
    setSelectedExamId(examId);
    setDrafts({});
    setEditableRows({});
    setSavedRows({});
    setReactivationWarningsAccepted({});
  };

  const updateSelectedExamEntryNotes = (value: string) => {
    if (!selectedExamId) return;
    setEntryNotesByExam((current) => ({ ...current, [selectedExamId]: value }));
  };

  const clearSelectedExamEntryNotes = () => {
    if (!selectedExamId) return;
    setEntryNotesByExam((current) => {
      const next = { ...current };
      delete next[selectedExamId];
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {gradeEntryNotice && (
        <div className="pointer-events-none fixed right-4 top-4 z-[100] w-[calc(100vw-2rem)] max-w-sm print:hidden sm:right-6 sm:top-6">
          <div
            role={gradeEntryNotice.type === "error" ? "alert" : "status"}
            className={`pointer-events-auto rounded-2xl border p-3 text-sm shadow-2xl backdrop-blur-md ${
              gradeEntryNotice.type === "success"
                ? "border-emerald-200 bg-emerald-50/95 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/90 dark:text-emerald-50"
                : gradeEntryNotice.type === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive shadow-destructive/10 dark:bg-destructive/20"
                  : "border-sky-200 bg-sky-50/95 text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/90 dark:text-sky-50"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="leading-6">{gradeEntryNotice.message}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2"
                onClick={() => setGradeEntryNotice(null)}
              >
                إخفاء
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog
        open={Boolean(pendingConfirm)}
        onOpenChange={(open) => {
          if (open) return;
          pendingConfirm?.onCancel?.();
          setPendingConfirm(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingConfirm?.title || "تأكيد العملية"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className={
                pendingConfirm?.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              onClick={() => {
                const action = pendingConfirm?.onConfirm;
                setPendingConfirm(null);
                action?.();
              }}
            >
              {pendingConfirm?.confirmLabel || "تأكيد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={quickScanOpen} onOpenChange={setQuickScanOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>بحث / مسح QR</DialogTitle>
            <DialogDescription>
              امسح QR/باركود أو اكتب كود الطالب للبحث.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={quickScanValue}
            onChange={(event) => setQuickScanValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitQuickScan();
            }}
            placeholder="كود الطالب أو النص المقروء من الماسح"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setQuickScanOpen(false)}
            >
              إلغاء
            </Button>
            <Button type="button" onClick={submitQuickScan}>
              بحث
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>تسجيل الدرجات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="grade-entry-course">اسم الدورة</Label>
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
                  {filteredActiveExams.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} ({e.type}) - {formatAppDate(e.date)}
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
              onClick={handleMarkAllMissingAsAbsent}
              disabled={!selectedExam || missingExamStudents.length === 0}
              title="يسجل كل طلاب الدورة المرتبطين بهذا الامتحان الذين لا يملكون درجة محفوظة كغائبين، وليس الصفحة الحالية فقط"
            >
              تسجيل الكل كغائب ({missingExamStudents.length})
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

          {selectedExam && (
            <div className="mt-4 rounded-2xl border bg-muted/25 p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Label
                    htmlFor="grade-entry-general-notes"
                    className="text-sm font-black"
                  >
                    ملاحظات مدخل الدرجات
                  </Label>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    اكتب أي ملاحظات سريعة تخص هذا الامتحان، مثل اسم طالب ودرجته
                    أو حالة طالب غير موجود. هذه الملاحظات لا تدخل ضمن الدرجات
                    ولا تغيّر بيانات الطلاب.
                  </p>
                </div>
                {selectedExamEntryNotes.trim() && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 text-xs"
                    onClick={clearSelectedExamEntryNotes}
                  >
                    مسح الملاحظات
                  </Button>
                )}
              </div>
              <textarea
                id="grade-entry-general-notes"
                value={selectedExamEntryNotes}
                onChange={(event) =>
                  updateSelectedExamEntryNotes(event.target.value)
                }
                placeholder={`مثال: طالب اسمه أحمد علي درجته 42 وغير موجود ضمن القائمة / صورة ورقة غير واضحة / ملاحظة خاصة بامتحان ${selectedExam.name}`}
                className="min-h-[140px] w-full resize-y rounded-2xl border bg-background px-4 py-3 text-sm leading-6 outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  محفوظة محلياً لهذا الامتحان فقط حتى لو تم تحديث الصفحة.
                </span>
                <span>{selectedExamEntryNotes.length} حرف</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedExam && (
        <Card className="border-amber-200/70 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">
                  ملاحظات مدخل الدرجات
                </CardTitle>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  اكتب هنا أسماء أو درجات طلاب غير موجودين أثناء إدخال درجات هذا
                  الامتحان. ستظهر كل الملاحظات لاحقاً من زر الطلاب الغير موجودين
                  في لوحة النظام.
                </p>
              </div>
              {missingStudentsNote.trim() && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    deleteGradeEntryMissingNote(selectedExam.id);
                    missingStudentsNoteLoadedRef.current = "";
                    setMissingStudentsNote("");
                  }}
                >
                  مسح الملاحظات
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <textarea
              id="grade-entry-missing-students-note"
              value={missingStudentsNote}
              onChange={(event) => setMissingStudentsNote(event.target.value)}
              placeholder="مثال: الطالب أحمد علي غير موجود بالقائمة، درجته 84. أو: طالبة باسم زينب غير مضافة لهذا الامتحان..."
              className="min-h-[120px] w-full resize-y rounded-2xl border border-input bg-background px-4 py-3 text-sm leading-7 shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>يتم الحفظ تلقائياً لكل امتحان على حدة.</span>
              {missingStudentsNote.trim() && (
                <span>{missingStudentsNote.trim().length} حرف</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!selectedExam && (
        <Card>
          <CardHeader>
            <CardTitle>ورقة إدخال الدرجة</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="empty-state">
              اختر الامتحان من الأعلى حتى تظهر ورقة إدخال الدرجات هنا مباشرة.
            </p>
          </CardContent>
        </Card>
      )}

      {selectedExam && (
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-col gap-3 lg:flex-row-reverse lg:items-end lg:justify-between">
              <div className="w-full space-y-2 text-right lg:max-w-sm">
                <Label htmlFor="grade-entry-search">
                  بحث الطالب داخل الإدخال
                </Label>
                <GradeEntrySearchInput
                  value={search}
                  onCommit={commitSearch}
                  onForwardTab={focusFirstGradeInput}
                />
              </div>
              <div className="text-right">
                <CardTitle>
                  ورقة إدخال الدرجة - {examStudents.length} طالب
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  البحث هنا يجد الطالب حتى لو تغيرت دورته ما دامت درجته محفوظة
                  لهذا الامتحان، ويعرض وقت إدخال الدرجة في السجل.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {entrySheetLoading && (
              <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-sm font-medium text-primary">
                جاري تحميل ورقة إدخال الدرجات من قاعدة البيانات...
              </div>
            )}
            {entrySheetError && (
              <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive">
                {entrySheetError}
              </div>
            )}
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
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
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
                  {entrySheetLoading
                    ? "جاري تجهيز ورقة إدخال الدرجة..."
                    : entrySheetError
                      ? "تعذر تحميل الطلاب من قاعدة البيانات لهذا الامتحان."
                      : "لا يوجد طلاب مطابقون للفلاتر أو للدورات المربوطة بفصل نشط."}
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
                      className="teacherpro-heavy-row grid grid-cols-1 items-center gap-3 rounded-2xl border bg-card/80 p-3 shadow-sm xl:grid-cols-[1.5fr_130px_130px_1fr_170px]"
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
                        {grade && (
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <Badge variant="outline" className="text-[10px]">
                              الدرجة موجودة
                            </Badge>
                            <span>
                              وقت الإدخال: {formatGradeEntryTimestamp(grade.createdAt)}
                            </span>
                            {grade.updatedAt &&
                              grade.createdAt &&
                              String(grade.updatedAt) !== String(grade.createdAt) && (
                                <span>
                                  آخر تعديل: {formatGradeEntryTimestamp(grade.updatedAt)}
                                </span>
                              )}
                          </div>
                        )}
                        {normalizedSearch &&
                          grade &&
                          (!selectedExam.courseIds.includes(student.courseId) ||
                            !activeChapterCourseIds.has(student.courseId) ||
                            !studentMatchesExamMainSites(
                              student,
                              splitSelection(selectedExam.mainSite),
                            ) ||
                            student.status === "مؤرشف") && (
                            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                              ظهر هذا الطالب لأن له درجة محفوظة لهذا الامتحان،
                              حتى لو لم يعد مطابقاً للدورة أو الموقع أو الفصل
                              الحالي.
                            </p>
                          )}
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
                            showGradeEntryNotice(
                              "error",
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
