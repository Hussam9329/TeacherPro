"use client";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useTeacherStore,
  type CourseTransferPolicy,
  type Student,
} from "@/lib/teacher-store";
import { useShallow } from "zustand/react/shallow";
import {
  studentApi,
  studentStatsApi,
  courseApi,
  type StudentAcademicUpdateImpactResponse,
  type StudentDeleteImpactResponse,
} from "@/lib/api";
import { baghdadDateKey } from "@/lib/baghdad-time";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/user-toast";
import {
  getPhoneValidationError,
  sanitizePhoneInput,
  toLatinDigits,
} from "@/lib/format";
import {
  getAvailablePrograms,
  getAvailableStudyTypesForProgram,
  getBaghdadSites,
  getProvinceOptions,
  getLocationScopes,
  getBaghdadMode,
  OUT_OF_COUNTRY_LOCATION_SCOPE,
} from "@/lib/course-config";
import {
  getStudentDuplicateMessage,
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import { getRequiredTextError } from "@/lib/validation";
import { useActionLock } from "@/hooks/use-action-lock";
import {
  AlertTriangle,
  Eye,
  RotateCcw,
  SearchX,
  UserPlus,
} from "lucide-react";
import { EmptyState, ListPagination } from "./ui-kit";
import { ListToolbar } from "./list-toolbar";
import { StudentProfileDialog } from "./student-profile-dialog";
import {
  StudentRegistryResults,
  formatRegistryLocation,
  registryIssueFilterLabels,
  studentMatchesRegistryIssue,
  type RegistryIssueFilter,
} from "./student-registry-results";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ExportDialog, type ExportFetchContext } from "./export-dialog";
import { collectStudentExportPages } from "@/lib/student-export-pagination";
import {
  studentMatchesListFilters,
} from "@/lib/student-list-filters";
import {
  getAcademicCourseProgramFilterOptions,
  getAcademicLocationFilterOptions,
  getAcademicStudyTypeFilterOptions,
} from "@/lib/filter-sequence";
import {
  ARCHIVED_STUDENT_STATUS,
  STUDENT_REGISTRY_STATE_KEY,
  emptyEditForm,
  getStudentRegistryCapabilities,
  getStudentEditForm,
  formatStudentCurrentGrace,
  reconcileRegistryRowsAfterMutation,
  studentExportColumns,
  studentMatchesRegistrySearch,
  telegramLink,
  whatsappLink,
  type RegistryViewMode,
  type StudentEditForm,
} from "./student-registry-helpers";
import {
  prepareStudentEditRecovery,
  resolveStudentEditRecovery,
  type StudentEditField,
  type StudentEditRecovery,
  type StudentEditRecoveryChoice,
} from "./student-edit-recovery";
import { StudentRegistryEditDialog } from "./student-registry-edit-dialog";
import { StudentRegistryFilters } from "./student-registry-filters";
import { StudentRegistryStatusDialogs } from "./student-registry-status-dialogs";
import "./student-registry.css";

