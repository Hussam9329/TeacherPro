"use client";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";

import React, { useEffect, useMemo, useState } from "react";
import {
  useTeacherStore,
  type CourseTransferPolicy,
  type Student,
} from "@/lib/teacher-store";
import {
  studentApi,
  studentStatsApi,
  courseApi,
  type StudentAcademicUpdateImpactResponse,
  type StudentDeleteImpactResponse,
} from "@/lib/api";
import {
  getStudentGraceWindow,
  isStudentCurrentlyInGrace as isStudentCurrentlyInGraceUnified,
  type GracePeriodStartMode,
} from "@/lib/student-grace";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { toast } from "@/lib/user-toast";
import {
  formatAppDate,
  getPhoneValidationError,
  sanitizePhoneInput,
  toLatinDigits,
} from "@/lib/format";
import { formatOpportunityBalance } from "@/lib/opportunity-balance";
import {
  COURSE_TERMS,
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
  normalizeTelegramIdentifier,
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import {
  getRequiredTextError,
  searchAny,
} from "@/lib/validation";
import { useActionLock } from "@/hooks/use-action-lock";
import {
  AlertTriangle,
  CalendarDays,
  GraduationCap,
  MapPin,
  Phone,
  SearchX,
  ShieldCheck,
  UserPlus,
  UserRound,
} from "lucide-react";
import { CountScopeSummary, EmptyState } from "./ui-kit";
import { StudentProfileDialog } from "./student-profile-dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ExportDialog, type ExportColumn } from "./export-dialog";
import {
  STUDENT_FILTER_COURSE_TERMS,
  studentMatchesListFilters,
} from "@/lib/student-list-filters";
import {
  getAcademicCourseProgramFilterOptions,
  getAcademicLocationFilterOptions,
  getAcademicStudyTypeFilterOptions,
} from "@/lib/filter-sequence";

const studentExportColumns: ExportColumn<any>[] = [
  { key: "code", label: "الكود", value: (s) => s.code || "" },
  { key: "name", label: "الاسم", value: (s) => s.name || "" },
  { key: "school", label: "المدرسة", value: (s) => s.school || "" },
  { key: "gender", label: "الجنس", value: (s) => s.gender || "" },
  { key: "course", label: "الدورة", value: (s) => s.courseName || "" },
  {
    key: "courseProgram",
    label: "نوع الدورة",
    value: (s) => s.courseProgram || "",
  },
  { key: "courseTerm", label: "الكورس", value: (s) => s.courseTerm || "" },
  { key: "studyType", label: "نوع البرنامج", value: (s) => s.studyType || "" },
  {
    key: "locationScope",
    label: "نطاق الموقع",
    value: (s) => s.locationScope || "",
  },
  { key: "location", label: "الموقع", value: (s) => s.locationText || "" },
  { key: "status", label: "الحالة", value: (s) => s.status || "" },
  { key: "opportunities", label: "الفرص", value: (s) => s.opportunities ?? "" },
  {
    key: "grace",
    label: "فترة السماح",
    value: (s) => `${s.accountingGraceDays ?? 0} يوم`,
  },
  { key: "phone", label: "الهاتف", value: (s) => s.phone || "" },
  { key: "parentPhone", label: "ولي الأمر", value: (s) => s.parentPhone || "" },
  { key: "telegram", label: "التيليجرام", value: (s) => s.telegram || "" },
];

type RegistryViewMode = "cards" | "table";

const ARCHIVED_STUDENT_STATUS = "مؤرشف";

function academicImpactKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    missing: "غير مكتملة",
    excused: "إجازة",
    "grace-period": "ضمن السماح",
    "before-registration": "قبل التسجيل",
    "unavailable-exam": "امتحان غير متاح",
    cheating: "غش",
    "absent-dismissal": "غياب فصل",
    "absent-deducted": "غياب مخصوم",
    discounted: "درجة مخصومة",
    "academic-accounting": "محاسبة أكاديمية",
    dismissal: "درجة فصل",
    failed: "راسب",
    passed: "ناجح",
    "full-mark": "درجة كاملة",
    "no-discount-protected": "بدون خصم",
  };
  return labels[kind] || kind || "—";
}



type RegistryIssueFilter =
  | ""
  | "no-active-chapter"
  | "active-chapter-conflict"
  | "zero-opportunities"
  | "opportunity-full"
  | "opportunity-over-limit"
  | "missing-contact"
  | "no-telegram";

type RegistryStudentHealth = Student & {
  hasActiveChapter?: boolean;
  activeChapterConflictCount?: number;
  activeChapter?: { id: string; name: string; opportunities: number } | null;
  isOpportunityFull?: boolean;
  isOpportunityOverLimit?: boolean;
};

const registryIssueFilterLabels: Record<Exclude<RegistryIssueFilter, "">, string> = {
  "no-active-chapter": "بدون فصل نشط",
  "active-chapter-conflict": "تعارض فصول نشطة",
  "zero-opportunities": "فرص صفر",
  "opportunity-full": "فرص كاملة",
  "opportunity-over-limit": "فوق السقف",
  "missing-contact": "ناقص بيانات تواصل",
  "no-telegram": "بلا تيليجرام",
};

function registryHealthBadges(student: Student) {
  const row = student as RegistryStudentHealth;
  const badges: Array<{ label: string; className: string }> = [];
  const conflictCount = Number(row.activeChapterConflictCount || 0);

  if (conflictCount > 1) {
    badges.push({
      label: `تعارض فصول نشطة: ${conflictCount}`,
      className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    });
  } else if (row.hasActiveChapter === false) {
    badges.push({
      label: "بدون فصل نشط",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    });
  }

  if (row.isOpportunityOverLimit) {
    badges.push({
      label: "فرص فوق السقف",
      className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    });
  } else if (row.isOpportunityFull) {
    badges.push({
      label: "فرص كاملة",
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    });
  }

  if (!sanitizePhoneInput(student.phone || "") || !sanitizePhoneInput(student.parentPhone || "")) {
    badges.push({
      label: "ناقص بيانات تواصل",
      className: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    });
  }

  if (!normalizeTelegramIdentifier(student.telegram || "")) {
    badges.push({
      label: "بلا تيليجرام",
      className: "border-muted-foreground/30 bg-muted/60 text-muted-foreground",
    });
  }

  return badges;
}

/**
 * Keep the opportunity balance consistent with the calls page.
 *
 * The student list is server-driven and already receives the persisted
 * opportunities/baseOpportunities values from /api/students.  Do not gate the
 * display behind the client-side course/chapter cache: that cache can still be
 * loading (or be stale) and previously made valid balances appear as 0 / 0.
 * Chapter health remains visible through the dedicated server snapshot badges.
 */
function registryOpportunityText(student: Student): string {
  return formatOpportunityBalance(student, { separator: " / " });
}

const studentDeleteImpactLabels: Array<
  [keyof StudentDeleteImpactResponse["counts"], string]
> = [
  ["grades", "درجات"],
  ["leaves", "إجازات"],
  ["calls", "مكالمات"],
  ["notes", "ملاحظات"],
  ["opportunityLogs", "سجلات فرص"],
  ["correctionSheets", "أوراق تصحيح"],
  ["telegramSubmissions", "مستلمات بوت"],
];

function formatStudentDeleteImpact(
  impact: StudentDeleteImpactResponse | null,
): string[] {
  if (!impact) return [];
  return studentDeleteImpactLabels
    .map(([key, label]) => [Number(impact.counts?.[key] || 0), label] as const)
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${label}: ${count}`);
}

type StudentEditForm = {
  name: string;
  school: string;
  gender: "ذكر" | "أنثى";
  phone: string;
  parentPhone: string;
  telegram: string;
  courseProgram: string;
  courseTerm: string;
  studyType: string;
  locationScope: string;
  baghdadMode: string;
  courseId: string;
  subSite: string;
  createdAt: string;
  accountingGraceDays: string;
};

const emptyEditForm: StudentEditForm = {
  name: "",
  school: "",
  gender: "ذكر",
  phone: "",
  parentPhone: "",
  telegram: "",
  courseProgram: "",
  courseTerm: "",
  studyType: "",
  locationScope: "",
  baghdadMode: "",
  courseId: "",
  subSite: "",
  createdAt: new Date().toISOString().slice(0, 10),
  accountingGraceDays: "0",
};

function getStudentEditForm(student: Student): StudentEditForm {
  return {
    name: student.name,
    school: student.school || "",
    gender: student.gender,
    phone: student.phone,
    parentPhone: student.parentPhone,
    telegram: sanitizeTelegramInput(student.telegram),
    courseProgram: student.courseProgram || "",
    courseTerm: student.courseTerm || "",
    studyType: student.studyType || "",
    locationScope: student.locationScope || "",
    baghdadMode: student.baghdadMode || "",
    courseId: student.courseId,
    subSite: student.subSite || "",
    createdAt: student.createdAt || new Date().toISOString().slice(0, 10),
    accountingGraceDays: String(student.accountingGraceDays ?? 0),
  };
}

function whatsappLink(phone: string): string {
  const sanitized = sanitizePhoneInput(phone);
  const appPhone =
    sanitized.startsWith("07") && sanitized.length === 11
      ? `964${sanitized.slice(1)}`
      : sanitized;
  return `https://wa.me/${encodeURIComponent(appPhone)}`;
}

