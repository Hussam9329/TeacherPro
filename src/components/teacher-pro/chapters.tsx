"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTeacherStore } from "@/lib/teacher-store";
import {
  BookOpen,
  ChevronDown,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import "./chapters.css";
import { ListToolbar } from "./list-toolbar";
import { RowActionsMenu } from "./row-actions-menu";
import {
  chapterApi,
  courseChapterApi,
  type ChapterCourseLinkOverview,
  type ChapterOverviewResponse,
  type ChapterOpportunityPreview,
  type CourseChapterActionPreview,
} from "@/lib/api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { emitTeacherProActionStatus } from "@/lib/teacherpro-language";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import { toLatinDigits } from "@/lib/format";
import { useActionLock } from "@/hooks/use-action-lock";
import { useLatestRequest } from "@/hooks/use-latest-request";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";

type CourseFilter =
  | "all"
  | "has-active"
  | "no-active"
  | "multiple-active"
  | "needs-repair";
type ChapterFilter = "all" | "active" | "unused" | "deletable" | "protected";
type ChapterRow = ChapterOverviewResponse["chapterRows"][number];
type CourseRow = ChapterOverviewResponse["courseRows"][number];

type EditChapterDialog = {
  open: boolean;
  id: string;
  chName: string;
  opps: number;
  row: ChapterRow | null;
};

type ChapterSyncDialog = {
  open: boolean;
  payload: { name: string; opportunities: number } | null;
  preview: ChapterOpportunityPreview | null;
};

type ActionDialog = {
  open: boolean;
  link: ChapterCourseLinkOverview | null;
  course: CourseRow | null;
  action: "activate" | "deactivate";
};

type SecondChapterTransitionPreview = {
  canExecute: boolean;
  blockers: string[];
  target: {
    courseNames: readonly string[];
    chapterId: string | null;
    chapterName: string;
    willCreateChapter: boolean;
    currentChapterOpportunities: number | null;
    nextChapterOpportunities: number;
  };
  impact: {
    courses: number;
    totalStudents: number;
    activeStudentsToReset: number;
    dismissedPreserved: number;
    archivedPreserved: number;
    balancesToReset: number;
    activeLinksToDeactivate: number;
    externalChapterLinks: number;
  };
  perCourse: Array<{
    courseId: string;
    courseName: string;
    courseCurrentlyActive: boolean;
    students: {
      total: number;
      active: number;
      dismissed: number;
      archived: number;
      otherStatus: number;
      balancesToReset: number;
    };
    activeLinksToDeactivate: number;
    currentActiveChapters: string[];
    targetLinkExists: boolean;
  }>;
  message: string;
  previewToken: string;
  source: "database";
  generatedAt: string;
};

const courseFilterLabels: Record<CourseFilter, string> = {
  all: "كل الدورات",
  "has-active": "لديها فصل نشط",
  "no-active": "بلا فصل نشط",
  "multiple-active": "أكثر من فصل نشط",
  "needs-repair": "تحتاج مراجعة فرص",
};

const chapterFilterLabels: Record<ChapterFilter, string> = {
  all: "كل الفصول",
  active: "مفعلة بدورات",
  unused: "غير مرتبطة",
  deletable: "قابلة للحذف",
  protected: "محمية من الحذف",
};

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase("ar-IQ")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

function statCard(
  label: string,
  value: React.ReactNode,
  hint?: string,
  color = "text-primary",
) {
  return (
    <Card data-count-scope="system">
      <CardContent className="p-4 text-center">
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {hint ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Said once at the top of the page and as a badge, not again per card. */
const NO_ACTIVE_CHAPTER_WARNING = "لا يوجد فصل نشط لهذه الدورة";
function courseReviewWarnings(row: { warnings: string[] }) {
  return row.warnings.filter((warning) => warning !== NO_ACTIVE_CHAPTER_WARNING);
}

function renderBlockers(blockers: string[]) {
  if (!blockers.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {blockers.map((blocker) => (
        <Badge
          key={blocker}
          variant="outline"
          className="border-warning-line bg-warning-soft text-warning"
        >
          {blocker}
        </Badge>
      ))}
    </div>
  );
}

export function ChaptersView() {
  const { loadSectionDataFromServer } = useTeacherStore();
  const syncKey = useTeacherProSyncKey([
    "chapters",
    "courses",
    "students",
    "opportunities",
    "dashboard",
  ]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const beginOverviewRequest = useLatestRequest();
  const overviewLoadedRef = useRef(false);
  const [overview, setOverview] = useState<ChapterOverviewResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [courseFilter, setCourseFilter] = useState<CourseFilter>("all");
  const [chapterFilter, setChapterFilter] = useState<ChapterFilter>("all");
  const [chapterNameInput, setChapterNameInput] = useState("");
  const [opportunities, setOpportunities] = useState(5);
  const [courseId, setCourseId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [operationDialog, setOperationDialog] = useState<
    "create" | "attach" | null
  >(null);
  const [operationDialogOpen, setOperationDialogOpen] = useState(false);
  const operationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [editChapterDialog, setEditChapterDialog] = useState<EditChapterDialog>(
    {
      open: false,
      id: "",
      chName: "",
      opps: 0,
      row: null,
    },
  );
  const [deleteChapterDialog, setDeleteChapterDialog] = useState<{
    open: boolean;
    row: ChapterRow | null;
  }>({ open: false, row: null });
  const [deleteLinkDialog, setDeleteLinkDialog] = useState<{
    open: boolean;
    link: ChapterCourseLinkOverview | null;
    course: CourseRow | null;
  }>({ open: false, link: null, course: null });
  const [actionDialog, setActionDialog] = useState<ActionDialog>({
    open: false,
    link: null,
    course: null,
    action: "activate",
  });
  const [actionPreview, setActionPreview] =
    useState<CourseChapterActionPreview | null>(null);
  const [actionPreviewLoading, setActionPreviewLoading] = useState(false);
  const [actionPreviewError, setActionPreviewError] = useState("");
  const [chapterSyncDialog, setChapterSyncDialog] = useState<ChapterSyncDialog>(
    { open: false, payload: null, preview: null },
  );
  const [transitionDialog, setTransitionDialog] = useState(false);
  const [transitionPreview, setTransitionPreview] =
    useState<SecondChapterTransitionPreview | null>(null);
  const [transitionPreviewLoading, setTransitionPreviewLoading] =
    useState(false);
  const [transitionPreviewError, setTransitionPreviewError] = useState("");
  const resolvedTransitionCourseNames =
    transitionPreview?.target.courseNames.length === 2
      ? transitionPreview.target.courseNames
          .map((name) => `«${name}»`)
          .join(" و")
      : "";

  const { locked: isAddingChapter, runLocked: runAddChapterLocked } =
    useActionLock();
  const { locked: isAttachingChapter, runLocked: runAttachChapterLocked } =
    useActionLock();
  const { locked: isSavingChapter, runLocked: runSaveChapterLocked } =
    useActionLock();
  const {
    locked: isApplyingChapterSync,
    runLocked: runApplyChapterSyncLocked,
  } = useActionLock();
  const { locked: isDeletingChapter, runLocked: runDeleteChapterLocked } =
    useActionLock();
  const { locked: isDeletingLink, runLocked: runDeleteLinkLocked } =
    useActionLock();
  const { locked: isApplyingAction, runLocked: runApplyActionLocked } =
    useActionLock();
  const {
    locked: isApplyingSecondChapterTransition,
    runLocked: runSecondChapterTransitionLocked,
  } = useActionLock();

  const loadOverview = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      const request = beginOverviewRequest();
      const quiet = Boolean(options.quiet || overviewLoadedRef.current);
      if (quiet) setRefreshing(true);
      else setLoading(true);
      try {
        const data = await chapterApi.overview({
          signal: request.signal,
          quietAbort: true,
        });
        if (!request.isLatest()) return;
        if (data) {
          setOverview(data);
          overviewLoadedRef.current = true;
        }
      } finally {
        if (!request.isLatest()) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [beginOverviewRequest],
  );

  useEffect(() => {
    void loadOverview({ quiet: isBackgroundSync() });
  }, [isBackgroundSync, loadOverview, syncKey]);

  const refreshAfterMutation = async (reason: string) => {
    await Promise.all([
      loadOverview({ quiet: true }),
      loadSectionDataFromServer("chapters"),
    ]);
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason,
      scopes: [
        "chapters",
        "courses",
        "students",
        "opportunities",
        "dashboard",
        "logs",
      ],
    });
  };

  const filteredCourses = useMemo(() => {
    const query = normalizeSearch(searchText);
    return (overview?.courseRows || []).filter((row) => {
      const haystack = normalizeSearch(
        [
          row.course.name,
          row.activeLink?.chapter.name || "",
          ...row.links.map((link) => link.chapter.name),
        ].join(" "),
      );
      if (query && !haystack.includes(query)) return false;
      if (courseFilter === "has-active" && row.counts.activeLinks === 0)
        return false;
      if (courseFilter === "no-active" && row.counts.activeLinks !== 0)
        return false;
      if (courseFilter === "multiple-active" && row.counts.activeLinks <= 1)
        return false;
      if (courseFilter === "needs-repair" && courseReviewWarnings(row).length === 0)
        return false;
      return true;
    });
  }, [overview, searchText, courseFilter]);

  // Each course-status button counts what it would show with the search.
  const courseChipCounts = useMemo(() => {
    const query = normalizeSearch(searchText);
    const counts = { all: 0, hasActive: 0, noActive: 0, multiple: 0, review: 0 };
    for (const row of overview?.courseRows || []) {
      const haystack = normalizeSearch(
        [
          row.course.name,
          row.activeLink?.chapter.name || "",
          ...row.links.map((link) => link.chapter.name),
        ].join(" "),
      );
      if (query && !haystack.includes(query)) continue;
      counts.all += 1;
      if (row.counts.activeLinks === 0) counts.noActive += 1;
      else counts.hasActive += 1;
      if (row.counts.activeLinks > 1) counts.multiple += 1;
      if (courseReviewWarnings(row).length > 0) counts.review += 1;
    }
    return counts;
  }, [overview, searchText]);

  const filteredChapters = useMemo(() => {
    const query = normalizeSearch(searchText);
    return (overview?.chapterRows || []).filter((row) => {
      const haystack = normalizeSearch(row.chapter.name);
      if (query && !haystack.includes(query)) return false;
      if (chapterFilter === "active" && row.counts.activeLinks === 0)
        return false;
      if (chapterFilter === "unused" && row.counts.linkedCourses > 0)
        return false;
      if (chapterFilter === "deletable" && !row.deleteSafety.canDelete)
        return false;
      if (chapterFilter === "protected" && row.deleteSafety.canDelete)
        return false;
      return true;
    });
  }, [overview, searchText, chapterFilter]);

  const selectedCourseLinks = useMemo(
    () =>
      new Map(
        (
          overview?.courseRows.find((row) => row.course.id === courseId)
            ?.links || []
        )
          .filter((link) => !link.archived)
          .map((link) => [link.chapterId, link]),
      ),
    [overview, courseId],
  );
  const selectedChapterAlreadyLinked = selectedCourseLinks.has(chapterId);

  const handleAddChapter = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runAddChapterLocked(async () => {
      const name = chapterNameInput.trim();
      if (!name) {
        toast.error("يرجى إدخال اسم الفصل");
        return;
      }
      const result = await chapterApi.add({
        name,
        opportunities: Math.max(0, Number(opportunities) || 0),
      });
      if (!result.ok) {
        toast.error(result.error || "تعذر إضافة الفصل");
        return;
      }
      setChapterNameInput("");
      setOpportunities(5);
      await refreshAfterMutation("إضافة فصل بعد التحقق من الحفظ");
      setOperationDialogOpen(false);
      toast.success("تمت إضافة الفصل");
    })();
  };

  const handleAttachChapter = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!courseId || !chapterId) {
      toast.error("يرجى اختيار اسم الدورة والفصل");
      return;
    }
    if (selectedChapterAlreadyLinked) {
      toast.info(
        "الفصل موجود في الفصول المرتبطة بهذه الدورة. لا يحتاج إلى ربط جديد.",
      );
      return;
    }
    await runAttachChapterLocked(async () => {
      const result = await courseChapterApi.add({ courseId, chapterId });
      if (!result.ok) {
        toast.error(result.error || "تعذر ربط الفصل بالدورة");
        return;
      }
      setChapterId("");
      if ((result.data as { alreadyLinked?: boolean } | null)?.alreadyLinked) {
        await loadOverview({ quiet: true });
        emitTeacherProActionStatus({ status: "idle", label: "" });
        toast.info(
          "الفصل مرتبط بهذه الدورة مسبقاً. تم تحديث قائمة الفصول المرتبطة.",
        );
        return;
      }
      setCourseId("");
      await refreshAfterMutation("ربط فصل بدورة بعد التحقق من الحفظ");
      setOperationDialogOpen(false);
      toast.success("تم ربط الفصل بالدورة");
    })();
  };

  const openEditChapterDialog = (row: ChapterRow) => {
    setEditChapterDialog({
      open: true,
      id: row.id,
      chName: row.chapter.name,
      opps: row.chapter.opportunities,
      row,
    });
  };

  const applyChapterUpdate = async (
    payload: { name: string; opportunities: number },
    syncStudentOpportunities: boolean,
    previewToken: string,
  ) => {
    const result = await chapterApi.update(editChapterDialog.id, {
      ...payload,
      syncStudentOpportunities,
      previewToken,
    });
    if (!result.ok) {
      if (result.status === 409) {
        setChapterSyncDialog({ open: false, payload: null, preview: null });
      }
      toast.error(result.error || "تعذر تعديل الفصل");
      return false;
    }
    const impact = (
      result.data as { opportunityImpact?: { message?: string } } | null
    )?.opportunityImpact;
    setEditChapterDialog({
      open: false,
      id: "",
      chName: "",
      opps: 0,
      row: null,
    });
    setChapterSyncDialog({ open: false, payload: null, preview: null });
    await refreshAfterMutation("تعديل فصل ومزامنة أثر الفرص");
    toast.success(impact?.message || "تم تعديل الفصل");
    return true;
  };

  const handleEditChapterSave = async () => {
    await runSaveChapterLocked(async () => {
      const name = editChapterDialog.chName.trim();
      if (!name) {
        toast.error("يرجى إدخال اسم الفصل");
        return;
      }
      const payload = {
        name,
        opportunities: Math.max(0, Number(editChapterDialog.opps) || 0),
      };
      const previewResult = await chapterApi.previewUpdate(
        editChapterDialog.id,
        payload,
      );
      if (!previewResult.ok) {
        toast.error(previewResult.error || "تعذر معاينة أثر تعديل الفصل");
        return;
      }
      const preview = (
        previewResult.data as { preview?: ChapterOpportunityPreview } | null
      )?.preview;
      if (!preview) {
        toast.error("لم يُرجع النظام معاينة موثوقة، لذلك لم يتم الحفظ.");
        return;
      }
      if (preview?.changed && preview.affectedStudents > 0) {
        setChapterSyncDialog({ open: true, payload, preview });
        return;
      }
      await applyChapterUpdate(payload, false, preview.previewToken);
    })();
  };

  const handleChapterSyncDecision = async (sync: boolean) => {
    await runApplyChapterSyncLocked(async () => {
      if (!chapterSyncDialog.payload) return;
      if (!chapterSyncDialog.preview) return;
      await applyChapterUpdate(
        chapterSyncDialog.payload,
        sync,
        chapterSyncDialog.preview.previewToken,
      );
    })();
  };

  const handleDeleteChapterConfirm = async () => {
    await runDeleteChapterLocked(async () => {
      const row = deleteChapterDialog.row;
      if (!row) return;
      if (!row.deleteSafety.canDelete) {
        toast.error("هذا الفصل محمي من الحذف بسبب روابط أو سجلات لها أثر.");
        return;
      }
      const result = await chapterApi.remove(row.id);
      if (!result.ok) {
        toast.error(result.error || "تعذر حذف الفصل");
        return;
      }
      setDeleteChapterDialog({ open: false, row: null });
      await refreshAfterMutation("حذف فصل آمن");
      toast.success("تم حذف الفصل بعد فحص الأثر");
    })();
  };

  const handleDeleteLinkConfirm = async () => {
    await runDeleteLinkLocked(async () => {
      const link = deleteLinkDialog.link;
      if (!link) return;
      if (!link.deleteSafety.canDelete) {
        toast.error("هذا الربط محمي من الحذف لأنه مفعل أو يحمل أرشيف فرص.");
        return;
      }
      const result = await courseChapterApi.remove(link.id);
      if (!result.ok) {
        toast.error(result.error || "تعذر حذف الربط");
        return;
      }
      setDeleteLinkDialog({ open: false, link: null, course: null });
      await refreshAfterMutation("حذف ربط فصل بدورة آمن");
      toast.success("تم حذف الربط");
    })();
  };

  const openActionDialog = (
    course: CourseRow,
    link: ChapterCourseLinkOverview,
  ) => {
    const action = link.active ? "deactivate" : "activate";
    setActionPreview(null);
    setActionPreviewError("");
    setActionPreviewLoading(true);
    setActionDialog({ open: true, course, link, action });
    void (async () => {
      const result = await courseChapterApi.previewAction(link.id, action);
      if (!result.ok) {
        setActionPreviewError(result.error || "تعذر تحميل معاينة الأثر");
        setActionPreviewLoading(false);
        return;
      }
      const preview =
        (result.data as { preview?: CourseChapterActionPreview } | null)
          ?.preview || null;
      setActionPreview(preview);
      setActionPreviewLoading(false);
    })();
  };

  const handleApplyChapterAction = async () => {
    await runApplyActionLocked(async () => {
      const { link, action } = actionDialog;
      if (!link) return;
      if (!actionPreview?.canExecute) {
        toast.error(
          actionPreview?.blockingMessage ||
            "لا يمكن تنفيذ هذا الإجراء حسب المعاينة الحالية.",
        );
        return;
      }
      const result = await courseChapterApi.activate(link.id, action, {
        confirmImpact: true,
        previewToken: actionPreview.previewToken,
      });
      if (!result.ok) {
        if (result.status === 409) {
          setActionPreview(null);
          setActionPreviewError(
            "تغيرت البيانات بعد المعاينة. أغلق النافذة وافتح الإجراء من جديد لمراجعة الأثر الحالي.",
          );
        }
        toast.error(result.error || "تعذر تنفيذ إجراء الفصل");
        return;
      }
      setActionDialog({
        open: false,
        link: null,
        course: null,
        action: "activate",
      });
      setActionPreview(null);
      setActionPreviewError("");
      await refreshAfterMutation(
        action === "activate" ? "تفعيل فصل آمن" : "إلغاء تفعيل فصل آمن",
      );
      toast.success(
        action === "activate"
          ? "تم تفعيل الفصل وتحديث الفرص بأمان"
          : "تم إلغاء التفعيل وأرشفة الفرص بأمان",
      );
    })();
  };

  const loadSecondChapterTransitionPreview = async () => {
    setTransitionPreview(null);
    setTransitionPreviewError("");
    setTransitionPreviewLoading(true);
    try {
      const response = await fetch(
        "/api/course-chapters/second-chapter-transition",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ previewOnly: true }),
        },
      );
      const payload = await response.json().catch(() => null);
      const preview = (payload?.preview ||
        null) as SecondChapterTransitionPreview | null;
      if (!response.ok || !preview) {
        setTransitionPreviewError(
          payload?.error || "تعذر تحميل معاينة انتقال الدورتين.",
        );
        return;
      }
      setTransitionPreview(preview);
    } catch {
      setTransitionPreviewError("تعذر الاتصال بالنظام لتحميل المعاينة.");
    } finally {
      setTransitionPreviewLoading(false);
    }
  };

  const openSecondChapterTransitionDialog = () => {
    setTransitionDialog(true);
    void loadSecondChapterTransitionPreview();
  };

  const handleSecondChapterTransitionDialogOpenChange = (open: boolean) => {
    if (!open && isApplyingSecondChapterTransition) return;
    setTransitionDialog(open);
    if (!open) {
      setTransitionPreview(null);
      setTransitionPreviewError("");
      setTransitionPreviewLoading(false);
    }
  };

  const handleApplySecondChapterTransition = async () => {
    await runSecondChapterTransitionLocked(async () => {
      if (!transitionPreview?.canExecute || !transitionPreview.previewToken) {
        toast.error(
          transitionPreview?.blockers[0] ||
            "يجب تحميل معاينة صالحة قبل التنفيذ.",
        );
        return;
      }
      try {
        const response = await fetch(
          "/api/course-chapters/second-chapter-transition",
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              confirmImpact: true,
              previewToken: transitionPreview.previewToken,
            }),
          },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 409) {
            setTransitionPreview(null);
            setTransitionPreviewError(
              payload?.error ||
                "تغيرت البيانات بعد المعاينة. حمّل معاينة جديدة.",
            );
          }
          toast.error(payload?.error || "تعذر تنفيذ انتقال الدورتين.");
          return;
        }
        setTransitionDialog(false);
        setTransitionPreview(null);
        setTransitionPreviewError("");
        await refreshAfterMutation("تفعيل الفصل الثاني وإعادة طلاب الدورتين");
        toast.success(payload?.message || "تم انتقال الدورتين بنجاح.");
      } catch {
        setTransitionPreviewError("تعذر الاتصال بالنظام لتنفيذ الانتقال.");
        toast.error("تعذر الاتصال بالنظام لتنفيذ انتقال الدورتين.");
      }
    })();
  };

  const resetFilters = () => {
    setSearchText("");
    setCourseFilter("all");
    setChapterFilter("all");
  };

  const renderLoadingSkeleton = () => (
    <div className="space-y-4" aria-live="polite" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="rounded-3xl border bg-card/80 p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="h-6 w-44 animate-pulse rounded-full bg-muted" />
            <span className="h-8 w-24 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((cell) => (
              <span
                key={cell}
                className="h-20 animate-pulse rounded-2xl bg-muted"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderCourseRow = (row: CourseRow) => (
    <article
      key={row.id}
      className="tp-chapters__row"
      aria-label={row.course.name}
    >
      <div className="tp-chapters__row-header">
        <div className="tp-chapters__identity">
          <h3 className="text-sm font-bold">{row.course.name}</h3>
          <p className="text-xs text-muted-foreground">
            الفصل النشط:{" "}
            {row.activeLink
              ? `${row.activeLink.chapter.name} (${row.activeLink.chapter.opportunities} فرص)`
              : "لا يوجد"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={row.course.active ? "success" : "outline"}>
            {row.course.active ? "نشطة للتسجيل" : "موقوفة عن التسجيل"}
          </Badge>
          {row.counts.activeLinks === 0 ? (
            <Badge
              variant="outline"
              className="border-warning-line bg-warning-soft text-warning"
            >
              بلا فصل نشط
            </Badge>
          ) : null}
          {row.counts.activeLinks > 1 ? (
            <Badge variant="destructive">تعارض: أكثر من فصل نشط</Badge>
          ) : null}
          {courseReviewWarnings(row).length > 0 ? (
            <Badge
              variant="outline"
              className="border-warning-line bg-warning-soft text-warning"
            >
              تحتاج مراجعة
            </Badge>
          ) : null}
        </div>
      </div>
      <dl className="tp-chapters__metrics">
        <div>
          <dt>الطلاب</dt>
          <dd>{row.counts.students}</dd>
        </div>
        <div>
          <dt>نشطون</dt>
          <dd className="text-success">
            {row.counts.activeStudents}
          </dd>
        </div>
        <div>
          <dt>مفصولون</dt>
          <dd className="text-danger">{row.counts.dismissedStudents}</dd>
        </div>
      </dl>
      {courseReviewWarnings(row).length ? (
        <div className="rounded-xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-3 text-xs leading-6 text-warning">
          {courseReviewWarnings(row).map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      <details className="tp-chapters__course-details">
        <summary className="tp-chapters__disclosure">
          <span>الفصول المرتبطة ({row.counts.linkedChapters})</span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </summary>
        <div className="space-y-3 pt-3">
          <dl className="tp-chapters__metrics">
            <div>
              <dt>فصول نشطة</dt>
              <dd>{row.counts.activeLinks}</dd>
            </div>
            <div>
              <dt>مؤرشفون</dt>
              <dd>{row.counts.archivedStudents}</dd>
            </div>
            <div>
              <dt>فرص 0/0</dt>
              <dd>{row.counts.zeroZeroWithActive}</dd>
            </div>
            <div>
              <dt>فوق سقف الفرص</dt>
              <dd>{row.counts.aboveCap}</dd>
            </div>
          </dl>
          {row.links.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              لا يوجد أي فصل مربوط بهذه الدورة.
            </p>
          ) : (
            <div className="tp-chapters__links">
              {row.links.map((link) => (
                <div
                  key={link.id}
                  className="tp-chapters__link"
                  data-active={link.active}
                >
                  <div className="tp-chapters__link-content">
                    <div className="tp-chapters__identity">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-bold">
                          {link.chapter.name}
                        </h4>
                        <Badge variant={link.active ? "success" : "outline"}>
                          {link.active ? "مفعل" : "غير مفعل"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {link.chapter.opportunities} فرص
                        {link.archiveCount > 0
                          ? ` · أرشيف ${link.archiveCount}`
                          : ""}
                      </p>
                    </div>
                    <div className="tp-chapters__actions">
                      <Button
                        size="sm"
                        variant={link.active ? "outline" : "default"}
                        aria-label={`${link.active ? "إلغاء تفعيل" : "تفعيل آمن"} ${link.chapter.name} — ${row.course.name}`}
                        onClick={() => openActionDialog(row, link)}
                      >
                        {link.active ? "إلغاء التفعيل" : "تفعيل آمن"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        aria-label={`حذف ربط ${link.chapter.name} — ${row.course.name}`}
                        onClick={() =>
                          setDeleteLinkDialog({ open: true, link, course: row })
                        }
                        disabled={!link.deleteSafety.canDelete}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        حذف الربط
                      </Button>
                    </div>
                  </div>
                  {link.deleteSafety.blockers.length > 0 ? (
                    <details className="tp-chapters__blockers">
                      <summary>أسباب حماية الربط من الحذف</summary>
                      {renderBlockers(link.deleteSafety.blockers)}
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </article>
  );

  const renderChapterRow = (row: ChapterRow) => (
    <article
      key={row.id}
      className="tp-chapters__row"
      aria-label={row.chapter.name}
    >
      <div className="tp-chapters__row-header">
        <div className="tp-chapters__identity">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold">{row.chapter.name}</h3>
            <Badge variant="secondary">{row.chapter.opportunities} فرص</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            مرتبط بـ {row.counts.linkedCourses} دورة · مفعل بـ{" "}
            {row.counts.activeLinks} · سجلات فرص {row.counts.opportunityLogs}
          </p>
        </div>
        <div className="tp-chapters__actions">
          <Button
            size="sm"
            variant="outline"
            aria-label={`تعديل ${row.chapter.name}`}
            onClick={() => openEditChapterDialog(row)}
          >
            <Pencil className="size-4" aria-hidden="true" />
            تعديل
          </Button>
          <RowActionsMenu
            label={`إجراءات ${row.chapter.name}`}
            actions={[
              {
                key: "delete",
                label: row.deleteSafety.canDelete ? "حذف الفصل…" : "حذف الفصل (محمي)",
                icon: <Trash2 className="size-4" aria-hidden="true" />,
                danger: true,
                disabled: !row.deleteSafety.canDelete,
                onSelect: () => setDeleteChapterDialog({ open: true, row }),
              },
            ]}
          />
        </div>
      </div>
      {row.deleteSafety.blockers.length > 0 ? (
        <details className="tp-chapters__blockers">
          <summary>محمي من الحذف — عرض الأسباب</summary>
          {renderBlockers(row.deleteSafety.blockers)}
        </details>
      ) : null}
    </article>
  );

  const actionCourse = actionDialog.course;
  const actionLink = actionDialog.link;
  const zeroZeroReviewCount = overview?.stats.studentsZeroZeroWithActive ?? "—";

  return (
    <div className="tp-management-page tp-chapters-page tp-list">
      <ListToolbar
        label="البحث والتصفية في الفصول والدورات"
        search={
          <Input
            id="chapter-search"
            aria-label="بحث في الفصول والدورات"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="اسم الدورة أو الفصل"
            autoComplete="off"
          />
        }
        actions={
          <>
            <Button
              onClick={(event) => {
                operationTriggerRef.current = event.currentTarget;
                setOperationDialog("create");
                setOperationDialogOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              إضافة فصل
            </Button>
            <Button
              variant="outline"
              onClick={(event) => {
                operationTriggerRef.current = event.currentTarget;
                setOperationDialog("attach");
                setOperationDialogOpen(true);
              }}
              disabled={loading}
            >
              <Link2 className="size-4" aria-hidden="true" />
              ربط فصل بدورة
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="تحديث"
              title={refreshing ? "جارٍ التحديث..." : "تحديث"}
              onClick={() => void loadOverview()}
              disabled={loading || refreshing}
            >
              <RefreshCw
                className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`}
                aria-hidden="true"
              />
            </Button>
            {searchText || courseFilter !== "all" || chapterFilter !== "all" ? (
              <Button variant="ghost" onClick={resetFilters}>
                تصفير الفلاتر
              </Button>
            ) : null}
          </>
        }
        chips={[
          { key: "all", label: "كل الدورات", count: overview ? courseChipCounts.all : null },
          { key: "has-active", label: courseFilterLabels["has-active"], tone: "success", count: overview ? courseChipCounts.hasActive : null },
          { key: "no-active", label: courseFilterLabels["no-active"], tone: "warning", count: overview ? courseChipCounts.noActive : null },
          ...(courseChipCounts.multiple || courseFilter === "multiple-active"
            ? [{ key: "multiple-active", label: courseFilterLabels["multiple-active"], tone: "danger" as const, count: courseChipCounts.multiple }]
            : []),
          ...(courseChipCounts.review || courseFilter === "needs-repair"
            ? [{ key: "needs-repair", label: courseFilterLabels["needs-repair"], tone: "info" as const, count: courseChipCounts.review }]
            : []),
        ]}
        chipsLabel="حالة الدورات"
        activeChip={courseFilter}
        onChipChange={(value) => setCourseFilter(value as CourseFilter)}
        activeFilterCount={Number(chapterFilter !== "all")}
        onClearFilters={() => setChapterFilter("all")}
        filters={
          <div className="space-y-1.5">
            <Label htmlFor="chapter-status-filter" className="text-xs font-bold">حالة الفصول</Label>
            <Select
              value={chapterFilter}
              onValueChange={(value) =>
                setChapterFilter(value as ChapterFilter)
              }
            >
              <SelectTrigger id="chapter-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(chapterFilterLabels) as ChapterFilter[]).map(
                  (key) => (
                    <SelectItem key={key} value={key}>
                      {chapterFilterLabels[key]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        }
        summary={
          overview ? (
            <span data-count-scope="filtered">
              <b>{filteredChapters.length}</b> من {overview.stats.chapters} فصل ·{" "}
              <b>{filteredCourses.length}</b> من {overview.stats.courses} دورة
              {Number(zeroZeroReviewCount) > 0 ? (
                <span title="مؤشر للمراجعة فقط"> · طلاب 0/0: {zeroZeroReviewCount}</span>
              ) : null}
            </span>
          ) : (
            "…"
          )
        }
      />

      {overview && overview.stats.coursesWithoutActiveChapter > 0 && courseFilter !== "no-active" ? (
        <div className="tp-chapters__banner" role="status">
          <p>
            <b>{overview.stats.coursesWithoutActiveChapter} من {overview.stats.courses}</b> دورات بلا فصل نشط:
            ما تنضاف إلها امتحانات، والطالب الجديد بيها يبدأ بدون فرص.
          </p>
          <Button variant="outline" size="sm" onClick={() => setCourseFilter("no-active")}>
            عرض هذي الدورات
          </Button>
        </div>
      ) : null}

      <section className="tp-chapters__section" aria-labelledby="chapters-library-title">
        <h3 id="chapters-library-title" className="tp-chapters__section-title">
          <BookOpen className="size-4 text-primary" aria-hidden="true" />
          مكتبة الفصول
        </h3>
        {loading ? (
          renderLoadingSkeleton()
        ) : filteredChapters.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            لا توجد فصول مطابقة للفلاتر.
          </p>
        ) : (
          <div className="tp-chapters__list">{filteredChapters.map(renderChapterRow)}</div>
        )}
      </section>

      <section className="tp-chapters__section" aria-labelledby="chapters-courses-title">
        <h3 id="chapters-courses-title" className="tp-chapters__section-title">
          حالة الدورات والفصول
        </h3>
        {loading ? (
          renderLoadingSkeleton()
        ) : filteredCourses.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            لا توجد دورات مطابقة للفلاتر.
          </p>
        ) : (
          <div className="tp-chapters__list">{filteredCourses.map(renderCourseRow)}</div>
        )}
      </section>

      <details className="tp-chapters__maintenance">
        <summary className="tp-chapters__disclosure">
          <span>انتقال الدورة الصيفية ودورة الإعفاء إلى الفصل الثاني</span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </summary>
        <div className="space-y-3 pt-3">
          <p className="text-xs leading-6 text-muted-foreground">
            يوقف الفصل النشط السابق، ويفعّل «الفصل الثاني - الانسجة» بثلاث
            فرص، ويضبط رصيد الطلاب النشطين في الدورتين إلى 3/3. يبقى
            المفصولون والمؤرشفون بحالاتهم وأرصدتهم. إذا لم يكن الفصل موجوداً
            فسينشئه التنفيذ بثلاث فرص. لا تشمل العملية «الدورة الصيفية
            الثانية».
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openSecondChapterTransitionDialog}
            disabled={isApplyingSecondChapterTransition}
          >
            معاينة انتقال الدورتين
          </Button>
        </div>
      </details>

      <Dialog
        open={operationDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isAddingChapter && !isAttachingChapter)
            setOperationDialogOpen(false);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            operationTriggerRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {operationDialog === "create" ? "إضافة فصل" : "ربط فصل بدورة"}
            </DialogTitle>
          </DialogHeader>
          {operationDialog === "create" ? (
            <form
              id="chapter-create-form"
              onSubmit={handleAddChapter}
              className="tp-chapters__form-body tp-validation-form"
            >
              <div className="space-y-2">
                <Label htmlFor="chapter-name">اسم الفصل</Label>
                <Input
                  id="chapter-name"
                  value={chapterNameInput}
                  onChange={(event) => setChapterNameInput(event.target.value)}
                  placeholder="مثلاً: الفصل الأول"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chapter-opps">عدد الفرص</Label>
                <Input
                  id="chapter-opps"
                  type="number"
                  min={0}
                  value={opportunities}
                  onChange={(event) =>
                    setOpportunities(
                      Math.max(
                        0,
                        Number(toLatinDigits(event.target.value)) || 0,
                      ),
                    )
                  }
                />
              </div>
            </form>
          ) : (
            <form
              id="chapter-attach-form"
              onSubmit={handleAttachChapter}
              className="tp-chapters__form-body tp-validation-form"
            >
              <div className="space-y-2">
                <Label htmlFor="attach-course">اسم الدورة</Label>
                <Select
                  value={courseId}
                  onValueChange={(value) => {
                    setCourseId(value);
                    setChapterId("");
                  }}
                  disabled={isAttachingChapter || loading}
                >
                  <SelectTrigger id="attach-course">
                    <SelectValue placeholder="اختر اسم الدورة" />
                  </SelectTrigger>
                  <SelectContent>
                    {(overview?.courseRows || []).map((row) => (
                      <SelectItem key={row.course.id} value={row.course.id}>
                        {row.course.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="attach-chapter">الفصل</Label>
                <Select
                  value={chapterId}
                  onValueChange={setChapterId}
                  disabled={!courseId || isAttachingChapter || loading}
                >
                  <SelectTrigger id="attach-chapter">
                    <SelectValue
                      placeholder={
                        courseId ? "اختر الفصل" : "اختر اسم الدورة أولاً"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(overview?.chapterRows || []).map((row) => {
                      const existingLink = selectedCourseLinks.get(
                        row.chapter.id,
                      );
                      return (
                        <SelectItem
                          key={row.chapter.id}
                          value={row.chapter.id}
                          disabled={Boolean(existingLink)}
                        >
                          {row.chapter.name} - {row.chapter.opportunities} فرص
                          {existingLink
                            ? existingLink.active
                              ? " — مرتبط ومفعّل"
                              : " — مرتبط"
                            : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              {selectedCourseLinks.size > 0 && (
                <p
                  className="text-xs leading-6 text-muted-foreground"
                  role="status"
                >
                  الفصول المعلّمة «مرتبط» موجودة ضمن الفصول المرتبطة بالدورة.
                  لتفعيل فصل مرتبط وغير مفعّل، استخدم زر «تفعيل آمن» من بطاقته.
                </p>
              )}
            </form>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isAddingChapter || isAttachingChapter}
              onClick={() => setOperationDialogOpen(false)}
            >
              إلغاء
            </Button>
            {operationDialog === "create" ? (
              <Button
                type="submit"
                disabled={isAddingChapter}
                form="chapter-create-form"
              >
                {isAddingChapter ? "جاري الإضافة..." : "إضافة فصل"}
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={
                  isAttachingChapter ||
                  loading ||
                  !courseId ||
                  !chapterId ||
                  selectedChapterAlreadyLinked
                }
                form="chapter-attach-form"
              >
                {isAttachingChapter ? "جاري الربط..." : "ربط الفصل بالدورة"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editChapterDialog.open}
        onOpenChange={(open) =>
          setEditChapterDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل الفصل</DialogTitle>
            <DialogDescription>
              إذا كان الفصل مرتبطاً بدورات، راجع الأثر الظاهر قبل تغيير عدد
              الفرص.
            </DialogDescription>
          </DialogHeader>
          {editChapterDialog.row ? (
            <div className="rounded-xl border bg-muted/25 p-3 text-xs text-muted-foreground">
              مرتبط بـ {editChapterDialog.row.counts.linkedCourses} دورة · مفعل
              بـ {editChapterDialog.row.counts.activeLinks} · سجلات فرص{" "}
              {editChapterDialog.row.counts.opportunityLogs}
            </div>
          ) : null}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="edit-chapter-name">اسم الفصل</Label>
              <Input
                id="edit-chapter-name"
                value={editChapterDialog.chName}
                onChange={(event) =>
                  setEditChapterDialog((prev) => ({
                    ...prev,
                    chName: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-chapter-opportunities">عدد الفرص</Label>
              <Input
                id="edit-chapter-opportunities"
                type="number"
                min={0}
                value={editChapterDialog.opps}
                onChange={(event) =>
                  setEditChapterDialog((prev) => ({
                    ...prev,
                    opps: Math.max(
                      0,
                      Number(toLatinDigits(event.target.value)) || 0,
                    ),
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setEditChapterDialog({
                  open: false,
                  id: "",
                  chName: "",
                  opps: 0,
                  row: null,
                })
              }
            >
              إلغاء
            </Button>
            <Button onClick={handleEditChapterSave} disabled={isSavingChapter}>
              {isSavingChapter ? "جاري الحفظ..." : "حفظ التعديلات"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={chapterSyncDialog.open}
        onOpenChange={(open) => {
          if (!open)
            setChapterSyncDialog({ open: false, payload: null, preview: null });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>معاينة أثر تغيير فرص الفصل</DialogTitle>
            <DialogDescription>
              عدد الفرص تغيّر، لذلك يجب اختيار هل تحفظ الفصل فقط أم تزامن أرصدة
              الطلاب فوراً من القواعد الحالية.
            </DialogDescription>
          </DialogHeader>
          {chapterSyncDialog.preview ? (
            <div className="space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                {statCard(
                  "السقف القديم",
                  chapterSyncDialog.preview.previousOpportunities,
                )}
                {statCard(
                  "السقف الجديد",
                  chapterSyncDialog.preview.nextOpportunities,
                )}
                {statCard(
                  "طلاب متأثرون",
                  chapterSyncDialog.preview.affectedStudents,
                )}
                {statCard(
                  "فوق السقف الجديد",
                  chapterSyncDialog.preview.currentlyAboveNewCap,
                )}
              </div>
              <p className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-6 text-muted-foreground">
                الفصل مفعل في {chapterSyncDialog.preview.activeCourses} دورة.
                المزامنة تعيد بناء baseOpportunities من الفصل الحقيقي ثم تعيد
                احتساب الخصومات والنجاح من السجلات، لذلك لا تمسح الخصومات
                الصحيحة ولا تعيدها عشوائياً. المؤرشفون (
                {chapterSyncDialog.preview.skippedArchived}) لا يتغيرون.
              </p>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={() => void handleChapterSyncDecision(false)}
              disabled={isApplyingChapterSync}
            >
              حفظ الفصل فقط
            </Button>
            <Button
              onClick={() => void handleChapterSyncDecision(true)}
              disabled={isApplyingChapterSync}
            >
              {isApplyingChapterSync
                ? "جاري التنفيذ..."
                : "حفظ ومزامنة الطلاب الآن"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={transitionDialog}
        onOpenChange={handleSecondChapterTransitionDialogOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {resolvedTransitionCourseNames
                ? `تفعيل الفصل الثاني لـ ${resolvedTransitionCourseNames} بثلاث فرص`
                : "تفعيل الفصل الثاني للدورتين بثلاث فرص"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {resolvedTransitionCourseNames
                ? `العملية محصورة بالدورتين الفعليتين ${resolvedTransitionCourseNames}. لا تشمل «الدورة الصيفية الثانية». ستوقف الفصل السابق، ثم تستخدم الفصل الثاني - الانسجة أو تنشئه إذا كان غير موجود، وتضبط أرصدة طلابهما النشطين إلى 3/3 مع إبقاء المفصولين والمؤرشفين بحالاتهم وأرصدتهم.`
                : "تعرض المعاينة الدورتين والفصل المستهدف والطلاب المتأثرين. لا تشمل العملية «الدورة الصيفية الثانية»."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {transitionPreviewLoading ? (
            <p className="rounded-2xl border bg-muted/25 p-4 text-sm text-muted-foreground">
              جاري تحميل المعاينة...
            </p>
          ) : transitionPreviewError ? (
            <div className="space-y-3 rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-4 text-sm text-danger">
              <p>{transitionPreviewError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadSecondChapterTransitionPreview()}
                disabled={isApplyingSecondChapterTransition}
              >
                تحميل معاينة جديدة
              </Button>
            </div>
          ) : transitionPreview ? (
            <div className="space-y-3 text-sm">
              <p className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs font-bold leading-6">
                {transitionPreview.target.willCreateChapter
                  ? `الفصل «${transitionPreview.target.chapterName}» غير موجود حالياً؛ سيُنشأ بثلاث فرص عند التأكيد.`
                  : `سيُستخدم الفصل الموجود «${transitionPreview.target.chapterName}» وتُضبط فرصه من ${transitionPreview.target.currentChapterOpportunities ?? "—"} إلى ${transitionPreview.target.nextChapterOpportunities}.`}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {statCard("كل الطلاب", transitionPreview.impact.totalStudents)}
                {statCard(
                  "نشطون سيُعاد ضبط رصيدهم",
                  transitionPreview.impact.activeStudentsToReset,
                )}
                {statCard(
                  "مفصولون يبقون مفصولين",
                  transitionPreview.impact.dismissedPreserved,
                )}
                {statCard(
                  "مؤرشفون يبقون مؤرشفين",
                  transitionPreview.impact.archivedPreserved,
                )}
              </div>
              {transitionPreview.perCourse.map((course) => (
                <div
                  key={course.courseId}
                  className="rounded-xl border bg-muted/20 p-3 text-xs leading-6"
                >
                  <b>{course.courseName}</b>: {course.students.total} طالب — نشط{" "}
                  {course.students.active}، مفصول {course.students.dismissed}،
                  مؤرشف {course.students.archived}. الفصل النشط حالياً:{" "}
                  {course.currentActiveChapters.join("، ") || "لا يوجد"}.
                </div>
              ))}
              <p className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-6 text-muted-foreground">
                {transitionPreview.message}
              </p>
              {transitionPreview.blockers.length > 0 ? (
                <div className="rounded-xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-xs leading-6 text-danger">
                  {transitionPreview.blockers.map((blocker) => (
                    <p key={blocker}>{blocker}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isApplyingSecondChapterTransition}>
              إلغاء
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={() => void handleApplySecondChapterTransition()}
              disabled={
                isApplyingSecondChapterTransition ||
                transitionPreviewLoading ||
                Boolean(transitionPreviewError) ||
                !transitionPreview?.canExecute
              }
            >
              {isApplyingSecondChapterTransition
                ? "جاري التنفيذ..."
                : "تنفيذ الانتقال الآن"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteChapterDialog.open}
        onOpenChange={(open) =>
          setDeleteChapterDialog((prev) => ({ ...prev, open }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الفصل</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteChapterDialog.row?.deleteSafety.canDelete
                ? "هذا الفصل لا يحمل روابط أو سجلات أثر، ويمكن حذفه بأمان."
                : "هذا الفصل محمي من الحذف لأن له أثراً على النظام."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteChapterDialog.row
            ? renderBlockers(deleteChapterDialog.row.deleteSafety.blockers)
            : null}
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteChapterConfirm}
              disabled={
                isDeletingChapter ||
                !deleteChapterDialog.row?.deleteSafety.canDelete
              }
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteLinkDialog.open}
        onOpenChange={(open) =>
          setDeleteLinkDialog((prev) => ({ ...prev, open }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف ربط الفصل بالدورة</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteLinkDialog.link?.deleteSafety.canDelete
                ? "الربط غير مفعل ولا يحمل أرشيف فرص، ويمكن حذفه بأمان."
                : "هذا الربط محمي من الحذف لأنه مفعل أو يحتوي أرشيف فرص."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm font-bold">
            {deleteLinkDialog.course?.course.name} /{" "}
            {deleteLinkDialog.link?.chapter.name}
          </p>
          {deleteLinkDialog.link
            ? renderBlockers(deleteLinkDialog.link.deleteSafety.blockers)
            : null}
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteLinkConfirm}
              disabled={
                isDeletingLink || !deleteLinkDialog.link?.deleteSafety.canDelete
              }
            >
              حذف الربط
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={actionDialog.open}
        onOpenChange={(open) => {
          setActionDialog((prev) => ({ ...prev, open }));
          if (!open) {
            setActionPreview(null);
            setActionPreviewError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog.action === "activate"
                ? "تفعيل فصل بأمان"
                : "إلغاء تفعيل الفصل"}
            </DialogTitle>
            <DialogDescription>
              سيتم أرشفة الفرص أو استرجاعها حسب الإجراء المختار.
            </DialogDescription>
          </DialogHeader>
          {actionCourse && actionLink ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-2xl border bg-muted/25 p-3">
                <p className="font-black">{actionCourse.course.name}</p>
                <p className="text-muted-foreground">
                  {actionLink.chapter.name} - {actionLink.chapter.opportunities}{" "}
                  فرص
                </p>
              </div>
              {actionPreviewLoading ? (
                <p className="rounded-xl border bg-muted/25 p-3 text-xs text-muted-foreground">
                  جاري تحميل معاينة الأثر...
                </p>
              ) : actionPreviewError ? (
                <p className="rounded-xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-xs text-danger">
                  {actionPreviewError}
                </p>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {statCard(
                      "طلاب نشطون",
                      actionPreview?.impact.activeStudents ??
                        actionCourse.counts.activeStudents,
                    )}
                    {statCard(
                      "مفصولون",
                      actionPreview?.impact.dismissedStudents ??
                        actionCourse.counts.dismissedStudents,
                      "محسوبون ضمن الأثر",
                    )}
                    {statCard(
                      "مؤرشفون",
                      actionPreview?.impact.archivedStudents ??
                        actionCourse.counts.archivedStudents,
                      "لا يتأثرون",
                    )}
                    {statCard(
                      actionDialog.action === "deactivate"
                        ? "أرصدة ستصفر"
                        : "فصول أخرى ستتعطل",
                      actionDialog.action === "deactivate"
                        ? (actionPreview?.impact.balancesThatWillBeZeroed ??
                            actionCourse.counts.activeStudents)
                        : (actionPreview?.impact.otherActiveLinksToDisable ??
                            0),
                    )}
                  </div>
                  {actionPreview?.blockingMessage ? (
                    <p className="rounded-xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-xs leading-6 text-danger">
                      {actionPreview.blockingMessage}
                    </p>
                  ) : null}
                  <p
                    className={`rounded-xl border p-3 text-xs leading-6 ${actionDialog.action === "activate" ? "border-primary/20 bg-primary/5 text-muted-foreground" : "border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft text-warning"}`}
                  >
                    {actionPreview?.message ||
                      (actionDialog.action === "activate"
                        ? "سيتم تعطيل أي فصل نشط آخر لنفس الدورة، ثم تفعيل هذا الفصل وتحديث فرص الطلاب."
                        : "سيتم أرشفة فرص الطلاب غير المؤرشفين ثم تصفير فرص الدورة لأنها ستصبح بلا فصل نشط.")}
                  </p>
                </>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setActionDialog({
                  open: false,
                  link: null,
                  course: null,
                  action: "activate",
                })
              }
            >
              إلغاء
            </Button>
            <Button
              onClick={handleApplyChapterAction}
              disabled={
                isApplyingAction ||
                actionPreviewLoading ||
                Boolean(actionPreviewError) ||
                !actionPreview?.canExecute
              }
            >
              {isApplyingAction ? "جاري التنفيذ..." : "تنفيذ بعد معاينة الأثر"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
