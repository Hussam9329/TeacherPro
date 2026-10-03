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
  CourseRegistrationPreview,
  type CourseFormState,
  emptyCourseForm,
  normalizeCourseLocationConfig,
  normalizeStudyLocationConfig,
  validateCourseForm,
} from "./course-builder";
import "./courses.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useActionLock } from "@/hooks/use-action-lock";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { BookOpen, BookPlus, Plus, Pencil, Pause, Play, Settings2, SquarePen, Trash2 } from "lucide-react";
import { FormDialogHero } from "./form-dialog";
import { EmptyState } from "./ui-kit";
import { ListToolbar } from "./list-toolbar";
import { RowActionsMenu } from "./row-actions-menu";
import { formatAppDate } from "@/lib/format";
import { normalizeForSearch } from "@/lib/validation";

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseOverviewRow = NonNullable<CourseOverviewResponse["rows"]>[number] & {
  course: Course;
};

type CourseStatusFilter = "all" | "active" | "inactive" | "no-chapter";
type CourseDeleteFilter = "all" | "deletable" | "blocked";

const courseStatusFilterLabels: Record<CourseStatusFilter, string> = {
  all: "كل الدورات",
  active: "نشطة للتسجيل",
  inactive: "موقوفة عن التسجيل",
  "no-chapter": "بلا فصل نشط",
};