function telegramLink(telegram: string): string {
  const username = normalizeTelegramIdentifier(telegram).replace(/^@+/, "");
  return `https://t.me/${encodeURIComponent(username)}`;
}

function normalizeGraceDaysInput(value: string): string {
  const digits = toLatinDigits(value).replace(/\D/g, "");
  if (!digits) return "0";
  return String(Math.min(Number(digits), 30));
}

function isValidGraceDays(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 && days <= 30;
}

function graceEndDate(student: Student): string {
  const graceWindow = getStudentGraceWindow(student);
  if (!graceWindow)
    return formatAppDate(
      student.createdAt,
      String(student.createdAt || "").slice(0, 10) || "-",
    );
  const end = new Date(graceWindow.endExclusive);
  end.setUTCDate(end.getUTCDate() - 1);
  return formatAppDate(end);
}

function isStudentCurrentlyInGrace(student: Student): boolean {
  return isStudentCurrentlyInGraceUnified(student);
}

function ContactLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="break-all font-bold text-primary underline-offset-4 hover:underline"
    >
      {children || "—"}
    </a>
  );
}


function looksLikeTelegramIdentifierSearch(query: string): boolean {
  const trimmed = toLatinDigits(query).trim();
  const telegramKey = normalizeTelegramIdentifier(trimmed);
  if (telegramKey.length < 3) return false;
  return (
    /^@?[A-Za-z0-9_]+$/.test(trimmed) &&
    (trimmed.startsWith("@") || /[A-Za-z_]/.test(trimmed))
  );
}

function studentMatchesExactIdentifierSearch(
  student: Student,
  query: string,
): boolean {
  const trimmed = toLatinDigits(query).trim();
  const queryTelegramKey = normalizeTelegramIdentifier(trimmed);
  const studentTelegramKey = normalizeTelegramIdentifier(student.telegram);
  const queryCode = trimmed.toLocaleLowerCase("ar-IQ");
  const studentCode = String(student.code ?? "")
    .trim()
    .toLocaleLowerCase("ar-IQ");

  if (studentTelegramKey && studentTelegramKey === queryTelegramKey)
    return true;
  if (!trimmed.startsWith("@") && studentCode && studentCode === queryCode)
    return true;
  return false;
}

function studentMatchesPrefixIdentifierSearch(
  student: Student,
  query: string,
): boolean {
  const trimmed = toLatinDigits(query).trim();
  const queryTelegramKey = normalizeTelegramIdentifier(trimmed);
  const studentTelegramKey = normalizeTelegramIdentifier(student.telegram);
  const queryCode = trimmed.toLocaleLowerCase("ar-IQ");
  const studentCode = String(student.code ?? "")
    .trim()
    .toLocaleLowerCase("ar-IQ");

  if (studentTelegramKey && studentTelegramKey.startsWith(queryTelegramKey))
    return true;
  if (
    !trimmed.startsWith("@") &&
    studentCode &&
    studentCode.startsWith(queryCode)
  )
    return true;
  return false;
}