export function StudentRegistryView() {
  const {
    students,
    courses,
    exams,
    grades,
    opportunityLogs,
    studentLeaves,
    studentCalls,
    studentNotes,
    logs,
    setSection,
    courseName,
    activeChapterForCourse,
    mergeStudentsCache,
    currentUser,
  } = useTeacherStore(
    useShallow((state) => ({ students: state.students, courses: state.courses, exams: state.exams, grades: state.grades, opportunityLogs: state.opportunityLogs, studentLeaves: state.studentLeaves, studentCalls: state.studentCalls, studentNotes: state.studentNotes, logs: state.logs, setSection: state.setSection, courseName: state.courseName, activeChapterForCourse: state.activeChapterForCourse, mergeStudentsCache: state.mergeStudentsCache, currentUser: state.currentUser, /* re-render when these change: */ users: state.users, currentUserId: state.currentUserId, isAuthenticated: state.isAuthenticated, courseChapters: state.courseChapters, chapters: state.chapters })),
  );

  const registryUser = currentUser();
  const { isAdmin, canAddStudents, canEditStudents, canArchiveStudents } =
    getStudentRegistryCapabilities(registryUser);
  const registryStateStorageKey = `${STUDENT_REGISTRY_STATE_KEY}:${
    registryUser?.id || registryUser?.username || "guest"
  }`;

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterCourseProgram, setFilterCourseProgram] = useState("");
  const [filterCourseTerm, setFilterCourseTerm] = useState("");
  const [filterStudyType, setFilterStudyType] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterRegistryIssue, setFilterRegistryIssue] =
    useState<RegistryIssueFilter>("");
  const [viewMode, setViewMode] = useState<RegistryViewMode>("cards");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [hydratedRegistryStorageKey, setHydratedRegistryStorageKey] =
    useState("");
  const registryStateHydrated =
    hydratedRegistryStorageKey === registryStateStorageKey;
  const skipRegistryStatePersistKey = useRef("");

  // خيارات الفلاتر تُشتق من إعدادات الدورة/نظام الاشتراك المختارة، وليس من قوائم ثابتة.
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

  // عند تغيير فلتر سابق، يتم تنظيف أي فلتر تابع صار غير متاح.
  useEffect(() => {
    if (!registryStateHydrated) return;
    const clearedFilters: string[] = [];
    if (
      filterCourseProgram &&
      availableProgramsForFilter.length > 0 &&
      !availableProgramsForFilter.includes(filterCourseProgram as any)
    ) {
      setFilterCourseProgram("");
      clearedFilters.push("نظام الاشتراك");
    }
    if (filterCourseProgram !== "كورسات" && filterCourseTerm) {
      setFilterCourseTerm("");
      clearedFilters.push("الكورس المطلوب");
    }
    if (
      filterStudyType &&
      availableStudyTypesForFilter.length > 0 &&
      !availableStudyTypesForFilter.includes(filterStudyType as any)
    ) {
      setFilterStudyType("");
      clearedFilters.push("نظام الدراسة");
    }
    if (clearedFilters.length > 0) {
      setPage(1);
      toast.warning("تم مسح فلتر تابع لم يعد متاحاً", {
        description: clearedFilters.join("، "),
      });
    }
  }, [
    registryStateHydrated,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    availableProgramsForFilter,
    availableStudyTypesForFilter,
  ]);

  useEffect(() => {
    setHydratedRegistryStorageKey("");
    setSearch("");
    setFilterStatus("");
    setFilterGender("");
    setFilterCourseId("");
    setFilterCourseProgram("");
    setFilterCourseTerm("");
    setFilterStudyType("");
    setFilterLocation("");
    setFilterRegistryIssue("");
    setViewMode("cards");
    setPageSize(10);
    setPage(1);
    try {
      const raw = window.localStorage.getItem(registryStateStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      const savedIssue = String(saved.registryIssue || "");
      const savedStatus = String(saved.status || "");
      const savedGender = String(saved.gender || "");
      const savedPageSize = Number(saved.pageSize);
      const savedPage = Number(saved.page);

      setSearch(String(saved.search || ""));
      setFilterStatus(
        ["نشط", "مفصول", ARCHIVED_STUDENT_STATUS].includes(savedStatus)
          ? savedStatus
          : "",
      );
      setFilterGender(["ذكر", "أنثى"].includes(savedGender) ? savedGender : "");
      setFilterCourseId(String(saved.courseId || ""));
      setFilterCourseProgram(String(saved.courseProgram || ""));
      setFilterCourseTerm(String(saved.courseTerm || ""));
      setFilterStudyType(String(saved.studyType || ""));
      setFilterLocation(String(saved.location || ""));
      setFilterRegistryIssue(
        savedIssue && savedIssue in registryIssueFilterLabels
          ? (savedIssue as RegistryIssueFilter)
          : "",
      );
      setViewMode(saved.viewMode === "table" ? "table" : "cards");
      setPageSize([10, 50, 100].includes(savedPageSize) ? savedPageSize : 10);
      setPage(Number.isInteger(savedPage) && savedPage > 0 ? savedPage : 1);
    } catch {
      try {
        window.localStorage.removeItem(registryStateStorageKey);
      } catch {
        // Keep defaults when browser storage is unavailable.
      }
    } finally {
      skipRegistryStatePersistKey.current = registryStateStorageKey;
      setHydratedRegistryStorageKey(registryStateStorageKey);
    }
  }, [registryStateStorageKey]);

  useEffect(() => {
    if (!registryStateHydrated || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("section") !== "student-registry") return;
    const issue = String(params.get("registryIssue") || "");
    if (issue && issue in registryIssueFilterLabels) {
      setFilterRegistryIssue(issue as RegistryIssueFilter);
      setPage(1);
    }
  }, [registryStateHydrated]);

  useEffect(() => {
    if (!registryStateHydrated) return;
    if (skipRegistryStatePersistKey.current === registryStateStorageKey) {
      skipRegistryStatePersistKey.current = "";
      return;
    }
    try {
      window.localStorage.setItem(
        registryStateStorageKey,
        JSON.stringify({
          search,
          status: filterStatus,
          gender: filterGender,
          courseId: filterCourseId,
          courseProgram: filterCourseProgram,
          courseTerm: filterCourseTerm,
          studyType: filterStudyType,
          location: filterLocation,
          registryIssue: filterRegistryIssue,
          viewMode,
          pageSize,
          page,
        }),
      );
    } catch {
      // Keep the registry usable when browser storage is unavailable.
    }
  }, [
    registryStateHydrated,
    registryStateStorageKey,
    search,
    filterStatus,
    filterGender,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    filterLocation,
    filterRegistryIssue,
    viewMode,
    pageSize,
    page,
  ]);
  const [serverStudents, setServerStudents] = useState<Student[] | null>(null);
  const [serverTotalCount, setServerTotalCount] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [serverStudentsLoading, setServerStudentsLoading] = useState(true);
  const [serverStudentsError, setServerStudentsError] = useState<string | null>(
    null,
  );
  const [serverRefreshKey, setServerRefreshKey] = useState(0);
  const syncKey = useTeacherProSyncKey([
    "students",
    "courses",
    "opportunities",
    "grades",
    "follow-up",
    "dashboard",
  ]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const [studentsSystemTotal, setStudentsSystemTotal] = useState<number | null>(
    null,
  );
  const [activeStudentsTotal, setActiveStudentsTotal] = useState<number | null>(
    null,
  );
  const [dismissedStudentsTotal, setDismissedStudentsTotal] = useState<
    number | null
  >(null);
  const [archivedStudentsTotal, setArchivedStudentsTotal] = useState<
    number | null
  >(null);
  const [otherStudentsTotal, setOtherStudentsTotal] = useState<number | null>(
    null,
  );
  const [statusChipCounts, setStatusChipCounts] = useState<{
    total: number; active: number; dismissed: number; archived: number;
  } | null>(null);
  const [noActiveChapterStudentsTotal, setNoActiveChapterStudentsTotal] =
    useState<number | null>(null);
  const [studentStatsLoading, setStudentStatsLoading] = useState(true);
  const [studentStatsError, setStudentStatsError] = useState<string | null>(
    null,
  );
  const [studentStatsRefreshKey, setStudentStatsRefreshKey] = useState(0);
  const [suppressedIssueRows, setSuppressedIssueRows] = useState<{
    issue: RegistryIssueFilter;
    ids: string[];
  }>({ issue: "", ids: [] });
  const registryResultsRef = useRef<HTMLDivElement>(null);

  const [dismissDialog, setDismissDialog] = useState<{
    student: Student | null;
    open: boolean;
  }>({ student: null, open: false });
  const [dismissReason, setDismissReason] = useState("");
  const [dismissNotes, setDismissNotes] = useState("");
  const [restoreDialog, setRestoreDialog] = useState<{
    student: Student | null;
    open: boolean;
  }>({ student: null, open: false });

  const [fileDialog, setFileDialog] = useState<{
    student: Student | null;
    open: boolean;
  }>({ student: null, open: false });
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    id: string;
    form: StudentEditForm;
  }>({ open: false, id: "", form: emptyEditForm });
  const [editOriginalStudent, setEditOriginalStudent] =
    useState<Student | null>(null);
  const [editRecoveryReason, setEditRecoveryReason] = useState<
    "conflict" | "unknown" | null
  >(null);
  const [editRecovery, setEditRecovery] = useState<{
    student: Student;
    review: StudentEditRecovery;
  } | null>(null);
  const [editRecoveryChoices, setEditRecoveryChoices] = useState<
    Partial<Record<StudentEditField, StudentEditRecoveryChoice>>
  >({});
  const [editRecoveryLoading, setEditRecoveryLoading] = useState(false);
  const editRecoveryRequest = useRef(0);
  const editRecoveryPanel = useRef<HTMLDivElement>(null);
  const [courseTransferPolicy, setCourseTransferPolicy] = useState<
    CourseTransferPolicy | ""
  >("");
  const [academicImpactPreview, setAcademicImpactPreview] =
    useState<StudentAcademicUpdateImpactResponse | null>(null);
  const [academicImpactPreviewSignature, setAcademicImpactPreviewSignature] =
    useState("");
  const [academicImpactConfirmed, setAcademicImpactConfirmed] = useState(false);
  const [academicImpactLoading, setAcademicImpactLoading] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    id: "",
    studentName: "",
  });
  const [deleteImpact, setDeleteImpact] =
    useState<StudentDeleteImpactResponse | null>(null);
  const [deleteImpactLoading, setDeleteImpactLoading] = useState(false);
  const { locked: isSavingEdit, runLocked: runSaveEditLocked } =
    useActionLock();
  const { locked: isDeletingStudent, runLocked: runDeleteStudentLocked } =
    useActionLock();
  const { locked: isStatusActionSaving, runLocked: runStatusActionLocked } =
    useActionLock();
  // Wait for a pause in typing so a name is one request, not one per letter.
  const debouncedSearch = useDebouncedValue(search, 350);
  const registrySearchPending = search !== debouncedSearch;
  const studentListRequestId = useRef(0);
  const studentStatsRequestId = useRef(0);

  // Fetch location filter options from server (distinct query, not all students)
  const [locationFilterOptions, setLocationFilterOptions] = useState<string[]>(
    [],
  );
  const locationFilterContextKey = JSON.stringify([
    filterStatus,
    filterGender,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
  ]);
  const [loadedLocationFilterContextKey, setLoadedLocationFilterContextKey] =
    useState("");

  useEffect(() => {
    setServerStudents(null);
    setServerTotalCount(0);
    setServerTotalPages(1);
    setServerStudentsError(null);
    setServerStudentsLoading(true);
    setStudentsSystemTotal(null);
    setActiveStudentsTotal(null);
    setDismissedStudentsTotal(null);
    setArchivedStudentsTotal(null);
    setOtherStudentsTotal(null);
    setNoActiveChapterStudentsTotal(null);
    setStudentStatsError(null);
    setStudentStatsLoading(true);
    setSuppressedIssueRows({ issue: "", ids: [] });
    setLocationFilterOptions([]);
    setLoadedLocationFilterContextKey("");
  }, [registryStateStorageKey]);

  useEffect(() => {
    if (!registryStateHydrated) return;
    setLoadedLocationFilterContextKey("");
    const params = new URLSearchParams();
    if (filterStatus) params.set("status", filterStatus);
    if (filterGender) params.set("gender", filterGender);
    if (filterCourseId) params.set("courseId", filterCourseId);
    if (filterCourseProgram) params.set("courseProgram", filterCourseProgram);
    if (filterCourseProgram === "كورسات" && filterCourseTerm) {
      params.set("courseTerm", filterCourseTerm);
    }
    if (filterStudyType) params.set("studyType", filterStudyType);

    const fallbackLocations = () =>
      getAcademicLocationFilterOptions(
        filterGender
          ? students.filter((student) => student.gender === filterGender)
          : students,
        {
          courseId: filterCourseId,
          courseProgram: filterCourseProgram,
          courseTerm: filterCourseProgram === "كورسات" ? filterCourseTerm : "",
          studyType: filterStudyType,
        },
      );

    const controller = new AbortController();

    fetch(
      `/api/students/filter-options${params.size ? `?${params.toString()}` : ""}`,
      {
        credentials: "same-origin",
        signal: controller.signal,
      },
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (controller.signal.aborted) return;
        if (Array.isArray(data?.locationOptions)) {
          setLocationFilterOptions(data.locationOptions.filter(Boolean));
          setLoadedLocationFilterContextKey(locationFilterContextKey);
          return;
        }
        if (Array.isArray(data?.locations)) {
          const scopes: string[] = Array.from(
            new Set(
              data.locations
                .map(
                  (l: { scope?: string; value?: string }) => l.value || l.scope,
                )
                .filter(Boolean),
            ),
          ) as string[];
          setLocationFilterOptions(scopes);
          setLoadedLocationFilterContextKey(locationFilterContextKey);
          return;
        }
        setLocationFilterOptions(fallbackLocations());
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setLocationFilterOptions(fallbackLocations());
      });

    return () => controller.abort();
  }, [
    registryStateHydrated,
    registryStateStorageKey,
    students,
    filterStatus,
    filterGender,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    locationFilterContextKey,
    syncKey,
  ]);

  useEffect(() => {
    if (
      registryStateHydrated &&
      loadedLocationFilterContextKey === locationFilterContextKey &&
      filterLocation &&
      !locationFilterOptions.includes(filterLocation)
    ) {
      setFilterLocation("");
      setPage(1);
      toast.warning("تم مسح فلتر الموقع", {
        description: "الموقع السابق غير متاح مع الفلاتر المختارة حالياً.",
      });
    }
  }, [
    registryStateHydrated,
    filterLocation,
    locationFilterOptions,
    loadedLocationFilterContextKey,
    locationFilterContextKey,
  ]);

  useEffect(() => {
    if (!registryStateHydrated || registrySearchPending) return;
    let cancelled = false;
    const controller = new AbortController();
    const requestId = ++studentListRequestId.current;
    const requestIsStale = () =>
      cancelled || requestId !== studentListRequestId.current;

    const silent = isBackgroundSync();
    // A refresh from a change elsewhere keeps the list and its count on
    // screen; the new rows replace them when they arrive.
    if (!silent) {
      setServerStudentsLoading(true);
      setServerStudentsError(null);
    }

    studentApi
      .list(
        {
          q: debouncedSearch,
          status: filterStatus,
          gender: filterGender,
          courseId: filterCourseId,
          courseProgram: filterCourseProgram,
          courseTerm: filterCourseProgram === "كورسات" ? filterCourseTerm : "",
          studyType: filterStudyType,
          location: filterLocation,
          registryIssue: filterRegistryIssue,
          opportunityMode: true,
          page,
          pageSize,
        },
        { signal: controller.signal, quietAbort: true },
      )
      .then((result) => {
        if (requestIsStale()) return;
        if (!result) {
          if (!silent) {
            setServerStudents(null);
            setServerStudentsError(
              "تعذر تحميل نتائج الطلاب من النظام. سيتم عرض النسخة المحلية مؤقتاً.",
            );
          }
          return;
        }

        const nextTotalPages = Math.max(1, Number(result.totalPages || 1));
        const nextStudents = (result.students || []) as unknown as Student[];
        setServerStudents(nextStudents);
        setSuppressedIssueRows({ issue: "", ids: [] });
        mergeStudentsCache(nextStudents);
        setServerTotalCount(Number(result.totalCount || 0));
        setServerTotalPages(nextTotalPages);

        if (page > nextTotalPages) {
          setPage(nextTotalPages);
        }
      })
      .catch(() => {
        if (requestIsStale() || silent) return;
        setServerStudents(null);
        setServerStudentsError(
          "تعذر تحميل نتائج الطلاب من النظام. سيتم عرض النسخة المحلية مؤقتاً.",
        );
      })
      .finally(() => {
        if (!requestIsStale()) setServerStudentsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    registryStateHydrated,
    registryStateStorageKey,
    registrySearchPending,
    debouncedSearch,
    filterStatus,
    filterGender,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    filterLocation,
    filterRegistryIssue,
    page,
    pageSize,
    serverRefreshKey,
    syncKey,
    mergeStudentsCache,
    isBackgroundSync,
  ]);

  useEffect(() => {
    if (!registryStateHydrated || registrySearchPending) return;
    let cancelled = false;
    const requestId = ++studentStatsRequestId.current;
    const requestIsStale = () =>
      cancelled || requestId !== studentStatsRequestId.current;
    // Same for the numbers on the filter buttons: they stay until the new ones come.
    const silent = isBackgroundSync();
    if (!silent) {
      setStudentStatsLoading(true);
      setStudentStatsError(null);
      setStudentsSystemTotal(null);
      setActiveStudentsTotal(null);
      setDismissedStudentsTotal(null);
      setArchivedStudentsTotal(null);
      setOtherStudentsTotal(null);
      setNoActiveChapterStudentsTotal(null);
    }
    studentStatsApi
      .get({
        q: debouncedSearch,
        status: filterStatus,
        gender: filterGender,
        courseId: filterCourseId,
        courseProgram: filterCourseProgram,
        courseTerm: filterCourseProgram === "كورسات" ? filterCourseTerm : "",
        studyType: filterStudyType,
        location: filterLocation,
        registryIssue: filterRegistryIssue,
      })
      .then((result) => {
        if (requestIsStale()) return;
        if (!result) throw new Error("student stats unavailable");
        setStudentsSystemTotal(Number(result.system.total || 0));
        setActiveStudentsTotal(Number(result.system.active || 0));
        setDismissedStudentsTotal(Number(result.system.dismissed || 0));
        setArchivedStudentsTotal(Number(result.system.archived || 0));
        setOtherStudentsTotal(Number(result.system.other || 0));
        setNoActiveChapterStudentsTotal(
          Number(result.filtered.noActiveChapter || 0),
        );
        setStatusChipCounts(result.statusCounts ? {
          total: Number(result.statusCounts.total || 0),
          active: Number(result.statusCounts.active || 0),
          dismissed: Number(result.statusCounts.dismissed || 0),
          archived: Number(result.statusCounts.archived || 0),
        } : null);
      })
      .catch(() => {
        if (requestIsStale() || silent) return;
        setStudentsSystemTotal(null);
        setActiveStudentsTotal(null);
        setDismissedStudentsTotal(null);
        setArchivedStudentsTotal(null);
        setOtherStudentsTotal(null);
        setNoActiveChapterStudentsTotal(null);
        setStudentStatsError("تعذر تحميل أعداد الطلاب حالياً.");
      })
      .finally(() => {
        if (!requestIsStale()) setStudentStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    registryStateHydrated,
    registryStateStorageKey,
    registrySearchPending,
    debouncedSearch,
    filterStatus,
    filterGender,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    filterLocation,
    filterRegistryIssue,
    studentStatsRefreshKey,
    serverRefreshKey,
    syncKey,
    isBackgroundSync,
  ]);

  const studentMatchesCurrentRegistryFilters = useCallback(
    (student: Student) => {
      if (
        debouncedSearch &&
        !studentMatchesRegistrySearch(student, debouncedSearch)
      ) {
        return false;
      }
      if (filterStatus && student.status !== filterStatus) return false;
      if (filterGender && student.gender !== filterGender) return false;
      if (filterCourseId && student.courseId !== filterCourseId) return false;
      if (!studentMatchesRegistryIssue(student, filterRegistryIssue))
        return false;
      return studentMatchesListFilters(student, {
        courseProgram: filterCourseProgram,
        courseTerm: filterCourseTerm,
        studyType: filterStudyType,
        location: filterLocation,
      });
    },
    [
      debouncedSearch,
      filterStatus,
      filterGender,
      filterCourseId,
      filterCourseProgram,
      filterCourseTerm,
      filterStudyType,
      filterLocation,
      filterRegistryIssue,
    ],
  );

  const reconcileMutationStudent = useCallback(
    (updatedStudent: Student) => {
      mergeStudentsCache([updatedStudent]);
      if (filterRegistryIssue) {
        setSuppressedIssueRows((current) => ({
          issue: filterRegistryIssue,
          ids: Array.from(new Set([...current.ids, updatedStudent.id])),
        }));
      }

      if (!serverStudents) return;
      // Mutation responses are not guaranteed to include a fresh opportunity
      // snapshot, so issue-filtered rows wait for the authoritative refresh.
      const shouldRemain =
        !filterRegistryIssue &&
        studentMatchesCurrentRegistryFilters(updatedStudent);
      const reconciliation = reconcileRegistryRowsAfterMutation(
        serverStudents,
        updatedStudent,
        shouldRemain,
      );
      setServerStudents(reconciliation.rows);

      const delta = reconciliation.totalDelta;
      if (delta !== 0) {
        const nextTotal = Math.max(0, serverTotalCount + delta);
        const nextTotalPages = Math.max(1, Math.ceil(nextTotal / pageSize));
        setServerTotalCount(nextTotal);
        setServerTotalPages(nextTotalPages);
        if (page > nextTotalPages) setPage(nextTotalPages);
      }
    },
    [
      filterRegistryIssue,
      mergeStudentsCache,
      page,
      pageSize,
      serverStudents,
      serverTotalCount,
      studentMatchesCurrentRegistryFilters,
    ],
  );


  const editFilteredCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          course.active || course.id === editOriginalStudent?.courseId,
      ),
    [courses, editOriginalStudent?.courseId],
  );

  const editSelectedCourse = useMemo(
    () => courses.find((c) => c.id === editDialog.form.courseId),
    [courses, editDialog.form.courseId],
  );

  const editCourseChanged = Boolean(
    editOriginalStudent &&
      editDialog.form.courseId &&
      editDialog.form.courseId !== editOriginalStudent.courseId,
  );

  // الفصل النشط للدورة المستهدفة يُجلب عبر API مخصص بدل الكاش المحلي،
  // حتى لا تظهر رسالة «الدورة لا تحتوي على فصل نشط» خطأً عندما يكون
  // الكاش قديماً أو غير محمّل بعد.
  const [
    editTargetActiveChapterFromServer,
    setEditTargetActiveChapterFromServer,
  ] = useState<{
    id: string;
    name: string;
    opportunities: number;
    chapterId: string;
  } | null>(null);
  const [editTargetActiveChapterLoading, setEditTargetActiveChapterLoading] =
    useState(false);
  const [editTargetActiveChapterConflict, setEditTargetActiveChapterConflict] =
    useState(false);
  const [
    editTargetActiveChapterLookupFailed,
    setEditTargetActiveChapterLookupFailed,
  ] = useState(false);

  useEffect(() => {
    const courseId = editDialog.form.courseId;
    if (!courseId || !editDialog.open) {
      setEditTargetActiveChapterFromServer(null);
      setEditTargetActiveChapterConflict(false);
      setEditTargetActiveChapterLookupFailed(false);
      return;
    }

    let cancelled = false;
    setEditTargetActiveChapterLoading(true);
    setEditTargetActiveChapterConflict(false);
    setEditTargetActiveChapterLookupFailed(false);

    courseApi
      .activeChapterForCourse(courseId)
      .then((response) => {
        if (cancelled) return;
        if (!response) {
          setEditTargetActiveChapterFromServer(null);
          setEditTargetActiveChapterConflict(false);
          setEditTargetActiveChapterLookupFailed(true);
          return;
        }
        setEditTargetActiveChapterFromServer(response.activeChapter);
        setEditTargetActiveChapterConflict(Boolean(response.conflict));
        setEditTargetActiveChapterLookupFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setEditTargetActiveChapterLookupFailed(true);
        // fallback إلى الكاش المحلي لو فشل الطلب
        setEditTargetActiveChapterFromServer(
          activeChapterForCourse(courseId)
            ? {
                id: activeChapterForCourse(courseId)!.id,
                name: activeChapterForCourse(courseId)!.name,
                opportunities: Number(
                  activeChapterForCourse(courseId)!.opportunities || 0,
                ),
                chapterId: activeChapterForCourse(courseId)!.id,
              }
            : null,
        );
      })
      .finally(() => {
        if (!cancelled) setEditTargetActiveChapterLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDialog.form.courseId, editDialog.open]);

  const editTargetActiveChapter = editTargetActiveChapterFromServer;

  const editAvailablePrograms = useMemo(
    () => (editSelectedCourse ? getAvailablePrograms(editSelectedCourse) : []),
    [editSelectedCourse],
  );

  const editEffectiveCourseProgram = useMemo(
    () =>
      editAvailablePrograms.length === 1
        ? editAvailablePrograms[0]
        : editDialog.form.courseProgram,
    [editAvailablePrograms, editDialog.form.courseProgram],
  );

  const editStudyTypeChanged = Boolean(
    editOriginalStudent &&
      editDialog.form.studyType !== String(editOriginalStudent.studyType || ""),
  );
  const editCourseProgramChanged = Boolean(
    editOriginalStudent &&
      editEffectiveCourseProgram !==
        String(editOriginalStudent.courseProgram || ""),
  );
  const editCourseTermChanged = Boolean(
    editOriginalStudent &&
      editDialog.form.courseTerm !==
        String(editOriginalStudent.courseTerm || ""),
  );
  const editLocationChanged = Boolean(
    editOriginalStudent &&
      (editDialog.form.locationScope !==
        String(editOriginalStudent.locationScope || "") ||
        editDialog.form.baghdadMode !==
          String(editOriginalStudent.baghdadMode || "") ||
        editDialog.form.subSite !== String(editOriginalStudent.subSite || "")),
  );
  const editSameCourseContextChanged =
    !editCourseChanged &&
    (editStudyTypeChanged ||
      editCourseProgramChanged ||
      editCourseTermChanged ||
      editLocationChanged);
  const editNeedsTransferPolicy =
    editCourseChanged || editSameCourseContextChanged;
  // The choice stays while other course fields change; only a move to
  // another course drops «الإبقاء», which a transfer does not offer.
  const effectiveCourseTransferPolicy: CourseTransferPolicy | "" =
    !editNeedsTransferPolicy ||
    (editCourseChanged && courseTransferPolicy === "keep")
      ? ""
      : courseTransferPolicy;
  const editRegistrationDateChanged = Boolean(
    editOriginalStudent &&
      editDialog.form.createdAt !==
        baghdadDateKey(editOriginalStudent.createdAt),
  );
  const editOriginalGraceText = editOriginalStudent
    ? formatStudentCurrentGrace(editOriginalStudent)
    : "";
  const editAcademicImpactSignature = `${editDialog.id}|${editDialog.form.createdAt}`;
  const resetWillStartNewFile =
    editNeedsTransferPolicy && effectiveCourseTransferPolicy === "reset";
  const editResetChapterUnresolved =
    resetWillStartNewFile &&
    (editTargetActiveChapterLoading ||
      editTargetActiveChapterLookupFailed ||
      editTargetActiveChapterConflict ||
      !editTargetActiveChapter);
  const editNeedsAcademicImpactPreview =
    !resetWillStartNewFile && editRegistrationDateChanged;
  const hasCurrentAcademicImpactPreview =
    academicImpactPreviewSignature === editAcademicImpactSignature &&
    Boolean(academicImpactPreview);

  const editAvailableStudyTypes = useMemo(
    () =>
      editSelectedCourse && editEffectiveCourseProgram
        ? getAvailableStudyTypesForProgram(
            editSelectedCourse,
            editEffectiveCourseProgram,
          )
        : [],
    [editSelectedCourse, editEffectiveCourseProgram],
  );

  const editLocationScopes = useMemo(
    () =>
      editSelectedCourse && editDialog.form.studyType
        ? getLocationScopes(editSelectedCourse, editDialog.form.studyType)
        : [],
    [editSelectedCourse, editDialog.form.studyType],
  );

  const editBaghdadMode = useMemo(
    () =>
      editSelectedCourse && editDialog.form.studyType
        ? getBaghdadMode(editSelectedCourse, editDialog.form.studyType)
        : undefined,
    [editSelectedCourse, editDialog.form.studyType],
  );

  const editBaghdadSites = useMemo(
    () =>
      editSelectedCourse && editDialog.form.studyType
        ? getBaghdadSites(editSelectedCourse, editDialog.form.studyType)
        : [],
    [editSelectedCourse, editDialog.form.studyType],
  );

  const editProvinces = useMemo(
    () =>
      editSelectedCourse && editDialog.form.studyType
        ? getProvinceOptions(editSelectedCourse, editDialog.form.studyType)
        : [],
    [editSelectedCourse, editDialog.form.studyType],
  );

  const isEditOutOfCountry =
    editDialog.form.locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE;

  const editSubSiteOptions = useMemo<string[]>(() => {
    if (!editSelectedCourse || !editDialog.form.studyType || isEditOutOfCountry)
      return [];
    if (editDialog.form.locationScope === "بغداد") {
      if (editBaghdadMode === "عموم بغداد") return [];
      if (editBaghdadMode === "بغداد - مخصص") return editBaghdadSites;
    }
    if (editDialog.form.locationScope === "محافظات") return editProvinces;
    return [];
  }, [
    editSelectedCourse,
    editDialog.form.studyType,
    editDialog.form.locationScope,
    isEditOutOfCountry,
    editBaghdadMode,
    editBaghdadSites,
    editProvinces,
  ]);

  // Reset dependent fields when course or studyType changes
  useEffect(() => {
    if (!editDialog.open) return;
    const patch: Partial<StudentEditForm> = {};
    let needsPatch = false;

    // Auto-select courseProgram if only one option
    if (editAvailablePrograms.length === 1 && !editDialog.form.courseProgram) {
      patch.courseProgram = editAvailablePrograms[0];
      needsPatch = true;
    }

    if (
      editDialog.form.studyType &&
      !(editAvailableStudyTypes as readonly string[]).includes(
        editDialog.form.studyType,
      )
    ) {
      patch.studyType = "";
      patch.locationScope = "";
      patch.baghdadMode = "";
      patch.subSite = "";
      needsPatch = true;
    }

    // Auto-set baghdadMode from course config
    if (editBaghdadMode && !editDialog.form.baghdadMode) {
      patch.baghdadMode = editBaghdadMode;
      needsPatch = true;
    }

    // Auto-resolve subSite for عموم بغداد
    if (
      editDialog.form.locationScope === "بغداد" &&
      editBaghdadMode === "عموم بغداد" &&
      editDialog.form.subSite !== "عموم بغداد"
    ) {
      patch.subSite = "عموم بغداد";
      needsPatch = true;
    }

    // Reset subSite if not in options
    if (
      !isEditOutOfCountry &&
      editSubSiteOptions.length > 0 &&
      editDialog.form.subSite &&
      !editSubSiteOptions.includes(editDialog.form.subSite) &&
      !(
        editDialog.form.locationScope === "بغداد" &&
        editBaghdadMode === "عموم بغداد"
      )
    ) {
      patch.subSite = "";
      needsPatch = true;
    }

    // Clear subSite if no options available
    if (
      !isEditOutOfCountry &&
      editSubSiteOptions.length === 0 &&
      editDialog.form.subSite &&
      editDialog.form.subSite !== "عموم بغداد"
    ) {
      patch.subSite = "";
      needsPatch = true;
    }

    if (!needsPatch) return;
    queueMicrotask(() => {
      setEditDialog((prev) => ({ ...prev, form: { ...prev.form, ...patch } }));
    });
  }, [
    editDialog.open,
    editDialog.form.courseProgram,
    editDialog.form.studyType,
    editDialog.form.locationScope,
    editDialog.form.baghdadMode,
    editDialog.form.subSite,
    isEditOutOfCountry,
    editAvailablePrograms,
    editAvailableStudyTypes,
    editBaghdadMode,
    editSubSiteOptions,
  ]);

  const openEditDialog = (student: Student) => {
    if (!canEditStudents) {
      toast.error("لا تملك صلاحية تعديل بيانات الطلاب");
      return;
    }
    setEditOriginalStudent(student);
    editRecoveryRequest.current += 1;
    setEditRecoveryReason(null);
    setEditRecovery(null);
    setEditRecoveryChoices({});
    setEditRecoveryLoading(false);
    setCourseTransferPolicy("");
    setAcademicImpactPreview(null);
    setAcademicImpactPreviewSignature("");
    setAcademicImpactConfirmed(false);
    setAcademicImpactLoading(false);
    setEditDialog({
      open: true,
      id: student.id,
      form: getStudentEditForm(student),
    });
  };

  useEffect(() => {
    if (editRecoveryReason) {
      editRecoveryPanel.current?.focus();
    }
  }, [editRecoveryReason]);

  useEffect(() => () => {
    editRecoveryRequest.current += 1;
  }, []);

  // A refresh of the list must never silently replace the baseline of an open
  // editor. Rebase only after the user reviews the authoritative row and any
  // conflicting fields; the next PUT still carries its new CAS token.
  const loadEditRecovery = async () => {
    if (!editOriginalStudent || !editRecoveryReason || editRecoveryLoading) return;
    const requestedId = editDialog.id;
    const request = ++editRecoveryRequest.current;
    setEditRecoveryLoading(true);
    try {
      const response = await studentApi.editSnapshot(requestedId);
      if (request !== editRecoveryRequest.current) return;
      const student = response?.student as unknown as Student | undefined;
      if (!student || student.id !== requestedId || !student.mutationToken) {
        toast.error("تعذر تحميل أحدث سجل للطالب. بقيت تعديلاتك محفوظة في النافذة؛ أعد المراجعة عند عودة الاتصال.");
        return;
      }
      setEditRecovery({
        student,
        review: prepareStudentEditRecovery(
          getStudentEditForm(editOriginalStudent),
          editDialog.form,
          getStudentEditForm(student),
        ),
      });
      setEditRecoveryChoices({});
    } catch {
      if (request === editRecoveryRequest.current) {
        toast.error("تعذر تحميل أحدث سجل للطالب. لم تُفقد تعديلاتك؛ حاول المراجعة مجدداً.");
      }
    } finally {
      if (request === editRecoveryRequest.current) setEditRecoveryLoading(false);
    }
  };

  const acceptEditRecovery = () => {
    if (!editRecovery || editRecoveryLoading) return;
    const form = resolveStudentEditRecovery(editRecovery.review, editRecoveryChoices);
    if (!form) return;
    setEditOriginalStudent(editRecovery.student);
    setEditDialog((current) => ({ ...current, form }));
    mergeStudentsCache([editRecovery.student]);
    setAcademicImpactPreview(null);
    setAcademicImpactPreviewSignature("");
    setAcademicImpactConfirmed(false);
    setCourseTransferPolicy("");
    setEditRecoveryReason(null);
    setEditRecovery(null);
    setEditRecoveryChoices({});
    setServerRefreshKey((value) => value + 1);
    toast.success("تم تحديث نسخة المراجعة دون حفظ أي تعديل", {
      description: "راجع القيم وأثر التعديل، ثم أكد الحفظ عند الحاجة.",
    });
  };

  const updateEditForm = (key: keyof StudentEditForm, value: string) => {
    setEditDialog((prev) => ({
      ...prev,
      form: { ...prev.form, [key]: toLatinDigits(value) },
    }));
  };

  const updateEditTelegram = (value: string) => {
    setEditDialog((prev) => ({
      ...prev,
      form: { ...prev.form, telegram: sanitizeTelegramInput(value) },
    }));
  };

  const updateEditUsername = (value: string) => {
    setEditDialog((prev) => ({
      ...prev,
      form: { ...prev.form, username: sanitizeTelegramInput(value) },
    }));
  };

  const updateEditPhone = (key: "phone" | "parentPhone", value: string) => {
    setEditDialog((prev) => ({
      ...prev,
      form: { ...prev.form, [key]: sanitizePhoneInput(value) },
    }));
  };

  const validateEditForm = () => {
    const form = editDialog.form;
    const requiredChecks: [boolean, string][] = [
      [Boolean(form.name.trim()), "اسم الطالب: هذا الحقل مطلوب"],
      [Boolean(form.school.trim()), "اسم المدرسة مطلوب"],
      [Boolean(form.gender), "الجنس مطلوب"],
      [Boolean(form.phone.trim()), "رقم الطالب مطلوب"],
      [Boolean(form.parentPhone.trim()), "رقم ولي الأمر مطلوب"],
      [
        Boolean(form.courseId),
        editFilteredCourses.length === 0
          ? "ماكو دورات مسجلة"
          : "يرجى اختيار اسم الدورة",
      ],
      [Boolean(form.createdAt), "تاريخ إضافة الطالب مطلوب"],
    ];

    const missing = requiredChecks.find(([ok]) => !ok);
    if (missing) return missing[1];

    if (editNeedsTransferPolicy && !effectiveCourseTransferPolicy) {
      return editCourseChanged
        ? "أكّد نقل الطالب كطالب جديد"
        : "اختر: الإبقاء على ملفه أو اعتباره طالباً جديداً";
    }

    if (editResetChapterUnresolved) {
      if (editTargetActiveChapterLoading) {
        return "انتظر اكتمال التحقق من الفصل النشط للدورة المستهدفة";
      }
      if (editTargetActiveChapterLookupFailed) {
        return "تعذر التحقق من الفصل النشط؛ أعد المحاولة قبل بدء ملف جديد";
      }
      if (editTargetActiveChapterConflict) {
        return "الدورة المستهدفة تحتوي تعارضاً بين الفصول النشطة؛ يجب حل التعارض قبل بدء ملف جديد";
      }
      return "لا يمكن بدء ملف جديد لأن الدورة المستهدفة لا تحتوي على فصل نشط";
    }

    // Course settings-based validation
    if (editAvailablePrograms.length > 1 && !form.courseProgram) {
      return "يرجى اختيار نظام الاشتراك (منهج كامل/كورسات)";
    }
    if (editEffectiveCourseProgram === "كورسات" && !form.courseTerm) {
      return "يرجى اختيار الكورس المطلوب";
    }
    if (editAvailableStudyTypes.length > 0 && !form.studyType) {
      return "يرجى اختيار نظام الدراسة";
    }
    if (editLocationScopes.length > 0 && !form.locationScope) {
      return "يرجى اختيار الموقع";
    }
    if (
      form.locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE &&
      !form.subSite.trim()
    ) {
      return "يرجى إدخال الدولة عند اختيار خارج القطر";
    }
    if (
      form.locationScope !== OUT_OF_COUNTRY_LOCATION_SCOPE &&
      editSubSiteOptions.length > 0 &&
      !form.subSite
    ) {
      return "يرجى اختيار الموقع الفرعي";
    }

    const nameError = getRequiredTextError(form.name, "اسم الطالب");
    if (nameError) return nameError;

    const phoneError = getPhoneValidationError(form.phone, "رقم الطالب", true);
    if (phoneError) return phoneError;

    const parentPhoneError = getPhoneValidationError(
      form.parentPhone,
      "رقم ولي الأمر",
      true,
    );
    if (parentPhoneError) return parentPhoneError;

    const duplicateMessage = getStudentDuplicateMessage(
      students,
      {
        id: editDialog.id,
        name: form.name,
        phone: form.phone,
        telegram: form.telegram,
      },
      editDialog.id,
      "edit",
    );
    if (duplicateMessage) return duplicateMessage.replace("إضافة", "تعديل");

    return null;
  };

  // runLocked only wraps the handler; the refs are read when it runs on save,
  // never during render, which the refs rule cannot see through.
  // eslint-disable-next-line react-hooks/refs
  const handleEditSave = runSaveEditLocked(async () => {
    if (editRecoveryReason) {
      editRecoveryPanel.current?.focus();
      return;
    }
    const error = validateEditForm();
    if (error) {
      toast.error(error);
      return;
    }

    const form = editDialog.form;
    const resolvedAcademicImpactConfirmed =
      hasCurrentAcademicImpactPreview && academicImpactConfirmed;

    if (editNeedsAcademicImpactPreview && !resolvedAcademicImpactConfirmed) {
      if (!hasCurrentAcademicImpactPreview) {
        setAcademicImpactLoading(true);
        const currentEditorRequest = editRecoveryRequest.current;
        let previewResult: Awaited<ReturnType<typeof studentApi.updateImpact>>;
        try {
          previewResult = await studentApi.updateImpact({
            studentId: editDialog.id,
            createdAt: form.createdAt,
          });
        } catch {
          if (currentEditorRequest === editRecoveryRequest.current) {
            toast.error("تعذر تحميل معاينة أثر التعديل. لم يتم إرسال طلب حفظ؛ حاول مجدداً.");
          }
          return;
        } finally {
          if (currentEditorRequest === editRecoveryRequest.current) {
            setAcademicImpactLoading(false);
          }
        }
        if (currentEditorRequest !== editRecoveryRequest.current) return;
        if (!previewResult.ok || !previewResult.data) {
          toast.error(
            previewResult.error || "تعذر معاينة أثر التغيير الأكاديمي",
          );
          return;
        }
        setAcademicImpactPreview(previewResult.data);
        setAcademicImpactPreviewSignature(editAcademicImpactSignature);
        setAcademicImpactConfirmed(false);
        toast.warning("راجع أثر تغيير تاريخ التسجيل ثم أكّد الحفظ.");
        return;
      }
      toast.warning("يجب تأكيد أثر تغيير تاريخ التسجيل قبل الحفظ.");
      return;
    }

    const transferUpdates = editNeedsTransferPolicy
      ? {
          courseTransferPolicy:
            effectiveCourseTransferPolicy as CourseTransferPolicy,
        }
      : {};
    const result = await studentApi.update(editDialog.id, {
      ...transferUpdates,
      academicImpactConfirmed:
        editNeedsAcademicImpactPreview && resolvedAcademicImpactConfirmed,
      academicImpactPreviewToken:
        editNeedsAcademicImpactPreview && hasCurrentAcademicImpactPreview
          ? academicImpactPreview?.previewToken || ""
          : "",
      expectedMutationToken: editOriginalStudent?.mutationToken || "",
      name: form.name.trim(),
      school: form.school.trim(),
      gender: form.gender,
      phone: form.phone.trim(),
      parentPhone: form.parentPhone.trim(),
      telegram: sanitizeTelegramInput(form.telegram),
      username: sanitizeTelegramInput(form.username),
      courseProgram: editEffectiveCourseProgram || "",
      courseTerm:
        editEffectiveCourseProgram === "كورسات" ? form.courseTerm : "",
      studyType: form.studyType,
      locationScope: form.locationScope,
      baghdadMode:
        form.locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE
          ? ""
          : form.baghdadMode || editBaghdadMode || "",
      courseId: form.courseId,
      mainSite: form.locationScope,
      subSite:
        form.subSite ||
        (form.locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE
          ? ""
          : editBaghdadMode === "عموم بغداد"
            ? "عموم بغداد"
            : ""),
      createdAt: form.createdAt,
    });

    if (!result.ok) {
      if (result.status === 409 || result.outcomeUnknown) {
        setAcademicImpactPreview(null);
        setAcademicImpactPreviewSignature("");
        setAcademicImpactConfirmed(false);
        setEditRecovery(null);
        setEditRecoveryChoices({});
        setEditRecoveryReason(result.outcomeUnknown ? "unknown" : "conflict");
        setServerRefreshKey((value) => value + 1);
      }
      toast.error(result.error || "تعذر تعديل بيانات الطالب");
      return;
    }
    const updatedStudent = (result.data as { student?: Student } | null)
      ?.student;
    if (updatedStudent) {
      reconcileMutationStudent(updatedStudent);
    }
    setEditDialog({ open: false, id: "", form: emptyEditForm });
    setEditOriginalStudent(null);
    setCourseTransferPolicy("");
    setAcademicImpactPreview(null);
    setAcademicImpactPreviewSignature("");
    setAcademicImpactConfirmed(false);
    setServerRefreshKey((value) => value + 1);
    toast.success("تم تعديل بيانات الطالب", {
      description:
        effectiveCourseTransferPolicy === "reset"
          ? "بدأ الطالب بملف جديد."
          : effectiveCourseTransferPolicy === "keep"
            ? "بقي ملفه كما هو."
            : "تم تحديث بيانات الطالب بنجاح.",
    });
  });

  const openDeleteDialog = (student: Student) => {
    if (!canArchiveStudents) {
      toast.error("لا تملك صلاحية أرشفة الطلاب");
      return;
    }
    if (registryServerUnavailable) {
      toast.error(
        "لا يمكن أرشفة طالب أثناء عرض نسخة محلية مؤقتة. أعد الاتصال بالنظام ثم حاول مجدداً.",
      );
      return;
    }
    setDeleteDialog({ open: true, id: student.id, studentName: student.name });
    setDeleteImpact(null);
    setDeleteImpactLoading(true);
    studentApi
      .deleteImpact(student.id)
      .then((result) => setDeleteImpact(result))
      .catch(() => setDeleteImpact(null))
      .finally(() => setDeleteImpactLoading(false));
  };

  const handleDeleteConfirm = runDeleteStudentLocked(async () => {
    if (registryServerUnavailable) {
      toast.error("لا يمكن أرشفة طالب أثناء عرض نسخة محلية مؤقتة.");
      return;
    }
    const previewToken = deleteImpact?.previewToken || "";
    if (!previewToken) {
      toast.error("يجب اكتمال معاينة علاقات الطالب قبل تأكيد الأرشفة");
      return;
    }
    const result = await studentApi.remove(deleteDialog.id, { previewToken });
    if (!result.ok) {
      if (result.status === 409) {
        setDeleteImpactLoading(true);
        const refreshedImpact = await studentApi
          .deleteImpact(deleteDialog.id)
          .catch(() => null);
        setDeleteImpact(refreshedImpact);
        setDeleteImpactLoading(false);
        toast.warning(result.error || "تغيرت بيانات الطالب المرتبطة", {
          description: refreshedImpact
            ? "تم تحديث معاينة العلاقات. راجع الأعداد الجديدة ثم أكّد الأرشفة مرة أخرى."
            : "تعذر تحديث المعاينة؛ أغلق النافذة وافتحها مجدداً بعد التحقق من الاتصال.",
        });
        return;
      }
      toast.error(result.error || "تعذر أرشفة الطالب");
      return;
    }
    const responseStudent = (result.data as { student?: Student } | null)
      ?.student;
    const sourceStudent =
      serverStudents?.find((student) => student.id === deleteDialog.id) ||
      students.find((student) => student.id === deleteDialog.id);
    const archivedStudent =
      responseStudent ||
      (sourceStudent
        ? ({
            ...sourceStudent,
            status: ARCHIVED_STUDENT_STATUS,
          } as Student)
        : null);
    if (archivedStudent) {
      reconcileMutationStudent(archivedStudent);
    } else {
      setServerStudents((prev) =>
        prev ? prev.filter((student) => student.id !== deleteDialog.id) : prev,
      );
    }
    setServerRefreshKey((value) => value + 1);
    toast.success("تمت أرشفة الطالب بدل الحذف النهائي", {
      description: "بقيت درجاته وإجازاته ومكالماته وفرصه وملاحظاته محفوظة.",
    });
    setDeleteDialog({ open: false, id: "", studentName: "" });
    setDeleteImpact(null);
  });

  const localFiltered = useMemo(() => {
    const suppressedIds =
      filterRegistryIssue && suppressedIssueRows.issue === filterRegistryIssue
        ? new Set(suppressedIssueRows.ids)
        : null;
    return students.filter(
      (student) =>
        !suppressedIds?.has(student.id) &&
        studentMatchesCurrentRegistryFilters(student),
    );
  }, [
    students,
    filterRegistryIssue,
    suppressedIssueRows,
    studentMatchesCurrentRegistryFilters,
  ]);

  const usingServerStudents = Boolean(serverStudents);
  const filtered = usingServerStudents ? serverStudents! : localFiltered;
  const filteredTotalCount = usingServerStudents
    ? serverTotalCount
    : localFiltered.length;
  const totalPages = usingServerStudents
    ? serverTotalPages
    : Math.max(1, Math.ceil(localFiltered.length / pageSize));
  const paged = usingServerStudents
    ? filtered
    : localFiltered.slice((page - 1) * pageSize, page * pageSize);
  const registryServerUnavailable = Boolean(
    serverStudentsError && !serverStudents,
  );
  const closeDismissDialog = () => {
    setDismissDialog({ student: null, open: false });
    setDismissReason("");
    setDismissNotes("");
  };
  const openDismissDialog = (student: Student) => {
    if (!canEditStudents) {
      toast.error("لا تملك صلاحية فصل الطلاب");
      return;
    }
    setDismissReason("");
    setDismissNotes("");
    setDismissDialog({ student, open: true });
  };
  const handleDismiss = runStatusActionLocked(async () => {
    if (!dismissDialog.student) return;
    if (!canEditStudents) {
      toast.error("لا تملك صلاحية فصل الطلاب");
      closeDismissDialog();
      return;
    }
    if (registryServerUnavailable) {
      toast.error(
        "لا يمكن فصل طالب أثناء عرض نسخة محلية مؤقتة. أعد الاتصال بالنظام ثم حاول مجدداً.",
      );
      return;
    }
    if (!dismissReason.trim()) {
      toast.error("يرجى إدخال سبب الفصل");
      return;
    }
    const result = await studentApi.statusAction({
      action: "dismiss",
      studentId: dismissDialog.student.id,
      reason: dismissReason.trim(),
      notes: dismissNotes.trim(),
      expectedStatus: dismissDialog.student.status,
      expectedMutationToken: dismissDialog.student.mutationToken || "",
    });
    if (!result.ok) {
      toast.error(result.error || "تعذر فصل الطالب");
      return;
    }
    const updatedStudent = (result.data as { student?: Student } | null)
      ?.student;
    if (updatedStudent) {
      reconcileMutationStudent(updatedStudent);
    }
    closeDismissDialog();
    setServerRefreshKey((value) => value + 1);
    toast.success("تم فصل الطالب");
  });

  const handleRestoreArchived = runStatusActionLocked(
    async (student: Student) => {
      if (!canEditStudents) {
        toast.error("لا تملك صلاحية استعادة الطلاب من الأرشيف");
        return;
      }
      if (registryServerUnavailable) {
        toast.error("لا يمكن استعادة طالب أثناء عرض نسخة محلية مؤقتة.");
        return;
      }
      if (student.status !== ARCHIVED_STUDENT_STATUS) {
        setRestoreDialog({ student: null, open: false });
        toast.error(
          "الاستعادة من سجل الطلاب مخصصة للطالب المؤرشف فقط. استرجاع المفصول يتم من إدارة المفصولين.",
        );
        return;
      }
      const result = await studentApi.statusAction({
        action: "restore",
        studentId: student.id,
        expectedStatus: student.status,
        expectedMutationToken: student.mutationToken || "",
      });
      if (!result.ok) {
        toast.error(result.error || "تعذر استعادة الطالب من الأرشيف");
        return;
      }
      const statusResult = result.data as {
        student?: Student;
        warning?: string | null;
      } | null;
      const updatedStudent = statusResult?.student;
      if (updatedStudent) reconcileMutationStudent(updatedStudent);
      setRestoreDialog({ student: null, open: false });
      setServerRefreshKey((value) => value + 1);
      if (statusResult?.warning) {
        toast.warning("تمت استعادة الطالب من الأرشيف", {
          description: statusResult.warning,
        });
      } else {
        toast.success("تمت استعادة الطالب من الأرشيف");
      }
    },
  );

  // Export rows: use current filtered results (server or local).
  // For full server-side export, the ExportDialog fetches from /api/students/export
  // with the same filter params — this local mapping is for preview only.
  const studentExportRows = (
    usingServerStudents ? serverStudents! : localFiltered
  ).map((student) => ({
    ...student,
    courseName: courseName(student.courseId),
    locationText: formatRegistryLocation(student),
  }));

  const fetchStudentExportRows = async ({
    signal,
    onProgress,
  }: ExportFetchContext) => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (filterStatus) params.set("status", filterStatus);
    if (filterGender) params.set("gender", filterGender);
    if (filterCourseId) params.set("courseId", filterCourseId);
    if (filterCourseProgram) params.set("courseProgram", filterCourseProgram);
    if (filterCourseProgram === "كورسات" && filterCourseTerm) {
      params.set("courseTerm", filterCourseTerm);
    }
    if (filterStudyType) params.set("studyType", filterStudyType);
    if (filterLocation) params.set("location", filterLocation);
    if (filterRegistryIssue) params.set("registryIssue", filterRegistryIssue);
    type ExportStudent = Student & {
      courseName?: string;
      course?: { name?: string } | null;
    };
    const exportedStudents = await collectStudentExportPages<ExportStudent>(
      async ({
        cursor,
        snapshotAt,
        pageSize: exportPageSize,
        signal: pageSignal,
      }) => {
        const pageParams = new URLSearchParams(params);
        pageParams.set("pageSize", String(exportPageSize));
        if (cursor) pageParams.set("cursor", cursor);
        if (snapshotAt) pageParams.set("snapshotAt", snapshotAt);
        const res = await fetch(
          `/api/students/export?${pageParams.toString()}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: pageSignal,
          },
        );
        const json = (await res.json().catch(() => null)) as {
          students?: ExportStudent[];
          totalCount?: number;
          hasMore?: boolean;
          nextCursor?: string | null;
          snapshotAt?: string;
          error?: string;
        } | null;
        if (!res.ok) {
          throw new Error(json?.error || "تعذر تحميل صفحة من بيانات التصدير.");
        }
        return {
          students: json?.students || [],
          totalCount: Number(json?.totalCount),
          hasMore: Boolean(json?.hasMore),
          nextCursor: json?.nextCursor || null,
          snapshotAt: String(json?.snapshotAt || ""),
        };
      },
      {
        pageSize: 500,
        signal,
        onProgress: ({ loaded, total }) => onProgress(loaded, total),
      },
    );

    return exportedStudents.map((student) => ({
      ...student,
      courseName:
        student.courseName ||
        student.course?.name ||
        courseName(student.courseId),
      locationText: formatRegistryLocation(student),
    }));
  };

  const resetFilters = () => {
    setSearch("");
    setFilterStatus("");
    setFilterGender("");
    setFilterCourseId("");
    setFilterCourseProgram("");
    setFilterCourseTerm("");
    setFilterStudyType("");
    setFilterLocation("");
    setFilterRegistryIssue("");
    setPage(1);
  };
  const hasActiveRegistryFilters = Boolean(
    search.trim() ||
      filterStatus ||
      filterGender ||
      filterCourseId ||
      filterCourseProgram ||
      filterCourseTerm ||
      filterStudyType ||
      filterLocation ||
      filterRegistryIssue,
  );
  const registryStatsPending =
    !registryStateHydrated || registrySearchPending || studentStatsLoading;
  const registryResultsPending =
    !registryStateHydrated || registrySearchPending || serverStudentsLoading;

  const activeFileStudent = fileDialog.student
    ? students.find((student) => student.id === fileDialog.student?.id) ||
      fileDialog.student
    : null;

  if (fileDialog.open && activeFileStudent) {
    return (
      <StudentProfileDialog
        student={activeFileStudent}
        open
        onOpenChange={(open) => {
          if (!open) setFileDialog({ student: null, open: false });
        }}
        exams={exams}
        grades={grades}
        opportunityLogs={opportunityLogs}
        studentLeaves={studentLeaves}
        studentCalls={studentCalls}
        studentNotes={studentNotes}
        logs={logs}
        courseName={courseName}
        activeChapterForCourse={activeChapterForCourse}
        whatsappLink={whatsappLink}
        telegramLink={telegramLink}
      />
    );
  }

  return (
    <div className="tp-management-page tp-student-registry tp-list">
      <ListToolbar
        label="البحث والتصفية في سجل الطلاب"
        search={
          <Input
            id="registry-search"
            name="search"
            data-teacherpro-search="true"
            autoComplete="off"
            aria-label="بحث في سجل الطلاب"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="ابحث بالاسم أو الكود أو التليگرام أو الهاتف"
          />
        }
        actions={
          <>
            <ExportDialog
              title="تصدير سجل الطلاب"
              fileName="students"
              rows={studentExportRows}
              fetchRows={fetchStudentExportRows}
              totalRowCount={filteredTotalCount}
              disabled={registryResultsPending || registryServerUnavailable}
              columns={studentExportColumns}
              triggerLabel="تصدير"
              description="تقرير سجل الطلاب حسب الفلاتر الحالية"
            />
            {hasActiveRegistryFilters && (
              <Button variant="ghost" onClick={resetFilters}>
                <RotateCcw className="size-4" aria-hidden="true" />
                تصفير الكل
              </Button>
            )}
          </>
        }
        chips={[
          { key: "", label: "الكل", hint: `كل طلاب النظام: ${studentsSystemTotal ?? "—"}`, count: registryStatsPending || studentStatsError ? null : (statusChipCounts?.total ?? null) },
          { key: "نشط", label: "نشط", tone: "success", hint: `كل النشطين بالنظام: ${activeStudentsTotal ?? "—"}`, count: registryStatsPending || studentStatsError ? null : (statusChipCounts?.active ?? null) },
          { key: "مفصول", label: "مفصول", tone: "danger", hint: `كل المفصولين بالنظام: ${dismissedStudentsTotal ?? "—"}`, count: registryStatsPending || studentStatsError ? null : (statusChipCounts?.dismissed ?? null) },
          { key: ARCHIVED_STUDENT_STATUS, label: "مؤرشف", tone: "muted", hint: `عرض المؤرشفين · كلهم بالنظام: ${archivedStudentsTotal ?? "—"}`, count: registryStatsPending || studentStatsError ? null : (statusChipCounts?.archived ?? null) },
        ]}
        chipsLabel="حالة الطالب"
        activeChip={filterStatus}
        onChipChange={(value) => {
          if (value === ARCHIVED_STUDENT_STATUS) setFilterStatus(ARCHIVED_STUDENT_STATUS);
          else setFilterStatus(value);
          setPage(1);
        }}
        activeFilterCount={
          Number(Boolean(filterCourseId)) + Number(Boolean(filterCourseProgram)) +
          Number(Boolean(filterStudyType)) + Number(Boolean(filterLocation)) +
          Number(Boolean(filterGender)) + Number(Boolean(filterRegistryIssue))
        }
        activeFilters={[
          ...(filterCourseId
            ? [{ key: "course", label: `الدورة: ${courses.find((course) => course.id === filterCourseId)?.name || "—"}`, onClear: () => { setFilterCourseId(""); setPage(1); } }]
            : []),
          ...(filterCourseProgram
            ? [{ key: "program", label: `الاشتراك: ${filterCourseProgram}`, onClear: () => { setFilterCourseProgram(""); setFilterCourseTerm(""); setPage(1); } }]
            : []),
          ...(filterCourseProgram === "كورسات" && filterCourseTerm
            ? [{ key: "term", label: `الكورس: ${filterCourseTerm}`, onClear: () => { setFilterCourseTerm(""); setPage(1); } }]
            : []),
          ...(filterStudyType
            ? [{ key: "study", label: `الدراسة: ${filterStudyType}`, onClear: () => { setFilterStudyType(""); setPage(1); } }]
            : []),
          ...(filterLocation
            ? [{ key: "location", label: `الموقع: ${filterLocation}`, onClear: () => { setFilterLocation(""); setPage(1); } }]
            : []),
          ...(filterGender
            ? [{ key: "gender", label: `الجنس: ${filterGender}`, onClear: () => { setFilterGender(""); setPage(1); } }]
            : []),
          ...(filterRegistryIssue
            ? [{ key: "issue", label: registryIssueFilterLabels[filterRegistryIssue], onClear: () => { setFilterRegistryIssue(""); setPage(1); } }]
            : []),
        ]}
        onClearFilters={resetFilters}
        filters={
          <StudentRegistryFilters
            filterCourseId={filterCourseId}
            setFilterCourseId={setFilterCourseId}
            setPage={setPage}
            courses={courses}
            filterCourseProgram={filterCourseProgram}
            setFilterCourseProgram={setFilterCourseProgram}
            availableProgramsForFilter={availableProgramsForFilter}
            filterCourseTerm={filterCourseTerm}
            setFilterCourseTerm={setFilterCourseTerm}
            filterStudyType={filterStudyType}
            setFilterStudyType={setFilterStudyType}
            availableStudyTypesForFilter={availableStudyTypesForFilter}
            filterLocation={filterLocation}
            setFilterLocation={setFilterLocation}
            locationFilterOptions={locationFilterOptions}
            filterGender={filterGender}
            setFilterGender={setFilterGender}
            filterRegistryIssue={filterRegistryIssue}
            setFilterRegistryIssue={setFilterRegistryIssue}
            viewMode={viewMode}
            setViewMode={setViewMode}
            pageSize={pageSize}
            setPageSize={setPageSize}
          />
        }
        summary={
          registryResultsPending ? (
            "جاري التحميل…"
          ) : (
            <>
              المعروض <b>{paged.length}</b> من <b>{filteredTotalCount}</b>
              {registryServerUnavailable ? " (نسخة محلية)" : ""}
              {!registryStatsPending && !studentStatsError && (noActiveChapterStudentsTotal ?? 0) > 0 ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="font-bold text-warning underline-offset-4 hover:underline"
                    onClick={() => {
                      setFilterRegistryIssue("no-active-chapter");
                      setPage(1);
                    }}
                  >
                    {noActiveChapterStudentsTotal} بدون فصل نشط
                  </button>
                </>
              ) : null}
            </>
          )
        }
      />

      {!registryStatsPending &&
        !studentStatsError &&
        (otherStudentsTotal ?? 0) > 0 && (
          <Card
            role="alert"
            className="border-warning-line bg-warning-soft"
            data-count-scope="system"
          >
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <AlertTriangle
                  aria-hidden="true"
                  className="size-5 shrink-0 text-warning"
                />
                <div>
                  <p className="font-bold text-warning">
                    حالات طلاب غير معروفة: {otherStudentsTotal}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    توجد حالات خارج نشط ومفصول ومؤرشف.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetFilters}
              >
                <Eye aria-hidden="true" className="size-4" />
                عرض كل الحالات
              </Button>
            </CardContent>
          </Card>
        )}

      {studentStatsError && !registryStatsPending && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-sm font-medium text-danger"
        >
          <span>{studentStatsError}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStudentStatsRefreshKey((value) => value + 1)}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            إعادة المحاولة
          </Button>
        </div>
      )}

      <div
        ref={registryResultsRef}
        className="space-y-3"
        aria-live="polite"
        aria-busy={registryResultsPending}
      >
              {registryResultsPending && (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-sm font-medium text-primary"
                >
                  جاري تحميل الطلاب...
                </div>
              )}

              {serverStudentsError && !registrySearchPending && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="rounded-2xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-3 text-sm font-medium text-warning"
                >
                  <strong>{serverStudentsError}</strong>
                  <span className="mt-1 block text-xs">
                    المعروض الآن نسخة محلية جزئية وقد لا تشمل جميع الطلاب. تم
                    إيقاف التعديل والفصل والأرشفة مؤقتاً حتى تعود بيانات النظام،
                    منعاً للتعامل مع بيانات قديمة.
                  </span>
                </div>
              )}

              {registryServerUnavailable &&
              filteredTotalCount === 0 &&
              !registryResultsPending ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="لا تتوفر نتائج محلية كافية"
                  description="تعذر الاتصال ببيانات النظام، والنسخة المحلية الجزئية لا تحتوي نتائج لهذه الفلاتر. هذا لا يعني عدم وجود طلاب في النظام."
                />
              ) : !registryServerUnavailable &&
                students.length === 0 &&
                filteredTotalCount === 0 &&
                !registryResultsPending ? (
                <EmptyState
                  icon={UserPlus}
                  title="لم تقم بإضافة طلاب بعد"
                  description={
                    canAddStudents
                      ? "ابدأ بإضافة أول طالب، وبعدها ستظهر البطاقات والفلاتر والإحصائيات هنا تلقائياً."
                      : "ماكو سجلات طلاب متاحة للعرض حالياً."
                  }
                  action={
                    canAddStudents ? (
                      <Button
                        onClick={() => setSection("student-register")}
                        className="tp-student-registry__empty-action"
                      >
                        <UserPlus aria-hidden="true" className="size-4" />
                        إضافة طالب الآن
                      </Button>
                    ) : undefined
                  }
                />
              ) : filteredTotalCount === 0 ? (
                <EmptyState
                  icon={SearchX}
                  title="ماكو نتائج مطابقة"
                  description="الفلاتر تعمل معاً؛ غيّر شروط البحث أو امسح الفلاتر لعرض كل الطلاب."
                  action={
                    <Button
                      variant="outline"
                      onClick={resetFilters}
                      className="tp-student-registry__empty-action"
                    >
                      <RotateCcw aria-hidden="true" className="size-4" />
                      مسح الفلاتر
                    </Button>
                  }
                />
              ) : (
                <StudentRegistryResults
                  students={paged}
                  viewMode={viewMode}
                  activeIssue={filterRegistryIssue}
                  courseName={courseName}
                  whatsappLink={whatsappLink}
                  telegramLink={telegramLink}
                  canEdit={canEditStudents}
                  canArchive={canArchiveStudents}
                  serverUnavailable={registryServerUnavailable}
                  statusActionSaving={isStatusActionSaving}
                  deleting={isDeletingStudent}
                  onFile={(student) => setFileDialog({ student, open: true })}
                  onEdit={openEditDialog}
                  onDismiss={openDismissDialog}
                  onRestore={(student) =>
                    setRestoreDialog({ student, open: true })
                  }
                  onArchive={openDeleteDialog}
                  onContactSaved={(studentId, field, value) =>
                    setServerStudents((current) =>
                      current
                        ? current.map((item) => (item.id === studentId ? { ...item, [field]: value ?? "" } : item))
                        : current,
                    )
                  }
                />
              )}

              <ListPagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                scrollTarget={registryResultsRef}
                label="صفحات سجل الطلاب"
                summary={<>صفحة <b>{page}</b> من <b>{totalPages}</b> · المعروض في الصفحة: <b>{paged.length}</b></>}
              />
      </div>

      <StudentRegistryEditDialog
        editDialog={editDialog}
        isSavingEdit={isSavingEdit}
        setEditDialog={setEditDialog}
        editRecoveryRequestRef={editRecoveryRequest}
        setEditRecoveryReason={setEditRecoveryReason}
        setEditRecovery={setEditRecovery}
        setEditRecoveryLoading={setEditRecoveryLoading}
        setEditOriginalStudent={setEditOriginalStudent}
        setCourseTransferPolicy={setCourseTransferPolicy}
        editRecoveryReason={editRecoveryReason}
        editRecoveryPanel={editRecoveryPanel}
        editRecovery={editRecovery}
        editRecoveryChoices={editRecoveryChoices}
        setEditRecoveryChoices={setEditRecoveryChoices}
        courses={courses}
        loadEditRecovery={loadEditRecovery}
        editRecoveryLoading={editRecoveryLoading}
        acceptEditRecovery={acceptEditRecovery}
        mergeStudentsCache={mergeStudentsCache}
        setServerRefreshKey={setServerRefreshKey}
        updateEditForm={updateEditForm}
        editOriginalGraceText={editOriginalGraceText}
        editNeedsAcademicImpactPreview={editNeedsAcademicImpactPreview}
        hasCurrentAcademicImpactPreview={hasCurrentAcademicImpactPreview}
        academicImpactPreview={academicImpactPreview}
        academicImpactConfirmed={academicImpactConfirmed}
        setAcademicImpactConfirmed={setAcademicImpactConfirmed}
        academicImpactLoading={academicImpactLoading}
        editFilteredCourses={editFilteredCourses}
        editOriginalStudent={editOriginalStudent}
        editNeedsTransferPolicy={editNeedsTransferPolicy}
        editCourseChanged={editCourseChanged}
        effectiveCourseTransferPolicy={effectiveCourseTransferPolicy}
        editResetChapterUnresolved={editResetChapterUnresolved}
        editTargetActiveChapterLoading={editTargetActiveChapterLoading}
        editTargetActiveChapterLookupFailed={editTargetActiveChapterLookupFailed}
        editTargetActiveChapterConflict={editTargetActiveChapterConflict}
        editAvailablePrograms={editAvailablePrograms}
        editEffectiveCourseProgram={editEffectiveCourseProgram}
        editAvailableStudyTypes={editAvailableStudyTypes}
        editLocationScopes={editLocationScopes}
        isEditOutOfCountry={isEditOutOfCountry}
        editSubSiteOptions={editSubSiteOptions}
        updateEditTelegram={updateEditTelegram}
        isAdmin={isAdmin}
        updateEditUsername={updateEditUsername}
        updateEditPhone={updateEditPhone}
        handleEditSave={handleEditSave}
      />

      <StudentRegistryStatusDialogs
        deleteDialog={deleteDialog}
        setDeleteDialog={setDeleteDialog}
        deleteImpactLoading={deleteImpactLoading}
        deleteImpact={deleteImpact}
        handleDeleteConfirm={handleDeleteConfirm}
        isDeletingStudent={isDeletingStudent}
        restoreDialog={restoreDialog}
        setRestoreDialog={setRestoreDialog}
        isStatusActionSaving={isStatusActionSaving}
        handleRestoreArchived={handleRestoreArchived}
        dismissDialog={dismissDialog}
        closeDismissDialog={closeDismissDialog}
        dismissReason={dismissReason}
        setDismissReason={setDismissReason}
        dismissNotes={dismissNotes}
        setDismissNotes={setDismissNotes}
        handleDismiss={handleDismiss}
      />
    </div>
  );
}
