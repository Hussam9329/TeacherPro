"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTeacherStore, type Course } from "@/lib/teacher-store";
import {
  courseApi,
  type CourseOverviewResponse,
  type CourseStudentSyncPreview,
} from "@/lib/api";
import {
  type CourseProgram,
  type StudyType,
  getAvailablePrograms,
  getAvailableStudyTypes,
  getCourseLocationConfig,
  getStudyTypesByProgram,
} from "@/lib/course-config";
import {
  CourseBuilderForm,
  type CourseFormState,
  emptyCourseForm,
  normalizeCourseLocationConfig,
  normalizeStudyLocationConfig,
  validateCourseForm,
} from "./course-builder";
import "./courses.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { useActionLock } from "@/hooks/use-action-lock";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import {
  BookOpen,
  Plus,
  ChevronDown,
  Pencil,
  Pause,
  Play,
  Search,
  Users,
  CircleCheck,
  ShieldCheck,
  Layers,
  ClipboardList,
} from "lucide-react";
import { EmptyState } from "./ui-kit";
import { formatAppDate } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseOverviewRow = NonNullable<CourseOverviewResponse["rows"]>[number] & {
  course: Course;
};

type CourseStatusFilter = "all" | "active" | "inactive";
type CourseDeleteFilter = "all" | "deletable" | "blocked";

const courseStatusFilterLabels: Record<CourseStatusFilter, string> = {
  all: "كل الدورات",
  active: "نشطة للتسجيل",
  inactive: "موقوفة عن التسجيل",
};

const courseDeleteFilterLabels: Record<CourseDeleteFilter, string> = {
  all: "كل حالات الحذف",
  deletable: "قابلة للحذف",
  blocked: "محمية من الحذف",
};

/** Generate a human-readable location summary for a course */
function buildLocationSummary(course: Course): string {
  const config = getCourseLocationConfig(course);
  const studyTypes = getAvailableStudyTypes(course);
  const parts: string[] = [];

  for (const st of studyTypes) {
    const rawConfig = config[st as StudyType];
    if (!rawConfig) continue;
    const sc = normalizeStudyLocationConfig(st as StudyType, rawConfig);
    const segments: string[] = [];
    if (sc.scopes.includes("بغداد")) {
      if (sc.baghdadMode === "عموم بغداد") {
        segments.push("عموم بغداد");
      } else if (
        sc.baghdadMode === "بغداد - مخصص" &&
        sc.baghdadSites &&
        sc.baghdadSites.length > 0
      ) {
        segments.push(`بغداد-مخصص(${sc.baghdadSites.join("، ")})`);
      } else {
        segments.push("بغداد");
      }
    }
    if (sc.scopes.includes("محافظات")) {
      segments.push(
        sc.provinces && sc.provinces.length > 0
          ? `محافظات(${sc.provinces.join("، ")})`
          : "محافظات(غير محددة)",
      );
    }
    if (segments.length > 0) {
      parts.push(`${st}: ${segments.join("، ")}`);
    }
  }

  return parts.join(" | ");
}

// ─── Main Component ──────────────────────────────────────────────────────────

function normalizeCourseFromApi(course: Record<string, unknown>): Course {
  return {
    id: String(course.id || ""),
    name: String(course.name || ""),
    createdAt: course.createdAt ? String(course.createdAt).slice(0, 10) : "",
    active: course.active !== undefined ? Boolean(course.active) : true,
    availablePrograms: getAvailablePrograms(course) as CourseProgram[],
    availableStudyTypes: getAvailableStudyTypes(course) as StudyType[],
    studyTypesByProgram: getStudyTypesByProgram(course),
    locationConfig: normalizeCourseLocationConfig(
      JSON.parse(JSON.stringify(getCourseLocationConfig(course))),
      getAvailableStudyTypes(course) as StudyType[],
    ),
  };
}

function normalizeOverviewRows(
  rows: CourseOverviewResponse["rows"] = [],
): CourseOverviewRow[] {
  return rows.map((row) => ({
    ...row,
    course: normalizeCourseFromApi(row.course),
  })) as CourseOverviewRow[];
}