function studentMatchesRegistrySearch(
  student: Student,
  query: string,
  hasExactIdentifierMatch: boolean,
): boolean {
  if (!query.trim()) return true;

  if (looksLikeTelegramIdentifierSearch(query)) {
    return hasExactIdentifierMatch
      ? studentMatchesExactIdentifierSearch(student, query)
      : studentMatchesPrefixIdentifierSearch(student, query);
  }

  return searchAny(query, [
    student.name,
    student.code,
    student.telegram,
    student.phone,
    student.parentPhone,
  ]);
}

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
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterCourseProgram, setFilterCourseProgram] = useState("");
  const [filterCourseTerm, setFilterCourseTerm] = useState("");
  const [filterStudyType, setFilterStudyType] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterRegistryIssue, setFilterRegistryIssue] =
    useState<RegistryIssueFilter>("");

  // خيارات الفلاتر تُشتق من إعدادات الدورة/نوع الدورة المختارة، وليس من قوائم ثابتة.
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
  }, [
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    availableProgramsForFilter,
    availableStudyTypesForFilter,
  ]);

  const [viewMode, setViewMode] = useState<RegistryViewMode>("cards");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [serverStudents, setServerStudents] = useState<Student[] | null>(null);
  const [serverTotalCount, setServerTotalCount] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [serverStudentsLoading, setServerStudentsLoading] = useState(false);
  const [serverStudentsError, setServerStudentsError] = useState<string | null>(
    null,
  );
  const [serverRefreshKey, setServerRefreshKey] = useState(0);
  const syncKey = useTeacherProSyncKey(["students", "courses", "opportunities", "grades", "follow-up", "dashboard"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const [studentsSystemTotal, setStudentsSystemTotal] = useState<number | null>(null);
  const [activeStudentsTotal, setActiveStudentsTotal] = useState<number | null>(
    null,
  );
  const [dismissedStudentsTotal, setDismissedStudentsTotal] = useState<
    number | null
  >(null);
  const [noActiveChapterStudentsTotal, setNoActiveChapterStudentsTotal] =
    useState<number | null>(null);

  const [dismissDialog, setDismissDialog] = useState<{
    student: Student | null;
    open: boolean;
  }>({ student: null, open: false });
  const [dismissType, setDismissType] = useState("فصل مؤقت");
  const [dismissReason, setDismissReason] = useState("");
  const [dismissNotes, setDismissNotes] = useState("");

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
  const [courseTransferPolicy, setCourseTransferPolicy] = useState<
    CourseTransferPolicy | ""
  >("");
  const [courseTransferPolicySignature, setCourseTransferPolicySignature] =
    useState("");
  const [academicImpactPreview, setAcademicImpactPreview] =
    useState<StudentAcademicUpdateImpactResponse | null>(null);
  const [academicImpactPreviewSignature, setAcademicImpactPreviewSignature] =
    useState("");
  const [academicImpactConfirmed, setAcademicImpactConfirmed] = useState(false);
  const [academicImpactLoading, setAcademicImpactLoading] = useState(false);
  const [gracePeriodStartMode, setGracePeriodStartMode] = useState<
    GracePeriodStartMode | ""
  >("");
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
  const debouncedSearch = useDebouncedValue(search, 180);
  // Fetch location filter options from server (distinct query, not all students)
  const [locationFilterOptions, setLocationFilterOptions] = useState<string[]>(
    [],
  );
  useEffect(() => {
    const params = new URLSearchParams();
    if (filterStatus) params.set("status", filterStatus);
    if (filterCourseId) params.set("courseId", filterCourseId);
    if (filterCourseProgram) params.set("courseProgram", filterCourseProgram);
    if (filterCourseProgram === "كورسات" && filterCourseTerm) {
      params.set("courseTerm", filterCourseTerm);
    }
    if (filterStudyType) params.set("studyType", filterStudyType);

    const fallbackLocations = () =>
      getAcademicLocationFilterOptions(students, {
        courseId: filterCourseId,
        courseProgram: filterCourseProgram,
        courseTerm: filterCourseProgram === "كورسات" ? filterCourseTerm : "",
        studyType: filterStudyType,
      });

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
          return;
        }
        setLocationFilterOptions(fallbackLocations());
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLocationFilterOptions(fallbackLocations());
      });

    return () => controller.abort();
  }, [
    students,
    filterStatus,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    syncKey,
  ]);

  useEffect(() => {
    if (filterLocation && !locationFilterOptions.includes(filterLocation)) {
      setFilterLocation("");
    }
  }, [filterLocation, locationFilterOptions]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const silent = isBackgroundSync();
    if (!silent) setServerStudentsLoading(true);
    if (!silent) setServerStudentsError(null);

    studentApi
      .list(
        {
          q: debouncedSearch,
          status: filterStatus,
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
        if (cancelled) return;
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
        mergeStudentsCache(nextStudents);
        setServerTotalCount(Number(result.totalCount || 0));
        setServerTotalPages(nextTotalPages);

        if (page > nextTotalPages) {
          setPage(nextTotalPages);
        }
      })
      .catch(() => {
        if (cancelled || silent) return;
        setServerStudents(null);
        setServerStudentsError(
          "تعذر تحميل نتائج الطلاب من النظام. سيتم عرض النسخة المحلية مؤقتاً.",
        );
      })
      .finally(() => {
        if (!cancelled) setServerStudentsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    debouncedSearch,
    filterStatus,
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
    let cancelled = false;
    studentStatsApi
      .get()
      .then((result) => {
        if (cancelled) return;
        setStudentsSystemTotal(result ? Number(result.total || 0) : null);
        setActiveStudentsTotal(result ? Number(result.active || 0) : null);
        setDismissedStudentsTotal(
          result ? Number(result.dismissed || 0) : null,
        );
        setNoActiveChapterStudentsTotal(
          result ? Number(result.noActiveChapter || 0) : null,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setStudentsSystemTotal(null);
        setActiveStudentsTotal(null);
        setDismissedStudentsTotal(null);
        setNoActiveChapterStudentsTotal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [serverRefreshKey, syncKey]);

  useEffect(() => {
    if (filterCourseProgram !== "كورسات" && filterCourseTerm) {
      setFilterCourseTerm("");
    }
  }, [filterCourseProgram, filterCourseTerm]);

  const editFilteredCourses = useMemo(
    () => courses.filter((c) => c.active),
    [courses],
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
  const [editTargetActiveChapterFromServer, setEditTargetActiveChapterFromServer] =
    useState<{
      id: string;
      name: string;
      opportunities: number;
      chapterId: string;
    } | null>(null);
  const [editTargetActiveChapterLoading, setEditTargetActiveChapterLoading] =
    useState(false);
  const [editTargetActiveChapterConflict, setEditTargetActiveChapterConflict] =
    useState(false);

  useEffect(() => {
    const courseId = editDialog.form.courseId;
    if (!courseId || !editDialog.open) {
      setEditTargetActiveChapterFromServer(null);
      setEditTargetActiveChapterConflict(false);
      return;
    }

    let cancelled = false;
    setEditTargetActiveChapterLoading(true);
    setEditTargetActiveChapterConflict(false);

    courseApi
      .activeChapterForCourse(courseId)
      .then((response) => {
        if (cancelled) return;
        if (!response) {
          setEditTargetActiveChapterFromServer(null);
          setEditTargetActiveChapterConflict(false);
          return;
        }
        setEditTargetActiveChapterFromServer(response.activeChapter);
        setEditTargetActiveChapterConflict(Boolean(response.conflict));
      })
      .catch(() => {
        if (cancelled) return;
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
  const editTargetOpportunities = Number(
    editTargetActiveChapter?.opportunities || 0,
  );

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
    editEffectiveCourseProgram !== String(editOriginalStudent.courseProgram || ""),
  );
  const editCourseTermChanged = Boolean(
    editOriginalStudent &&
    editDialog.form.courseTerm !== String(editOriginalStudent.courseTerm || ""),
  );
  const editLocationChanged = Boolean(
    editOriginalStudent &&
    (
      editDialog.form.locationScope !== String(editOriginalStudent.locationScope || "") ||
      editDialog.form.baghdadMode !== String(editOriginalStudent.baghdadMode || "") ||
      editDialog.form.subSite !== String(editOriginalStudent.subSite || "")
    ),
  );
  const editSameCourseContextChanged =
    !editCourseChanged &&
    (editStudyTypeChanged ||
      editCourseProgramChanged ||
      editCourseTermChanged ||
      editLocationChanged);
  const editNeedsTransferPolicy = editCourseChanged || editSameCourseContextChanged;
  const editTransferSignature = JSON.stringify([
    editDialog.form.courseId,
    editEffectiveCourseProgram,
    editDialog.form.courseTerm,
    editDialog.form.studyType,
    editDialog.form.locationScope,
    editDialog.form.baghdadMode,
    editDialog.form.subSite,
  ]);
  const effectiveCourseTransferPolicy =
    courseTransferPolicySignature === editTransferSignature
      ? courseTransferPolicy
      : "";
  const editRegistrationDateChanged = Boolean(
    editOriginalStudent &&
    editDialog.form.createdAt !== String(editOriginalStudent.createdAt || "").slice(0, 10),
  );
  const editGraceDaysChanged = Boolean(
    editOriginalStudent &&
    Number(editDialog.form.accountingGraceDays || 0) !==
      Number(editOriginalStudent.accountingGraceDays || 0),
  );
  const editAcademicImpactSignature = `${editDialog.id}|${editDialog.form.createdAt}|${Number(editDialog.form.accountingGraceDays || 0)}|${gracePeriodStartMode}`;
  const resetWillStartNewFile =
    editNeedsTransferPolicy && effectiveCourseTransferPolicy === "reset";
  const editNeedsAcademicImpactPreview =
    !resetWillStartNewFile &&
    (editRegistrationDateChanged || editGraceDaysChanged);
  const hasCurrentAcademicImpactPreview =
    academicImpactPreviewSignature === editAcademicImpactSignature &&
    Boolean(academicImpactPreview);
  const effectiveAcademicImpactConfirmed =
    hasCurrentAcademicImpactPreview && academicImpactConfirmed;

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
    setEditOriginalStudent(student);
    setCourseTransferPolicy("");
    setCourseTransferPolicySignature("");
    setAcademicImpactPreview(null);
    setAcademicImpactPreviewSignature("");
    setAcademicImpactConfirmed(false);
    setGracePeriodStartMode("");
    setEditDialog({
      open: true,
      id: student.id,
      form: getStudentEditForm(student),
    });
  };

  const updateEditForm = (key: keyof StudentEditForm, value: string) => {
    if (key === "accountingGraceDays") {
      setGracePeriodStartMode("");
      setAcademicImpactPreview(null);
      setAcademicImpactPreviewSignature("");
      setAcademicImpactConfirmed(false);
    }
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
          ? "لا توجد دورات مسجلة"
          : "يرجى اختيار الدورة",
      ],
      [Boolean(form.createdAt), "تاريخ إضافة الطالب مطلوب"],
    ];

    const missing = requiredChecks.find(([ok]) => !ok);
    if (missing) return missing[1];

    if (editNeedsTransferPolicy && !effectiveCourseTransferPolicy) {
      return editCourseChanged
        ? "نقل الطالب إلى دورة جديدة يحتاج تأكيد بدء ملف جديد وتصفير الإجراءات الحالية"
        : "عند تغيير نوع البرنامج/الكورس/الموقع داخل نفس الدورة اختر الإبقاء على الملف أو البدء كطالب جديد";
    }

    // Course settings-based validation
    if (editAvailablePrograms.length > 1 && !form.courseProgram) {
      return "يرجى اختيار نوع الدورة (منهج كامل/كورسات)";
    }
    if (editEffectiveCourseProgram === "كورسات" && !form.courseTerm) {
      return "يرجى اختيار الكورس";
    }
    if (editAvailableStudyTypes.length > 0 && !form.studyType) {
      return "يرجى اختيار نوع البرنامج";
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

    if (!isValidGraceDays(form.accountingGraceDays)) {
      return "فترة السماح يجب أن تكون رقماً من 0 إلى 30 يوم";
    }

    const duplicateMessage = getStudentDuplicateMessage(
      students,
      {
        id: editDialog.id,
        name: form.name,
        phone: form.phone,
        telegram: form.telegram,
      },
      editDialog.id,
    );
    if (duplicateMessage) return duplicateMessage.replace("إضافة", "تعديل");

    return null;
  };

  const handleEditSave = runSaveEditLocked(async () => {
    const error = validateEditForm();
    if (error) {
      toast.error(error);
      return;
    }

    const form = editDialog.form;
    let resolvedGracePeriodStartMode = gracePeriodStartMode;
    if (
      editGraceDaysChanged &&
      Number(form.accountingGraceDays || 0) > 0 &&
      !resolvedGracePeriodStartMode
    ) {
      resolvedGracePeriodStartMode = window.confirm(
        "هل تريد بدء فترة السماح من تاريخ تسجيل الطالب؟\n\nموافق: من تاريخ التسجيل.\nإلغاء: من اليوم الذي وضعت فيه فترة السماح.",
      )
        ? "registration"
        : "now";
      setGracePeriodStartMode(resolvedGracePeriodStartMode);
    }
    const resolvedAcademicImpactSignature = `${editDialog.id}|${form.createdAt}|${Number(form.accountingGraceDays || 0)}|${resolvedGracePeriodStartMode}`;
    const hasResolvedAcademicImpactPreview =
      academicImpactPreviewSignature === resolvedAcademicImpactSignature &&
      Boolean(academicImpactPreview);
    const resolvedAcademicImpactConfirmed =
      hasResolvedAcademicImpactPreview && academicImpactConfirmed;

    if (editNeedsAcademicImpactPreview && !resolvedAcademicImpactConfirmed) {
      if (!hasResolvedAcademicImpactPreview) {
        setAcademicImpactLoading(true);
        const previewResult = await studentApi.updateImpact({
          studentId: editDialog.id,
          createdAt: form.createdAt,
          accountingGraceDays: Number(form.accountingGraceDays || 0),
          gracePeriodStartMode: resolvedGracePeriodStartMode || undefined,
        });
        setAcademicImpactLoading(false);
        if (!previewResult.ok || !previewResult.data) {
          toast.error(previewResult.error || "تعذر معاينة أثر التغيير الأكاديمي");
          return;
        }
        setAcademicImpactPreview(previewResult.data);
        setAcademicImpactPreviewSignature(resolvedAcademicImpactSignature);
        setAcademicImpactConfirmed(false);
        toast.warning("راجع أثر تغيير التاريخ/فترة السماح ثم أكّد الحفظ.");
        return;
      }
      toast.warning("يجب تأكيد أثر تغيير التاريخ أو فترة السماح قبل الحفظ.");
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
        editNeedsAcademicImpactPreview && hasResolvedAcademicImpactPreview
          ? academicImpactPreview?.previewToken || ""
          : "",
      name: form.name.trim(),
      school: form.school.trim(),
      gender: form.gender,
      phone: form.phone.trim(),
      parentPhone: form.parentPhone.trim(),
      telegram: sanitizeTelegramInput(form.telegram),
      courseProgram: editEffectiveCourseProgram || "",
      courseTerm: editEffectiveCourseProgram === "كورسات" ? form.courseTerm : "",
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
      accountingGraceDays: Number(form.accountingGraceDays || 0),
      gracePeriodStartMode: resolvedGracePeriodStartMode || undefined,
    });

    if (!result.ok) {
      toast.error(result.error || "تعذر تعديل بيانات الطالب");
      return;
    }
    const updatedStudent = (result.data as { student?: Student } | null)?.student;
    if (updatedStudent) {
      mergeStudentsCache([updatedStudent]);
      setServerStudents((prev) =>
        prev
          ? prev.map((student) =>
              student.id === updatedStudent.id ? updatedStudent : student,
            )
          : prev,
      );
    }
    setEditDialog({ open: false, id: "", form: emptyEditForm });
    setEditOriginalStudent(null);
    setCourseTransferPolicy("");
    setCourseTransferPolicySignature("");
    setAcademicImpactPreview(null);
    setAcademicImpactPreviewSignature("");
    setAcademicImpactConfirmed(false);
    setGracePeriodStartMode("");
    setServerRefreshKey((value) => value + 1);
    toast.success("تم تعديل بيانات الطالب", {
      description:
        effectiveCourseTransferPolicy === "reset"
          ? "تم حفظ الملف السابق للقراءة فقط وبدء ملف نظيف للطالب."
          : effectiveCourseTransferPolicy === "keep"
            ? "تم تعديل الإعدادات مع إبقاء الدرجات والفرص والإجراءات كما هي حرفياً."
            : "تم تحديث بيانات الطالب بنجاح.",
    });
  });

  const openDeleteDialog = (student: Student) => {
    if (registryServerUnavailable) {
      toast.error("لا يمكن أرشفة طالب أثناء عرض نسخة محلية مؤقتة. أعد الاتصال بالنظام ثم حاول مجدداً.");
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
    const result = await studentApi.remove(deleteDialog.id);
    if (!result.ok) {
      toast.error(result.error || "تعذر أرشفة الطالب");
      return;
    }
    const archivedStudent = (result.data as { student?: Student } | null)?.student;
    if (archivedStudent) {
      mergeStudentsCache([archivedStudent]);
      setServerStudents((prev) =>
        prev
          ? prev.map((student) =>
              student.id === archivedStudent.id ? archivedStudent : student,
            ).filter((student) => filterStatus || student.status !== ARCHIVED_STUDENT_STATUS)
          : prev,
      );
    } else {
      setServerStudents((prev) =>
        prev ? prev.filter((student) => student.id !== deleteDialog.id) : prev,
      );
    }
    setServerRefreshKey((value) => value + 1);
    toast.success("تمت أرشفة الطالب بدل الحذف النهائي", {
      description:
        "بقيت درجاته وإجازاته ومكالماته وفرصه وملاحظاته وأوراق تصحيحه محفوظة.",
    });
    setDeleteDialog({ open: false, id: "", studentName: "" });
    setDeleteImpact(null);
  });

  const localFiltered = useMemo(() => {
    const hasExactIdentifierMatch =
      looksLikeTelegramIdentifierSearch(debouncedSearch) &&
      students.some((student) =>
        studentMatchesExactIdentifierSearch(student, debouncedSearch),
      );

    return students.filter((s) => {
      if (
        debouncedSearch &&
        !studentMatchesRegistrySearch(
          s,
          debouncedSearch,
          hasExactIdentifierMatch,
        )
      )
        return false;
      if (filterStatus && s.status !== filterStatus) return false;
      if (!filterStatus && s.status === ARCHIVED_STUDENT_STATUS) return false;
      if (filterCourseId && s.courseId !== filterCourseId) return false;
      if (filterRegistryIssue) {
        const badges = registryHealthBadges(s).map((badge) => badge.label);
        const label = registryIssueFilterLabels[filterRegistryIssue];
        if (!badges.some((badge) => badge.includes(label))) return false;
      }
      if (
        !studentMatchesListFilters(s, {
          courseProgram: filterCourseProgram,
          courseTerm: filterCourseTerm,
          studyType: filterStudyType,
          location: filterLocation,
        })
      )
        return false;
      return true;
    });
  }, [
    students,
    debouncedSearch,
    filterStatus,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    filterLocation,
    filterRegistryIssue,
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
  const registryServerUnavailable = Boolean(serverStudentsError && !serverStudents);
  const handleDismiss = runStatusActionLocked(async () => {
    if (!dismissDialog.student) return;
    if (registryServerUnavailable) {
      toast.error("لا يمكن فصل طالب أثناء عرض نسخة محلية مؤقتة. أعد الاتصال بالنظام ثم حاول مجدداً.");
      return;
    }
    if (!dismissReason.trim()) {
      toast.error("يرجى إدخال سبب الفصل");
      return;
    }
    const result = await studentApi.statusAction({
      action: "dismiss",
      studentId: dismissDialog.student.id,
      dismissalType: dismissType,
      reason: dismissReason.trim(),
      notes: dismissNotes.trim(),
    });
    if (!result.ok) {
      toast.error(result.error || "تعذر فصل الطالب");
      return;
    }
    const updatedStudent = (result.data as { student?: Student } | null)?.student;
    if (updatedStudent) {
      mergeStudentsCache([updatedStudent]);
      setServerStudents((prev) =>
        prev
          ? prev.map((student) =>
              student.id === updatedStudent.id ? updatedStudent : student,
            )
          : prev,
      );
    }
    setDismissDialog({ student: null, open: false });
    setDismissReason("");
    setDismissNotes("");
    setServerRefreshKey((value) => value + 1);
    toast.success("تم فصل الطالب من بيانات النظام", {
      description: "تم حفظ حالة الطالب وسجل الفرص والملاحظة الإدارية داخل عملية واحدة.",
    });
  });

  const handleReactivate = runStatusActionLocked(async (studentId: string) => {
    if (registryServerUnavailable) {
      toast.error("لا يمكن إعادة تفعيل طالب أثناء عرض نسخة محلية مؤقتة.");
      return;
    }
    const student = students.find((item) => item.id === studentId);
    const isArchived = student?.status === ARCHIVED_STUDENT_STATUS;
    const result = await studentApi.statusAction({
      action: isArchived ? "restore" : "reactivate",
      studentId,
    });
    if (!result.ok) {
      toast.error(
        result.error ||
          (isArchived ? "تعذر استعادة الطالب من الأرشيف" : "تعذر إعادة تفعيل الطالب"),
      );
      return;
    }
    const updatedStudent = (result.data as { student?: Student } | null)?.student;
    if (updatedStudent) {
      mergeStudentsCache([updatedStudent]);
      setServerStudents((prev) => {
        if (!prev) return prev;
        const next = prev.map((item) =>
          item.id === studentId ? updatedStudent : item,
        );
        return filterStatus && filterStatus !== "نشط"
          ? next.filter((item) => item.id !== studentId)
          : next;
      });
    }
    setServerRefreshKey((value) => value + 1);
    toast.success(
      student?.status === ARCHIVED_STUDENT_STATUS
        ? "تمت استعادة الطالب من الأرشيف"
        : "تم إعادة تفعيل الطالب",
    );
  });

  // Export rows: use current filtered results (server or local).
  // For full server-side export, the ExportDialog fetches from /api/students/export
  // with the same filter params — this local mapping is for preview only.
  const studentExportRows = (
    usingServerStudents ? serverStudents! : localFiltered
  ).map((student) => ({
    ...student,
    courseName: courseName(student.courseId),
    locationText: `${student.locationScope || student.mainSite || ""} - ${student.subSite || ""}`,
  }));

  const fetchStudentExportRows = async () => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (filterStatus) params.set("status", filterStatus);
    if (filterCourseId) params.set("courseId", filterCourseId);
    if (filterCourseProgram) params.set("courseProgram", filterCourseProgram);
    if (filterCourseTerm) params.set("courseTerm", filterCourseTerm);
    if (filterStudyType) params.set("studyType", filterStudyType);
    if (filterLocation) params.set("location", filterLocation);
    if (filterRegistryIssue) params.set("registryIssue", filterRegistryIssue);
    const res = await fetch(`/api/students/export?${params.toString()}`, {
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error("students export failed");
    const json = (await res.json()) as { students?: Student[] };
    return (json.students || []).map((student) => ({
      ...student,
      courseName: courseName(student.courseId),
      locationText: `${student.locationScope || student.mainSite || ""} - ${student.subSite || ""}`,
    }));
  };

  const resetFilters = () => {
    setSearch("");
    setFilterStatus("");
    setFilterCourseId("");
    setFilterCourseProgram("");
    setFilterCourseTerm("");
    setFilterStudyType("");
    setFilterLocation("");
    setFilterRegistryIssue("");
    setViewMode("cards");
    setPage(1);
  };

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
        isStudentCurrentlyInGrace={isStudentCurrentlyInGrace}
        graceEndDate={graceEndDate}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="tp-filter-card">
        <CardContent className="tp-filter-content">
          <div className="tp-filter-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-8">
            <div className="tp-filter-field tp-filter-primary">
              <Label htmlFor="registry-course" className="text-xs">
                الدورة
              </Label>
              <Select
                name="courseId"
                value={filterCourseId || "all"}
                onValueChange={(v) => {
                  setFilterCourseId(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-course">
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
              <Label htmlFor="registry-program" className="text-xs">
                نوع الدورة
              </Label>
              <Select
                name="courseProgram"
                value={filterCourseProgram || "all"}
                onValueChange={(v) => {
                  setFilterCourseProgram(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-program">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {availableProgramsForFilter.map((program) => (
                    <SelectItem key={program} value={program}>
                      {program}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {filterCourseProgram === "كورسات" && (
              <div className="tp-filter-field tp-filter-primary">
                <Label htmlFor="registry-term" className="text-xs">
                  الكورس
                </Label>
                <Select
                  name="courseTerm"
                  value={filterCourseTerm || "all"}
                  onValueChange={(v) => {
                    setFilterCourseTerm(v === "all" ? "" : v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger id="registry-term">
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
            <div className="tp-filter-field tp-filter-primary">
              <Label htmlFor="registry-study-type" className="text-xs">
                نوع البرنامج
              </Label>
              <Select
                name="studyType"
                value={filterStudyType || "all"}
                onValueChange={(v) => {
                  setFilterStudyType(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-study-type">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {availableStudyTypesForFilter.map((studyType) => (
                    <SelectItem key={studyType} value={studyType}>
                      {studyType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-secondary">
              <Label htmlFor="registry-location" className="text-xs">
                المحافظة / الموقع
              </Label>
              <Select
                name="location"
                value={filterLocation || "all"}
                onValueChange={(v) => {
                  setFilterLocation(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-location">
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
            <div className="tp-filter-field tp-filter-secondary">
              <Label htmlFor="registry-status" className="text-xs">
                الحالة
              </Label>
              <Select
                name="status"
                value={filterStatus || "all"}
                onValueChange={(v) => {
                  setFilterStatus(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-status">
                  <SelectValue placeholder="كل الحالات" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  <SelectItem value="نشط">نشط</SelectItem>
                  <SelectItem value="مفصول">مفصول</SelectItem>
                  <SelectItem value="مؤرشف">مؤرشف</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-secondary">
              <Label htmlFor="registry-issue" className="text-xs">
                مشاكل/صحة الطالب
              </Label>
              <Select
                name="registryIssue"
                value={filterRegistryIssue || "all"}
                onValueChange={(v) => {
                  setFilterRegistryIssue(
                    v === "all" ? "" : (v as RegistryIssueFilter),
                  );
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-issue">
                  <SelectValue placeholder="كل الطلاب" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الطلاب</SelectItem>
                  {Object.entries(registryIssueFilterLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-search 2xl:col-span-2">
              <Label htmlFor="registry-search" className="text-xs">
                بحث
              </Label>
              <Input
                id="registry-search"
                name="search"
                data-teacherpro-search="true"
                autoComplete="off"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="اسم / كود / تيليجرام / هاتف"
              />
            </div>
            <div className="tp-filter-field tp-filter-meta">
              <Label htmlFor="registry-view" className="text-xs">
                طريقة العرض
              </Label>
              <Select
                value={viewMode}
                onValueChange={(v) => setViewMode(v as RegistryViewMode)}
              >
                <SelectTrigger id="registry-view">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cards">البطاقات</SelectItem>
                  <SelectItem value="table">الجدول</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-actions">
              <span className="text-xs font-medium">تصدير</span>
              <ExportDialog
                title="تصدير سجل الطلاب"
                fileName="students"
                rows={studentExportRows}
                fetchRows={fetchStudentExportRows}
                columns={studentExportColumns}
                triggerLabel="تصدير"
                description="تقرير سجل الطلاب حسب الفلاتر الحالية"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="bg-card/80">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">الطلاب النشطون</p>
              <p className="text-2xl font-black">
                {activeStudentsTotal ?? "…"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilterStatus("نشط");
                setPage(1);
              }}
            >
              عرض
            </Button>
          </CardContent>
        </Card>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">قائمة المفصولين</p>
              <p className="text-2xl font-black text-destructive">
                {dismissedStudentsTotal ?? "…"}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setFilterStatus("مفصول");
                setPage(1);
              }}
            >
              عرض المفصولين
            </Button>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">بدون فصل نشط</p>
              <p className="text-2xl font-black text-amber-600">
                {noActiveChapterStudentsTotal ?? "…"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetFilters();
              }}
            >
              عرض الكل
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-2">
        <CountScopeSummary
          subject="الطلاب"
          systemTotal={studentsSystemTotal ?? "…"}
          filteredTotal={filteredTotalCount}
          pageCount={paged.length}
        />
        <div className="flex items-center justify-end text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
          <Label htmlFor="registry-pageSize" className="text-xs">
            حجم الصفحة:
          </Label>
          <Select
            name="pageSize"
            value={String(pageSize)}
            onValueChange={(v) => {
              setPageSize(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger id="registry-pageSize" className="w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          </div>
        </div>
      </div>

      {serverStudentsLoading && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-sm font-medium text-primary">
          جاري تحميل نتائج الطلاب من بيانات النظام...
        </div>
      )}

      {serverStudentsError && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-medium text-amber-700 dark:text-amber-300">
          {serverStudentsError}
          <span className="mt-1 block text-xs">
            تم إيقاف التعديل والفصل والأرشفة مؤقتاً حتى ترجع بيانات بيانات النظام، حتى لا تتعامل الصفحة مع بيانات مؤقتة قديمة.
          </span>
        </div>
      )}

      {students.length === 0 &&
      filteredTotalCount === 0 &&
      !serverStudentsLoading ? (
        <EmptyState
          icon={UserPlus}
          title="لم تقم بإضافة طلاب بعد"
          description="ابدأ بإضافة أول طالب، وبعدها ستظهر البطاقات والفلاتر والإحصائيات هنا تلقائياً."
          action={
            <Button
              onClick={() => setSection("student-register")}
              className="min-h-11 px-6"
            >
              إضافة طالب الآن
            </Button>
          }
        />
      ) : filteredTotalCount === 0 ? (
        <EmptyState
          icon={SearchX}
          title="لا توجد نتائج مطابقة"
          description="الفلاتر تعمل معاً؛ غيّر شروط البحث أو امسح الفلاتر لعرض كل الطلاب."
          action={
            <Button
              variant="outline"
              onClick={resetFilters}
              className="min-h-11 px-6"
            >
              مسح الفلاتر
            </Button>
          }
        />
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {paged.map((student) => (
            <Card
              key={student.id}
              className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10"
            >
              <CardContent className="p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{student.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {student.code} - {student.school || "بدون مدرسة"}
                    </p>
                  </div>
                  <Badge
                    variant={
                      student.status === "نشط"
                        ? "default"
                        : student.status === ARCHIVED_STUDENT_STATUS
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {student.status}
                  </Badge>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground">
                      الدورة
                    </span>
                    <p className="text-xs font-medium">
                      {courseName(student.courseId)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      نوع الدورة
                    </span>
                    <p className="text-xs font-medium">
                      {student.courseProgram
                        ? student.courseProgram === "كورسات"
                          ? `كورسات - ${student.courseTerm}`
                          : student.courseProgram
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      نوع البرنامج
                    </span>
                    <p className="text-xs font-medium">
                      {student.studyType || "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      الموقع
                    </span>
                    <p className="text-xs font-medium">{`${student.locationScope || student.mainSite || "-"} - ${student.subSite || "-"}`}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">الفرص</span>
                    <p className="text-xs font-medium">
                      {registryOpportunityText(student)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      السماح
                    </span>
                    <p className="text-xs font-medium">
                      {student.accountingGraceDays ?? 0} يوم
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      تاريخ الإضافة
                    </span>
                    <p className="text-xs font-medium">
                      {formatAppDate(
                        student.createdAt,
                        student.createdAt || "-",
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      تيليجرام
                    </span>
                    <p className="text-xs">
                      {student.telegram ? (
                        <ContactLink href={telegramLink(student.telegram)}>
                          {student.telegram}
                        </ContactLink>
                      ) : (
                        "-"
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      رقم الطالب
                    </span>
                    <p className="text-xs">
                      <ContactLink href={whatsappLink(student.phone)}>
                        {student.phone}
                      </ContactLink>
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      ولي الأمر
                    </span>
                    <p className="text-xs">
                      <ContactLink href={whatsappLink(student.parentPhone)}>
                        {student.parentPhone}
                      </ContactLink>
                    </p>
                  </div>
                </div>

                {registryHealthBadges(student).length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {registryHealthBadges(student).map((badge) => (
                      <Badge
                        key={badge.label}
                        variant="outline"
                        className={`rounded-full ${badge.className}`}
                      >
                        {badge.label}
                      </Badge>
                    ))}
                  </div>
                )}

                {student.status === "مفصول" && (
                  <div className="mb-3 rounded bg-destructive/10 p-2 text-xs text-destructive">
                    <div>
                      {student.dismissalType} - {student.dismissalReason}
                    </div>
                    {student.dismissalNotes && (
                      <div className="mt-1 text-destructive/80">
                        ملاحظات: {student.dismissalNotes}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 text-xs"
                    onClick={() => setFileDialog({ student, open: true })}
                  >
                    ملف الطالب
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-11 text-xs"
                    disabled={registryServerUnavailable}
                    onClick={() => openEditDialog(student)}
                  >
                    تعديل
                  </Button>
                  {student.status === "نشط" ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="min-h-11 text-xs"
                      disabled={registryServerUnavailable || isStatusActionSaving}
                      onClick={() => setDismissDialog({ student, open: true })}
                    >
                      فصل
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      className="min-h-11 text-xs"
                      disabled={registryServerUnavailable || isStatusActionSaving}
                      onClick={() => handleReactivate(student.id)}
                    >
                      {student.status === ARCHIVED_STUDENT_STATUS
                        ? "استعادة"
                        : "إعادة تفعيل"}
                    </Button>
                  )}
                  {student.status !== ARCHIVED_STUDENT_STATUS && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
                      disabled={registryServerUnavailable || isDeletingStudent}
                      onClick={() => openDeleteDialog(student)}
                    >
                      أرشفة
                    </Button>
                  )}
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
                <th className="p-3 text-right">الدراسة</th>
                <th className="p-3 text-right">الموقع</th>
                <th className="p-3 text-right">الهاتف</th>
                <th className="p-3 text-right">التيليجرام</th>
                <th className="p-3 text-right">الفرص</th>
                <th className="p-3 text-right">السماح</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-right">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((student) => (
                <tr key={student.id} className="border-t align-top">
                  <td className="p-3 font-medium">
                    {student.name}
                    <div className="text-xs text-muted-foreground">
                      {student.school || "بدون مدرسة"}
                    </div>
                  </td>
                  <td className="p-3">{student.code}</td>
                  <td className="p-3">{courseName(student.courseId)}</td>
                  <td className="p-3">{student.studyType || "—"}</td>
                  <td className="p-3 min-w-40">{`${student.locationScope || student.mainSite || "-"} - ${student.subSite || "-"}`}</td>
                  <td className="p-3">
                    <ContactLink href={whatsappLink(student.phone)}>
                      {student.phone}
                    </ContactLink>
                  </td>
                  <td className="p-3">
                    {student.telegram ? (
                      <ContactLink href={telegramLink(student.telegram)}>
                        {student.telegram}
                      </ContactLink>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3">
                    {registryOpportunityText(student)}
                  </td>
                  <td className="p-3">
                    {student.accountingGraceDays ?? 0} يوم
                  </td>
                  <td className="p-3">
                    <Badge
                      variant={
                        student.status === "نشط"
                          ? "default"
                          : student.status === ARCHIVED_STUDENT_STATUS
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {student.status}
                    </Badge>
                  </td>
                  <td className="p-3 min-w-56">
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setFileDialog({ student, open: true })}
                      >
                        ملف
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={registryServerUnavailable}
                        onClick={() => openEditDialog(student)}
                      >
                        تعديل
                      </Button>
                      {student.status === "نشط" ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={registryServerUnavailable || isStatusActionSaving}
                          onClick={() =>
                            setDismissDialog({ student, open: true })
                          }
                        >
                          فصل
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={registryServerUnavailable || isStatusActionSaving}
                          onClick={() => handleReactivate(student.id)}
                        >
                          {student.status === ARCHIVED_STUDENT_STATUS
                            ? "استعادة"
                            : "تفعيل"}
                        </Button>
                      )}
                      {student.status !== ARCHIVED_STUDENT_STATUS && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-destructive/40 text-destructive hover:bg-destructive/10"
                          disabled={registryServerUnavailable || isDeletingStudent}
                          onClick={() => openDeleteDialog(student)}
                        >
                          أرشفة
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">
            صفحة {page} من {totalPages} · المعروض في الصفحة: {paged.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
          </Button>
        </div>
      )}

      <Dialog
        open={editDialog.open}
        onOpenChange={(open) => {
          setEditDialog((prev) => ({ ...prev, open }));
          if (!open) {
            setEditOriginalStudent(null);
            setCourseTransferPolicy("");
          }
        }}
      >
        <DialogContent
          dir="rtl"
          className="teacherpro-fullscreen-dialog left-0 top-0 flex h-dvh max-h-dvh w-dvw max-w-none flex-col translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none sm:max-w-none sm:rounded-none sm:p-0"
        >
          <DialogHeader className="shrink-0 border-b border-border/70 bg-gradient-to-l from-primary/12 via-background to-muted/50 px-6 py-5 pr-16 text-right">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <DialogTitle className="text-2xl font-black tracking-tight text-gradient-brand">
                  تعديل بيانات الطالب
                </DialogTitle>
                <DialogDescription className="mt-2 text-sm leading-6">
                  واجهة منظمة لتحديث البيانات الأساسية، الاتصال، الدورة، وفترة
                  السماح بدون تغيير آلية الحفظ.
                </DialogDescription>
              </div>
              <Badge
                variant="secondary"
                className="w-fit rounded-full px-4 py-1 text-xs font-bold"
              >
                {editDialog.form.gender || "بيانات الطالب"}
              </Badge>
            </div>
          </DialogHeader>

          <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.6fr]">
              <aside className="space-y-4">
                <div className="rounded-[1.75rem] border border-primary/20 bg-primary/5 p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-3xl bg-primary text-xl font-black text-primary-foreground shadow-lg shadow-primary/20">
                      {editDialog.form.name.trim().slice(0, 1) || "ط"}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-black">
                        {editDialog.form.name || "اسم الطالب"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {editDialog.form.school || "المدرسة غير محددة"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm">
                    <div className="rounded-2xl bg-background/80 p-3">
                      <span className="text-xs text-muted-foreground">
                        الدورة
                      </span>
                      <p className="mt-1 font-bold">
                        {editDialog.form.courseId
                          ? courseName(editDialog.form.courseId)
                          : "لم يتم اختيار دورة"}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-background/80 p-3 text-center">
                        <p className="text-xs text-muted-foreground">الهاتف</p>
                        <p className="mt-1 truncate font-black">
                          {editDialog.form.phone || "—"}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-background/80 p-3 text-center">
                        <p className="text-xs text-muted-foreground">السماح</p>
                        <p className="mt-1 font-black">
                          {editDialog.form.accountingGraceDays || "0"} يوم
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.75rem] border bg-card p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <ShieldCheck className="size-4 text-primary" />
                    <h4 className="font-black">ملاحظات الإدخال</h4>
                  </div>
                  <ul className="space-y-2 text-xs leading-6 text-muted-foreground">
                    <li>• الأرقام تقبل الصيغة العراقية 07 وتتكون من 11 رقم.</li>
                    <li>• فترة السماح لا تتجاوز 30 يوم.</li>
                    <li>
                      • تغيير الدورة يعيد تهيئة خيارات نوع البرنامج والموقع.
                    </li>
                  </ul>
                </div>
              </aside>

              <div className="space-y-5">
                <section className="rounded-[1.75rem] border bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <UserRound className="size-5 text-primary" />
                    <div>
                      <h3 className="font-black">البيانات الأساسية</h3>
                      <p className="text-xs text-muted-foreground">
                        الاسم، المدرسة، الجنس، ومعرف التيليجرام.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="edit-name">اسم الطالب</Label>
                      <Input
                        id="edit-name"
                        name="name"
                        autoComplete="off"
                        value={editDialog.form.name}
                        onChange={(e) => updateEditForm("name", e.target.value)}
                        required
                        placeholder="اسم الطالب الرباعي"
                        className="h-12 rounded-2xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-school">اسم المدرسة</Label>
                      <Input
                        id="edit-school"
                        name="school"
                        autoComplete="off"
                        value={editDialog.form.school}
                        onChange={(e) =>
                          updateEditForm("school", e.target.value)
                        }
                        required
                        placeholder="اسم المدرسة"
                        className="h-12 rounded-2xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-gender">الجنس</Label>
                      <Select
                        name="gender"
                        value={editDialog.form.gender}
                        onValueChange={(v) => updateEditForm("gender", v)}
                      >
                        <SelectTrigger
                          id="edit-gender"
                          className="h-12 rounded-2xl"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ذكر">ذكر</SelectItem>
                          <SelectItem value="أنثى">أنثى</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="edit-telegram">معرف التيليجرام</Label>
                      <Input
                        id="edit-telegram"
                        name="telegram"
                        autoComplete="off"
                        value={editDialog.form.telegram}
                        onChange={(e) => updateEditTelegram(e.target.value)}
                        placeholder="اختياري - username بدون @"
                        className="h-12 rounded-2xl"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-[1.75rem] border bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Phone className="size-5 text-primary" />
                    <div>
                      <h3 className="font-black">بيانات الاتصال</h3>
                      <p className="text-xs text-muted-foreground">
                        أرقام الطالب وولي الأمر مع ضبط الصيغة تلقائياً.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="edit-phone">رقم الطالب</Label>
                      <Input
                        id="edit-phone"
                        name="phone"
                        autoComplete="off"
                        value={editDialog.form.phone}
                        onChange={(e) =>
                          updateEditPhone("phone", e.target.value)
                        }
                        inputMode="numeric"
                        maxLength={11}
                        pattern="07[0-9]{9}"
                        dir="ltr"
                        required
                        className="h-12 rounded-2xl text-left"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-parentPhone">رقم ولي الأمر</Label>
                      <Input
                        id="edit-parentPhone"
                        name="parentPhone"
                        autoComplete="off"
                        value={editDialog.form.parentPhone}
                        onChange={(e) =>
                          updateEditPhone("parentPhone", e.target.value)
                        }
                        inputMode="numeric"
                        maxLength={11}
                        pattern="07[0-9]{9}"
                        dir="ltr"
                        required
                        className="h-12 rounded-2xl text-left"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-[1.75rem] border bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <GraduationCap className="size-5 text-primary" />
                    <div>
                      <h3 className="font-black">الدورة ونوع البرنامج</h3>
                      <p className="text-xs text-muted-foreground">
                        اختر الدورة ثم أكمل الخيارات المرتبطة بها.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div className="space-y-2 xl:col-span-2">
                      <Label htmlFor="edit-courseId">اختر الدورة</Label>
                      <Select
                        name="courseId"
                        value={editDialog.form.courseId}
                        onValueChange={(v) => {
                          setCourseTransferPolicy("");
                          setEditDialog((prev) => ({
                            ...prev,
                            form: {
                              ...prev.form,
                              courseId: v,
                              courseProgram: "",
                              courseTerm: "",
                              studyType: "",
                              locationScope: "",
                              baghdadMode: "",
                              subSite: "",
                            },
                          }));
                        }}
                        disabled={editFilteredCourses.length === 0}
                      >
                        <SelectTrigger
                          id="edit-courseId"
                          className="h-12 rounded-2xl"
                        >
                          <SelectValue
                            placeholder={
                              editFilteredCourses.length === 0
                                ? "لا توجد دورات مسجلة"
                                : "اختر الدورة"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {editFilteredCourses.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-muted-foreground">
                              لا توجد دورات مسجلة
                            </div>
                          ) : (
                            editFilteredCourses.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    {editNeedsTransferPolicy && editOriginalStudent && (
                      <div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/50 dark:bg-amber-950/20 dark:text-amber-100">
                        <div className="mb-3 flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
                          <div>
                            <p className="font-black">
                              {editCourseChanged
                                ? "نقل إلى دورة جديدة — سيبدأ الطالب بملف نظيف"
                                : "تغيير داخل نفس الدورة — اختر طريقة التعامل مع الملف"}
                            </p>
                            <p className="mt-1 text-xs leading-6 opacity-90">
                              رصيد الطالب الحالي: {registryOpportunityText(editOriginalStudent)}.
                              {editCourseChanged
                                ? ` سيتم حفظ كل درجاته وفرصه وإجازاته ومكالماته وملاحظاته الحالية داخل ملف سابق للقراءة فقط، ثم تصفير الملف الحي وبدء التسجيل في ${courseName(editDialog.form.courseId)}.`
                                : " يمكنك إبقاء كل الدرجات والفرص والإجراءات حرفياً كما هي، أو أرشفتها والبدء كطالب جديد داخل الدورة نفسها."}
                            </p>
                          </div>
                        </div>

                        <RadioGroup
                          value={effectiveCourseTransferPolicy}
                          onValueChange={(value) => {
                            setCourseTransferPolicy(value as CourseTransferPolicy);
                            setCourseTransferPolicySignature(editTransferSignature);
                            setAcademicImpactConfirmed(false);
                          }}
                          className={`grid gap-3 ${editCourseChanged ? "" : "md:grid-cols-2"}`}
                        >
                          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-background/80 p-3 text-foreground shadow-sm transition hover:border-primary/50">
                            <RadioGroupItem value="reset" className="mt-1" />
                            <span>
                              <span className="block font-bold">
                                {editCourseChanged
                                  ? "تأكيد النقل كطالب جديد"
                                  : "اعتباره طالباً جديداً داخل الدورة"}
                              </span>
                              <span className="mt-1 block text-xs leading-6 text-muted-foreground">
                                يُحفظ الملف الحالي للقراءة فقط، ثم تُزال الدرجات والخصومات والإجازات والمكالمات والملاحظات وأوراق التصحيح من الملف الحي. يبدأ برصيد {editTargetOpportunities} / {editTargetOpportunities} وتاريخ تسجيل جديد لحظة الحفظ.
                              </span>
                            </span>
                          </label>

                          {!editCourseChanged && (
                            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-background/80 p-3 text-foreground shadow-sm transition hover:border-primary/50">
                              <RadioGroupItem value="keep" className="mt-1" />
                              <span>
                                <span className="block font-bold">
                                  الإبقاء على الملف كما هو حرفياً
                                </span>
                                <span className="mt-1 block text-xs leading-6 text-muted-foreground">
                                  تتغير خيارات نوع البرنامج/الكورس/الموقع فقط. لا يعاد احتساب الرصيد، ولا تُقيّد الفرص بسقف جديد، ولا تتغير الدرجات أو الخصومات أو الحالة الأكاديمية.
                                </span>
                              </span>
                            </label>
                          )}
                        </RadioGroup>

                        {effectiveCourseTransferPolicy === "reset" &&
                          !editTargetActiveChapter && (
                            <p className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:border-red-500/50 dark:bg-red-950/30 dark:text-red-100">
                              تنبيه: الدورة لا تحتوي على فصل نشط، لذلك سيبدأ الملف الجديد برصيد 0 / 0.
                            </p>
                          )}
                      </div>
                    )}

                    {editDialog.form.courseId &&
                      editAvailablePrograms.length > 1 && (
                        <div className="space-y-2">
                          <Label htmlFor="edit-courseProgram">نوع الدورة</Label>
                          <Select
                            name="courseProgram"
                            value={editDialog.form.courseProgram}
                            onValueChange={(v) =>
                              setEditDialog((prev) => ({
                                ...prev,
                                form: {
                                  ...prev.form,
                                  courseProgram: v,
                                  courseTerm:
                                    v === "كورسات" ? prev.form.courseTerm : "",
                                  studyType: "",
                                  locationScope: "",
                                  baghdadMode: "",
                                  subSite: "",
                                },
                              }))
                            }
                          >
                            <SelectTrigger
                              id="edit-courseProgram"
                              className="h-12 rounded-2xl"
                            >
                              <SelectValue placeholder="اختر نوع الدورة..." />
                            </SelectTrigger>
                            <SelectContent>
                              {editAvailablePrograms.map((p) => (
                                <SelectItem key={p} value={p}>
                                  {p}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                    {editEffectiveCourseProgram === "كورسات" && (
                      <div className="space-y-2">
                        <Label htmlFor="edit-courseTerm">الكورس</Label>
                        <Select
                          name="courseTerm"
                          value={editDialog.form.courseTerm}
                          onValueChange={(v) => updateEditForm("courseTerm", v)}
                        >
                          <SelectTrigger
                            id="edit-courseTerm"
                            className="h-12 rounded-2xl"
                          >
                            <SelectValue placeholder="اختر الكورس..." />
                          </SelectTrigger>
                          <SelectContent>
                            {COURSE_TERMS.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {editDialog.form.courseId &&
                      editAvailableStudyTypes.length > 0 && (
                        <div className="space-y-2">
                          <Label htmlFor="edit-studyType">نوع البرنامج</Label>
                          <Select
                            name="studyType"
                            value={editDialog.form.studyType}
                            onValueChange={(v) =>
                              setEditDialog((prev) => ({
                                ...prev,
                                form: {
                                  ...prev.form,
                                  studyType: v,
                                  locationScope: "",
                                  baghdadMode: "",
                                  subSite: "",
                                },
                              }))
                            }
                          >
                            <SelectTrigger
                              id="edit-studyType"
                              className="h-12 rounded-2xl"
                            >
                              <SelectValue placeholder="اختر نوع البرنامج..." />
                            </SelectTrigger>
                            <SelectContent>
                              {editAvailableStudyTypes.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                  </div>
                </section>

                <section className="rounded-[1.75rem] border bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <MapPin className="size-5 text-primary" />
                    <div>
                      <h3 className="font-black">الموقع</h3>
                      <p className="text-xs text-muted-foreground">
                        تظهر الخيارات حسب نوع البرنامج والدورة المختارة.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {editDialog.form.studyType &&
                    editLocationScopes.length > 0 ? (
                      <div className="space-y-2">
                        <Label htmlFor="edit-locationScope">الموقع</Label>
                        <Select
                          name="locationScope"
                          value={
                            isEditOutOfCountry
                              ? ""
                              : editDialog.form.locationScope
                          }
                          onValueChange={(v) =>
                            setEditDialog((prev) => ({
                              ...prev,
                              form: {
                                ...prev.form,
                                locationScope: v,
                                subSite: "",
                              },
                            }))
                          }
                        >
                          <SelectTrigger
                            id="edit-locationScope"
                            className="h-12 rounded-2xl"
                          >
                            <SelectValue placeholder="اختر الموقع..." />
                          </SelectTrigger>
                          <SelectContent>
                            {editLocationScopes.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-2xl border border-dashed bg-muted/30 p-3 text-sm font-bold text-foreground transition hover:bg-muted/50">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={isEditOutOfCountry}
                            onChange={(event) =>
                              setEditDialog((prev) => ({
                                ...prev,
                                form: {
                                  ...prev.form,
                                  locationScope: event.target.checked
                                    ? OUT_OF_COUNTRY_LOCATION_SCOPE
                                    : "",
                                  baghdadMode: "",
                                  subSite: "",
                                },
                              }))
                            }
                          />
                          الطالب خارج القطر
                        </label>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground md:col-span-2">
                        اختر الدورة ونوع البرنامج لعرض خيارات الموقع.
                      </div>
                    )}

                    {isEditOutOfCountry && (
                      <div className="space-y-2">
                        <Label htmlFor="edit-outOfCountrySite">الدولة</Label>
                        <Input
                          id="edit-outOfCountrySite"
                          name="subSite"
                          autoComplete="off"
                          value={editDialog.form.subSite}
                          onChange={(e) =>
                            updateEditForm("subSite", e.target.value)
                          }
                          placeholder="مثلاً: تركيا"
                          required
                          className="h-12 rounded-2xl"
                        />
                        <p className="text-xs text-muted-foreground">
                          خيار خارج القطر عام لكل الدورات ولا يحتاج تفعيله من
                          إعدادات الدورة.
                        </p>
                      </div>
                    )}

                    {editDialog.form.locationScope &&
                      !isEditOutOfCountry &&
                      editSubSiteOptions.length > 0 && (
                        <div className="space-y-2">
                          <Label htmlFor="edit-subSite">الموقع الفرعي</Label>
                          <Select
                            name="subSite"
                            value={editDialog.form.subSite}
                            onValueChange={(v) => updateEditForm("subSite", v)}
                          >
                            <SelectTrigger
                              id="edit-subSite"
                              className="h-12 rounded-2xl"
                            >
                              <SelectValue placeholder="اختر الموقع الفرعي..." />
                            </SelectTrigger>
                            <SelectContent>
                              {editSubSiteOptions.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                  </div>
                </section>

                <section className="rounded-[1.75rem] border bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <CalendarDays className="size-5 text-primary" />
                    <div>
                      <h3 className="font-black">التسجيل وفترة السماح</h3>
                      <p className="text-xs text-muted-foreground">
                        يحدد هذا الجزء بداية احتساب الطالب أكاديمياً.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="edit-createdAt">
                        تاريخ إضافة الطالب / بداية السماح
                      </Label>
                      <DateInput
                        id="edit-createdAt"
                        name="createdAt"
                        autoComplete="off"
                        value={editDialog.form.createdAt}
                        onChange={(value) => updateEditForm("createdAt", value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-accountingGraceDays">
                        فترة السماح بالأيام
                      </Label>
                      <Input
                        id="edit-accountingGraceDays"
                        name="accountingGraceDays"
                        inputMode="numeric"
                        min={0}
                        max={30}
                        pattern="(?:[0-9]|[12][0-9]|30)"
                        autoComplete="off"
                        value={editDialog.form.accountingGraceDays}
                        onChange={(e) =>
                          updateEditForm(
                            "accountingGraceDays",
                            normalizeGraceDaysInput(e.target.value),
                          )
                        }
                        required
                        className="h-12 rounded-2xl"
                      />
                      <p className="text-xs text-muted-foreground">
                        لا يُحاسَب الطالب على الامتحانات أو الإخفاقات خلال هذه
                        الأيام.
                      </p>
                    </div>
                  </div>

                  {editNeedsAcademicImpactPreview && (
                    <div className="mt-4 rounded-2xl border border-orange-300 bg-orange-50 p-4 text-sm text-orange-950 dark:border-orange-500/50 dark:bg-orange-950/20 dark:text-orange-100">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-black">تغيير التاريخ أو فترة السماح يعيد تفسير الامتحانات القديمة</p>
                          {!hasCurrentAcademicImpactPreview ? (
                            <p className="mt-1 text-xs leading-6 opacity-90">
                              عند الضغط على حفظ سيعرض النظام الأثر الفعلي من بيانات النظام أولاً، ولن يحفظ التغيير قبل تأكيدك.
                            </p>
                          ) : academicImpactPreview ? (
                            <div className="mt-3 space-y-3">
                              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                                <div className="rounded-xl bg-background/80 p-3 text-foreground"><p className="text-xs text-muted-foreground">درجات تغير تفسيرها</p><p className="mt-1 text-xl font-black">{academicImpactPreview.impact.changedGrades}</p></div>
                                <div className="rounded-xl bg-background/80 p-3 text-foreground"><p className="text-xs text-muted-foreground">أصبحت محمية</p><p className="mt-1 text-xl font-black">{academicImpactPreview.impact.becameProtected}</p></div>
                                <div className="rounded-xl bg-background/80 p-3 text-foreground"><p className="text-xs text-muted-foreground">عادت للمحاسبة</p><p className="mt-1 text-xl font-black">{academicImpactPreview.impact.becameChargeable}</p></div>
                                <div className="rounded-xl bg-background/80 p-3 text-foreground"><p className="text-xs text-muted-foreground">الرصيد المتوقع</p><p className="mt-1 text-xl font-black">{academicImpactPreview.projection?.current.opportunities ?? "—"} ← {academicImpactPreview.projection?.projected.opportunities ?? "—"}</p></div>
                              </div>
                              {academicImpactPreview.projection && (
                                <p className="rounded-xl bg-background/80 p-3 text-xs leading-6 text-foreground">
                                  الحالة المتوقعة: {academicImpactPreview.projection.current.status} ← {academicImpactPreview.projection.projected.status}
                                  {academicImpactPreview.projection.projected.dismissalReason ? ` — ${academicImpactPreview.projection.projected.dismissalReason}` : ""}
                                </p>
                              )}
                              {academicImpactPreview.impact.sample.length > 0 && (
                                <div className="max-h-48 space-y-2 overflow-y-auto">
                                  {academicImpactPreview.impact.sample.map((item) => (
                                    <div key={item.examId} className="rounded-xl bg-background/80 p-3 text-xs text-foreground">
                                      <p className="font-bold">{item.examName} — {formatAppDate(item.examDate)}</p>
                                      <p className="mt-1 text-muted-foreground">{academicImpactKindLabel(item.before)} ← {academicImpactKindLabel(item.after)}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <Button
                                type="button"
                                variant={academicImpactConfirmed ? "default" : "outline"}
                                onClick={() => setAcademicImpactConfirmed((value) => !value)}
                                className="rounded-xl"
                              >
                                {academicImpactConfirmed
                                  ? "تم تأكيد الأثر — يمكن الحفظ"
                                  : "أؤكد تطبيق هذا الأثر عند الحفظ"}
                              </Button>
                            </div>
                          ) : null}
                          {academicImpactLoading && <p className="mt-2 text-xs font-bold">جاري حساب الأثر من بيانات النظام…</p>}
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border/70 bg-muted/30 px-4 py-4 sm:justify-between md:px-6">
            <p className="hidden text-xs text-muted-foreground sm:block">
              راجع الحقول المطلوبة قبل حفظ التعديل.
            </p>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <Button
                variant="outline"
                className="min-w-28 rounded-2xl"
                onClick={() =>
                  setEditDialog({ open: false, id: "", form: emptyEditForm })
                }
              >
                إلغاء
              </Button>
              <Button
                className="min-w-32 rounded-2xl"
                onClick={handleEditSave}
                disabled={isSavingEdit}
              >
                {isSavingEdit ? "جاري الحفظ..." : "حفظ التعديلات"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(o) => setDeleteDialog((prev) => ({ ...prev, open: o }))}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>أرشفة الطالب بدل الحذف النهائي</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-right leading-relaxed">
                <p>
                  لن يتم حذف الطالب &quot;{deleteDialog.studentName}&quot;
                  نهائياً. سيتم أرشفته وإخفاؤه من القوائم اليومية فقط، مع إبقاء
                  سجلاته وتقاريره محفوظة ويمكن استعادته لاحقاً.
                </p>
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-destructive">
                  الحذف النهائي معطّل لحماية الدرجات والإجازات والمكالمات
                  والملاحظات وسجلات الفرص وأوراق التصحيح من الضياع أو ظهور حالات
                  “طالب محذوف”.
                </div>
                <div className="rounded-2xl border bg-muted/40 p-3 text-foreground">
                  <div className="mb-2 font-bold">
                    فحص العلاقات من بيانات النظام
                  </div>
                  {deleteImpactLoading ? (
                    <div className="text-muted-foreground">
                      جاري فحص بيانات الطالب المرتبطة...
                    </div>
                  ) : formatStudentDeleteImpact(deleteImpact).length > 0 ? (
                    <ul className="list-inside list-disc space-y-1">
                      {formatStudentDeleteImpact(deleteImpact).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : deleteImpact ? (
                    <div className="text-muted-foreground">
                      لا توجد علاقات مسجلة، ومع ذلك سيتم استخدام الأرشفة كسلوك
                      آمن.
                    </div>
                  ) : (
                    <div className="text-muted-foreground">
                      تعذر عرض تفاصيل العلاقات حالياً، لكن الأرشفة ستبقى آمنة
                      لأنها لا تحذف السجلات.
                    </div>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeletingStudent || deleteImpactLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingStudent ? "جاري الأرشفة..." : "أرشفة الطالب"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={dismissDialog.open}
        onOpenChange={(o) => {
          setDismissDialog({ ...dismissDialog, open: o });
          if (!o) setDismissNotes("");
        }}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              فصل الطالب - {dismissDialog.student?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dismiss-type">نوع الفصل</Label>
              <Select
                name="type"
                value={dismissType}
                onValueChange={setDismissType}
              >
                <SelectTrigger id="dismiss-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="فصل مؤقت">فصل مؤقت</SelectItem>
                  <SelectItem value="فصل نهائي">فصل نهائي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dismiss-reason">سبب الفصل</Label>
              <Input
                id="dismiss-reason"
                name="dismissReason"
                autoComplete="off"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="سبب الفصل"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dismiss-notes">ملاحظات الفصل</Label>
              <textarea
                id="dismiss-notes"
                name="dismissNotes"
                value={dismissNotes}
                onChange={(e) => setDismissNotes(e.target.value)}
                placeholder="ملاحظات خاصة بالطالب المفصول"
                className="min-h-24 w-full rounded-2xl border bg-background/70 px-3 py-2 text-sm shadow-xs outline-none focus:border-primary"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDismissDialog({ student: null, open: false });
                setDismissNotes("");
              }}
            >
              إلغاء
            </Button>
            <Button variant="destructive" onClick={handleDismiss}>
              تأكيد الفصل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