/** Said once at the top of the page, not on every card. */
const NO_ACTIVE_CHAPTER_WARNING = "لا يوجد فصل نشط مرتبط بهذه الدورة حالياً.";

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
  icon,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseFocus: () => void;
  icon: React.ComponentType<{ className?: string }>;
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
        className="tp-form-dialog tp-course-editor sm:max-w-3xl"
      >
        <FormDialogHero icon={icon} title={title} />
        <div className="tp-form-dialog__body tp-course-editor__body">{children}</div>
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
  const [settingsCourseId, setSettingsCourseId] = useState<string | null>(null);
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
    const q = normalizeForSearch(debouncedSearchText);
    return rows.filter((row) => {
      if (statusFilter === "active" && !row.course.active) return false;
      if (statusFilter === "inactive" && row.course.active) return false;
      if (statusFilter === "no-chapter" && row.activeChapter) return false;
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
        .map(normalizeForSearch)
        .join(" ");
      return haystack.includes(q);
    });
  }, [debouncedSearchText, deleteFilter, rows, statusFilter]);

  const filteredStats = { total: filteredRows.length };
  // The status buttons count what each would show with the other filters.
  const statusChipCounts = useMemo(() => {
    const q = normalizeForSearch(debouncedSearchText);
    const counts = { all: 0, active: 0, inactive: 0, noChapter: 0 };
    for (const row of rows) {
      if (deleteFilter === "deletable" && !row.deleteSafety.canDelete) continue;
      if (deleteFilter === "blocked" && row.deleteSafety.canDelete) continue;
      if (q) {
        const haystack = [
          row.course.name,
          ...row.course.availablePrograms,
          ...row.course.availableStudyTypes,
          buildLocationSummary(row.course),
          row.activeChapter?.name || "",
          ...row.deleteSafety.blockers,
          ...row.configWarnings,
        ]
          .map(normalizeForSearch)
          .join(" ");
        if (!haystack.includes(q)) continue;
      }
      counts.all += 1;
      if (row.course.active) counts.active += 1;
      else counts.inactive += 1;
      if (!row.activeChapter) counts.noChapter += 1;
    }
    return counts;
  }, [debouncedSearchText, deleteFilter, rows]);
  const coursesWithoutChapter = rows.filter((row) => !row.activeChapter).length;

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
    const studyTypes = getAvailableStudyTypes(row.course);
    const cardWarnings = row.configWarnings.filter(
      (warning) => warning !== NO_ACTIVE_CHAPTER_WARNING,
    );
    return (
      <article
        key={row.id}
        className="tp-course-card"
        aria-labelledby={`course-title-${row.id}`}
        data-inactive={!row.course.active || undefined}
      >
        <div className="tp-course-card__overview">
          <div className="tp-course-card__identity">
            <header className="tp-course-card__header">
              <h3 id={`course-title-${row.id}`}>{row.course.name}</h3>
              <Badge variant={row.course.active ? "success" : "warning"}>
                {row.course.active ? "نشطة للتسجيل" : "موقوفة عن التسجيل"}
              </Badge>
              {!row.activeChapter && (
                <Badge variant="outline" className="tp-course-card__no-chapter">
                  بلا فصل نشط
                </Badge>
              )}
            </header>
            <dl className="tp-course-card__chapter">
              <dt>الفصل النشط:</dt>
              <dd>
                <span>{row.activeChapter?.name || "لا يوجد"}</span>
                {row.activeChapter && (
                  <span> · {row.activeChapter.opportunities} فرص</span>
                )}
              </dd>
            </dl>
            <ul className="tp-course-card__chips" aria-label="خيارات الاشتراك والدراسة">
              {programs.map((program) => (
                <li key={program} data-kind="program">{program}</li>
              ))}
              {studyTypes.map((studyType) => (
                <li key={studyType} data-kind="study">{studyType}</li>
              ))}
              {programs.length === 0 && <li data-kind="empty">لم تُضبط الخيارات بعد</li>}
            </ul>
          </div>
          <dl className="tp-course-card__metrics">
            <div>
              <dt>الطلاب</dt>
              <dd className="text-primary">{row.counts.students}</dd>
            </div>
            <div>
              <dt>الامتحانات</dt>
              <dd>{row.counts.exams}</dd>
            </div>
            <div>
              <dt>الفصول</dt>
              <dd>{row.counts.courseChapters}</dd>
            </div>
          </dl>
        </div>

        {cardWarnings.length > 0 && (
          <div className="tp-course-card__warnings" role="status">
            {cardWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}

        <div className="tp-course-card__actions">
          <Button
            variant="default"
            size="sm"
            className="text-xs font-bold"
            onClick={(event) => {
              courseDialogTrigger.current = event.currentTarget;
              setSettingsCourseId(row.id);
            }}
            aria-label={`عرض إعدادات ${row.course.name}`}
          >
            <Settings2 aria-hidden="true" /> عرض إعدادات الدورة
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={(event) => {
              courseDialogTrigger.current = event.currentTarget;
              openEditDialog(row);
            }}
            aria-label={`تعديل ${row.course.name}`}
          >
            <Pencil aria-hidden="true" /> تعديل الدورة
          </Button>
          <RowActionsMenu
            label={`إجراءات ${row.course.name}`}
            actions={[
              {
                key: "toggle",
                label: row.course.active ? "إيقاف التسجيل" : "تفعيل التسجيل",
                icon: row.course.active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />,
                disabled: isTogglingCourse,
                onSelect: () => void handleToggle(row),
              },
              {
                key: "delete",
                label: "حذف نهائي…",
                icon: <Trash2 aria-hidden="true" />,
                danger: true,
                onSelect: () => openDeleteDialog(row),
              },
            ]}
          />
        </div>
      </article>
    );
  };

  const settingsRow = settingsCourseId
    ? rows.find((row) => row.id === settingsCourseId) || null
    : null;

  const renderCourseSettings = (row: CourseOverviewRow) => {
    const studyTypeUsage = topUsageItems(row.usage.studyTypes);
    const locationUsage = topUsageItems(row.usage.locations);
    return (
      <div className="tp-course-settings">
        <section className="tp-course-settings__section" aria-labelledby="course-settings-registration">
          <h4 id="course-settings-registration">ما يظهر للموظف عند تسجيل طالب</h4>
          <CourseRegistrationPreview form={courseToForm(row.course)} />
        </section>

        <section className="tp-course-settings__section" aria-labelledby="course-settings-facts">
          <h4 id="course-settings-facts">الطلاب والامتحانات</h4>
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
          <section className="tp-course-settings__section" aria-labelledby="course-settings-usage">
            <h4 id="course-settings-usage">توزيع الطلاب الحاليين</h4>
            <div className="tp-course-settings__usage">
              {studyTypeUsage.length > 0 && (
                <div>
                  <p className="font-bold">حسب الدراسة</p>
                  <ul>
                    {studyTypeUsage.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {locationUsage.length > 0 && (
                <div>
                  <p className="font-bold">أكثر المواقع استخداماً</p>
                  <ul>
                    {locationUsage.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        <section className="tp-course-settings__section tp-course-card__delete" aria-labelledby="course-settings-delete">
          <h4 id="course-settings-delete">{courseDeleteBadge(row)}</h4>
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
            onClick={() => {
              setSettingsCourseId(null);
              openDeleteDialog(row);
            }}
            className="text-danger hover:text-destructive"
            aria-label={`حذف نهائي للدورة ${row.course.name}`}
          >
            <Trash2 aria-hidden="true" />
            حذف نهائي
          </Button>
        </section>
      </div>
    );
  };

  return (
    <div className="tp-management-page tp-courses-page tp-list">
      <ListToolbar
        label="البحث والتصفية في الدورات"
        search={
          <Input
            id="course-search"
            aria-label="بحث في الدورات"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="اسم الدورة، الفصل أو الموقع"
            autoComplete="off"
          />
        }
        actions={
          <>
            <Button
              onClick={(event) => {
                courseDialogTrigger.current = event.currentTarget;
                setShowCreateForm(true);
              }}
            >
              <Plus aria-hidden="true" /> إضافة دورة جديدة
            </Button>
            {hasActiveFilters ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearchText("");
                  setStatusFilter("all");
                  setDeleteFilter("all");
                }}
              >
                تصفير الفلاتر
              </Button>
            ) : null}
          </>
        }
        chips={[
          { key: "all", label: "الكل", count: isLoading ? null : statusChipCounts.all, hint: "إجمالي الدورات" },
          { key: "active", label: courseStatusFilterLabels.active, tone: "success", count: isLoading ? null : statusChipCounts.active },
          { key: "inactive", label: courseStatusFilterLabels.inactive, tone: "warning", count: isLoading ? null : statusChipCounts.inactive },
          { key: "no-chapter", label: courseStatusFilterLabels["no-chapter"], tone: "danger", count: isLoading ? null : statusChipCounts.noChapter },
        ]}
        chipsLabel="حالة الدورة"
        activeChip={statusFilter}
        onChipChange={(value) => setStatusFilter(value as CourseStatusFilter)}
        activeFilterCount={Number(deleteFilter !== "all")}
        activeFilters={
          deleteFilter !== "all"
            ? [{ key: "delete", label: courseDeleteFilterLabels[deleteFilter], onClear: () => setDeleteFilter("all") }]
            : []
        }
        onClearFilters={() => setDeleteFilter("all")}
        filters={
          <div className="space-y-1.5">
            <Label htmlFor="course-delete-filter" className="text-xs font-bold">حماية الحذف</Label>
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
        }
        summary={
          <span data-count-scope="filtered" role="status">
            {isLoading ? (
              "جاري التحميل…"
            ) : (
              <>
                المعروض <b>{filteredStats.total}</b> من <b>{rows.length}</b> دورة
                {stats ? <> · عليها طلاب {stats.withStudents} · آمنة للحذف {stats.deletable}</> : null}
              </>
            )}
          </span>
        }
      />

      {!isLoading && coursesWithoutChapter > 0 && statusFilter !== "no-chapter" ? (
        <div className="tp-courses__chapter-banner" role="status">
          <p>
            <b>{coursesWithoutChapter} من {rows.length}</b> دورات بلا فصل نشط: ما تنضاف إلها امتحانات،
            والطالب الجديد بيها يبدأ بدون فرص.
          </p>
          <Button variant="outline" size="sm" onClick={() => setStatusFilter("no-chapter")}>
            عرض هذي الدورات
          </Button>
        </div>
      ) : null}

      <section className="tp-courses__results" aria-label="قائمة الدورات">
        {loadError ? (
          <div className="tp-courses__error" role="alert">
            <p>{loadError}</p>
            <Button
              variant="outline"
              onClick={() => void refreshOverview()}
            >
              إعادة المحاولة
            </Button>
          </div>
        ) : isLoading ? (
          renderLoadingSkeleton()
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={
              hasActiveFilters ? "لا توجد دورات مطابقة" : "لا توجد دورات"
            }
          />
        ) : (
          <div className="tp-courses__grid">
            {filteredRows.map(renderCourseCard)}
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(settingsRow)}
        onOpenChange={(open) => {
          if (!open) setSettingsCourseId(null);
        }}
      >
        <DialogContent
          dir="rtl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            courseDialogTrigger.current?.focus();
          }}
          className="tp-form-dialog tp-course-settings-dialog sm:max-w-2xl"
        >
          <FormDialogHero
            icon={Settings2}
            title="إعدادات الدورة"
            description={settingsRow
              ? `${settingsRow.course.name} · ${settingsRow.course.active ? "نشطة للتسجيل" : "موقوفة عن التسجيل"}`
              : null}
          />
          {settingsRow && <div className="tp-form-dialog__body">{renderCourseSettings(settingsRow)}</div>}
          {settingsRow && (
            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  const row = settingsRow;
                  setSettingsCourseId(null);
                  openEditDialog(row);
                }}
              >
                <Pencil aria-hidden="true" />
                تعديل إعدادات الدورة
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <CourseEditorDialog
        open={showCreateForm}
        onCloseFocus={() => courseDialogTrigger.current?.focus()}
        onOpenChange={(open) => {
          if (!isAddingCourse) setShowCreateForm(open);
        }}
        icon={BookPlus}
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
        icon={SquarePen}
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
          mode="edit"
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
                          الكورس المطلوب:{" "}
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
                      <p className="rounded-xl border border-success-line border-s-4 border-s-success-vivid bg-success-soft p-3 text-success">
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
                    className={`rounded-xl border p-3 ${deleteDialog.row.deleteSafety.canDelete ? "bg-muted/40" : "border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft text-danger"}`}
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