function courseFormToPayload(form: CourseFormState) {
  return {
    name: form.name.trim(),
    availablePrograms: form.availablePrograms,
    availableStudyTypes: form.availableStudyTypes,
    studyTypesByProgram: form.studyTypesByProgram,
    locationConfig: normalizeCourseLocationConfig(
      form.locationConfig,
      form.availableStudyTypes,
    ),
  };
}

function courseToForm(course: Course): CourseFormState {
  const studyTypes = getAvailableStudyTypes(course) as StudyType[];
  return {
    name: course.name,
    availablePrograms: getAvailablePrograms(course) as CourseProgram[],
    availableStudyTypes: studyTypes,
    studyTypesByProgram: getStudyTypesByProgram(course),
    locationConfig: normalizeCourseLocationConfig(
      JSON.parse(JSON.stringify(getCourseLocationConfig(course))),
      studyTypes,
    ),
  };
}

function topUsageItems(record: Record<string, number>, limit = 4): string[] {
  return Object.entries(record || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => `${label}: ${count}`);
}

function courseDeleteBadge(row: CourseOverviewRow) {
  return row.deleteSafety.canDelete ? "آمنة للحذف" : "الحذف محمي";
}

function CourseEditorDialog({
  open,
  onOpenChange,
  onCloseFocus,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseFocus: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseFocus();
        }}
        className="tp-course-editor teacherpro-fullscreen-dialog left-0 top-0 flex h-dvh max-h-dvh w-dvw max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:left-1/2 sm:top-1/2 sm:h-[min(90dvh,56rem)] sm:w-[calc(100dvw-2rem)] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-0"
      >
        <DialogHeader className="shrink-0 px-4 pl-16 sm:px-6 sm:pl-16">
          <DialogTitle className="tp-course-editor__title">
            <span className="tp-course-editor__icon">
              <BookOpen aria-hidden="true" />
            </span>
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="tp-course-editor__body">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function CoursesView() {
  const courseDialogTrigger = useRef<HTMLButtonElement | null>(null);
  const { loadSectionDataFromServer } = useTeacherStore();
  const syncKey = useTeacherProSyncKey([
    "courses",
    "chapters",
    "students",
    "exams",
  ]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);

  const [rows, setRows] = useState<CourseOverviewRow[]>([]);
  const [stats, setStats] = useState<CourseOverviewResponse["stats"] | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchText, setSearchText] = useState("");
  const debouncedSearchText = useDebouncedValue(searchText, 250);
  const [statusFilter, setStatusFilter] = useState<CourseStatusFilter>("all");
  const [deleteFilter, setDeleteFilter] = useState<CourseDeleteFilter>("all");

  // Create form
  const [createForm, setCreateForm] =
    useState<CourseFormState>(emptyCourseForm);

  // Edit dialog
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    courseId: string;
    form: CourseFormState;
    row: CourseOverviewRow | null;
  }>({ open: false, courseId: "", form: emptyCourseForm(), row: null });

  const [courseSyncDialog, setCourseSyncDialog] = useState<{
    open: boolean;
    courseId: string;
    payload: Record<string, unknown> | null;
    preview: CourseStudentSyncPreview | null;
  }>({ open: false, courseId: "", payload: null, preview: null });

  // Delete dialog
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    id: string;
    courseName: string;
    confirmText: string;
    row: CourseOverviewRow | null;
  }>({ open: false, id: "", courseName: "", confirmText: "", row: null });

  // Action locks
  const { locked: isAddingCourse, runLocked: runAddCourseLocked } =
    useActionLock();
  const { locked: isSavingCourse, runLocked: runSaveCourseLocked } =
    useActionLock();
  const { locked: isApplyingCourseSync, runLocked: runApplyCourseSyncLocked } =
    useActionLock();
  const { locked: isDeletingCourse, runLocked: runDeleteCourseLocked } =
    useActionLock();
  const { locked: isTogglingCourse, runLocked: runToggleCourseLocked } =
    useActionLock();

  const refreshOverview = useCallback(
    async (signal?: AbortSignal, options: { silent?: boolean } = {}) => {
      if (!options.silent) setIsLoading(true);
      if (!options.silent) setLoadError("");
      const data = await courseApi.overview({ signal, quietAbort: true });
      if (!data) {
        if (!signal?.aborted && !options.silent) {
          setLoadError("تعذر تحميل ملخص الدورات.");
          setIsLoading(false);
        }
        return;
      }
      if (signal?.aborted) return;
      setRows(normalizeOverviewRows(data.rows));
      setStats(data.stats);
      setIsLoading(false);
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshOverview(controller.signal, { silent: isBackgroundSync() });
    return () => controller.abort();
  }, [refreshOverview, syncKey, isBackgroundSync]);

  const syncCoursesAfterMutation = useCallback(
    async (reason: string) => {
      await refreshOverview(undefined, { silent: true });
      void loadSectionDataFromServer("courses");
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason,
        scopes: ["courses", "students", "exams", "dashboard"],
      });
    },
    [loadSectionDataFromServer, refreshOverview],
  );

  const filteredRows = useMemo(() => {
    const q = debouncedSearchText.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === "active" && !row.course.active) return false;
      if (statusFilter === "inactive" && row.course.active) return false;
      if (deleteFilter === "deletable" && !row.deleteSafety.canDelete)
        return false;
      if (deleteFilter === "blocked" && row.deleteSafety.canDelete)
        return false;
      if (!q) return true;
      const haystack = [
        row.course.name,
        ...row.course.availablePrograms,
        ...row.course.availableStudyTypes,
        buildLocationSummary(row.course),
        row.activeChapter?.name || "",
        ...row.deleteSafety.blockers,
        ...row.configWarnings,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [debouncedSearchText, deleteFilter, rows, statusFilter]);

  const filteredStats = { total: filteredRows.length };

  const hasActiveFilters =
    Boolean(debouncedSearchText.trim()) ||
    statusFilter !== "all" ||
    deleteFilter !== "all";

  // ─── Create course handler ─────────────────────────────────────────────────
  const handleCreate = runAddCourseLocked(async () => {
    const validationMessage = validateCourseForm(createForm);
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }
    const payload = courseFormToPayload(createForm);
    const result = await courseApi.add(
      payload as unknown as Record<string, unknown>,
    );
    if (!result.ok) {
      toast.error(result.error || "تعذر إضافة الدورة");
      return;
    }
    setCreateForm(emptyCourseForm());
    setShowCreateForm(false);
    toast.success("تمت إضافة الدورة");
    await syncCoursesAfterMutation("إضافة دورة");
  });

  // ─── Edit handlers ─────────────────────────────────────────────────────────
  const openEditDialog = (row: CourseOverviewRow) => {
    setEditDialog({
      open: true,
      courseId: row.course.id,
      form: courseToForm(row.course),
      row,
    });
  };

  const applyCourseUpdate = async (
    courseId: string,
    payload: Record<string, unknown>,
    syncStudentSnapshots: boolean,
    previewToken: string,
  ) => {
    const result = await courseApi.update(courseId, {
      ...payload,
      syncStudentSnapshots,
      previewToken,
    });
    if (!result.ok) {
      if (result.status === 409) {
        setCourseSyncDialog({
          open: false,
          courseId: "",
          payload: null,
          preview: null,
        });
      }
      toast.error(result.error || "تعذر تعديل الدورة");
      return false;
    }
    const impact = (
      result.data as {
        studentConfigImpact?: {
          affectedStudents?: number;
          syncedStudents?: number;
          message?: string;
        } | null;
      } | null
    )?.studentConfigImpact;
    setCourseSyncDialog({
      open: false,
      courseId: "",
      payload: null,
      preview: null,
    });
    setEditDialog({
      open: false,
      courseId: "",
      form: emptyCourseForm(),
      row: null,
    });
    toast.success(impact?.message || "تم تعديل الدورة");
    await syncCoursesAfterMutation(
      syncStudentSnapshots ? "تعديل ومزامنة إعدادات دورة" : "تعديل دورة",
    );
    return true;
  };

  const handleEditSave = runSaveCourseLocked(async () => {
    const validationMessage = validateCourseForm(editDialog.form);
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }
    const payload = courseFormToPayload(editDialog.form) as unknown as Record<
      string,
      unknown
    >;
    const result = await courseApi.previewUpdate(editDialog.courseId, payload);
    if (!result.ok) {
      toast.error(result.error || "تعذر معاينة أثر تعديل الدورة");
      return;
    }
    const preview = (
      result.data as { preview?: CourseStudentSyncPreview } | null
    )?.preview;
    if (!preview) {
      toast.error(
        "لم يُرجع النظام معاينة موثوقة لأثر التعديل، لذلك لم يتم الحفظ.",
      );
      return;
    }
    if (!preview.canSave) {
      toast.error(
        preview.blockingMessage ||
          "لا يمكن حفظ هذا التعديل لأنه سيجعل بيانات طلاب حاليين غير صالحة.",
      );
      return;
    }
    if (preview.configTouched && preview.eligibleStudents > 0) {
      setCourseSyncDialog({
        open: true,
        courseId: editDialog.courseId,
        payload,
        preview,
      });
      return;
    }
    await applyCourseUpdate(
      editDialog.courseId,
      payload,
      false,
      preview.previewToken,
    );
  });

  const handleCourseSyncDecision = runApplyCourseSyncLocked(
    async (syncStudentSnapshots: boolean) => {
      if (!courseSyncDialog.payload || !courseSyncDialog.courseId) return;
      await applyCourseUpdate(
        courseSyncDialog.courseId,
        courseSyncDialog.payload,
        syncStudentSnapshots,
        courseSyncDialog.preview?.previewToken || "",
      );
    },
  );

  // ─── Delete handler ────────────────────────────────────────────────────────
  const openDeleteDialog = (row: CourseOverviewRow) => {
    setDeleteDialog({
      open: true,
      id: row.course.id,
      courseName: row.course.name,
      confirmText: "",
      row,
    });
  };

  const handleDeleteConfirm = runDeleteCourseLocked(async () => {
    if (!deleteDialog.row?.deleteSafety.canDelete) {
      toast.error(
        "لا يمكن حذف هذه الدورة لأنها مرتبطة ببيانات. استخدم التعطيل بدل الحذف.",
      );
      return;
    }
    const result = await courseApi.remove(deleteDialog.id);
    if (!result.ok) {
      toast.error(result.error || "تعذر حذف الدورة");
      return;
    }
    toast.success("تم حذف الدورة");
    setDeleteDialog({
      open: false,
      id: "",
      courseName: "",
      confirmText: "",
      row: null,
    });
    await syncCoursesAfterMutation("حذف دورة");
  });

  // ─── Toggle handler ────────────────────────────────────────────────────────
  const handleToggle = runToggleCourseLocked(async (row: CourseOverviewRow) => {
    const nextActive = !row.course.active;
    const result = await courseApi.update(row.course.id, {
      active: nextActive,
    });
    if (!result.ok) {
      toast.error(result.error || "تعذر تغيير حالة الدورة");
      return;
    }
    toast.success(
      nextActive
        ? "تم تفعيل الدورة للاختيارات الجديدة"
        : "تم إيقاف الدورة عن التسجيل والاختيارات الجديدة",
    );
    await syncCoursesAfterMutation(nextActive ? "تفعيل دورة" : "تعطيل دورة");
  });

  const renderStats = () => (
    <dl className="tp-courses__stats" aria-label="إحصائيات الدورات">
      {[
        {
          label: "إجمالي الدورات",
          value: stats?.total,
          icon: BookOpen,
          tone: "violet",
        },
        {
          label: "نشطة للتسجيل",
          value: stats?.active,
          icon: CircleCheck,
          tone: "green",
        },
        {
          label: "موقوفة عن التسجيل",
          value: stats?.inactive,
          icon: Pause,
          tone: "amber",
        },
        {
          label: "عليها طلاب",
          value: stats?.withStudents,
          icon: Users,
          tone: "sky",
        },
        {
          label: "آمنة للحذف",
          value: stats?.deletable,
          icon: ShieldCheck,
          tone: "teal",
        },
      ].map(({ label, value, icon: Icon, tone }) => (
        <div key={label} data-tone={tone}>
          <dt>
            <span className="tp-courses__stat-icon" aria-hidden="true">
              <Icon />
            </span>
            {label}
          </dt>
          <dd>{value ?? (isLoading ? "…" : "—")}</dd>
        </div>
      ))}
    </dl>
  );

  const renderLoadingSkeleton = () => (
    <div
      className="tp-courses__grid"
      role="status"
      aria-label="جاري تحميل الدورات"
    >
      <span className="sr-only">جاري تحميل الدورات…</span>
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="tp-course-card tp-courses__skeleton"
          aria-hidden="true"
        >
          <span className="h-5 w-2/3 animate-pulse rounded bg-muted" />
          <span className="h-14 w-full animate-pulse rounded-lg bg-muted" />
          <span className="h-10 w-full animate-pulse rounded-lg bg-muted" />
          <span className="h-10 w-full animate-pulse rounded-lg bg-muted" />
        </div>
      ))}
    </div>
  );

  const renderCourseCard = (row: CourseOverviewRow) => {
    const programs = getAvailablePrograms(row.course);
    const studyTypesByProgram = getStudyTypesByProgram(row.course);
    const locationSummary = buildLocationSummary(row.course);
    const studyTypeUsage = topUsageItems(row.usage.studyTypes);
    const locationUsage = topUsageItems(row.usage.locations);
    return (
      <article
        key={row.id}
        className="tp-course-card"
        aria-labelledby={`course-title-${row.id}`}
      >
        <header className="tp-course-card__header">
          <span className="tp-course-card__identity-icon">
            <BookOpen aria-hidden="true" />
          </span>
          <h3 id={`course-title-${row.id}`}>{row.course.name}</h3>
          <span
            className={`tp-course-card__status ${row.course.active ? "is-active" : "is-inactive"}`}
          >
            {row.course.active ? "نشطة للتسجيل" : "موقوفة عن التسجيل"}
          </span>
        </header>

        <dl className="tp-course-card__metrics">
          <div data-tone="sky">
            <dt>
              <Users aria-hidden="true" /> الطلاب
            </dt>
            <dd>{row.counts.students}</dd>
          </div>
          <div data-tone="violet">
            <dt>
              <ClipboardList aria-hidden="true" /> الامتحانات
            </dt>
            <dd>{row.counts.exams}</dd>
          </div>
          <div data-tone="teal">
            <dt>
              <Layers aria-hidden="true" /> الفصول
            </dt>
            <dd>{row.counts.courseChapters}</dd>
          </div>
        </dl>

        <dl className="tp-course-card__chapter">
          <dt>الفصل النشط</dt>
          <dd>
            <span>{row.activeChapter?.name || "لا يوجد"}</span>
            {row.activeChapter && (
              <span className="tp-course-card__opportunities">
                {row.activeChapter.opportunities} فرص
              </span>
            )}
          </dd>
        </dl>

        {row.configWarnings.length > 0 && (
          <div className="tp-course-card__warnings" role="status">
            {row.configWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}

        <div className="tp-course-card__actions">
          <Button
            variant="default"
            className="tp-course-card__edit-button"
            onClick={(event) => {
              courseDialogTrigger.current = event.currentTarget;
              openEditDialog(row);
            }}
            aria-label={`تعديل ${row.course.name}`}
          >
            <Pencil aria-hidden="true" /> تعديل الدورة
          </Button>
          <Button
            variant="outline"
            className={`tp-course-card__toggle-button ${row.course.active ? "is-pause" : "is-resume"}`}
            disabled={isTogglingCourse}
            onClick={() => void handleToggle(row)}
            aria-label={`${row.course.active ? "إيقاف التسجيل في" : "تفعيل التسجيل في"} ${row.course.name}`}
          >
            {row.course.active ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            {row.course.active ? "إيقاف التسجيل" : "تفعيل التسجيل"}
          </Button>
        </div>

        <details className="tp-course-card__disclosure">
          <summary>
            <span>
              <ClipboardList aria-hidden="true" /> تفاصيل الدورة
            </span>{" "}
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="tp-course-card__details">
            <section className="tp-course-card__detail-section">
              <h4>إعدادات التسجيل</h4>
              <dl className="tp-course-card__facts">
                {programs.map((program) => (
                  <div key={program}>
                    <dt>{program}</dt>
                    <dd>
                      {(studyTypesByProgram[program] || []).join("، ") ||
                        "بدون نوع دراسة"}
                    </dd>
                  </div>
                ))}
              </dl>
              {locationSummary ? (
                <ul className="tp-course-card__locations">
                  {locationSummary.split(" | ").map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">
                  لا توجد إعدادات مواقع مكتملة لهذه الدورة.
                </p>
              )}
            </section>

            <section className="tp-course-card__detail-section">
              <h4>الطلاب والامتحانات</h4>
              <dl className="tp-course-card__facts">
                <div>
                  <dt>طلاب نشطون</dt>
                  <dd>{row.counts.activeStudents}</dd>
                </div>
                <div>
                  <dt>طلاب مفصولون</dt>
                  <dd>{row.counts.dismissedStudents}</dd>
                </div>
                <div>
                  <dt>طلاب مؤرشفون</dt>
                  <dd>{row.counts.archivedStudents}</dd>
                </div>
                <div>
                  <dt>امتحانات فعالة</dt>
                  <dd>{row.counts.activeExams}</dd>
                </div>
                <div>
                  <dt>امتحانات معطلة</dt>
                  <dd>{row.counts.inactiveExams}</dd>
                </div>
                <div>
                  <dt>تاريخ الإنشاء</dt>
                  <dd>{formatAppDate(row.course.createdAt)}</dd>
                </div>
              </dl>
            </section>

            {(studyTypeUsage.length > 0 || locationUsage.length > 0) && (
              <section className="tp-course-card__detail-section">
                {studyTypeUsage.length > 0 && (
                  <>
                    <h4>توزيع الطلاب حسب الدراسة</h4>
                    <ul>
                      {studyTypeUsage.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}
                {locationUsage.length > 0 && (
                  <>
                    <h4>أكثر المواقع استخداماً</h4>
                    <ul>
                      {locationUsage.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}

            <section className="tp-course-card__detail-section tp-course-card__delete">
              <h4>{courseDeleteBadge(row)}</h4>
              <p>
                {row.deleteSafety.blockers.length
                  ? row.deleteSafety.blockers.join("، ")
                  : "لا توجد روابط مانعة للحذف."}
              </p>
              <p className="text-muted-foreground">
                إيقاف التسجيل لا يغيّر بيانات الطلاب الحاليين.
              </p>
              <Button
                variant="ghost"
                onClick={() => openDeleteDialog(row)}
                className="text-destructive hover:text-destructive"
                aria-label={`حذف نهائي للدورة ${row.course.name}`}
              >
                حذف نهائي
              </Button>
            </section>
          </div>
        </details>
      </article>
    );
  };

  return (
    <div className="tp-courses">
      <div className="tp-courses__intro">
        <h2>
          <span className="tp-courses__intro-icon">
            <BookOpen aria-hidden="true" />
          </span>
          إدارة الدورات
        </h2>
        <Button
          onClick={(event) => {
            courseDialogTrigger.current = event.currentTarget;
            setShowCreateForm(true);
          }}
        >
          <Plus aria-hidden="true" /> إضافة دورة جديدة
        </Button>
      </div>

      {renderStats()}

      <section className="tp-courses__list" aria-label="قائمة الدورات">
        <div className="tp-courses__filters">
          <div className="tp-courses__search">
            <Label htmlFor="course-search">بحث في الدورات</Label>
            <div className="tp-courses__search-input">
              <Search aria-hidden="true" />
              <Input
                id="course-search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="اسم الدورة، الفصل أو الموقع"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="tp-courses__filter">
            <Label htmlFor="course-status-filter">حالة الدورة</Label>
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                setStatusFilter(value as CourseStatusFilter)
              }
            >
              <SelectTrigger id="course-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(courseStatusFilterLabels).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="tp-courses__filter">
            <Label htmlFor="course-delete-filter">حماية الحذف</Label>
            <Select
              value={deleteFilter}
              onValueChange={(value) =>
                setDeleteFilter(value as CourseDeleteFilter)
              }
            >
              <SelectTrigger id="course-delete-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(courseDeleteFilterLabels).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="tp-courses__results" role="status" aria-live="polite">
          <p data-count-scope="filtered">
            {isLoading
              ? "جاري التحميل…"
              : `${filteredStats.total} من ${rows.length} دورة`}
          </p>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearchText("");
                setStatusFilter("all");
                setDeleteFilter("all");
              }}
            >
              تصفير الفلاتر
            </Button>
          )}
        </div>
        {loadError ? (
          <div className="tp-courses__error" role="alert">
            <p>{loadError}</p>
            <Button variant="outline" onClick={() => void refreshOverview()}>
              إعادة المحاولة
            </Button>
          </div>
        ) : isLoading ? (
          renderLoadingSkeleton()
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={hasActiveFilters ? "لا توجد دورات مطابقة" : "لا توجد دورات"}
          />
        ) : (
          <div className="tp-courses__grid">
            {filteredRows.map(renderCourseCard)}
          </div>
        )}
      </section>

      <CourseEditorDialog
        open={showCreateForm}
        onCloseFocus={() => courseDialogTrigger.current?.focus()}
        onOpenChange={(open) => {
          if (!isAddingCourse) setShowCreateForm(open);
        }}
        title="إضافة دورة جديدة"
      >
        <CourseBuilderForm
          form={createForm}
          setForm={setCreateForm}
          onSubmit={handleCreate}
          submitLabel="حفظ الدورة"
          submitDisabled={isAddingCourse}
        />
      </CourseEditorDialog>

      <CourseEditorDialog
        open={editDialog.open}
        onCloseFocus={() => courseDialogTrigger.current?.focus()}
        onOpenChange={(open) => {
          if (!isSavingCourse && !isApplyingCourseSync)
            setEditDialog((prev) => ({ ...prev, open }));
        }}
        title="تعديل الدورة"
      >
        {editDialog.row && (
          <div className="tp-course-editor__context">
            <p className="font-bold">{editDialog.row.course.name}</p>
            <dl className="tp-course-editor__facts">
              <div>
                <dt>الطلاب</dt>
                <dd>{editDialog.row.counts.students}</dd>
              </div>
              <div>
                <dt>الامتحانات</dt>
                <dd>{editDialog.row.counts.exams}</dd>
              </div>
              <div>
                <dt>الفصل النشط</dt>
                <dd>{editDialog.row.activeChapter?.name || "لا يوجد"}</dd>
              </div>
            </dl>
            <p className="text-sm text-muted-foreground">
              لا يمكن حذف خيار يستخدمه طلاب مسجلون.
            </p>
          </div>
        )}
        <CourseBuilderForm
          form={editDialog.form}
          setForm={(action) =>
            setEditDialog((prev) => ({
              ...prev,
              form: typeof action === "function" ? action(prev.form) : action,
            }))
          }
          onSubmit={handleEditSave}
          submitLabel="حفظ التعديلات"
          submitDisabled={isSavingCourse || isApplyingCourseSync}
        />
      </CourseEditorDialog>

      {/* ─── Course snapshot synchronization preview ─────────────────────── */}
      <AlertDialog
        open={courseSyncDialog.open}
        onOpenChange={(open) => {
          if (isApplyingCourseSync) return;
          setCourseSyncDialog((prev) =>
            open
              ? { ...prev, open: true }
              : { open: false, courseId: "", payload: null, preview: null },
          );
        }}
      >
        <AlertDialogContent
          dir="rtl"
          className="tp-course-sync-dialog sm:max-w-2xl"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>معاينة أثر تعديل إعدادات الدورة</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-right leading-7">
                <p>
                  اختر الاحتفاظ ببيانات الطلاب الحالية أو تحديثها حسب الإعدادات
                  الجديدة.
                </p>
                {courseSyncDialog.preview ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-xl border bg-muted/35 p-3">
                        <p className="text-xs text-muted-foreground">
                          طلاب حاليون
                        </p>
                        <p className="text-xl font-black text-foreground">
                          {courseSyncDialog.preview.eligibleStudents}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-primary/5 p-3">
                        <p className="text-xs text-muted-foreground">
                          تحتاج بياناتهم تحديثاً
                        </p>
                        <p className="text-xl font-black text-primary">
                          {courseSyncDialog.preview.studentsToUpdate}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-muted/35 p-3">
                        <p className="text-xs text-muted-foreground">
                          مؤرشفون لن يتغيروا
                        </p>
                        <p className="text-xl font-black text-foreground">
                          {courseSyncDialog.preview.skippedArchived}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border bg-muted/25 p-3 text-sm">
                      <p className="mb-2 font-bold text-foreground">
                        الحقول التي ستتغير عند اختيار المزامنة:
                      </p>
                      <div className="grid gap-1 sm:grid-cols-2">
                        <p>
                          الفترة/نوع الدورة:{" "}
                          {courseSyncDialog.preview.fieldChanges.courseTerm}
                        </p>
                        <p>
                          نمط بغداد:{" "}
                          {courseSyncDialog.preview.fieldChanges.baghdadMode}
                        </p>
                        <p>
                          الموقع الرئيسي:{" "}
                          {courseSyncDialog.preview.fieldChanges.mainSite}
                        </p>
                        <p>
                          الموقع الفرعي:{" "}
                          {courseSyncDialog.preview.fieldChanges.subSite}
                        </p>
                      </div>
                    </div>
                    {courseSyncDialog.preview.studentsToUpdate === 0 ? (
                      <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-emerald-800 dark:text-emerald-200">
                        جميع بيانات الطلاب الحالية متوافقة أصلاً؛ خيار المزامنة
                        لن يغير أي سجل.
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogCancel disabled={isApplyingCourseSync}>
              إلغاء التعديل
            </AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={isApplyingCourseSync}
              onClick={() => void handleCourseSyncDecision(false)}
            >
              حفظ الإعداد فقط
            </Button>
            <AlertDialogAction
              disabled={
                isApplyingCourseSync || !courseSyncDialog.preview?.canSync
              }
              onClick={() => void handleCourseSyncDecision(true)}
            >
              {isApplyingCourseSync ? "جاري الحفظ..." : "حفظ ومزامنة الطلاب"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Delete Course AlertDialog ───────────────────────────────────── */}
      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) =>
          setDeleteDialog((prev) => ({
            ...prev,
            open,
            confirmText: open ? prev.confirmText : "",
          }))
        }
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف نهائي للدورة</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-right leading-7">
                <p>يمكن حذف الدورة إذا لم تكن مرتبطة بطلاب أو امتحانات.</p>
                {deleteDialog.row ? (
                  <div
                    className={`rounded-xl border p-3 ${deleteDialog.row.deleteSafety.canDelete ? "bg-muted/40" : "border-destructive/25 bg-destructive/10 text-destructive"}`}
                  >
                    <p className="font-bold">
                      {deleteDialog.row.deleteSafety.canDelete
                        ? "هذه الدورة آمنة للحذف"
                        : "لا يمكن حذف هذه الدورة حالياً"}
                    </p>
                    <p className="text-sm">
                      {deleteDialog.row.deleteSafety.blockers.length
                        ? deleteDialog.row.deleteSafety.blockers.join("، ")
                        : "لا توجد روابط تمنع الحذف."}
                    </p>
                    <p className="text-sm">
                      {deleteDialog.row.deleteSafety.recommendedAction}
                    </p>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="deleteCourseConfirm">
                    اكتب اسم الدورة لتأكيد الحذف النهائي:
                  </Label>
                  <Input
                    id="deleteCourseConfirm"
                    value={deleteDialog.confirmText}
                    onChange={(event) =>
                      setDeleteDialog((prev) => ({
                        ...prev,
                        confirmText: event.target.value,
                      }))
                    }
                    placeholder={deleteDialog.courseName}
                    autoComplete="off"
                    disabled={!deleteDialog.row?.deleteSafety.canDelete}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={
                isDeletingCourse ||
                !deleteDialog.row?.deleteSafety.canDelete ||
                deleteDialog.confirmText.trim() !==
                  deleteDialog.courseName.trim()
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingCourse ? "جاري الحذف..." : "حذف نهائي"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
